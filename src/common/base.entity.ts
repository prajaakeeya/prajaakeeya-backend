import {
  CreateDateColumn,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  ValueTransformer,
} from "typeorm";

// Postgres returns DATE/TIMESTAMP columns as JS Date objects. The frontend
// expects unix-ms numbers, so we serialize on the way out via TypeORM's
// column-level transformer instead of running a global interceptor that
// recursively walks every response payload.
//
// Exported so non-BaseEntity columns (VotingWindow.startTime, etc.) can use
// the same transformer.
export const dateToEpoch: ValueTransformer = {
  to: (v?: number | Date | null) => {
    if (v == null) return v;
    return v instanceof Date ? v : new Date(v);
  },
  from: (v?: Date | null) => (v ? new Date(v).getTime() : v),
};

export abstract class BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @CreateDateColumn({ name: "created_at", transformer: dateToEpoch })
  createdAt!: number | Date;

  @UpdateDateColumn({ name: "updated_at", transformer: dateToEpoch })
  updatedAt!: number | Date;
}
