import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AuditEvent } from "./audit-event.entity";

export interface AuditContext {
  actorId?: number;
  actorRole?: "user" | "admin" | "system";
  action: string;
  targetType?: string;
  targetId?: number;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditEvent)
    private readonly repo: Repository<AuditEvent>,
  ) {}

  async log(ctx: AuditContext): Promise<void> {
    await this.repo.save(
      this.repo.create({
        actorId: ctx.actorId,
        actorRole: ctx.actorRole ?? "system",
        action: ctx.action,
        targetType: ctx.targetType,
        targetId: ctx.targetId,
        metadata: ctx.metadata,
        ipAddress: ctx.ipAddress,
      }),
    );
  }
}
