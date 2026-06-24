import {
  Injectable,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { State } from "./state.entity";
import { CreateStateDto } from "./dto/create-state.dto";

@Injectable()
export class GeographyService {
  constructor(
    @InjectRepository(State)
    private readonly stateRepo: Repository<State>,
  ) {}

  private readonly inflight = new Map<string, Promise<unknown>>();
  private singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.inflight.get(key) as Promise<T> | undefined;
    if (hit) return hit;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  async createState(dto: CreateStateDto) {
    const existing = await this.stateRepo.findOne({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException("State already exists");
    }
    const state = this.stateRepo.create(dto);
    return this.stateRepo.save(state);
  }

  findAllStates() {
    return this.singleFlight("states", () =>
      this.stateRepo.find({ order: { name: "ASC" } }),
    );
  }

  async findState(id: number) {
    const state = await this.stateRepo.findOne({ where: { id } });
    if (!state) throw new NotFoundException("State not found");
    return state;
  }
}
