import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, DataSource } from "typeorm";
import { Issue } from "./issue.entity";
import { HandRaise } from "./hand-raise.entity";
import { ElectionsService } from "../elections/elections.service";
import { WardsService } from "../wards/wards.service";
import { UsersService } from "../users/users.service";
import { CreateIssueDto } from "./dto/create-issue.dto";
import { UpdateIssueDto } from "./dto/update-issue.dto";
import { CreateHandRaiseDto } from "./dto/create-hand-raise.dto";

export const ISSUE_CATEGORIES = [
  "Jobs issues",
  "Health issues",
  "Education issues",
  "Roads issues",
  "Water issues",
  "Sewage issues",
  "Garbage issues",
  "Street Lights issues",
  "Safety issues",
  "Parks issues",
  "Construction issues",
  "Electricity issues",
  "Environment issues",
  "Government Services issues",
  "Public Infrastructure issues",

  "others",
];

const CATEGORY_KANNADA: Record<string, string> = {
  "Jobs issues": "ಉದ್ಯೋಗ ಸಮಸ್ಯೆಗಳು",
  "Health issues": "ಆರೋಗ್ಯ ಸಮಸ್ಯೆಗಳು",
  "Education issues": "ಶಿಕ್ಷಣ ಸಮಸ್ಯೆಗಳು",
  "Roads issues": "ರಸ್ತೆ ಸಮಸ್ಯೆಗಳು",
  "Water issues": "ನೀರಿನ ಸಮಸ್ಯೆಗಳು",
  "Sewage issues": "ಒಳಚರಂಡಿ ಸಮಸ್ಯೆಗಳು",
  "Garbage issues": "ಕಸದ ಸಮಸ್ಯೆಗಳು",
  "Street Lights issues": "ಬೀದಿ ದೀಪಗಳ ಸಮಸ್ಯೆಗಳು",
  "Safety issues": "ಭದ್ರತಾ ಸಮಸ್ಯೆಗಳು",
  "Parks issues": "ಉದ್ಯಾನವನಗಳ ಸಮಸ್ಯೆಗಳು",
  "Construction issues": "ನಿರ್ಮಾಣ ಸಮಸ್ಯೆಗಳು",
  "Electricity issues": "ವಿದ್ಯುತ್ ಸಮಸ್ಯೆಗಳು",
  "Environment issues": "ಪರಿಸರ ಸಮಸ್ಯೆಗಳು",
  "Government Services issues": "ಸರ್ಕಾರಿ ಸೇವೆಗಳ ಸಮಸ್ಯೆಗಳು",
  "Public Infrastructure issues": "ಸಾರ್ವಜನಿಕ ಮೂಲಸೌಕರ್ಯ ಸಮಸ್ಯೆಗಳು",
  others: "ಇತರೆ ಸಮಸ್ಯೆಗಳು",
};

@Injectable()
export class IssuesService {
  constructor(
    @InjectRepository(Issue) private readonly repo: Repository<Issue>,
    @InjectRepository(HandRaise)
    private readonly handRepo: Repository<HandRaise>,
    private readonly electionsService: ElectionsService,
    private readonly wardsService: WardsService,
    private readonly usersService: UsersService,
    private readonly dataSource: DataSource,
  ) {}

  /** Resolve wardId for municipal_corporation elections */
  private async resolveWardId(
    electionId: number,
    constituencyId: number,
  ): Promise<number | undefined> {
    const election = await this.electionsService.findById(electionId);
    if (election.type === "municipal_corporation") {
      await this.wardsService.findOne(constituencyId);
      return constituencyId;
    }
    return undefined;
  }

  async createIssue(
    userId: number,
    electionId: number,
    constituencyId: number,
    dto: CreateIssueDto,
  ) {
    const wardId = await this.resolveWardId(electionId, constituencyId);

    const issue = this.repo.create({
      electionId,
      constituencyId,
      wardId,
      createdById: userId,
      title: dto.title,
      description: dto.description,
    });

    return this.repo.save(issue);
  }

  async listIssues(
    electionId: number,
    constituencyId: number,
    userId?: number,
  ) {
    // validate election exists
    await this.electionsService.findById(electionId);

    const issues = await this.repo.find({
      where: { electionId, constituencyId },
      order: { createdAt: "DESC" },
    });

    const categories = await this.getCategoryCounts(
      electionId,
      constituencyId,
      userId,
    );

    // Total = sum of every category's hand-raise count for this
    // election + constituency. Each hand_raise row belongs to exactly one
    // category, so summing the per-category counts is exact (no double-count).
    const totalHandRaises = categories.reduce(
      (sum, c) => sum + (c.count ?? 0),
      0,
    );

    return { issues, categories, totalHandRaises };
  }

  async getCategoryCounts(
    electionId: number,
    constituencyId: number,
    userId?: number,
  ) {
    // Single GROUP BY pulls every category's count plus whether the current
    // user has raised that category — no per-category round-trip.
    const qb = this.handRepo
      .createQueryBuilder("h")
      .select("h.category", "category")
      .addSelect("COUNT(*)::int", "cnt")
      .where('h."electionId" = :electionId', { electionId })
      .andWhere('h."constituencyId" = :constituencyId', { constituencyId })
      .groupBy("h.category");

    if (userId !== undefined) {
      qb.addSelect('BOOL_OR(h."createdById" = :uid)', "raised").setParameter(
        "uid",
        userId,
      );
    }

    const rows: Array<{
      category: string;
      cnt: number;
      raised?: boolean;
    }> = await qb.getRawMany();

    const dbMap = new Map<string, { count: number; isRaised?: boolean }>();
    for (const r of rows) {
      dbMap.set(r.category, {
        count: Number(r.cnt),
        isRaised: userId !== undefined ? Boolean(r.raised) : undefined,
      });
    }

    const results: {
      name: string;
      nameKn: string;
      count: number;
      isRaised?: boolean;
    }[] = [];

    // Static categories first (preserve well-known order, default count to 0).
    for (const name of ISSUE_CATEGORIES) {
      const stats = dbMap.get(name);
      const entry: {
        name: string;
        nameKn: string;
        count: number;
        isRaised?: boolean;
      } = {
        name,
        nameKn: CATEGORY_KANNADA[name] ?? name,
        count: stats?.count ?? 0,
      };
      if (userId !== undefined) entry.isRaised = stats?.isRaised ?? false;
      results.push(entry);
    }

    // Dynamic / unexpected categories that were saved in DB but not in the
    // static list — surface them with their counts too.
    for (const [category, stats] of dbMap) {
      if (ISSUE_CATEGORIES.includes(category)) continue;
      const entry: {
        name: string;
        nameKn: string;
        count: number;
        isRaised?: boolean;
      } = {
        name: category,
        nameKn: CATEGORY_KANNADA[category] ?? category,
        count: stats.count,
      };
      if (userId !== undefined) entry.isRaised = stats.isRaised ?? false;
      results.push(entry);
    }

    return results;
  }

  async createHandRaise(
    userId: number,
    electionId: number,
    constituencyId: number,
    dto: CreateHandRaiseDto,
  ) {
    // validate election exists
    await this.electionsService.findById(electionId);

    const category = dto.category?.trim();
    if (!category) throw new BadRequestException("Category is required");

    const matched = ISSUE_CATEGORIES.find(
      (c) => c.toLowerCase() === category.toLowerCase(),
    );
    const catToUse = matched || category;

    const wardId = await this.resolveWardId(electionId, constituencyId);

    return this.dataSource.transaction(async (manager) => {
      // Serialize concurrent toggles for the same (user, election, constituency, category);
      // lock auto-releases at transaction end.
      await manager.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`handraise:${electionId}:${constituencyId}:${userId}:${catToUse}`],
      );
      const handRepo = manager.getRepository(HandRaise);
      const existing = await handRepo.findOne({
        where: {
          electionId,
          constituencyId,
          createdById: userId,
          category: catToUse,
        },
      });
      if (existing) {
        await handRepo.delete(existing.id);
        return { raised: false };
      }
      await handRepo.save(
        handRepo.create({
          electionId,
          constituencyId,
          wardId,
          createdById: userId,
          category: catToUse,
        }),
      );
      return { raised: true };
    });
  }

  getCategories() {
    return ISSUE_CATEGORIES;
  }

  async getIssue(electionId: number, constituencyId: number, id: number) {
    const issue = await this.repo.findOne({
      where: { id, electionId, constituencyId },
    });
    if (!issue) throw new NotFoundException("Issue not found");
    return issue;
  }

  async updateIssue(
    userId: number,
    electionId: number,
    constituencyId: number,
    id: number,
    dto: UpdateIssueDto,
  ) {
    const issue = await this.getIssue(electionId, constituencyId, id);
    const user = await this.usersService.findById(userId);
    const isCreator = issue.createdById === userId;
    const isAdmin = user && user.role === "admin";
    if (!isCreator && !isAdmin)
      throw new ForbiddenException("Not authorized to update this issue");

    if (dto.title !== undefined) issue.title = dto.title;
    if (dto.description !== undefined) issue.description = dto.description;
    if (dto.isActive !== undefined) issue.isActive = dto.isActive;

    return this.repo.save(issue);
  }

  async deleteIssue(
    userId: number,
    electionId: number,
    constituencyId: number,
    id: number,
  ) {
    const issue = await this.getIssue(electionId, constituencyId, id);
    const user = await this.usersService.findById(userId);
    const isCreator = issue.createdById === userId;
    const isAdmin = user && user.role === "admin";
    if (!isCreator && !isAdmin)
      throw new ForbiddenException("Not authorized to delete this issue");

    await this.repo.delete(id);
    return { deleted: 1 };
  }
}
