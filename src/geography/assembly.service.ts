import {
  Injectable,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository, FindOptionsWhere } from "typeorm";
import { Assembly } from "./assembly.entity";
import { CreateAssemblyDto } from "./dto/create-assembly.dto";

@Injectable()
export class AssemblyService {
  constructor(
    @InjectRepository(Assembly)
    private readonly assemblyRepo: Repository<Assembly>,
  ) {}

  async create(dto: CreateAssemblyDto) {
    const existing = await this.assemblyRepo.findOne({
      where: { name: dto.name },
    });
    if (existing) {
      throw new ConflictException("Assembly constituency already exists");
    }
    const assembly = this.assemblyRepo.create(dto);
    return this.assemblyRepo.save(assembly);
  }

  findAll(state?: string, parliamentary?: string) {
    const where: FindOptionsWhere<Assembly> = {};
    if (state) where.state = state;
    if (parliamentary) where.parliamentary = parliamentary;

    return this.assemblyRepo.find({
      where: Object.keys(where).length > 0 ? where : undefined,
      order: { name: "ASC" },
    });
  }

  async findOne(id: number) {
    const assembly = await this.assemblyRepo.findOne({ where: { id } });
    if (!assembly)
      throw new NotFoundException("Assembly constituency not found");
    return assembly;
  }

  async update(id: number, dto: Partial<CreateAssemblyDto>) {
    const assembly = await this.findOne(id);
    if (dto.name !== undefined) assembly.name = dto.name;
    if (dto.state !== undefined) assembly.state = dto.state;
    if (dto.parliamentary !== undefined)
      assembly.parliamentary = dto.parliamentary;
    return this.assemblyRepo.save(assembly);
  }

  async delete(id: number) {
    const assembly = await this.findOne(id);
    await this.assemblyRepo.remove(assembly);
    return { message: `Assembly constituency '${assembly.name}' deleted` };
  }
}
