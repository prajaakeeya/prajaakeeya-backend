import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "../common/base.entity";

@Entity("audit_events")
@Index(["action"])
@Index(["actorId"])
@Index(["targetType", "targetId"])
export class AuditEvent extends BaseEntity {
  @Column({ nullable: true, name: "actor_id" })
  actorId?: number;

  @Column({ length: 16, name: "actor_role", default: "system" })
  actorRole!: string;

  // Dot-namespaced action: 'vote.cast', 'user.unblock', 'voting_window.open', etc.
  @Column({ length: 64 })
  action!: string;

  @Column({ length: 64, nullable: true, name: "target_type" })
  targetType?: string;

  @Column({ nullable: true, name: "target_id" })
  targetId?: number;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown>;

  @Column({ nullable: true, length: 45, name: "ip_address" })
  ipAddress?: string;
}
