import {
  Column,
  Entity,
  ManyToOne,
  JoinColumn,
  ValueTransformer,
} from "typeorm";
import { BaseEntity, dateToEpoch } from "../common/base.entity";
import { Ward } from "../wards/ward.entity";
import { User } from "../users/user.entity";

@Entity("ward_meetings")
export class WardMeeting extends BaseEntity {
  @Column({ name: "ward_id" })
  wardId!: number;

  @ManyToOne(() => Ward)
  @JoinColumn({ name: "ward_id" })
  ward!: Ward;

  @Column({ type: "text" })
  title!: string;

  @Column({ type: "text", nullable: true })
  description?: string;

  @Column({ name: "meeting_link", type: "text" })
  meetingLink!: string;

  @Column({
    name: "scheduled_at",
    type: "timestamp",
    nullable: true,
    transformer: dateToEpoch as ValueTransformer,
  })
  scheduledAt?: number | Date;

  @Column({ name: "created_by_id" })
  createdById!: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: "created_by_id" })
  createdBy!: User;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  @Column({ type: "boolean", default: false })
  completed!: boolean;

  @Column({ type: "text", nullable: true })
  notes?: string;

  @Column({
    name: "completed_at",
    type: "timestamp",
    nullable: true,
    transformer: dateToEpoch as ValueTransformer,
  })
  completedAt?: number | Date;
}
