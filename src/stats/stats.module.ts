import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "../users/user.entity";
import { AspirantCandidacy } from "../aspirants/aspirant-candidacy.entity";
import { ElectionsModule } from "../elections/elections.module";
import { StatsService } from "./stats.service";
import { StatsController } from "./stats.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([User, AspirantCandidacy]),
    ElectionsModule,
  ],
  providers: [StatsService],
  controllers: [StatsController],
})
export class StatsModule {}
