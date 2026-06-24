import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AuditLogService } from "./audit-log.service";
import { AdminAuditLog } from "./audit-log.entity";
import { WardsModule } from "../wards/wards.module";
import { AspirantsModule } from "../aspirants/aspirants.module";
import { VotesModule } from "../votes/votes.module";
import { UsersModule } from "../users/users.module";
import { ElectionsModule } from "../elections/elections.module";
import { GeographyModule } from "../geography/geography.module";
import { GramaPanchayatModule } from "../grama-panchayat/grama-panchayat.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([AdminAuditLog]),
    WardsModule,
    AspirantsModule,
    VotesModule,
    UsersModule,
    ElectionsModule,
    GeographyModule,
    GramaPanchayatModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, AuditLogService],
  exports: [AuditLogService],
})
export class AdminModule {}
