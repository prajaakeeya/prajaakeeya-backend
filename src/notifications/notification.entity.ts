import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../common/base.entity";
import { User } from "../users/user.entity";

export type NotificationType =
  | "new_aspirant"
  | "aspirant_meeting"
  | "aspirant_visit"
  | "aspirant_event"
  | "chat_message"
  | "voting_window"
  // Reminder notifications fired by the scheduler:
  | "meeting_reminder" // 15 min before a meeting
  | "meeting_started" // when a meeting starts
  | "visit_reminder" // 15 min before a visit
  | "visit_started"; // when a visit starts

@Index("idx_notifications_user_created", ["userId", "createdAt"])
@Index("idx_notifications_user_unread", ["userId", "isRead"])
@Entity("notifications")
export class Notification extends BaseEntity {
  @Column({ name: "user_id", type: "int" })
  userId!: number;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user?: User;

  @Column({ type: "varchar", length: 64 })
  type!: NotificationType;

  @Column()
  title!: string;

  @Column({ type: "text" })
  body!: string;

  @Column({ name: "aspirant_id", type: "int", nullable: true })
  aspirantId?: number | null;

  @Column({ name: "aspirant_name", type: "varchar", nullable: true })
  aspirantName?: string | null;

  @Column({ name: "election_id", type: "int", nullable: true })
  electionId?: number | null;

  @Column({ name: "constituency_id", type: "int", nullable: true })
  constituencyId?: number | null;

  @Column({ name: "constituency_name", type: "varchar", nullable: true })
  constituencyName?: string | null;

  @Column({ name: "meeting_id", type: "int", nullable: true })
  meetingId?: number | null;

  @Column({ name: "visit_id", type: "int", nullable: true })
  visitId?: number | null;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown> | null;

  @Column({ name: "is_read", type: "boolean", default: false })
  isRead!: boolean;

  @Column({ name: "read_at", type: "timestamp", nullable: true })
  readAt?: Date | null;
}
