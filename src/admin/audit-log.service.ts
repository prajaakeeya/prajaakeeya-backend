import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AdminAuditLog } from "./audit-log.entity";

export interface AuditLogParams {
  adminId: number;
  adminEmail?: string;
  action: string;
  resource?: string;
  resourceId?: number;
  metadata?: Record<string, any>;
}

/**
 * Thin service that writes an immutable audit log entry for every
 * admin action. Failures are logged but never propagated — audit
 * logging must never break the action it records.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(
    @InjectRepository(AdminAuditLog)
    private readonly repo: Repository<AdminAuditLog>,
  ) {}

  async log(params: AuditLogParams): Promise<void> {
    try {
      const entry = this.repo.create(params);
      await this.repo.save(entry);
    } catch (err) {
      this.logger.error(
        `AuditLog failed to persist [action=${params.action} admin=${params.adminId}]: ` +
          `${(err as Error).message}`,
      );
    }
  }

  async findAll(options: {
    adminId?: number;
    action?: string;
    resource?: string;
    page?: number;
    limit?: number;
  } = {}) {
    const page = Math.max(options.page ?? 1, 1);
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const qb = this.repo
      .createQueryBuilder("log")
      .orderBy("log.createdAt", "DESC")
      .skip((page - 1) * limit)
      .take(limit);

    if (options.adminId) qb.andWhere("log.adminId = :adminId", { adminId: options.adminId });
    if (options.action) qb.andWhere("log.action = :action", { action: options.action });
    if (options.resource) qb.andWhere("log.resource = :resource", { resource: options.resource });

    const [data, total] = await qb.getManyAndCount();
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}
