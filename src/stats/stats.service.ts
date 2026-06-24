import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "../users/user.entity";
import { Aspirant } from "../aspirants/aspirant.entity";
import { AspirantCandidacy } from "../aspirants/aspirant-candidacy.entity";
import { ElectionsService } from "../elections/elections.service";
import { ElectionType } from "../elections/election.entity";

const USER_CONSTITUENCY_COLUMN: Record<ElectionType, string> = {
  lok_sabha: "lok_sabha_constituency_id",
  state_assembly: "state_assembly_constituency_id",
  municipal_corporation: "municipal_corporation_constituency_id",
  gram_panchayat: "gram_panchayat_constituency_id",
};

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(AspirantCandidacy)
    private readonly candidacyRepo: Repository<AspirantCandidacy>,
    private readonly electionsService: ElectionsService,
  ) {}

  /** Public — total registered citizens (voters + aspirants; admins excluded). */
  async countCitizens(): Promise<{ citizens: number }> {
    const citizens = await this.userRepo.count({
      where: [{ role: "voter" }, { role: "aspirant" }],
    });
    return { citizens };
  }

  /**
   * Public stats for a single constituency: how many users have set this
   * constituency on their profile, and how many fully-onboarded aspirants
   * are registered for it.
   */
  async findStatsByConstituency(electionId: number, constituencyId: number) {
    const election = await this.electionsService.findById(electionId);
    const column = USER_CONSTITUENCY_COLUMN[election.type as ElectionType];

    const [voterRow, aspirantCount, constituencyName] = await Promise.all([
      this.userRepo.manager
        .createQueryBuilder()
        .select("COUNT(u.id)", "count")
        .from("users", "u")
        .where(`u.${column} = :constituencyId`, { constituencyId })
        .andWhere("u.role = :role", { role: "voter" })
        .andWhere("u.is_blocked = false")
        .andWhere("u.is_self_deleted = false")
        .getRawOne<{ count: string }>(),
      // Counts via aspirant_candidacies — not just the aspirant's "primary"
      // electionId/constituencyId — so a multi-race aspirant is counted in
      // every constituency they've declared for.
      this.candidacyRepo
        .createQueryBuilder("c")
        .innerJoin(Aspirant, "a", "a.id = c.aspirantId")
        .where("c.electionId = :electionId", { electionId })
        .andWhere("c.constituencyId = :constituencyId", { constituencyId })
        .andWhere("a.isActive = :isActive", { isActive: true })
        .andWhere("a.sopAgreed = :sopAgreed", { sopAgreed: true })
        .andWhere("a.selfieUrl IS NOT NULL")
        .getCount(),
      this.resolveConstituencyName(
        election.type as ElectionType,
        constituencyId,
      ),
    ]);

    return {
      electionId,
      constituencyId,
      electionType: election.type,
      electionName: election.name,
      constituencyName,
      totalVoters: Number(voterRow?.count ?? 0),
      totalAspirants: aspirantCount,
    };
  }

  private async resolveConstituencyName(
    type: ElectionType,
    id: number,
  ): Promise<string | null> {
    try {
      const mgr = this.userRepo.manager;
      switch (type) {
        case "lok_sabha": {
          const row = await mgr
            .createQueryBuilder()
            .select("pc.name", "name")
            .from("parliamentary_constituencies", "pc")
            .where("pc.id = :id", { id })
            .getRawOne<{ name: string }>();
          return row?.name ?? null;
        }
        case "state_assembly": {
          const row = await mgr
            .createQueryBuilder()
            .select("ac.name", "name")
            .from("assembly_constituencies", "ac")
            .where("ac.id = :id", { id })
            .getRawOne<{ name: string }>();
          return row?.name ?? null;
        }
        case "municipal_corporation": {
          const row = await mgr
            .createQueryBuilder()
            .select(`w.number || ' - ' || w.name`, "name")
            .from("wards", "w")
            .where("w.id = :id", { id })
            .getRawOne<{ name: string }>();
          return row?.name ?? null;
        }
        case "gram_panchayat": {
          const row = await mgr
            .createQueryBuilder()
            .select(`gp."Village Name"`, "name")
            .from("grama_panchayat", "gp")
            .where(`gp."Sr.No" = :id`, { id })
            .getRawOne<{ name: string }>();
          return row?.name ?? null;
        }
        default:
          return null;
      }
    } catch {
      return null;
    }
  }
}
