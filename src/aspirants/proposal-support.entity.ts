import { Column, Entity, Index, ManyToOne } from "typeorm";
import { BaseEntity } from "../common/base.entity";
import { AspirantProposal } from "./aspirant-proposal.entity";

// A citizen backing a specific proposal/idea — not the aspirant as a whole.
// Reversible: a citizen can remove their support at any time (see
// AspirantsService.unsupportProposal), unlike the formal, immutable Vote.
@Index(["userId", "proposalId"], { unique: true })
@Entity("proposal_supports")
export class ProposalSupport extends BaseEntity {
  @Column()
  userId!: number;

  @Column()
  proposalId!: number;

  @ManyToOne(() => AspirantProposal, (proposal) => proposal.supports, {
    onDelete: "CASCADE",
  })
  proposal!: AspirantProposal;
}
