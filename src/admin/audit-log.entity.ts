import { Column, Entity } from "typeorm";
import { BaseEntity } from "../common/base.entity";

/**
 * Immutable record of an admin action. Rows are INSERT-only — never updated
 * or deleted — so the log can serve as a reliable audit trail.
 */
@Entity("admin_audit_logs")
export class AdminAuditLog extends BaseEntity {
  /** ID of the admin who performed the action. */
  @Column({ type: "int" })
  adminId!: number;

  /** Email of the admin at the time of the action (denormalised for durability). */
  @Column({ type: "varchar", nullable: true })
  adminEmail?: string;

  /**
   * The action performed, e.g. "block_user", "set_voting_window",
   * "update_election", "approve_aspirant", "update_report_status".
   */
  @Column({ type: "varchar" })
  action!: string;

  /**
   * The resource type the action was taken on, e.g. "user", "election",
   * "voting_window", "aspirant", "report", "ward".
   */
  @Column({ type: "varchar", nullable: true })
  resource?: string;

  /** The primary ID of the resource being acted on, when applicable. */
  @Column({ type: "int", nullable: true })
  resourceId?: number;

  /**
   * A structured snapshot of the key parameters / outcome of the action.
   * Stored as JSON so it can hold any relevant context without schema changes.
   */
  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, any>;
}
