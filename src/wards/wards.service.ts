import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CreateWardDto } from "./dto/create-ward.dto";
import { Ward } from "./ward.entity";
import { GetWardsDto } from "./dto/get-wards.dto";
import { WardMeeting } from "./ward-meeting.entity";
import { CreateWardMeetingDto } from "./dto/create-ward-meeting.dto";
import { UpdateWardMeetingDto } from "./dto/update-ward-meeting.dto";

@Injectable()
export class WardsService {
  constructor(
    @InjectRepository(Ward) private readonly repo: Repository<Ward>,
    @InjectRepository(WardMeeting)
    private readonly meetingRepo: Repository<WardMeeting>,
  ) {}

  async create(dto: CreateWardDto) {
    const existing = await this.repo.findOne({ where: { number: dto.number } });
    if (existing) {
      throw new ConflictException("Ward number already exists");
    }
    const ward = this.repo.create({
      ...dto,
      state: dto.state ?? "N/A",
      parliamentary: dto.parliamentary ?? "N/A",
      assembly: dto.assembly ?? "N/A",
      zone: dto.zone ?? "N/A",
    });
    return this.repo.save(ward);
  }

  findAll(query?: GetWardsDto) {
    if (!query || (!query.state && !query.parliamentary && !query.assembly)) {
      return this.repo.find();
    }

    const where: any = {};
    if (query.state) where.state = query.state;
    if (query.parliamentary) where.parliamentary = query.parliamentary;
    if (query.assembly) where.assembly = query.assembly;

    return this.repo.find({ where, order: { number: "ASC" } });
  }

  async findOne(id: number) {
    const ward = await this.repo.findOne({ where: { id } });
    if (!ward) throw new NotFoundException("Ward not found");
    return ward;
  }

  async update(id: number, dto: Partial<CreateWardDto>) {
    const ward = await this.findOne(id);
    if (dto.number !== undefined) ward.number = dto.number;
    if (dto.name !== undefined) ward.name = dto.name;
    if (dto.state !== undefined) ward.state = dto.state;
    if (dto.parliamentary !== undefined) ward.parliamentary = dto.parliamentary;
    if (dto.assembly !== undefined) ward.assembly = dto.assembly;
    if (dto.zone !== undefined) ward.zone = dto.zone!;
    if (dto.category !== undefined) ward.category = dto.category;
    if (dto.municipality !== undefined) ward.municipality = dto.municipality!;
    return this.repo.save(ward);
  }

  async delete(id: number) {
    const ward = await this.findOne(id);
    await this.repo.remove(ward);
    return { message: `Ward '${ward.number} - ${ward.name}' deleted` };
  }

  findByMunicipality(municipality: string) {
    return this.repo.find({
      where: { municipality },
      order: { number: "ASC" },
    });
  }

  async findByNumber(number: string) {
    const ward = await this.repo.findOne({ where: { number } });
    if (!ward) throw new NotFoundException("Ward not found");
    return ward;
  }

  async findByName(name: string) {
    const trimmedName = name.trim();

    const ward = await this.repo
      .createQueryBuilder("ward")
      .where("LOWER(TRIM(ward.name)) = LOWER(:name)", { name: trimmedName })
      .getOne();
    if (ward) return ward;

    throw new NotFoundException(`Ward not found with name: ${name}`);
  }

  // Return simplified list of wards with number, name and category
  listSimple() {
    return this.repo
      .createQueryBuilder("ward")
      .select(["ward.number", "ward.name", "ward.category"])
      .orderBy("ward.number", "ASC")
      .getRawMany();
  }

  // Search wards by name or number (public); returns id, name, number, category
  search(q?: string) {
    const qb = this.repo
      .createQueryBuilder("ward")
      .select(["ward.id", "ward.name", "ward.number", "ward.category"])
      .orderBy("ward.number", "ASC");

    if (q) {
      qb.where("ward.name ILIKE :q OR ward.number ILIKE :q", { q: `%${q}%` });
    }

    return qb.getMany();
  }

  // Return wards ordered by voter count (highest first)
  async listByVoterCount() {
    const rows = await this.repo
      .createQueryBuilder("ward")
      .leftJoin("ward.users", "usr")
      .select(["ward.id as id", "ward.number as number", "ward.name as name"])
      .addSelect(
        "COUNT(DISTINCT usr.id) FILTER (WHERE usr.role = 'voter')",
        "voter_count",
      )
      .addSelect(
        "COUNT(DISTINCT usr.id) FILTER (WHERE usr.role = 'aspirant')",
        "aspirant_record_count",
      )
      .addSelect(
        "COUNT(DISTINCT usr.id) FILTER (WHERE usr.role = 'aspirant')",
        "user_aspirant_count",
      )
      .addSelect(
        "COUNT(DISTINCT usr.id) FILTER (WHERE usr.role IN ('voter', 'aspirant'))",
        "total_count",
      )
      .groupBy("ward.id")
      .orderBy("total_count", "DESC")
      .getRawMany();

    return rows.map((r) => ({
      id: Number(r.id),
      number: r.number,
      name: r.name,
      voterOnlyCount: Number(r.voter_count),
      aspirantRecordCount: Number(r.aspirant_record_count),
      userAspirantCount: Number(r.user_aspirant_count),
      voterCount: Number(r.total_count), // kept for backward compatibility: combined total
    }));
  }

  // Ward Meeting methods
  async createMeeting(
    dto: CreateWardMeetingDto,
    createdById: number,
  ): Promise<WardMeeting> {
    // Verify ward exists
    const ward = await this.repo.findOne({ where: { id: dto.wardId } });
    if (!ward) {
      throw new NotFoundException("Ward not found");
    }

    const meeting = this.meetingRepo.create({
      wardId: dto.wardId,
      title: dto.title,
      description: dto.description,
      meetingLink: dto.meetingLink,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
      createdById,
      isActive: true,
    });

    return this.meetingRepo.save(meeting);
  }

  async getAllMeetings(
    wardId?: number,
    isActive?: boolean,
  ): Promise<WardMeeting[]> {
    const query = this.meetingRepo
      .createQueryBuilder("meeting")
      .leftJoinAndSelect("meeting.ward", "ward")
      .leftJoinAndSelect("meeting.createdBy", "createdBy")
      .orderBy("meeting.scheduledAt", "DESC");

    if (wardId !== undefined) {
      query.andWhere("meeting.wardId = :wardId", { wardId });
    }

    if (isActive !== undefined) {
      query.andWhere("meeting.isActive = :isActive", { isActive });
    }

    return query.getMany();
  }

  async getMeetingById(id: number): Promise<WardMeeting> {
    const meeting = await this.meetingRepo.findOne({
      where: { id },
      relations: { ward: true, createdBy: true },
    });

    if (!meeting) {
      throw new NotFoundException("Meeting not found");
    }

    return meeting;
  }

  async updateMeeting(
    id: number,
    dto: UpdateWardMeetingDto,
  ): Promise<WardMeeting> {
    const meeting = await this.meetingRepo.findOne({ where: { id } });

    if (!meeting) {
      throw new NotFoundException("Meeting not found");
    }

    if (dto.title !== undefined) meeting.title = dto.title;
    if (dto.description !== undefined) meeting.description = dto.description;
    if (dto.meetingLink !== undefined) meeting.meetingLink = dto.meetingLink;
    if (dto.scheduledAt !== undefined)
      meeting.scheduledAt = new Date(dto.scheduledAt);
    if (dto.isActive !== undefined) meeting.isActive = dto.isActive;

    return this.meetingRepo.save(meeting);
  }

  async completeMeeting(id: number, notes: string): Promise<WardMeeting> {
    const meeting = await this.meetingRepo.findOne({ where: { id } });
    if (!meeting) {
      throw new NotFoundException("Meeting not found");
    }
    meeting.completed = true;
    meeting.notes = notes;
    meeting.completedAt = new Date();
    return this.meetingRepo.save(meeting);
  }

  async deleteMeeting(id: number): Promise<void> {
    const meeting = await this.meetingRepo.findOne({ where: { id } });

    if (!meeting) {
      throw new NotFoundException("Meeting not found");
    }

    await this.meetingRepo.remove(meeting);
  }

  async getActiveMeetingsByWard(wardId: number): Promise<WardMeeting[]> {
    return this.meetingRepo.find({
      where: { wardId, isActive: true },
      relations: { ward: true, createdBy: true },
      order: { scheduledAt: "DESC" },
    });
  }
}
