import { Column, Entity, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "../common/base.entity";
import { Aspirant } from "./aspirant.entity";
import type { MeetingResponse } from "./meeting-response.entity";

@Entity("aspirant_meetings")
export class AspirantMeeting extends BaseEntity {
  @Column({ type: "text" })
  meetingLink!: string;

  @Column({ type: "varchar", default: "others" })
  platform!: "google_meet" | "zoom" | "instagram" | "facebook" | "others";

  @Column({ nullable: true })
  title?: string;

  @Column({ type: "text", nullable: true })
  description?: string;

  @Column({ type: "bigint", nullable: true })
  startTime?: number; // unix timestamp in ms

  @Column({ type: "bigint", nullable: true })
  endTime?: number; // unix timestamp in ms

  @Column({ type: "boolean", default: false })
  completed!: boolean;

  // Reminder bookkeeping so the scheduler sends each notification exactly once.
  // reminderBeforeSent → the "15 minutes before start" reminder.
  // reminderStartSent  → the "starting now" notification (at start time).
  @Column({ name: "reminder_before_sent", type: "boolean", default: false })
  reminderBeforeSent!: boolean;

  @Column({ name: "reminder_start_sent", type: "boolean", default: false })
  reminderStartSent!: boolean;

  @Column({ type: "text", nullable: true })
  notes?: string;

  @ManyToOne(() => Aspirant, (aspirant) => aspirant.meetings, {
    onDelete: "CASCADE",
  })
  aspirant!: Aspirant;

  @Column()
  aspirantId!: number;

  @OneToMany("MeetingResponse", "meeting")
  responses?: MeetingResponse[];
}
