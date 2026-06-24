import { Column, Entity, ManyToOne, JoinColumn } from "typeorm";
import { BaseEntity, dateToEpoch } from "../common/base.entity";
import { User } from "./user.entity";

export type ReportStatus = "pending" | "resolved" | "rejected";
export type ReportedUserType = "voter" | "aspirant";

@Entity("reports")
export class Report extends BaseEntity {
  @Column({ name: "reported_user_id" })
  reportedUserId!: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: "reported_user_id" })
  reportedUser!: User;

  @Column({ name: "reported_by_id", nullable: true })
  reportedById?: number;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: "reported_by_id" })
  reportedBy?: User;

  @Column({ name: "reported_user_type", type: "varchar" })
  reportedUserType!: ReportedUserType;

  @Column({ type: "text" })
  reason!: string;

  @Column({ type: "varchar", default: "pending" })
  status!: ReportStatus;

  @Column({ name: "attachment_url", type: "text", nullable: true })
  attachmentUrl?: string;

  @Column({ name: "admin_notes", type: "text", nullable: true })
  adminNotes?: string;

  @Column({
    name: "resolved_at",
    type: "timestamp",
    nullable: true,
    transformer: dateToEpoch,
  })
  resolvedAt?: number | Date;

  @Column({ name: "resolved_by_id", nullable: true })
  resolvedById?: number;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: "resolved_by_id" })
  resolvedBy?: User;
}
