import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
} from "@nestjs/common";
import { CACHE_MANAGER } from "@nestjs/cache-manager";
import type { Cache } from "cache-manager";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, DataSource, In } from "typeorm";
import { S3Service } from "../common/services/s3.service";
import { tokenVersionCacheKey } from "../auth/strategies/jwt.strategy";
import { User } from "./user.entity";
import { Report } from "./report.entity";
import { UserSignedDocument } from "./user-signed-document.entity";
import { CreateReportDto } from "./dto/create-report.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { Vote } from "../votes/vote.entity";
import { Message } from "../forum/message.entity";
import { AspirantMessage } from "../aspirants/aspirant-message.entity";
import { AspirantDiscussionMessage } from "../aspirant-discussion/aspirant-discussion-message.entity";
import { Aspirant } from "../aspirants/aspirant.entity";
import { AspirantBooking } from "../aspirants/aspirant-booking.entity";
import { VisitResponse } from "../aspirants/visit-response.entity";
import { WardMeeting } from "../wards/ward-meeting.entity";
import { UserAspirantInteraction } from "./user-aspirant-interaction.entity";

type InteractionType = "chat" | "meeting" | "directMeet" | "phoneCall";

/**
 * Convert a JWT_EXPIRES_IN-style string (`"24h"`, `"7d"`, `"3600"`, `"15m"`)
 * into milliseconds. Returns undefined for unrecognised input so callers can
 * fall back to a sensible default.
 */
function parseTokenTtlMs(raw?: string): number | undefined {
  if (!raw) return undefined;
  const m = raw.match(/^(\d+)\s*([smhd]?)$/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  switch (m[2].toLowerCase()) {
    case "s":
      return n * 1000;
    case "m":
      return n * 60 * 1000;
    case "h":
      return n * 3600 * 1000;
    case "d":
      return n * 86400 * 1000;
    default:
      return n * 1000;
  }
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    @InjectRepository(Report) private readonly reportRepo: Repository<Report>,
    @InjectRepository(UserSignedDocument)
    private readonly userSignedDocRepo: Repository<UserSignedDocument>,
    @InjectRepository(UserAspirantInteraction)
    private readonly userAspirantInteractionRepo: Repository<UserAspirantInteraction>,
    @InjectRepository(Vote) private readonly voteRepo: Repository<Vote>,
    @InjectRepository(Message)
    private readonly messageRepo: Repository<Message>,
    @InjectRepository(AspirantMessage)
    private readonly aspirantMessageRepo: Repository<AspirantMessage>,
    @InjectRepository(AspirantDiscussionMessage)
    private readonly aspirantDiscussionMessageRepo: Repository<AspirantDiscussionMessage>,
    @InjectRepository(Aspirant)
    private readonly aspirantRepo: Repository<Aspirant>,
    @InjectRepository(AspirantBooking)
    private readonly aspirantBookingRepo: Repository<AspirantBooking>,
    @InjectRepository(VisitResponse)
    private readonly visitResponseRepo: Repository<VisitResponse>,
    @InjectRepository(WardMeeting)
    private readonly wardMeetingRepo: Repository<WardMeeting>,
    private readonly dataSource: DataSource,
    private readonly s3Service: S3Service,
    @Inject(CACHE_MANAGER) private readonly cache: Cache,
  ) {}

  /**
   * Bump the user's tokenVersion and publish the new value to the cache so
   * the JWT strategy rejects every JWT issued before this call. Used on
   * block / unblock / hard-delete / soft-delete to enforce "logout
   * everywhere" immediately rather than waiting for natural JWT expiry.
   *
   * The cache TTL matches the longest JWT lifetime: once every old token
   * has expired naturally, the revocation marker is no longer needed.
   */
  private async revokeAllSessions(userId: number): Promise<number> {
    const fresh = await this.repo
      .createQueryBuilder()
      .update(User)
      .set({ tokenVersion: () => '"token_version" + 1' })
      .where("id = :id", { id: userId })
      .returning("token_version")
      .execute();
    const newVersion = Number(fresh.raw?.[0]?.token_version ?? 0);
    // Default 24h matches the default JWT_EXPIRES_IN; if the env var is
    // higher, this TTL is overridden so the marker outlives the JWT.
    const ttlMs = parseTokenTtlMs(process.env.JWT_EXPIRES_IN) ?? 24 * 3600_000;
    await this.cache.set(tokenVersionCacheKey(userId), newVersion, ttlMs);
    return newVersion;
  }

  findById(id: number) {
    return this.repo.findOne({ where: { id } });
  }

  /** Bulk-fetch users by id. Used to avoid N+1 lookup loops. */
  findManyByIds(ids: number[]): Promise<User[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.repo.findBy({ id: In(ids) as any });
  }

  async getLastInteractionMessage(userId: number): Promise<string | null> {
    const user = await this.repo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");
    return user.lastInteractionMessage || null;
  }

  findByPhone(phone: string) {
    return this.repo.findOne({ where: { phone } });
  }

  findByEmail(email: string) {
    return this.repo.findOne({ where: { email } });
  }

  findByEpic(epic: string) {
    return this.repo.findOne({
      where: [{ epicId: epic }, { voterEpic: epic }],
    });
  }

  async upsertOtp(phone: string, otp: string) {
    const user = await this.repo.findOne({ where: { phone } });
    if (!user) {
      throw new NotFoundException("User not registered");
    }
    user.lastOtp = otp;
    await this.repo.save(user);
  }

  async validateOtp(phone: string, otp: string) {
    const user = await this.repo.findOne({ where: { phone } });
    if (!user || user.lastOtp !== otp) {
      return null;
    }
    user.lastOtp = null;
    await this.repo.save(user);
    return user;
  }

  async registerVoterFromRoll(payload: {
    phone: string;
    name: string;
    relativeName: string;
    epicId: string;
    gender: string;
    wardId: number;
  }) {
    let user = await this.repo.findOne({ where: { phone: payload.phone } });
    if (!user) {
      user = this.repo.create({ phone: payload.phone, role: "voter" });
    }
    user.name = payload.name;
    user.relativeName = payload.relativeName;
    user.epicId = payload.epicId;
    user.gender = payload.gender;
    user.wardId = payload.wardId;
    return this.repo.save(user);
  }

  async upsertAdmin(email: string, name = "Admin User", password?: string) {
    let user = await this.repo.findOne({ where: { email } });
    if (!user) {
      user = this.repo.create({ email, role: "admin" });
    }
    user.name = name;
    user.role = "admin";

    // Clear voter-specific fields for admin users
    user.epicId = undefined;
    user.relativeName = undefined;
    user.gender = undefined;
    user.wardId = undefined;
    user.voterEpic = undefined;
    user.nameEn = undefined;
    user.nameKn = undefined;
    user.corporationName = undefined;
    user.corporationNameL1 = undefined;
    user.wardName = undefined;
    user.wardNameL1 = undefined;
    user.psName = undefined;
    user.psNameL1 = undefined;
    user.psLong = undefined;
    user.psLat = undefined;

    // If password is provided, hash and set it
    if (password) {
      const crypto = await import("crypto");
      const { promisify } = await import("util");
      const scryptAsync = promisify(crypto.scrypt);
      const salt = crypto.randomBytes(16).toString("hex");
      const hash = (
        (await scryptAsync(password, salt, 64)) as Buffer
      ).toString("hex");
      user.passwordSalt = salt;
      user.passwordHash = hash;
    }

    return this.repo.save(user);
  }

  async setRole(userId: number, role: "admin" | "voter" | "aspirant") {
    const user = await this.repo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");
    user.role = role;
    return this.repo.save(user);
  }

  async create(payload: Partial<User>) {
    const user = this.repo.create(payload);
    return this.repo.save(user);
  }

  async findAllVoters(page: number, limit: number, search?: string) {
    const qb = this.repo
      .createQueryBuilder("user")
      .leftJoinAndSelect("user.ward", "ward")
      .where("user.role IN (:...roles)", { roles: ["voter", "aspirant"] });

    if (search) {
      qb.andWhere("LOWER(user.name) LIKE :search", {
        search: `%${search.toLowerCase()}%`,
      });
    }

    const [users, total] = await qb
      .orderBy("user.name", "ASC")
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const totalUsers = await this.repo.count({
      where: [{ role: "voter" as any }, { role: "aspirant" as any }],
    });

    return {
      totalUsers,
      data: users.map((u) => ({
        id: u.id,
        name: u.name,
        profilePicture: u.profilePicture,
        // epicId intentionally omitted — voter EPIC IDs are sensitive PII and
        // must not be returned in list responses.
        role: u.role,
        isBlocked: u.isBlocked,
        wardId: u.wardId,
        nameEn: u.nameEn,
        nameKn: u.nameKn,
        corporationName: u.corporationName,
        corporationNameL1: u.corporationNameL1,
        wardName: u.wardName,
        wardNameL1: u.wardNameL1,
        psName: u.psName,
        psNameL1: u.psNameL1,
        psLong:
          u.psLong !== undefined && u.psLong !== null
            ? String(u.psLong)
            : u.psLong,
        psLat:
          u.psLat !== undefined && u.psLat !== null ? String(u.psLat) : u.psLat,
        ward: u.ward
          ? {
              id: u.ward.id,
              createdAt: u.ward.createdAt,
              updatedAt: u.ward.updatedAt,
              number: u.ward.number,
              name: u.ward.name,
              state: u.ward.state,
              parliamentary: u.ward.parliamentary,
              assembly: u.ward.assembly,
              zone: u.ward.zone,
              category: u.ward.category,
            }
          : null,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async createReport(
    createReportDto: CreateReportDto,
    reportedById?: number,
    file?: Express.Multer.File,
  ) {
    // Check if reported user exists
    const reportedUser = await this.repo.findOne({
      where: { id: createReportDto.reportedUserId },
    });

    if (!reportedUser) {
      throw new NotFoundException("Reported user not found");
    }

    // Validate file type if provided
    if (file) {
      const allowedMimeTypes = [
        "application/pdf",
        "image/jpeg",
        "image/jpg",
        "image/png",
      ];
      if (!allowedMimeTypes.includes(file.mimetype)) {
        throw new BadRequestException(
          "Only PDF, JPEG, and PNG files are allowed",
        );
      }
    }

    // Upload file to S3 if provided
    let attachmentUrl: string | undefined;
    if (file) {
      attachmentUrl = await this.s3Service.uploadFile(file, "reports");
    }

    // Create the report
    const report = this.reportRepo.create({
      reportedUserId: createReportDto.reportedUserId,
      reportedUserType: createReportDto.reportedUserType,
      reason: createReportDto.reason,
      ...(reportedById && { reportedById }),
      ...(attachmentUrl && { attachmentUrl }),
      status: "pending",
    });

    return this.reportRepo.save(report);
  }

  async getAllReports(status?: string, page?: number, limit?: number) {
    const queryBuilder = this.reportRepo
      .createQueryBuilder("report")
      .leftJoinAndSelect("report.reportedUser", "reportedUser")
      .leftJoinAndSelect("report.reportedBy", "reportedBy")
      .leftJoinAndSelect("report.resolvedBy", "resolvedBy")
      .orderBy("report.createdAt", "DESC");

    if (status) {
      queryBuilder.where("report.status = :status", { status });
    }

    // Backwards-compatible: when callers don't request pagination, return the
    // bare array (the historical admin response shape). Pagination kicks in
    // only when page or limit is explicitly provided.
    if (page === undefined && limit === undefined) {
      return queryBuilder.getMany();
    }

    const safeLimit = Math.min(Math.max(limit ?? 50, 1), 200);
    const safePage = Math.max(page ?? 1, 1);
    queryBuilder.skip((safePage - 1) * safeLimit).take(safeLimit);

    const [data, total] = await queryBuilder.getManyAndCount();
    return {
      data,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  async getReportById(id: number) {
    const report = await this.reportRepo
      .createQueryBuilder("report")
      .leftJoinAndSelect("report.reportedUser", "reportedUser")
      .leftJoinAndSelect("report.reportedBy", "reportedBy")
      .leftJoinAndSelect("report.resolvedBy", "resolvedBy")
      .where("report.id = :id", { id })
      .getOne();

    if (!report) {
      throw new NotFoundException("Report not found");
    }

    return report;
  }

  async getReportsByUser(userId: number) {
    return this.reportRepo
      .createQueryBuilder("report")
      .leftJoinAndSelect("report.reportedUser", "reportedUser")
      .where("report.reportedById = :userId", { userId })
      .orderBy("report.createdAt", "DESC")
      .getMany();
  }

  async updateReportStatus(
    id: number,
    status: "pending" | "resolved" | "rejected",
    adminNotes?: string,
    resolvedById?: number,
  ) {
    const report = await this.reportRepo.findOne({ where: { id } });

    if (!report) {
      throw new NotFoundException("Report not found");
    }

    report.status = status;
    if (adminNotes) {
      report.adminNotes = adminNotes;
    }

    if (status === "resolved" || status === "rejected") {
      report.resolvedAt = new Date();
      if (resolvedById) {
        report.resolvedById = resolvedById;
      }
    }

    return this.reportRepo.save(report);
  }

  async getAllUsers(wardId?: number): Promise<User[]> {
    const query = this.repo
      .createQueryBuilder("user")
      .leftJoinAndSelect("user.ward", "ward")
      .orderBy("user.createdAt", "DESC");

    if (wardId) {
      query.where("user.wardId = :wardId", { wardId });
    }

    return query.getMany();
  }

  async voterCounts(wardIds?: number[]) {
    const qb = this.repo
      .createQueryBuilder("user")
      .select("user.wardId", "wardId")
      .addSelect("COUNT(user.id)", "total")
      .where("user.role = :role", { role: "voter" })
      .groupBy("user.wardId");

    if (wardIds?.length)
      qb.andWhere("user.wardId IN (:...wardIds)", { wardIds });

    const rows = await qb.getRawMany();
    return rows.map((row) => ({
      wardId: Number(row.wardId),
      total: Number(row.total),
    }));
  }

  async getUserById(id: number): Promise<User> {
    const user = await this.repo.findOne({
      where: { id },
      relations: ["ward"],
    });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    return user;
  }

  async updateUser(id: number, dto: UpdateUserDto): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    // Update fields
    if (dto.name !== undefined) user.name = dto.name;
    if (dto.phone !== undefined) {
      if (dto.phone) {
        const existing = await this.repo.findOne({
          where: { phone: dto.phone },
        });
        if (existing && existing.id !== id) {
          throw new BadRequestException("Phone already in use");
        }
      }
      user.phone = dto.phone;
      // Sync phone to aspirant profile if user is an aspirant
      const aspirant = await this.aspirantRepo.findOne({
        where: { userId: id },
      });
      if (aspirant) {
        aspirant.phone = dto.phone;
        await this.aspirantRepo.save(aspirant);
      }
    }
    if (dto.relativeName !== undefined) user.relativeName = dto.relativeName;
    if (dto.epicId !== undefined) user.epicId = dto.epicId;
    if (dto.gender !== undefined) user.gender = dto.gender;
    if ((dto as any).age !== undefined) user.age = (dto as any).age;
    if (dto.wardId !== undefined) user.wardId = dto.wardId;
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.isBlocked !== undefined) user.isBlocked = dto.isBlocked;
    if (dto.profilePicture !== undefined)
      user.profilePicture = dto.profilePicture;
    if (dto.lokSabhaConstituencyId !== undefined)
      user.lokSabhaConstituencyId = dto.lokSabhaConstituencyId;
    if (dto.stateAssemblyConstituencyId !== undefined)
      user.stateAssemblyConstituencyId = dto.stateAssemblyConstituencyId;
    if (dto.municipalCorporationConstituencyId !== undefined)
      user.municipalCorporationConstituencyId =
        dto.municipalCorporationConstituencyId;
    if (dto.gramPanchayatConstituencyId !== undefined)
      user.gramPanchayatConstituencyId = dto.gramPanchayatConstituencyId;

    return this.repo.save(user);
  }

  async updateConstituencies(
    userId: number,
    dto: {
      lokSabhaConstituencyId?: number;
      stateAssemblyConstituencyId?: number;
      municipalCorporationConstituencyId?: number;
      gramPanchayatConstituencyId?: number;
    },
  ): Promise<User> {
    const user = await this.repo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    if (dto.lokSabhaConstituencyId !== undefined)
      user.lokSabhaConstituencyId = dto.lokSabhaConstituencyId;
    if (dto.stateAssemblyConstituencyId !== undefined)
      user.stateAssemblyConstituencyId = dto.stateAssemblyConstituencyId;
    if (dto.municipalCorporationConstituencyId !== undefined)
      user.municipalCorporationConstituencyId =
        dto.municipalCorporationConstituencyId;
    if (dto.gramPanchayatConstituencyId !== undefined)
      user.gramPanchayatConstituencyId = dto.gramPanchayatConstituencyId;

    return this.repo.save(user);
  }

  async blockUser(id: number): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    user.isBlocked = true;
    const saved = await this.repo.save(user);
    // Invalidate every JWT the blocked user is holding so they can't keep
    // calling protected endpoints until their token naturally expires.
    await this.revokeAllSessions(id).catch(() => undefined);
    return saved;
  }

  async unblockUser(id: number): Promise<User> {
    const user = await this.repo.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    user.isBlocked = false;
    const saved = await this.repo.save(user);
    // Bump tokenVersion on unblock too — any JWT minted before block had
    // isBlocked=false in its payload, but we still want unblocked users
    // re-authenticated cleanly with a fresh token.
    await this.revokeAllSessions(id).catch(() => undefined);
    return saved;
  }

  async deleteUser(id: number): Promise<void> {
    const user = await this.repo.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException("User not found");
    }

    // Use transaction to ensure all deletions happen atomically
    await this.dataSource.transaction(async (manager) => {
      // Delete all votes by this user
      await manager.delete(Vote, { userId: id });

      // Delete all forum messages by this user
      await manager.delete(Message, { userId: id });

      // Delete all aspirant messages by this user
      await manager.delete(AspirantMessage, { userId: id });

      // Delete all aspirant discussion messages by this user
      await manager.delete(AspirantDiscussionMessage, { userId: id });

      // Delete all signed documents by this user
      await manager.delete(UserSignedDocument, { userId: id });

      // Delete all aspirant bookings by this user (voterId)
      await manager.delete(AspirantBooking, { voterId: id });

      // Delete all visit responses by this user (voterId)
      await manager.delete(VisitResponse, { voterId: id });

      // Delete ward meetings created by this user
      await manager.delete(WardMeeting, { createdById: id });

      // Delete aspirants created by this user
      await manager.delete(Aspirant, { userId: id });

      // Delete all user-aspirant interactions by this user
      await manager.delete(UserAspirantInteraction, { userId: id });

      // Handle reports: Delete reports where user is the reported user
      await manager.delete(Report, { reportedUserId: id });

      // Update reports where user is the reporter or resolver (set to null)
      await manager.update(
        Report,
        { reportedById: id },
        { reportedById: null as any },
      );
      await manager.update(
        Report,
        { resolvedById: id },
        { resolvedById: null as any },
      );

      // Finally, delete the user
      await manager.remove(user);
    });
  }

  async getUsersByWard(wardId: number, page?: number, limit?: number) {
    // Bare-array response is preserved when caller doesn't ask for pagination
    // (matches the historical admin endpoint behaviour).
    if (page === undefined && limit === undefined) {
      return this.repo.find({
        where: { wardId },
        relations: ["ward"],
        order: { createdAt: "DESC" },
      });
    }

    const safeLimit = Math.min(Math.max(limit ?? 50, 1), 200);
    const safePage = Math.max(page ?? 1, 1);
    const [data, total] = await this.repo.findAndCount({
      where: { wardId },
      relations: ["ward"],
      order: { createdAt: "DESC" },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });
    return {
      data,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(total / safeLimit),
    };
  }

  // Interaction tracking methods
  private async trackInteraction(
    userId: number,
    aspirantId: number,
    type: InteractionType,
    at?: Date,
  ): Promise<{ user: User; message: string }> {
    const flagCol = {
      chat: "isChat",
      meeting: "isMeeting",
      directMeet: "isDirectMeet",
      phoneCall: "isPhoneCall",
    }[type];

    const interactionLabel = {
      chat: "Chat",
      meeting: "Meeting",
      directMeet: "Direct meet",
      phoneCall: "Phone call",
    }[type];

    const [user, aspirant] = await Promise.all([
      this.repo.findOne({ where: { id: userId } }),
      this.aspirantRepo.findOne({ where: { id: aspirantId } }),
    ]);
    if (!user) throw new NotFoundException("User not found");
    if (!aspirant) throw new NotFoundException("Aspirant not found");

    // SELECT-then-INSERT/UPDATE keeps behavior identical to the original
    // four track* methods and doesn't depend on a DB unique constraint.
    const existing = await this.userAspirantInteractionRepo.findOne({
      where: { userId, aspirantId },
    });
    if (existing) {
      (existing as any)[flagCol] = true;
      if (type === "phoneCall") (existing as any).phoneCallAt = at ?? new Date();
      await this.userAspirantInteractionRepo.save(existing);
    } else {
      await this.userAspirantInteractionRepo.save({
        userId,
        aspirantId,
        [flagCol]: true,
        ...(type === "phoneCall" ? { phoneCallAt: at ?? new Date() } : {}),
      } as any);
    }

    const uniqueAspirants = await this.userAspirantInteractionRepo
      .createQueryBuilder("interaction")
      .where("interaction.userId = :userId", { userId })
      .select("COUNT(DISTINCT interaction.aspirantId)", "count")
      .getRawOne();

    const count = parseInt(uniqueAspirants.count);
    const requiredCount = 1;
    const aspirantLabel = aspirant.name || `#${aspirantId}`;
    const message =
      `${interactionLabel} interaction tracked with aspirant ${aspirantLabel}.` +
      (count >= requiredCount
        ? ` You have interacted with ${count} aspirant(s). Voting enabled!`
        : ` Interact with ${requiredCount - count} more aspirant(s) to enable voting.`);

    const userPatch: Partial<User> = { lastInteractionMessage: message };
    if (count >= requiredCount) {
      (userPatch as any)[flagCol] = true;
    }
    await this.repo.update(userId, userPatch);
    Object.assign(user, userPatch);

    return { user, message };
  }

  trackChat(userId: number, aspirantId: number) {
    return this.trackInteraction(userId, aspirantId, "chat");
  }

  trackMeeting(userId: number, aspirantId: number) {
    return this.trackInteraction(userId, aspirantId, "meeting");
  }

  trackDirectMeet(userId: number, aspirantId: number) {
    return this.trackInteraction(userId, aspirantId, "directMeet");
  }

  trackPhoneCall(userId: number, aspirantId: number, at?: Date) {
    return this.trackInteraction(userId, aspirantId, "phoneCall", at);
  }

  async clearPhone(userId: number) {
    await this.repo.update(userId, { phone: undefined } as any);
  }

  async hasAnyInteraction(userId: number): Promise<boolean> {
    const user = await this.repo.findOne({ where: { id: userId } });
    if (!user) return false;
    return user.isChat || user.isMeeting || user.isPhoneCall;
  }

  async deleteAccount(userId: number) {
    const user = await this.repo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    if (user.role !== "voter") {
      throw new BadRequestException("Only voters can delete their account");
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Delete from child/referencing tables first to avoid FK errors
      // Tables referencing userId as voterId
      await queryRunner.query(
        `DELETE FROM "activity_ratings" WHERE "voterId" = $1`,
        [userId],
      );
      await queryRunner.query(
        `DELETE FROM "meeting_responses" WHERE "voterId" = $1`,
        [userId],
      );
      await queryRunner.query(
        `DELETE FROM "visit_responses" WHERE "voterId" = $1`,
        [userId],
      );
      await queryRunner.query(
        `DELETE FROM "aspirant_bookings" WHERE "voterId" = $1`,
        [userId],
      );

      // Tables referencing userId as userId
      await queryRunner.query(`DELETE FROM "votes" WHERE "userId" = $1`, [
        userId,
      ]);
      await queryRunner.query(`DELETE FROM "messages" WHERE "user_id" = $1`, [
        userId,
      ]);
      await queryRunner.query(
        `DELETE FROM "aspirant_messages" WHERE "user_id" = $1`,
        [userId],
      );
      await queryRunner.query(
        `DELETE FROM "aspirant_discussion_messages" WHERE "user_id" = $1`,
        [userId],
      );
      await queryRunner.query(
        `DELETE FROM "user_aspirant_interactions" WHERE "userId" = $1`,
        [userId],
      );
      await queryRunner.query(
        `DELETE FROM "user_signed_documents" WHERE "userId" = $1`,
        [userId],
      );
      await queryRunner.query(
        `DELETE FROM "ward_meetings" WHERE "created_by_id" = $1`,
        [userId],
      );

      // Aspirant and its child tables (user may have been an aspirant before withdrawing)
      const aspirantRows = await queryRunner.query(
        `SELECT "id" FROM "aspirants" WHERE "userId" = $1`,
        [userId],
      );
      if (aspirantRows.length > 0) {
        const aspirantIds = aspirantRows.map((r: any) => r.id);
        // Delete children of aspirant meetings first
        await queryRunner.query(
          `DELETE FROM "meeting_responses" WHERE "meetingId" IN (SELECT "id" FROM "aspirant_meetings" WHERE "aspirantId" = ANY($1))`,
          [aspirantIds],
        );
        await queryRunner.query(
          `DELETE FROM "aspirant_meetings" WHERE "aspirantId" = ANY($1)`,
          [aspirantIds],
        );
        // Delete children of aspirant visits
        await queryRunner.query(
          `DELETE FROM "visit_responses" WHERE "visitId" IN (SELECT "id" FROM "aspirant_visits" WHERE "aspirantId" = ANY($1))`,
          [aspirantIds],
        );
        await queryRunner.query(
          `DELETE FROM "aspirant_visits" WHERE "aspirantId" = ANY($1)`,
          [aspirantIds],
        );
        await queryRunner.query(
          `DELETE FROM "aspirant_bookings" WHERE "aspirantId" = ANY($1)`,
          [aspirantIds],
        );
        await queryRunner.query(
          `DELETE FROM "activity_ratings" WHERE "aspirantId" = ANY($1)`,
          [aspirantIds],
        );
        await queryRunner.query(
          `DELETE FROM "aspirant_messages" WHERE "aspirant_id" = ANY($1)`,
          [aspirantIds],
        );
        await queryRunner.query(
          `DELETE FROM "aspirant_discussion_messages" WHERE "aspirant_id" = ANY($1)`,
          [aspirantIds],
        );
        await queryRunner.query(
          `DELETE FROM "votes" WHERE "aspirantId" = ANY($1)`,
          [aspirantIds],
        );
        await queryRunner.query(
          `DELETE FROM "user_aspirant_interactions" WHERE "aspirantId" = ANY($1)`,
          [aspirantIds],
        );
        await queryRunner.query(
          `DELETE FROM "aspirants" WHERE "id" = ANY($1)`,
          [aspirantIds],
        );
      }

      // Issues tables
      await queryRunner.query(
        `DELETE FROM "issue_hand_raises" WHERE "createdById" = $1`,
        [userId],
      );
      await queryRunner.query(`DELETE FROM "issues" WHERE "createdById" = $1`, [
        userId,
      ]);

      // Reports (both as reporter and reported)
      await queryRunner.query(
        `DELETE FROM "reports" WHERE "reported_by_id" = $1 OR "reported_user_id" = $1`,
        [userId],
      );

      // OTPs
      await queryRunner.query(
        `DELETE FROM "otps" WHERE "email" = $1 OR "phone" = $2`,
        [user.email, user.phone],
      );

      // Pending aspirant registrations
      await queryRunner.query(
        `DELETE FROM "pending_aspirant_registrations" WHERE "userId" = $1`,
        [userId],
      );

      // Disable FK checks and delete the user
      await queryRunner.query(`SET session_replication_role = 'replica'`);
      await queryRunner.query(`DELETE FROM "users" WHERE "id" = $1`, [userId]);
      await queryRunner.query(`SET session_replication_role = 'origin'`);

      await queryRunner.commitTransaction();
      // After a successful hard delete, evict the user's tokenVersion key so
      // we don't leak cache entries for vanished users. (Their JWT is now
      // worthless anyway because the user row is gone.)
      await this.cache.del(tokenVersionCacheKey(userId)).catch(() => undefined);
      return { message: "Account permanently deleted" };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      console.error(
        `[DeleteAccount] Hard delete failed for userId=${userId}:`,
        (error as any)?.message || error,
      );

      // Hard delete failed — soft delete instead
      user.isSelfDeleted = true;
      user.name = "Deleted User";
      user.phone = undefined;
      user.profilePicture = undefined;
      user.lastOtp = null;
      await this.repo.save(user);

      // Clear phone in aspirant table too
      await this.aspirantRepo.update({ userId }, { phone: null as any });

      // Revoke every outstanding session for the soft-deleted user.
      await this.revokeAllSessions(userId).catch(() => undefined);

      return { message: "Account deactivated" };
    } finally {
      await queryRunner.release();
    }
  }

  async reactivateAccount(
    email: string,
    userData: Partial<User>,
  ): Promise<User | null> {
    const user = await this.repo.findOne({ where: { email } });
    if (!user) return null;
    if (!user.isSelfDeleted && !user.isBlocked) return null;

    // Reactivate the old account with new data
    user.isBlocked = false;
    user.isSelfDeleted = false;
    user.name = userData.name || user.name;
    user.role = "voter";
    if (userData.wardId !== undefined) user.wardId = userData.wardId;
    if (userData.voterEpic) user.voterEpic = userData.voterEpic;
    if (userData.nameEn) user.nameEn = userData.nameEn;
    if (userData.nameKn) user.nameKn = userData.nameKn;
    if (userData.corporationName)
      user.corporationName = userData.corporationName;
    if (userData.corporationNameL1)
      user.corporationNameL1 = userData.corporationNameL1;
    if (userData.wardName) user.wardName = userData.wardName;
    if (userData.wardNameL1) user.wardNameL1 = userData.wardNameL1;
    if (userData.psName) user.psName = userData.psName;
    if (userData.psNameL1) user.psNameL1 = userData.psNameL1;
    if (userData.psLong !== undefined) user.psLong = userData.psLong;
    if (userData.psLat !== undefined) user.psLat = userData.psLat;
    if (userData.age !== undefined) user.age = userData.age;
    if (userData.gender) user.gender = userData.gender;
    if (userData.profilePicture) user.profilePicture = userData.profilePicture;

    return this.repo.save(user);
  }
}
