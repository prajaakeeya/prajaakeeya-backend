import { Column, Entity, Index, ManyToOne } from "typeorm";
import { BaseEntity } from "../common/base.entity";
import { Aspirant } from "./aspirant.entity";

// One race an aspirant has declared candidacy for. An aspirant can hold
// multiple rows (e.g. Lok Sabha + Gram Panchayat simultaneously), but at
// most one per election type (unique aspirantId+electionId) — you can't
// run for two different Lok Sabha seats at once.
@Index(["aspirantId", "electionId"], { unique: true })
@Entity("aspirant_candidacies")
export class AspirantCandidacy extends BaseEntity {
  @Column()
  aspirantId!: number;

  @ManyToOne(() => Aspirant, { onDelete: "CASCADE" })
  aspirant!: Aspirant;

  @Column()
  electionId!: number;

  @Column()
  constituencyId!: number;

  @Column({ type: "int", nullable: true })
  wardId?: number | null;
}
