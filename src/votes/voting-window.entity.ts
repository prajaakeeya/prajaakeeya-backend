import {
  Column,
  Entity,
  ManyToOne,
  JoinColumn,
  ValueTransformer,
} from "typeorm";
import { BaseEntity, dateToEpoch } from "../common/base.entity";
import { Election } from "../elections/election.entity";

@Entity("voting_windows")
export class VotingWindow extends BaseEntity {
  @Column({
    name: "start_time",
    type: "timestamp",
    transformer: dateToEpoch as ValueTransformer,
  })
  startTime!: number | Date;

  @Column({
    name: "end_time",
    type: "timestamp",
    transformer: dateToEpoch as ValueTransformer,
  })
  endTime!: number | Date;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  @Column({ type: "text", nullable: true })
  description?: string;

  @Column({ nullable: true })
  electionId?: number;

  @ManyToOne(() => Election, { nullable: true })
  @JoinColumn({ name: "electionId" })
  election?: Election;
}
