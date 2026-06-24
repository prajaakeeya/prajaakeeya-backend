import {
  Injectable,
  NotFoundException,
  ConflictException,
  OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Election, ElectionType } from "./election.entity";
import { CreateElectionDto } from "./dto/create-election.dto";
import { UpdateElectionDto } from "./dto/update-election.dto";
import { ParliamentaryService } from "../geography/parliamentary.service";
import { AssemblyService } from "../geography/assembly.service";
import { MunicipalityService } from "../geography/municipality.service";
import { WardsService } from "../wards/wards.service";
import { GramaPanchayatService } from "../grama-panchayat/grama-panchayat.service";
import { Parliamentary } from "../geography/parliamentary.entity";
import { Assembly } from "../geography/assembly.entity";
import { Ward } from "../wards/ward.entity";
import { GramaPanchayat } from "../grama-panchayat/grama-panchayat.entity";

@Injectable()
export class ElectionsService implements OnModuleInit {
  constructor(
    @InjectRepository(Election)
    private readonly repo: Repository<Election>,
    private readonly parliamentaryService: ParliamentaryService,
    private readonly assemblyService: AssemblyService,
    private readonly municipalityService: MunicipalityService,
    private readonly wardsService: WardsService,
    private readonly gramaPanchayatService: GramaPanchayatService,
  ) {}

  async onModuleInit() {
    const seeds: { type: ElectionType; name: string }[] = [
      { type: "lok_sabha", name: "Lok Sabha (MP)" },
      { type: "state_assembly", name: "State Assembly (MLA)" },
      {
        type: "municipal_corporation",
        name: "Municipal Corporation (Corporator)",
      },
      { type: "gram_panchayat", name: "Gram Panchayat (Village)" },
    ];

    for (const seed of seeds) {
      const existing = await this.repo.findOne({ where: { type: seed.type } });
      if (!existing) {
        await this.repo.save(this.repo.create(seed));
      } else if (
        seed.type === "municipal_corporation" &&
        existing.scope === "GBA"
      ) {
        existing.scope = undefined;
        await this.repo.save(existing);
      }
    }
  }

  async findAll() {
    return this.repo.find();
  }

  async createElection(dto: CreateElectionDto) {
    const existing = await this.repo.findOne({
      where: { type: dto.type as ElectionType },
    });
    if (existing)
      throw new ConflictException(`Election type '${dto.type}' already exists`);
    return this.repo.save(
      this.repo.create({ ...dto, type: dto.type as ElectionType }),
    );
  }

  async updateElection(id: number, dto: UpdateElectionDto) {
    const election = await this.repo.findOne({ where: { id } });
    if (!election)
      throw new NotFoundException(`Election with id ${id} not found`);
    if (dto.name !== undefined) election.name = dto.name;
    if (dto.scope !== undefined) election.scope = dto.scope;
    return this.repo.save(election);
  }

  async deleteElection(id: number) {
    const election = await this.repo.findOne({ where: { id } });
    if (!election)
      throw new NotFoundException(`Election with id ${id} not found`);
    await this.repo.remove(election);
    return { message: `Election '${election.name}' deleted` };
  }

  async findById(id: number) {
    const election = await this.repo.findOne({ where: { id } });
    if (!election)
      throw new NotFoundException(`Election with id ${id} not found`);
    return election;
  }

  async findByType(type: ElectionType) {
    const election = await this.repo.findOne({ where: { type } });
    if (!election)
      throw new NotFoundException(`Election type '${type}' not found`);
    return election;
  }

  async getConstituenciesByScope(scope: string) {
    return this.wardsService.findByMunicipality(scope);
  }

  getMunicipalities(state?: string) {
    return this.municipalityService.findAll(state);
  }

  async getConstituencies(
    type: ElectionType,
    filters?: {
      state?: string;
      district?: string;
      taluk?: string;
      gpName?: string;
    },
  ) {
    const election = await this.findByType(type);

    let constituencies: Array<Parliamentary | Assembly | Ward | GramaPanchayat>;
    switch (type) {
      case "lok_sabha":
        constituencies = await this.parliamentaryService.findAll();
        break;
      case "state_assembly":
        constituencies = await this.assemblyService.findAll();
        break;
      case "municipal_corporation":
        constituencies = await this.wardsService.findAll();
        break;
      case "gram_panchayat":
        constituencies = await this.gramaPanchayatService.findAll(filters);
        break;
      default:
        constituencies = [];
    }

    return { election, constituencies };
  }
}
