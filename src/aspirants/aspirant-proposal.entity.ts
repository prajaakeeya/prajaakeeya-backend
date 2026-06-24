import { Column, Entity, ManyToOne, OneToMany } from "typeorm";
import { BaseEntity } from "../common/base.entity";
import { Aspirant } from "./aspirant.entity";

// A single project/idea/policy entry an aspirant puts up for citizens to back.
// `details` is freeform markdown written by the aspirant — the data-backed
// action plan, law, or policy proposal, including how it can be done with no
// or minimal government funding and what public documents/data support it.
// We deliberately don't split this into rigid sub-fields (cost, sources,
// outcomes, etc.) — that nuance belongs in the aspirant's own prose.
@Entity("aspirant_proposals")
export class AspirantProposal extends BaseEntity {
  @Column()
  title!: string;

  @Column({ type: "text" })
  details!: string;

  @ManyToOne(() => Aspirant, { onDelete: "CASCADE" })
  aspirant!: Aspirant;

  @Column()
  aspirantId!: number;

  @OneToMany("ProposalSupport", "proposal")
  supports?: any[];
}
