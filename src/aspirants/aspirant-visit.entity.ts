import { Column, Entity, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "../common/base.entity";
import { Aspirant } from "./aspirant.entity";
import type { VisitResponse } from "./visit-response.entity";

@Entity("aspirant_visits")
export class AspirantVisit extends BaseEntity {
  @Column()
  aspirantId!: number;

  @ManyToOne(() => Aspirant)
  aspirant?: Aspirant;

  @Column({ type: "bigint" })
  @Column({ type: "bigint", nullable: true })
  startTime?: number;

  @Column({ type: "bigint", nullable: true })
  endTime?: number;

  @Column({ nullable: true })
  title?: string;

  @Column({ type: "text", nullable: true })
  description?: string;

  @Column({ nullable: true })
  location?: string;

  @Column({ nullable: true })
  googleMapsLink?: string;

  // Reminder bookkeeping so the scheduler sends each notification exactly once.
  // reminderBeforeSent → the "15 minutes before start" reminder.
  // reminderStartSent  → the "starting now" notification (at start time).
  @Column({ name: "reminder_before_sent", type: "boolean", default: false })
  reminderBeforeSent!: boolean;

  @Column({ name: "reminder_start_sent", type: "boolean", default: false })
  reminderStartSent!: boolean;

  @OneToMany("VisitResponse", "visit")
  responses?: VisitResponse[];
}
