import { Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditEvent } from "./audit-event.entity";
import { AuditService } from "./audit.service";

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditEvent])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
