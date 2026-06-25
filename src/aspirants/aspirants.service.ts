import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Inject,
  forwardRef,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, In, DataSource, EntityManager } from "typeorm";
import { Aspirant } from "./aspirant.entity";
import { CreateAspirantDto } from "./dto/create-aspirant.dto";
import { UsersService } from "../users/users.service";
import { WardsService } from "../wards/wards.service";
import { AspirantMeeting } from "./aspirant-meeting.entity";
import { AspirantBooking } from "./aspirant-booking.entity";
import { AspirantVisit } from "./aspirant-visit.entity";
import { VisitResponse } from "./visit-response.entity";
import { MeetingResponse } from "./meeting-response.entity";
import { VotesService } from "../votes/votes.service";
import { ElectionsService } from "../elections/elections.service";
import { ActivityRating } from "./activity-rating.entity";
import { UserAspirantInteraction } from "../users/user-aspirant-interaction.entity";
import { UpdateAspirantDto } from "./dto/update-aspirant.dto";
import { User } from "../users/user.entity";
import { NotificationsService } from "../notifications/notifications.service";
import { ElectionType } from "../elections/election.entity";

interface ResponseCounts {
  attending: number;
  notAttending: number;
}

@Injectable()
export class AspirantsService {
  constructor(
    @InjectRepository(Aspirant) private readonly repo: Repository<Aspirant>,
    @InjectRepository(AspirantMeeting)
    private readonly meetingRepo: Repository<AspirantMeeting>,
    @InjectRepository(AspirantBooking)
    private readonly bookingRepo: Repository<AspirantBooking>,
    @InjectRepository(AspirantVisit)
    private readonly visitRepo: Repository<AspirantVisit>,
    @InjectRepository(VisitResponse)
    private readonly visitResponseRepo: Repository<VisitResponse>,
    @InjectRepository(MeetingResponse)
    private readonly meetingResponseRepo: Repository<MeetingResponse>,
    @InjectRepository(ActivityRating)
    private readonly activityRatingRepo: Repository<ActivityRating>,
    @InjectRepository(UserAspirantInteraction)
    private readonly interactionRepo: Repository<UserAspirantInteraction>,
    private readonly usersService: UsersService,
    private readonly wardsService: WardsService,
    private readonly electionsService: ElectionsService,
    private readonly notificationsService: NotificationsService,
    @Inject(forwardRef(() => VotesService))
    private readonly votesService: VotesService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Resolve the election type and human-friendly constituency name for an
   * aspirant so notifications can be addressed in the right "namespace".
   * Returns null when the aspirant has no election/constituency configured.
   */
  private async resolveConstituencyContext(
    aspirant: Aspirant,
  ): Promise<{ electionType: ElectionType; constituencyName: string | null } | null> {
    if (!aspirant.electionId || !aspirant.constituencyId) return null;
    const election = await this.electionsService.findById(aspirant.electionId);
    const electionMap = new Map([
      [election.id, { id: election.id, name: election.name, type: election.type }],
    ]);
    const lookup = await this.resolveConstituencyNames(
      [{ electionId: aspirant.electionId, constituencyId: aspirant.constituencyId }],
      electionMap,
    );
    return {
      electionType: election.type as ElectionType,
      constituencyName:
        lookup.get(`${aspirant.electionId}:${aspirant.constituencyId}`) ?? null,
    };
  }

  /** Aggregated meeting response counts by meeting id, in one query. */
  private async getMeetingResponseCounts(
    meetingIds: number[],
    manager?: EntityManager,
  ): Promise<Map<number, ResponseCounts>> {
    const map = new Map<number, ResponseCounts>();
    if (!meetingIds.length) return map;
    const responseRepo = manager
      ? manager.getRepository(MeetingResponse)
      : this.meetingResponseRepo;
    const rows = await responseRepo
      .createQueryBuilder("r")
      .select("r.meetingId", "meetingId")
      .addSelect(
        "SUM(CASE WHEN r.attending THEN 1 ELSE 0 END)::int",
        "attending",
      )
      .addSelect(
        "SUM(CASE WHEN r.attending = false THEN 1 ELSE 0 END)::int",
        "notAttending",
      )
      .where("r.meetingId IN (:...ids)", { ids: meetingIds })
      .groupBy("r.meetingId")
      .getRawMany();
    for (const r of rows) {
      map.set(Number(r.meetingId), {
        attending: Number(r.attending) || 0,
        notAttending: Number(r.notAttending) || 0,
      });
    }
    return map;
  }

  /** Aggregated visit response counts by visit id, in one query. */
  private async getVisitResponseCounts(
    visitIds: number[],
  ): Promise<Map<number, ResponseCounts>> {
    const map = new Map<number, ResponseCounts>();
    if (!visitIds.length) return map;
    const rows = await this.visitResponseRepo
      .createQueryBuilder("r")
      .select("r.visitId", "visitId")
      .addSelect(
        "SUM(CASE WHEN r.attending THEN 1 ELSE 0 END)::int",
        "attending",
      )
      .addSelect(
        "SUM(CASE WHEN r.attending = false THEN 1 ELSE 0 END)::int",
        "notAttending",
      )
      .where("r.visitId IN (:...ids)", { ids: visitIds })
      .groupBy("r.visitId")
      .getRawMany();
    for (const r of rows) {
      map.set(Number(r.visitId), {
        attending: Number(r.attending) || 0,
        notAttending: Number(r.notAttending) || 0,
      });
    }
    return map;
  }

  /**
   * Bulk-resolve constituency display names for a set of aspirants in one
   * query per election type, then return a Map keyed by `${electionId}:${constituencyId}`.
   */
  private async resolveConstituencyNames(
    aspirants: Array<{ electionId?: number; constituencyId?: number }>,
    electionMap: Map<number, { id: number; name: string; type: string }>,
  ): Promise<Map<string, string>> {
    const buckets: Record<string, number[]> = {
      lok_sabha: [],
      state_assembly: [],
      municipal_corporation: [],
      gram_panchayat: [],
    };
    for (const a of aspirants) {
      if (!a.electionId || !a.constituencyId) continue;
      const t = electionMap.get(a.electionId)?.type;
      if (t && buckets[t]) buckets[t].push(a.constituencyId);
    }

    const dedupe = (arr: number[]) => Array.from(new Set(arr));

    const [parls, asms, wards, gps] = await Promise.all([
      buckets.lok_sabha.length
        ? this.repo.manager
            .createQueryBuilder()
            .select(["pc.id AS id", "pc.name AS name"])
            .from("parliamentary_constituencies", "pc")
            .where("pc.id IN (:...ids)", { ids: dedupe(buckets.lok_sabha) })
            .getRawMany()
        : Promise.resolve([] as any[]),
      buckets.state_assembly.length
        ? this.repo.manager
            .createQueryBuilder()
            .select(["ac.id AS id", "ac.name AS name"])
            .from("assembly_constituencies", "ac")
            .where("ac.id IN (:...ids)", { ids: dedupe(buckets.state_assembly) })
            .getRawMany()
        : Promise.resolve([] as any[]),
      buckets.municipal_corporation.length
        ? this.repo.manager
            .createQueryBuilder()
            .select(["w.id AS id", "w.name AS name"])
            .from("wards", "w")
            .where("w.id IN (:...ids)", {
              ids: dedupe(buckets.municipal_corporation),
            })
            .getRawMany()
        : Promise.resolve([] as any[]),
      buckets.gram_panchayat.length
        ? this.repo.manager
            .createQueryBuilder()
            .select([
              'gp."Sr.No" AS id',
              'gp."Village Name" AS "villageName"',
            ])
            .from("grama_panchayat", "gp")
            .where('gp."Sr.No" IN (:...ids)', {
              ids: dedupe(buckets.gram_panchayat),
            })
            .getRawMany()
        : Promise.resolve([] as any[]),
    ]);

    const lookup = new Map<string, string>();
    const electionsByType = new Map<string, number[]>();
    for (const [eid, e] of electionMap)
      electionsByType.set(
        e.type,
        (electionsByType.get(e.type) ?? []).concat(eid),
      );

    const fillForType = (type: string, rows: any[], nameKey = "name") => {
      const electionIds = electionsByType.get(type) ?? [];
      for (const r of rows) {
        for (const eid of electionIds) {
          lookup.set(`${eid}:${r.id}`, r[nameKey]);
        }
      }
    };

    fillForType("lok_sabha", parls);
    fillForType("state_assembly", asms);
    fillForType("municipal_corporation", wards);
    fillForType("gram_panchayat", gps, "villageName");

    return lookup;
  }

  async register(dto: CreateAspirantDto, user?: any) {
    if (!user?.id) throw new BadRequestException("Authentication required");

    // Validate phone uniqueness
    if (dto.phone) {
      const phoneOwner = await this.usersService.findByPhone(dto.phone);
      if (phoneOwner && phoneOwner.id !== user.id) {
        throw new BadRequestException("Phone already in use");
      }
    }

    // Validate whatsapp number uniqueness
    if (dto.whatsappNumber) {
      const existing = await this.repo.findOne({
        where: { whatsappNumber: dto.whatsappNumber },
      });
      if (existing && existing.userId !== user.id) {
        throw new BadRequestException("WhatsApp number already in use");
      }
    }

    // Prevent duplicate active aspirant
    const existing = await this.findByUserId(user.id);
    if (existing?.isActive) {
      throw new BadRequestException(
        "User already has an active aspirant profile",
      );
    }

    return this.create(dto, user);
  }

  private async create(dto: CreateAspirantDto, user?: any) {
    // Resolve election and set wardId for municipal_corporation
    const election = await this.electionsService.findById(dto.electionId);
    let wardId: number | null = null;
    if (election.type === "municipal_corporation") {
      const ward = await this.wardsService.findOne(dto.constituencyId);
      if (!ward)
        throw new NotFoundException(
          `Ward with id ${dto.constituencyId} not found`,
        );
      wardId = ward.id;
    }

    // Gender fallback: the JWT-derived `user` doesn't carry the user's stored
    // gender, so when the DTO omits it we look the value up from the DB.
    let fallbackGender: string | undefined;
    if (!dto.gender && user?.id) {
      const stored = await this.usersService.findById(user.id);
      fallbackGender = stored?.gender;
    }

    // Build entity data
    const entityData = {
      name: dto.name,
      party: dto.party,
      age: dto.age,
      education: dto.education,
      occupation: dto.occupation,
      gender: dto.gender || fallbackGender,
      phone: dto.phone,
      address: dto.address,
      manifesto: dto.manifesto,
      identityBackground: dto.identityBackground,
      resignationPledge: dto.resignationPledge,
      financialIntegrity: dto.financialIntegrity,
      noHighCommand: dto.noHighCommand,
      technicalCompetence: dto.technicalCompetence,
      transparency: dto.transparency,
      emergencyProtocol: dto.emergencyProtocol,
      expertConsultation: dto.expertConsultation,
      voterFeedback: dto.voterFeedback,
      primaryRule: dto.primaryRule,
      instagramLink: dto.instagramLink,
      facebookLink: dto.facebookLink,
      linkedinLink: dto.linkedinLink,
      twitterLink: dto.twitterLink,
      whatsappNumber: dto.whatsappNumber,
      electionId: dto.electionId,
      constituencyId: dto.constituencyId,
      wardId,
      userId: undefined as number | undefined,
      sopAgreed: dto.sopAgreed === true,
      sopAgreedAt: (dto.sopAgreed === true ? new Date() : null) as Date | null,
      // SOP file path is deprecated — mark the legacy status as verified
      // when agreement is given so admin views don't show "pending".
      sopStatus: (dto.sopAgreed === true ? "verified" : "pending") as
        | "pending"
        | "verified"
        | "rejected",
    };

    // Validate phone uniqueness before any writes
    if (dto.phone && user?.id) {
      const phoneOwner = await this.usersService.findByPhone(dto.phone);
      if (phoneOwner && phoneOwner.id !== user.id) {
        throw new BadRequestException("Phone already in use");
      }
    }

    if (dto.whatsappNumber && user?.id) {
      const existing = await this.repo.findOne({
        where: { whatsappNumber: dto.whatsappNumber },
      });
      if (existing && existing.userId !== user.id) {
        throw new BadRequestException("WhatsApp number already in use");
      }
    }

    // Existence check (read) stays BEFORE the transaction so the duplicate
    // "User already has an aspirant" rejection throws exactly as before, with
    // no transaction opened.
    let existing: Aspirant | null = null;
    if (user && user.id) {
      existing = await this.findByUserId(user.id);
      if (existing?.isActive) {
        throw new BadRequestException("User already has an aspirant");
      }
    }

    // From here on everything is a write — wrap atomically so the aspirant
    // row, the user's role/profile, and the constituency sync commit or roll
    // back together. All writes are threaded through `manager`.
    return this.dataSource.transaction(async (manager) => {
      const aspirantRepo = manager.getRepository(Aspirant);

      // Set userId if user exists
      if (user && user.id) {
        if (existing) {
          // Reactivate withdrawn aspirant by overwriting with new data
          await aspirantRepo.update(existing.id, {
            ...entityData,
            isActive: true,
          });
          await this.usersService.setRole(user.id, "aspirant", manager);
          const userToUpdate = await this.usersService.findById(
            user.id,
            manager,
          );
          if (userToUpdate) {
            await this.usersService.updateUser(
              user.id,
              {
                phone: dto.phone ?? userToUpdate.phone,
                age: dto.age ?? userToUpdate.age,
                gender: dto.gender ?? userToUpdate.gender,
              },
              manager,
            );
          }
          const updated = await aspirantRepo.findOne({
            where: { id: existing.id },
          });
          if (updated) {
            await this.syncUserSavedConstituency(updated, manager);
            // No new-aspirant notification yet — that fires when documents
            // complete (sop + selfie uploaded), in MediaService.
          }
          return { ...updated, documentStatus: updated!.getDocumentStatus() };
        }
        entityData.userId = user.id;
      }

      const aspirant = aspirantRepo.create(entityData);
      await aspirantRepo.save(aspirant);

      if (user && user.id) {
        await this.usersService.setRole(user.id, "aspirant", manager);

        // Update user profile with aspirant details
        const userToUpdate = await this.usersService.findById(user.id, manager);
        if (userToUpdate) {
          if (dto.phone) userToUpdate.phone = dto.phone;
          if (dto.age !== undefined) userToUpdate.age = dto.age;
          if (dto.gender) userToUpdate.gender = dto.gender;
          await this.usersService.updateUser(
            user.id,
            {
              phone: userToUpdate.phone,
              age: userToUpdate.age,
              gender: userToUpdate.gender,
            },
            manager,
          );
        }
      }

      await this.syncUserSavedConstituency(aspirant, manager);
      // No new-aspirant notification at registration — it fires when the
      // aspirant first completes their required documents
      // (hasAllRequiredDocuments → true), dispatched from MediaService.

      // Include documentStatus in response
      return {
        ...aspirant,
        documentStatus: aspirant.getDocumentStatus(),
      };
    });
  }

  /**
   * Public entry point — call this from MediaService once an aspirant has
   * uploaded the required documents (sop + selfie). Best-effort: failures
   * here must never block the upload flow.
   */
  async dispatchNewAspirantNotification(aspirant: Aspirant) {
    try {
      const ctx = await this.resolveConstituencyContext(aspirant);
      if (!ctx) return;
      await this.notificationsService.notifyNewAspirant(aspirant, ctx);
    } catch {
      /* best-effort */
    }
  }

  /**
   * Sync the aspirant's constituency onto the user's saved constituency
   * field that matches the election type (e.g. an aspirant registered
   * for a municipal corporation ward gets their
   * `municipalCorporationConstituencyId` filled in). Keeps the
   * /auth/me payload and notification fan-out consistent without the
   * user having to set it manually.
   */
  private async syncUserSavedConstituency(
    aspirant: Aspirant,
    manager?: EntityManager,
  ) {
    if (!aspirant.userId || !aspirant.electionId || !aspirant.constituencyId) {
      return;
    }
    try {
      const election = await this.electionsService.findById(aspirant.electionId);
      const patch: Record<string, number> = {};
      switch (election.type) {
        case "lok_sabha":
          patch.lokSabhaConstituencyId = aspirant.constituencyId;
          break;
        case "state_assembly":
          patch.stateAssemblyConstituencyId = aspirant.constituencyId;
          break;
        case "municipal_corporation":
          patch.municipalCorporationConstituencyId = aspirant.constituencyId;
          break;
        case "gram_panchayat":
          patch.gramPanchayatConstituencyId = aspirant.constituencyId;
          break;
        default:
          return;
      }
      if (manager) {
        // Inside a transaction: write through the transaction's manager so
        // the constituency sync commits/rolls back atomically with the
        // aspirant + user writes. updateConstituencies (which uses its own
        // repo) would otherwise run outside this transaction.
        const userRepo = manager.getRepository(User);
        const user = await userRepo.findOne({
          where: { id: aspirant.userId },
        });
        if (!user) return;
        Object.assign(user, patch);
        await userRepo.save(user);
      } else {
        await this.usersService.updateConstituencies(aspirant.userId, patch);
      }
    } catch {
      /* best-effort */
    }
  }

  private async dispatchMeetingNotifications(
    aspirantIds: number[],
    meetingsByAspirant: Map<number, AspirantMeeting>,
  ) {
    if (!aspirantIds.length) return;
    const aspirants = await this.repo.find({
      where: { id: In(aspirantIds) },
    });
    for (const aspirant of aspirants) {
      const meeting = meetingsByAspirant.get(aspirant.id);
      if (!meeting) continue;
      try {
        const ctx = await this.resolveConstituencyContext(aspirant);
        if (!ctx) continue;
        await this.notificationsService.notifyAspirantMeeting(
          aspirant,
          meeting,
          ctx,
        );
      } catch {
        /* best-effort */
      }
    }
  }

  /** Ensure the caller owns the aspirant profile (admins bypass). Returns the aspirant. */
  private async assertOwnsAspirant(
    aspirantId: number,
    user: { id?: number; role?: string },
  ): Promise<Aspirant> {
    const aspirant = await this.repo.findOne({ where: { id: aspirantId } });
    if (!aspirant) throw new NotFoundException("Aspirant not found");
    if (user?.role !== "admin" && aspirant.userId !== user?.id) {
      throw new ForbiddenException(
        "You can only manage your own aspirant profile",
      );
    }
    return aspirant;
  }

  async createBooking(
    aspirantId: number,
    voterId: number,
    message?: string,
    preferredAt?: number,
  ) {
    const aspirant = await this.repo.findOne({ where: { id: aspirantId } });
    if (!aspirant) throw new NotFoundException("Aspirant not found");
    const booking = this.bookingRepo.create({
      aspirantId,
      voterId,
      message,
      preferredAt,
      status: "pending",
    });
    return this.bookingRepo.save(booking);
  }

  async listBookingsForAspirant(
    aspirantId: number,
    user: { id?: number; role?: string },
    page?: number,
    limit?: number,
  ) {
    await this.assertOwnsAspirant(aspirantId, user);
    const p = Math.max(1, Number(page) || 1);
    const l = Math.min(100, Math.max(1, Number(limit) || 100));
    const bookings = await this.bookingRepo.find({
      where: { aspirantId },
      order: { createdAt: "DESC" },
      skip: (p - 1) * l,
      take: l,
    });
    if (!bookings.length) return [];

    const voterIds = Array.from(new Set(bookings.map((b) => b.voterId)));
    const voters = await this.usersService.findManyByIds(voterIds);
    const voterMap = new Map<number, User>(voters.map((v) => [v.id, v]));

    return bookings.map((b: any) => ({
      id: b.id,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      aspirantId: b.aspirantId,
      voterId: b.voterId,
      voterName: voterMap.get(b.voterId)?.name ?? null,
      message: b.message,
      preferredAt: b.preferredAt,
      status: b.status,
      scheduledAt: b.scheduledAt,
    }));
  }

  async createVisit(
    aspirantId: number,
    startTime: number,
    endTime?: number,
    title?: string,
    description?: string,
    location?: string,
    googleMapsLink?: string,
    user: { id?: number; role?: string } = {},
  ) {
    const aspirant = await this.assertOwnsAspirant(aspirantId, user);
    const visit = this.visitRepo.create({
      aspirantId,
      startTime,
      endTime,
      title,
      description,
      location,
      googleMapsLink,
    });
    const saved = await this.visitRepo.save(visit);
    try {
      const ctx = await this.resolveConstituencyContext(aspirant);
      if (ctx) {
        await this.notificationsService.notifyAspirantVisit(aspirant, saved, ctx);
      }
    } catch {
      /* best-effort */
    }
    return saved;
  }

  async listVisitsForAspirant(
    aspirantId: number,
    page?: number,
    limit?: number,
  ) {
    const p = Math.max(1, Number(page) || 1);
    const l = Math.min(100, Math.max(1, Number(limit) || 100));
    const visits = await this.visitRepo.find({
      where: { aspirantId },
      order: { startTime: "DESC" },
      skip: (p - 1) * l,
      take: l,
    });
    const counts = await this.getVisitResponseCounts(visits.map((v) => v.id));
    return visits.map((v) => ({
      id: v.id,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
      aspirantId: v.aspirantId,
      startTime: v.startTime,
      endTime: v.endTime,
      title: v.title,
      description: v.description,
      location: v.location,
      googleMapsLink: v.googleMapsLink,
      attendingCount: counts.get(v.id)?.attending ?? 0,
    }));
  }

  async respondToVisit(visitId: number, voterId: number, attending: boolean) {
    const visit = await this.visitRepo.findOne({ where: { id: visitId } });
    if (!visit) throw new NotFoundException("Visit not found");

    let response = await this.visitResponseRepo.findOne({
      where: { visitId, voterId },
    });
    if (response) {
      response.attending = attending;
    } else {
      response = this.visitResponseRepo.create({ visitId, voterId, attending });
    }
    return this.visitResponseRepo.save(response);
  }

  async respondToMeeting(
    meetingId: number,
    voterId: number,
    attending: boolean,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const meetingRepo = manager.getRepository(AspirantMeeting);
      const meetingResponseRepo = manager.getRepository(MeetingResponse);

      // Pessimistically lock the parent meeting row so concurrent responders
      // for the same meeting are serialized — this closes the find-then-insert
      // race that could otherwise insert duplicate response rows.
      const meeting = await meetingRepo.findOne({
        where: { id: meetingId },
        lock: { mode: "pessimistic_write" },
      });
      if (!meeting) throw new NotFoundException("Meeting not found");

      let response = await meetingResponseRepo.findOne({
        where: { meetingId, voterId },
      });
      if (response) {
        response.attending = attending;
      } else {
        response = meetingResponseRepo.create({
          meetingId,
          voterId,
          attending,
        });
      }
      await meetingResponseRepo.save(response);

      const counts = await this.getMeetingResponseCounts([meetingId], manager);
      const c = counts.get(meetingId);
      return {
        id: meeting.id,
        meetingId,
        attending,
        attendingCount: c?.attending ?? 0,
        notAttendingCount: c?.notAttending ?? 0,
      };
    });
  }

  async getVisitResponses(visitId: number) {
    return this.visitResponseRepo.find({ where: { visitId } });
  }

  findByWard(wardId: number) {
    return this.repo.find({
      where: { wardId, isActive: true },
      order: { createdAt: "DESC" },
    });
  }

  async findByWardAndName(wardId: number, name: string) {
    return this.repo
      .createQueryBuilder("aspirant")
      .where("aspirant.wardId = :wardId", { wardId })
      .andWhere("LOWER(aspirant.name) = LOWER(:name)", { name })
      .getOne();
  }

  async findByUserId(userId: number) {
    return this.repo.findOne({ where: { userId } });
  }

  async findByWardNumber(wardNumber: string) {
    const aspirants = await this.repo
      .createQueryBuilder("aspirant")
      .leftJoinAndSelect("aspirant.ward", "ward")
      .leftJoinAndSelect("aspirant.user", "user")
      .where("ward.number = :wardNumber", { wardNumber })
      .andWhere("aspirant.isActive = :isActive", { isActive: true })
      .orderBy("aspirant.createdAt", "DESC")
      .getMany();

    if (!aspirants.length) return [];

    const ids = aspirants.map((a) => a.id);

    // Load meetings separately (instead of a leftJoinAndSelect that multiplies
    // aspirant rows by their meetings) and group them in JS, mirroring the
    // allVisits pattern below.
    const meetings = await this.meetingRepo.find({
      where: { aspirantId: In(ids) },
    });
    const meetingsByAspirant = new Map<number, AspirantMeeting[]>();
    for (const m of meetings) {
      (
        meetingsByAspirant.get(m.aspirantId) ??
        meetingsByAspirant.set(m.aspirantId, []).get(m.aspirantId)!
      ).push(m);
    }
    for (const a of aspirants) {
      (a as any).meetings = meetingsByAspirant.get(a.id) ?? [];
    }
    const meetingIds = aspirants.flatMap(
      (a) => (a.meetings ?? []).map((m: any) => m.id),
    );

    const [
      allVisits,
      voteCounts,
      meetingCounts,
      { meetingRatings, visitRatings, contactRatings, overallRatings },
    ] = await Promise.all([
      this.visitRepo.find({
        where: { aspirantId: In(ids) },
        order: { startTime: "DESC" },
      }),
      this.votesService.countByAspirantIds(ids),
      this.getMeetingResponseCounts(meetingIds),
      this.getActivityRatingsBulk(ids),
    ]);
    const visitCounts = await this.getVisitResponseCounts(
      allVisits.map((v) => v.id),
    );

    const visitsByAspirant: Record<number, any[]> = {};
    for (const v of allVisits) {
      if (!visitsByAspirant[v.aspirantId]) visitsByAspirant[v.aspirantId] = [];
      const c = visitCounts.get(v.id);
      visitsByAspirant[v.aspirantId].push({
        id: v.id,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
        aspirantId: v.aspirantId,
        startTime: v.startTime,
        endTime: v.endTime,
        title: v.title,
        description: v.description,
        location: v.location,
        googleMapsLink: v.googleMapsLink,
        attendingCount: c?.attending ?? 0,
        rating: visitRatings[v.id] ?? this.emptyRating(),
      });
    }

    return aspirants.map((aspirant) => {
      const { user, ...rest } = aspirant as any;
      return {
        ...rest,
        email: user?.email ?? null,
        voteCount: voteCounts[aspirant.id] ?? 0,
        overallRating: overallRatings[aspirant.id] ?? this.emptyRating(),
        contactRating: contactRatings[aspirant.id] ?? this.emptyRating(),
        visits: visitsByAspirant[aspirant.id] ?? [],
        meetings: (aspirant.meetings || [])
          .sort((a: any, b: any) => b.startTime - a.startTime)
          .map((m: any) => {
            const c = meetingCounts.get(m.id);
            return {
              id: m.id,
              createdAt: m.createdAt,
              updatedAt: m.updatedAt,
              aspirantId: m.aspirantId,
              meetingLink: m.meetingLink,
              platform: m.platform,
              title: m.title,
              description: m.description,
              startTime: m.startTime,
              endTime: m.endTime,
              completed: m.completed,
              notes: m.notes,
              attendingCount: c?.attending ?? 0,
              notAttendingCount: c?.notAttending ?? 0,
              rating: meetingRatings[m.id] ?? this.emptyRating(),
            };
          }),
        documentStatus: aspirant.getDocumentStatus(),
      };
    });
  }

  async findByConstituency(
    electionId: number,
    constituencyId: number,
    userId?: number,
  ) {
    const aspirants = await this.repo
      .createQueryBuilder("aspirant")
      .leftJoinAndSelect("aspirant.ward", "ward")
      .leftJoinAndSelect("aspirant.user", "user")
      .where("aspirant.electionId = :electionId", { electionId })
      .andWhere("aspirant.constituencyId = :constituencyId", { constituencyId })
      .andWhere("aspirant.isActive = :isActive", { isActive: true })
      .andWhere("aspirant.sopAgreed = :sopAgreed", { sopAgreed: true })
      .andWhere("aspirant.selfieUrl IS NOT NULL")
      .orderBy("aspirant.createdAt", "DESC")
      .getMany();

    if (!aspirants.length)
      return [this.getDemoAspirant(electionId, constituencyId)];

    const ids = aspirants.map((a) => a.id);

    // Load meetings separately (instead of a leftJoinAndSelect that multiplies
    // aspirant rows by their meetings) and group them in JS, mirroring the
    // allVisits pattern below.
    const meetings = await this.meetingRepo.find({
      where: { aspirantId: In(ids) },
    });
    const meetingsByAspirant = new Map<number, AspirantMeeting[]>();
    for (const m of meetings) {
      (
        meetingsByAspirant.get(m.aspirantId) ??
        meetingsByAspirant.set(m.aspirantId, []).get(m.aspirantId)!
      ).push(m);
    }
    for (const a of aspirants) {
      (a as any).meetings = meetingsByAspirant.get(a.id) ?? [];
    }
    const meetingIds = aspirants.flatMap(
      (a) => (a.meetings ?? []).map((m: any) => m.id),
    );

    const [
      allVisits,
      voteCounts,
      meetingCounts,
      { meetingRatings, visitRatings, contactRatings, overallRatings },
    ] = await Promise.all([
      this.visitRepo.find({
        where: { aspirantId: In(ids) },
        order: { startTime: "DESC" },
      }),
      this.votesService.countByAspirantIds(ids),
      this.getMeetingResponseCounts(meetingIds),
      this.getActivityRatingsBulk(ids),
    ]);
    const visitCounts = await this.getVisitResponseCounts(
      allVisits.map((v) => v.id),
    );

    const userRatedMeetings = new Set<number>();
    const userRatedVisits = new Set<number>();
    const userRatedContacts = new Set<number>(); // aspirantIds whose contact this user rated
    if (userId) {
      const userRatings = await this.activityRatingRepo.find({
        where: { voterId: userId, aspirantId: In(ids) },
      });
      for (const r of userRatings) {
        if (r.type === "meeting") userRatedMeetings.add(r.activityId);
        else if (r.type === "visit") userRatedVisits.add(r.activityId);
        else if (r.type === "contact") userRatedContacts.add(r.aspirantId);
      }
    }

    // Aspirants this voter has contacted (pressed phone/WhatsApp) → eligible to
    // rate their contact (until they've already rated). Keep the press time so
    // the response can expose when the voter last contacted each aspirant.
    const contactedAspirantIds = new Set<number>();
    const contactedAtByAspirant = new Map<number, number | null>();
    if (userId) {
      const interactions = await this.interactionRepo.find({
        where: { userId, aspirantId: In(ids), isPhoneCall: true },
        select: { aspirantId: true, phoneCallAt: true },
      });
      for (const i of interactions) {
        contactedAspirantIds.add(i.aspirantId);
        contactedAtByAspirant.set(
          i.aspirantId,
          i.phoneCallAt ? new Date(i.phoneCallAt).getTime() : null,
        );
      }
    }

    const visitsByAspirant: Record<number, any[]> = {};
    for (const v of allVisits) {
      if (!visitsByAspirant[v.aspirantId]) visitsByAspirant[v.aspirantId] = [];
      const c = visitCounts.get(v.id);
      const visitData: any = {
        id: v.id,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
        aspirantId: v.aspirantId,
        startTime: v.startTime,
        endTime: v.endTime,
        title: v.title,
        description: v.description,
        location: v.location,
        googleMapsLink: v.googleMapsLink,
        attendingCount: c?.attending ?? 0,
        rating: visitRatings[v.id] ?? this.emptyRating(),
      };
      if (userId) visitData.isRated = userRatedVisits.has(v.id);
      visitsByAspirant[v.aspirantId].push(visitData);
    }

    const totalVotes = Object.values(voteCounts).reduce(
      (sum: number, c: number) => sum + c,
      0,
    );

    return aspirants.map((aspirant) => {
      const { user, ...rest } = aspirant as any;
      const voteCount = voteCounts[aspirant.id] ?? 0;
      return this.applyContactPrivacy({
        ...rest,
        email: user?.email ?? null,
        voteCount,
        votePercentage:
          totalVotes > 0
            ? parseFloat(((voteCount / totalVotes) * 100).toFixed(1))
            : 0,
        overallRating: overallRatings[aspirant.id] ?? this.emptyRating(),
        contactRating: contactRatings[aspirant.id] ?? this.emptyRating(),
        ...(userId
          ? {
              isContactRated: userRatedContacts.has(aspirant.id),
              // Show the "rate contact" prompt only to a voter who pressed this
              // aspirant's phone/WhatsApp button and hasn't rated yet.
              canRateContact:
                contactedAspirantIds.has(aspirant.id) &&
                !userRatedContacts.has(aspirant.id),
              // When this voter last contacted the aspirant, as an epoch-ms
              // timestamp (null if never contacted).
              contactedAt: contactedAtByAspirant.get(aspirant.id) ?? null,
            }
          : {}),
        visits: visitsByAspirant[aspirant.id] ?? [],
        meetings: (aspirant.meetings || [])
          .sort((a: any, b: any) => b.startTime - a.startTime)
          .map((m: any) => {
            const c = meetingCounts.get(m.id);
            const meetingData: any = {
              id: m.id,
              createdAt: m.createdAt,
              updatedAt: m.updatedAt,
              aspirantId: m.aspirantId,
              meetingLink: m.meetingLink,
              platform: m.platform,
              title: m.title,
              description: m.description,
              startTime: m.startTime,
              endTime: m.endTime,
              completed: m.completed,
              notes: m.notes,
              attendingCount: c?.attending ?? 0,
              notAttendingCount: c?.notAttending ?? 0,
              rating: meetingRatings[m.id] ?? this.emptyRating(),
            };
            if (userId) meetingData.isRated = userRatedMeetings.has(m.id);
            return meetingData;
          }),
        documentStatus: aspirant.getDocumentStatus(),
      });
    });
  }

  async approve(id: number) {
    await this.repo.update(id, { status: "approved" });
    return this.repo.findOne({ where: { id } });
  }

  async findOne(id: number, currentUser?: any) {
    if (id === 0) return this.getDemoAspirant();

    const aspirant = await this.repo.findOne({
      where: { id },
      relations: { ward: true, user: true, meetings: true } as any,
    });
    if (!aspirant) return null;

    const meetingIds = (aspirant.meetings || []).map((m: any) => m.id);
    const visits = await this.visitRepo.find({
      where: { aspirantId: id },
      order: { startTime: "DESC" },
    });

    const [
      { meetingRatings, visitRatings, contactRatings, overallRatings },
      meetingCounts,
      visitCounts,
    ] = await Promise.all([
      this.getActivityRatingsBulk([id]),
      this.getMeetingResponseCounts(meetingIds),
      this.getVisitResponseCounts(visits.map((v) => v.id)),
    ]);

    const mappedMeetings = (aspirant.meetings || [])
      .sort((a: any, b: any) => b.startTime - a.startTime)
      .map((m: any) => {
        const c = meetingCounts.get(m.id);
        return {
          id: m.id,
          createdAt: m.createdAt,
          updatedAt: m.updatedAt,
          aspirantId: m.aspirantId,
          meetingLink: m.meetingLink,
          platform: m.platform,
          title: m.title,
          description: m.description,
          startTime: m.startTime,
          endTime: m.endTime,
          completed: m.completed,
          notes: m.notes,
          attendingCount: c?.attending ?? 0,
          notAttendingCount: c?.notAttending ?? 0,
          rating: meetingRatings[m.id] ?? this.emptyRating(),
        };
      });

    const mappedVisits = visits.map((v) => {
      const c = visitCounts.get(v.id);
      return {
        id: v.id,
        createdAt: v.createdAt,
        updatedAt: v.updatedAt,
        aspirantId: v.aspirantId,
        startTime: v.startTime,
        endTime: v.endTime,
        title: v.title,
        description: v.description,
        location: v.location,
        googleMapsLink: v.googleMapsLink,
        attendingCount: c?.attending ?? 0,
        rating: visitRatings[v.id] ?? this.emptyRating(),
      };
    });

    // Fallback: if the aspirant has no gender on file, surface the viewing
    // user's gender. The JWT-derived currentUser no longer carries gender,
    // so we look it up here only when the fallback is actually needed.
    if ((!aspirant.gender || aspirant.gender === "") && currentUser?.id) {
      const viewer = await this.usersService.findById(currentUser.id);
      if (viewer?.gender) aspirant.gender = viewer.gender;
    }

    // Resolve election + constituency names in a single bulk pass.
    let electionName: string | null = null;
    let constituencyName: string | null = null;
    if (aspirant.electionId) {
      try {
        const election = await this.electionsService.findById(
          aspirant.electionId,
        );
        electionName = election.name;
        if (aspirant.constituencyId) {
          const electionMap = new Map<
            number,
            { id: number; name: string; type: string }
          >([[election.id, { id: election.id, name: election.name, type: election.type }]]);
          const lookup = await this.resolveConstituencyNames(
            [{ electionId: aspirant.electionId, constituencyId: aspirant.constituencyId }],
            electionMap,
          );
          constituencyName =
            lookup.get(`${aspirant.electionId}:${aspirant.constituencyId}`) ??
            null;
        }
      } catch {
        /* skip if not found */
      }
    }

    const { user: _user, ...aspirantRest } = aspirant as any;
    const result = {
      ...aspirantRest,
      isBlocked: aspirant.user?.isBlocked ?? false,
      electionName,
      constituencyName,
      meetings: mappedMeetings,
      visits: mappedVisits,
      overallRating: overallRatings[id] ?? this.emptyRating(),
      contactRating: contactRatings[id] ?? this.emptyRating(),
      documentStatus: aspirant.getDocumentStatus(),
    };

    // The owner viewing their own profile always sees their full contact
    // details (the FE profile screen relies on this); everyone else gets the
    // privacy filter applied per the allow* flags.
    const isOwner =
      currentUser?.id != null &&
      aspirant.userId != null &&
      currentUser.id === aspirant.userId;
    return isOwner ? result : this.applyContactPrivacy(result);
  }

  async setMeetingLink(
    id: number,
    meetingLink: string,
    startTime: number,
    endTime?: number,
    title?: string,
    description?: string,
    platform?: string,
  ) {
    const aspirant = await this.repo.findOne({ where: { id } });
    if (!aspirant) throw new NotFoundException("Aspirant not found");

    const meeting = this.meetingRepo.create({
      aspirantId: aspirant.id,
      meetingLink,
      platform: platform ?? "others",
      startTime,
      endTime,
      title,
      description,
    } as any);
    const saved = (await this.meetingRepo.save(meeting)) as unknown as AspirantMeeting;
    try {
      const ctx = await this.resolveConstituencyContext(aspirant);
      if (ctx) {
        await this.notificationsService.notifyAspirantMeeting(
          aspirant,
          saved,
          ctx,
        );
      }
    } catch {
      /* best-effort */
    }
    return this.repo.findOne({
      where: { id },
      relations: { ward: true, meetings: true },
    });
  }

  async setMeetingLinkForMultiple(
    aspirantIds: number[],
    meetingLink: string,
    startTime: number,
    endTime?: number,
    title?: string,
    description?: string,
    platform?: string,
    user: { id?: number; role?: string } = {},
  ) {
    // Fetch all aspirants and verify they exist
    const aspirants = await this.repo.findBy({ id: In(aspirantIds) });

    if (aspirants.length !== aspirantIds.length) {
      const foundIds = aspirants.map((a) => a.id);
      const missingIds = aspirantIds.filter((id) => !foundIds.includes(id));
      throw new NotFoundException(
        `Aspirants not found: ${missingIds.join(", ")}`,
      );
    }

    // Ownership: a non-admin caller may only set meeting links on their own
    // aspirant profile. Verify every requested id belongs to the caller.
    if (user?.role !== "admin") {
      const callerAspirant = await this.findByUserId(user?.id as number);
      const ownsAll = aspirantIds.every((id) => id === callerAspirant?.id);
      if (!ownsAll) {
        throw new ForbiddenException(
          "You can only manage your own aspirant profile",
        );
      }
    }

    // Create meetings for all aspirants
    const meetings = aspirantIds.map((aspirantId) =>
      this.meetingRepo.create({
        aspirantId,
        meetingLink,
        platform: platform ?? "others",
        startTime,
        endTime,
        title,
        description,
      } as any),
    );

    const saved = (await this.meetingRepo.save(meetings as any)) as unknown as AspirantMeeting[];
    const meetingsByAspirant = new Map<number, AspirantMeeting>();
    for (const m of saved) meetingsByAspirant.set(m.aspirantId, m);
    await this.dispatchMeetingNotifications(aspirantIds, meetingsByAspirant);

    // Return updated aspirants with their meetings
    return this.repo.find({
      where: { id: In(aspirantIds) },
      relations: { ward: true, meetings: true },
    });
  }

  async completeMeeting(
    aspirantId: number,
    meetingId: number,
    notes: string,
    user: { id?: number; role?: string } = {},
  ) {
    await this.assertOwnsAspirant(aspirantId, user);
    const meeting = await this.meetingRepo.findOne({
      where: { id: meetingId, aspirantId },
    });
    if (!meeting) throw new NotFoundException("Meeting not found");
    meeting.completed = true;
    meeting.notes = notes;
    await this.meetingRepo.save(meeting);
    return this.meetingRepo.findOne({ where: { id: meetingId } });
  }

  async deleteMeetings(
    meetingIds: number[],
    user: { id?: number; role?: string } = {},
  ) {
    if (!meetingIds || meetingIds.length === 0) return { deleted: 0 };
    // verify meetings exist
    const meetings = await this.meetingRepo.findBy({ id: In(meetingIds) });
    if (meetings.length === 0) return { deleted: 0 };

    // Ownership: a non-admin caller may only delete meetings that belong to
    // their own aspirant profile.
    if (user?.role !== "admin") {
      const callerAspirant = await this.findByUserId(user?.id as number);
      const ownsAll = meetings.every(
        (m) => m.aspirantId === callerAspirant?.id,
      );
      if (!ownsAll) {
        throw new ForbiddenException(
          "You can only manage your own aspirant profile",
        );
      }
    }

    const foundIds = meetings.map((m) => m.id);
    const toDelete = meetingIds.filter((id) => foundIds.includes(id));
    if (toDelete.length === 0) return { deleted: 0 };
    const res = await this.meetingRepo.delete(toDelete);
    // TypeORM DeleteResult doesn't always include affected on some drivers; compute from found
    return { deleted: toDelete.length };
  }

  async deleteVisit(
    aspirantId: number,
    visitId: number,
    user: { id?: number; role?: string } = {},
  ) {
    await this.assertOwnsAspirant(aspirantId, user);
    const visit = await this.visitRepo.findOne({
      where: { id: visitId, aspirantId },
    });
    if (!visit) throw new NotFoundException("Visit not found");
    await this.visitRepo.delete(visitId);
    return { deleted: 1 };
  }

  async deleteVisits(aspirantId: number, visitIds: number[]) {
    if (!visitIds || visitIds.length === 0) return { deleted: 0 };
    const visits = await this.visitRepo.findBy({ id: In(visitIds) });
    // ensure they belong to aspirant
    const owned = visits
      .filter((v) => v.aspirantId === aspirantId)
      .map((v) => v.id);
    if (owned.length === 0) return { deleted: 0 };
    await this.visitRepo.delete(owned);
    return { deleted: owned.length };
  }

  async withdrawAspirant(userId: number) {
    const aspirant = await this.repo.findOne({ where: { userId } });
    if (!aspirant)
      throw new NotFoundException("No aspirant profile found for this user");

    // Only block withdrawal if there's an active voting window for THIS
    // aspirant's election type. A lok_sabha aspirant should still be
    // able to withdraw while a municipal_corporation window is open
    // (and vice versa).
    const votingAllowed = await this.votesService.isVotingAllowed();
    if (votingAllowed) {
      const activeWindow = await this.votesService.getActiveVotingWindow();
      if (
        activeWindow?.electionId &&
        aspirant.electionId &&
        activeWindow.electionId === aspirant.electionId
      ) {
        throw new BadRequestException(
          "Cannot withdraw candidacy while voting is open for this election",
        );
      }
    }

    await this.repo.update(aspirant.id, {
      isActive: false,
      sopUrl: null as any,
      sopAgreed: false,
      sopAgreedAt: null,
      selfieUrl: null as any,
      phone: null as any,
    });
    await this.usersService.setRole(userId, "voter");
    await this.usersService.clearPhone(userId);
    return { message: "Aspirant candidacy withdrawn. Role reverted to voter." };
  }

  async updateAspirant(
    aspirantId: number,
    userId: number,
    dto: UpdateAspirantDto,
  ) {
    const aspirant = await this.repo.findOne({
      where: { id: aspirantId, userId },
    });
    if (!aspirant)
      throw new NotFoundException(
        "Aspirant not found or does not belong to this user",
      );

    if (dto.phone && dto.phone !== aspirant.phone) {
      const phoneOwner = await this.usersService.findByPhone(dto.phone);
      if (phoneOwner && phoneOwner.id !== userId) {
        throw new BadRequestException("Phone already in use");
      }
    }

    if (dto.whatsappNumber && dto.whatsappNumber !== aspirant.whatsappNumber) {
      const existing = await this.repo.findOne({
        where: { whatsappNumber: dto.whatsappNumber },
      });
      if (existing && existing.userId !== userId) {
        throw new BadRequestException("WhatsApp number already in use");
      }
    }

    const updatableFields = [
      "age",
      "gender",
      "education",
      "occupation",
      "phone",
      "address",
      "manifesto",
      "instagramLink",
      "facebookLink",
      "linkedinLink",
      "twitterLink",
      "whatsappNumber",
    ] as const;
    for (const field of updatableFields) {
      if (dto[field] !== undefined) (aspirant as any)[field] = dto[field];
    }

    await this.repo.save(aspirant);

    // Sync phone/age/gender to user profile
    const userToUpdate = await this.usersService.findById(userId);
    if (userToUpdate) {
      await this.usersService.updateUser(userId, {
        phone: dto.phone ?? userToUpdate.phone,
        age: dto.age ?? userToUpdate.age,
        gender: dto.gender ?? userToUpdate.gender,
      });
    }

    return { ...aspirant, documentStatus: aspirant.getDocumentStatus() };
  }

  async updatePermissions(
    aspirantId: number,
    userId: number,
    dto: { allowPhone?: boolean; allowWhatsapp?: boolean; allowChat?: boolean },
  ) {
    const aspirant = await this.repo.findOne({
      where: { id: aspirantId, userId },
    });
    if (!aspirant)
      throw new NotFoundException(
        "Aspirant not found or does not belong to this user",
      );

    if (dto.allowPhone !== undefined) aspirant.allowPhone = dto.allowPhone;
    if (dto.allowWhatsapp !== undefined)
      aspirant.allowWhatsapp = dto.allowWhatsapp;
    if (dto.allowChat !== undefined) aspirant.allowChat = dto.allowChat;

    await this.repo.save(aspirant);
    return {
      allowPhone: aspirant.allowPhone,
      allowWhatsapp: aspirant.allowWhatsapp,
      allowChat: aspirant.allowChat,
    };
  }

  count() {
    return this.repo.count();
  }

  async findAllAspirants(
    page: number = 1,
    limit: number = 20,
    search?: string,
  ) {
    const qb = this.repo
      .createQueryBuilder("aspirant")
      .leftJoinAndSelect("aspirant.user", "user")
      .where("aspirant.isActive = :isActive", { isActive: true })
      .andWhere("aspirant.sopAgreed = :sopAgreed", { sopAgreed: true })
      .andWhere("aspirant.selfieUrl IS NOT NULL");

    if (search) {
      qb.andWhere("LOWER(aspirant.name) LIKE :search", {
        search: `%${search.toLowerCase()}%`,
      });
    }

    const [aspirants, total] = await qb
      .orderBy("aspirant.name", "ASC")
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    if (!aspirants.length)
      return { data: [], total, page, limit, totalPages: 0 };

    // Collect unique electionIds and bulk-resolve elections in a single IN-query.
    const electionIds = [
      ...new Set(aspirants.map((a) => a.electionId).filter(Boolean)),
    ] as number[];
    const elections = electionIds.length
      ? await this.repo.manager
          .getRepository("Election")
          .findBy({ id: In(electionIds) } as any)
      : [];

    const electionNameMap = new Map<number, string>();
    const electionMap = new Map<
      number,
      { id: number; name: string; type: string }
    >();
    for (const e of elections as any[]) {
      electionNameMap.set(e.id, e.name);
      electionMap.set(e.id, { id: e.id, name: e.name, type: e.type });
    }

    const constituencyLookup = await this.resolveConstituencyNames(
      aspirants,
      electionMap,
    );

    const data = aspirants.map((a) => ({
      id: a.id,
      userId: a.userId ?? null,
      name: a.name,
      party: a.party,
      selfieUrl: a.selfieUrl ?? null,
      isBlocked: a.user?.isBlocked ?? false,
      electionId: a.electionId,
      electionName: a.electionId
        ? (electionNameMap.get(a.electionId) ?? null)
        : null,
      constituencyId: a.constituencyId,
      constituencyName:
        a.electionId && a.constituencyId
          ? (constituencyLookup.get(`${a.electionId}:${a.constituencyId}`) ??
            null)
          : null,
    }));

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Privacy filter for outgoing aspirant responses. An aspirant controls who
   * can see their contact details via the allow* flags: the phone number is
   * only included when allowPhone is true, and the WhatsApp number only when
   * allowWhatsapp is true. When a flag is false the corresponding field is
   * removed entirely so the value never leaves the server. The allow* flags
   * themselves are preserved so the client knows which contact actions to show.
   */
  private applyContactPrivacy<T extends Record<string, any>>(aspirant: T): T {
    if (!aspirant) return aspirant;
    if (aspirant.allowPhone === false) delete (aspirant as any).phone;
    if (aspirant.allowWhatsapp === false) delete (aspirant as any).whatsappNumber;
    return aspirant;
  }

  private emptyDistribution(): Record<number, number> {
    return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  }

  private getDemoAspirant(electionId?: number, constituencyId?: number) {
    const now = new Date().toISOString();
    const demoOverallRating = {
      averageRating: 4.2,
      totalRatings: 48,
      distribution: { 1: 1, 2: 2, 3: 5, 4: 18, 5: 22 },
    };
    const demoMeetingRating1 = {
      averageRating: 4.5,
      totalRatings: 20,
      distribution: { 1: 0, 2: 1, 3: 2, 4: 7, 5: 10 },
    };
    const demoMeetingRating2 = {
      averageRating: 4.0,
      totalRatings: 15,
      distribution: { 1: 1, 2: 1, 3: 2, 4: 5, 5: 6 },
    };
    const demoMeetingRating3 = {
      averageRating: 4.3,
      totalRatings: 8,
      distribution: { 1: 0, 2: 0, 3: 1, 4: 4, 5: 3 },
    };
    const demoMeetingRating4 = {
      averageRating: 3.8,
      totalRatings: 5,
      distribution: { 1: 0, 2: 1, 3: 1, 4: 2, 5: 1 },
    };
    const demoVisitRating = {
      averageRating: 4.4,
      totalRatings: 12,
      distribution: { 1: 0, 2: 0, 3: 1, 4: 5, 5: 6 },
    };
    return {
      id: 0,
      isDemo: true,
      name: "Prajaakeeya Demo Aspirant",
      phone: "9999999999",
      address: "123 MG Road, Bengaluru, Karnataka",
      party: "Independent",
      age: 35,
      education: "B.Tech Computer Science",
      occupation: "Social Worker",
      gender: "Male",
      meetingLink: null,
      manifesto:
        "This is a demo aspirant profile to showcase how the platform works. Register as an aspirant to create your own profile!",
      status: "approved",
      isActive: true,
      wardId: null,
      electionId: electionId ?? null,
      constituencyId: constituencyId ?? null,
      userId: null,
      identityBackground:
        "Demo aspirant with experience in community development and civic tech.",
      resignationPledge:
        "Yes — I will sign a legal affidavit to resign if poll < 50%.",
      financialIntegrity:
        "I will declare all family assets on the portal before primary selection.",
      noHighCommand: "I will follow the digital vote of the ward citizens.",
      technicalCompetence:
        "All budgets will be submitted to Expert Portal for verification before polling.",
      transparency:
        "I agree to upload every bill and receipt to the Live Ledger within 24 hours.",
      emergencyProtocol:
        "I will publish a timestamped justification and notify experts and voters immediately.",
      expertConsultation:
        "Yes — will consult at least three registered experts for projects > ₹1 Lakh.",
      voterFeedback:
        "I will revise the plan and resubmit it for a corrective poll or accept majority rejection.",
      primaryRule:
        "Yes — I will withdraw my nomination and support the selected person.",
      instagramLink: "https://instagram.com/prajaakeeya",
      facebookLink: "https://facebook.com/prajaakeeya",
      linkedinLink: null,
      twitterLink: "https://twitter.com/prajaakeeya",
      whatsappNumber: "9999999999",
      sopUrl:
        "https://prajaakeeya.s3.ap-south-1.amazonaws.com/demo/demo-aspirant-sop.pdf",
      sopStatus: "verified",
      selfieUrl:
        "https://prajaakeeya.s3.ap-south-1.amazonaws.com/demo/demo-aspirant-avatar.jpg",
      recentPhotoUrl:
        "https://prajaakeeya.s3.ap-south-1.amazonaws.com/demo/demo-aspirant-avatar.jpg",
      allowPhone: true,
      allowWhatsapp: true,
      allowChat: true,
      createdAt: now,
      updatedAt: now,
      email: null,
      voteCount: 5,
      votePercentage: 100,
      overallRating: demoOverallRating,
      contactRating: demoOverallRating,
      documentStatus: "completed",
      visits: [
        {
          id: 0,
          createdAt: now,
          updatedAt: now,
          aspirantId: 0,
          startTime: Date.now() + 86400000,
          endTime: Date.now() + 90000000,
          title: "Demo Ward Visit",
          description:
            "This is a demo ward visit to show how visits appear on the platform.",
          location: "Community Hall, MG Road, Bengaluru",
          googleMapsLink: null,
          attendingCount: 12,
          rating: demoVisitRating,
        },
      ],
      meetings: [
        {
          id: 0,
          createdAt: now,
          updatedAt: now,
          aspirantId: 0,
          meetingLink: "https://meet.google.com/demo",
          platform: "google_meet",
          title: "Demo Town Hall Meeting",
          description:
            "Open discussion on ward development priorities and upcoming projects.",
          startTime: Date.now() + 172800000,
          endTime: Date.now() + 176400000,
          completed: false,
          notes: null,
          attendingCount: 25,
          notAttendingCount: 3,
          rating: demoMeetingRating1,
        },
        {
          id: 1,
          createdAt: now,
          updatedAt: now,
          aspirantId: 0,
          meetingLink: "https://zoom.us/j/demo123",
          platform: "zoom",
          title: "Budget Review & Q&A Session",
          description:
            "Reviewing the quarterly budget allocation and answering citizen questions.",
          startTime: Date.now() + 259200000,
          endTime: Date.now() + 262800000,
          completed: false,
          notes: null,
          attendingCount: 40,
          notAttendingCount: 5,
          rating: demoMeetingRating2,
        },
        {
          id: 2,
          createdAt: now,
          updatedAt: now,
          aspirantId: 0,
          meetingLink: "https://instagram.com/live/demo",
          platform: "instagram",
          title: "Instagram Live - Youth Engagement",
          description:
            "Interactive session with young voters on education and employment initiatives.",
          startTime: Date.now() + 345600000,
          endTime: Date.now() + 349200000,
          completed: false,
          notes: null,
          attendingCount: 60,
          notAttendingCount: 8,
          rating: demoMeetingRating3,
        },
        {
          id: 3,
          createdAt: now,
          updatedAt: now,
          aspirantId: 0,
          meetingLink: "https://facebook.com/live/demo",
          platform: "facebook",
          title: "Facebook Live - Infrastructure Update",
          description:
            "Progress update on road repairs, drainage, and water supply projects.",
          startTime: Date.now() + 432000000,
          endTime: Date.now() + 435600000,
          completed: false,
          notes: null,
          attendingCount: 35,
          notAttendingCount: 4,
          rating: demoMeetingRating4,
        },
      ],
    };
  }

  private emptyRating() {
    return {
      averageRating: 0,
      totalRatings: 0,
      distribution: this.emptyDistribution(),
    };
  }

  private async getActivityRatingsBulk(aspirantIds: number[]) {
    const emptyResult = {
      meetingRatings: {} as Record<number, any>,
      visitRatings: {} as Record<number, any>,
      contactRatings: {} as Record<number, any>,
      overallRatings: {} as Record<number, any>,
    };
    if (!aspirantIds.length) return emptyResult;

    // Get per-activity breakdown: type, activityId, aspirantId, rating value, count
    const distRows = await this.activityRatingRepo
      .createQueryBuilder("r")
      .select("r.type", "type")
      .addSelect("r.activityId", "activityId")
      .addSelect("r.aspirantId", "aspirantId")
      .addSelect("r.rating", "rating")
      .addSelect("COUNT(r.id)", "count")
      .where("r.aspirantId IN (:...aspirantIds)", { aspirantIds })
      .groupBy("r.type, r.activityId, r.aspirantId, r.rating")
      .getRawMany();

    // Build per-activity rating data
    const activityMap: Record<
      string,
      {
        totalRatings: number;
        sum: number;
        aspirantId: number;
        distribution: Record<number, number>;
      }
    > = {};

    for (const row of distRows) {
      const key = `${row.type}:${row.activityId}`;
      if (!activityMap[key])
        activityMap[key] = {
          totalRatings: 0,
          sum: 0,
          aspirantId: row.aspirantId,
          distribution: this.emptyDistribution(),
        };
      const cnt = parseInt(row.count, 10);
      activityMap[key].totalRatings += cnt;
      activityMap[key].sum += row.rating * cnt;
      activityMap[key].distribution[row.rating] = cnt;
    }

    const meetingRatings: Record<number, any> = {};
    const visitRatings: Record<number, any> = {};
    // Contact ratings are keyed by aspirantId (activityId === aspirantId).
    const contactRatings: Record<number, any> = {};
    const overallSums: Record<
      number,
      { sum: number; count: number; distribution: Record<number, number> }
    > = {};

    for (const [key, data] of Object.entries(activityMap)) {
      const [type, activityIdStr] = key.split(":");
      const activityId = Number(activityIdStr);
      const entry = {
        averageRating: parseFloat((data.sum / data.totalRatings).toFixed(1)),
        totalRatings: data.totalRatings,
        distribution: data.distribution,
      };

      if (type === "meeting") meetingRatings[activityId] = entry;
      else if (type === "visit") visitRatings[activityId] = entry;
      else if (type === "contact") contactRatings[activityId] = entry;

      if (!overallSums[data.aspirantId])
        overallSums[data.aspirantId] = {
          sum: 0,
          count: 0,
          distribution: this.emptyDistribution(),
        };
      overallSums[data.aspirantId].sum += data.sum;
      overallSums[data.aspirantId].count += data.totalRatings;
      for (const [rating, cnt] of Object.entries(data.distribution)) {
        overallSums[data.aspirantId].distribution[Number(rating)] =
          (overallSums[data.aspirantId].distribution[Number(rating)] || 0) +
          cnt;
      }
    }

    const overallRatings: Record<number, any> = {};
    for (const [id, s] of Object.entries(overallSums)) {
      overallRatings[Number(id)] = {
        averageRating:
          s.count > 0 ? parseFloat((s.sum / s.count).toFixed(1)) : 0,
        totalRatings: s.count,
        distribution: s.distribution,
      };
    }

    return { meetingRatings, visitRatings, contactRatings, overallRatings };
  }

  async rateMeeting(meetingId: number, voterId: number, rating: number) {
    const meeting = await this.meetingRepo.findOne({
      where: { id: meetingId },
    });
    if (!meeting) throw new NotFoundException("Meeting not found");

    let existing = await this.activityRatingRepo.findOne({
      where: { type: "meeting", activityId: meetingId, voterId },
    });
    if (existing) {
      existing.rating = rating;
    } else {
      existing = this.activityRatingRepo.create({
        type: "meeting",
        activityId: meetingId,
        aspirantId: meeting.aspirantId,
        voterId,
        rating,
      });
    }
    return this.activityRatingRepo.save(existing);
  }

  async rateVisit(visitId: number, voterId: number, rating: number) {
    const visit = await this.visitRepo.findOne({ where: { id: visitId } });
    if (!visit) throw new NotFoundException("Visit not found");

    let existing = await this.activityRatingRepo.findOne({
      where: { type: "visit", activityId: visitId, voterId },
    });
    if (existing) {
      existing.rating = rating;
    } else {
      existing = this.activityRatingRepo.create({
        type: "visit",
        activityId: visitId,
        aspirantId: visit.aspirantId,
        voterId,
        rating,
      });
    }
    return this.activityRatingRepo.save(existing);
  }

  /**
   * Rate an aspirant's contact responsiveness (combined phone + WhatsApp), 1-5.
   * Eligibility: the voter must have pressed this aspirant's phone/WhatsApp
   * ("contact") button — i.e. an interaction with isPhoneCall=true exists.
   * One-time: a contact rating cannot be changed once given. Stored as an
   * ActivityRating with type "contact" and activityId = aspirantId.
   */
  async rateContact(aspirantId: number, voterId: number, rating: number) {
    const aspirant = await this.repo.findOne({ where: { id: aspirantId } });
    if (!aspirant) throw new NotFoundException("Aspirant not found");

    // Eligibility — only a voter who has contacted this aspirant can rate.
    const contacted = await this.interactionRepo.findOne({
      where: { userId: voterId, aspirantId, isPhoneCall: true },
    });
    if (!contacted) {
      throw new BadRequestException(
        "You can rate an aspirant's contact only after contacting them via phone or WhatsApp.",
      );
    }

    // One-time — a contact rating is final and cannot be changed.
    const existing = await this.activityRatingRepo.findOne({
      where: { type: "contact", activityId: aspirantId, voterId },
    });
    if (existing) {
      throw new BadRequestException(
        "You have already rated this aspirant's contact.",
      );
    }

    return this.activityRatingRepo.save(
      this.activityRatingRepo.create({
        type: "contact",
        activityId: aspirantId,
        aspirantId,
        voterId,
        rating,
      }),
    );
  }

  async getActivityRatings(type: "meeting" | "visit", activityId: number) {
    const { avg, count } = await this.activityRatingRepo
      .createQueryBuilder("r")
      .select("AVG(r.rating)", "avg")
      .addSelect("COUNT(r.id)", "count")
      .where("r.type = :type AND r.activityId = :activityId", {
        type,
        activityId,
      })
      .getRawOne();

    return {
      averageRating: avg ? parseFloat(parseFloat(avg).toFixed(1)) : 0,
      totalRatings: parseInt(count, 10),
    };
  }

  async getAspirantOverallRating(aspirantId: number) {
    const { avg, count } = await this.activityRatingRepo
      .createQueryBuilder("r")
      .select("AVG(r.rating)", "avg")
      .addSelect("COUNT(r.id)", "count")
      .where("r.aspirantId = :aspirantId", { aspirantId })
      .getRawOne();

    return {
      averageRating: avg ? parseFloat(parseFloat(avg).toFixed(1)) : 0,
      totalRatings: parseInt(count, 10),
    };
  }
}
