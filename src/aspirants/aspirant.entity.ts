import {
  Column,
  Entity,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from "typeorm";
import { BaseEntity } from "../common/base.entity";
import { Ward } from "../wards/ward.entity";
import { User } from "../users/user.entity";
import { AspirantMeeting } from "./aspirant-meeting.entity";

@Index(["userId"], { unique: true })
@Entity("aspirants")
export class Aspirant extends BaseEntity {
  @Column()
  name!: string;

  @Column({ nullable: true })
  phone?: string;

  @Column({ nullable: true })
  address?: string;

  @Column({ default: "Independent" })
  party?: string;

  @Column({ type: "int", nullable: true })
  age?: number;

  @Column({ nullable: true })
  education?: string;

  @Column({ nullable: true })
  occupation?: string;

  @Column({ nullable: true })
  gender?: string;

  @Column({ nullable: true })
  meetingLink?: string;

  @Column({ type: "text" })
  manifesto!: string;

  @Column({ default: "pending" })
  status!: "pending" | "approved" | "rejected";

  // "idle": registered as an aspirant but hasn't declared an
  // election/constituency yet (e.g. none has been announced). "declared":
  // electionId + constituencyId are set. See AspirantsService.declareCandidacy.
  @Column({ default: "idle" })
  candidacyStatus!: "idle" | "declared";

  @Column({ default: true })
  isActive!: boolean;

  @Column({ nullable: true })
  wardId?: number | null;

  @ManyToOne(() => Ward, (ward) => ward.aspirants, { nullable: true })
  ward?: Ward;

  @Column({ type: "int", nullable: true })
  electionId?: number | null;

  @Column({ type: "int", nullable: true })
  constituencyId?: number | null;

  @Column({ nullable: true })
  userId?: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: "userId" })
  user?: User;

  @Column({ type: "text", nullable: true })
  identityBackground?: string;

  @Column({ type: "text", nullable: true })
  resignationPledge?: string;

  @Column({ type: "text", nullable: true })
  financialIntegrity?: string;

  @Column({ type: "text", nullable: true })
  noHighCommand?: string;

  @Column({ type: "text", nullable: true })
  technicalCompetence?: string;

  @Column({ type: "text", nullable: true })
  transparency?: string;

  @Column({ type: "text", nullable: true })
  emergencyProtocol?: string;

  @Column({ type: "text", nullable: true })
  expertConsultation?: string;

  @Column({ type: "text", nullable: true })
  voterFeedback?: string;

  @Column({ type: "text", nullable: true })
  primaryRule?: string;

  // Document uploads with verification status
  @Column({ type: "text", nullable: true })
  sopUrl?: string;

  @Column({ type: "varchar", default: "pending" })
  sopStatus!: "pending" | "verified" | "rejected";

  // SOP is no longer a file upload — aspirants agree to it electronically.
  // `sopAgreed` is the authoritative flag for the SOP requirement;
  // `sopUrl` is retained for legacy records but no longer required.
  @Column({ name: "sop_agreed", type: "boolean", default: false })
  sopAgreed!: boolean;

  @Column({ name: "sop_agreed_at", type: "timestamp", nullable: true })
  sopAgreedAt?: Date | null;

  @Column({ type: "text", nullable: true })
  sopKannadaUrl?: string;

  @Column({ type: "varchar", default: "pending" })
  sopKannadaStatus!: "pending" | "verified" | "rejected";

  @Column({ type: "text", nullable: true })
  agreementUrl?: string;

  @Column({ type: "varchar", default: "pending" })
  agreementStatus!: "pending" | "verified" | "rejected";

  @Column({ type: "text", nullable: true })
  propertyDeclarationUrl?: string;

  @Column({ type: "varchar", default: "pending" })
  propertyDeclarationStatus!: "pending" | "verified" | "rejected";

  @Column({ type: "text", nullable: true })
  codeOfConductUrl?: string;

  @Column({ type: "varchar", default: "pending" })
  codeOfConductStatus!: "pending" | "verified" | "rejected";

  @Column({ type: "text", nullable: true })
  resumeUrl?: string;

  @Column({ type: "varchar", default: "pending" })
  resumeStatus!: "pending" | "verified" | "rejected";

  @Column({ type: "text", nullable: true })
  epicCardUrl?: string;

  @Column({ type: "varchar", default: "pending" })
  epicCardStatus!: "pending" | "verified" | "rejected";

  @Column({ type: "text", nullable: true })
  epicCardBackUrl?: string;

  @Column({ type: "varchar", default: "pending" })
  epicCardBackStatus!: "pending" | "verified" | "rejected";

  @Column({ type: "text", nullable: true })
  addressProofUrl?: string;

  @Column({ type: "varchar", default: "pending" })
  addressProofStatus!: "pending" | "verified" | "rejected";

  @Column({ type: "text", nullable: true })
  recentPhotoUrl?: string;

  @Column({ type: "varchar", default: "pending" })
  recentPhotoStatus!: "pending" | "verified" | "rejected";

  @Column({ type: "text", nullable: true })
  selfieUrl?: string;

  @Column({ type: "varchar", default: "pending" })
  selfieStatus!: "pending" | "verified" | "rejected";

  @Column({ type: "text", nullable: true })
  instagramLink?: string;

  @Column({ type: "text", nullable: true })
  facebookLink?: string;

  @Column({ type: "text", nullable: true })
  linkedinLink?: string;

  @Column({ type: "text", nullable: true })
  twitterLink?: string;

  @Column({ nullable: true })
  whatsappNumber?: string;

  @Column({ type: "boolean", default: true })
  allowPhone!: boolean;

  @Column({ type: "boolean", default: true })
  allowWhatsapp!: boolean;

  @Column({ type: "boolean", default: true })
  allowChat!: boolean;

  @Column({ type: "text", nullable: true })
  rejectionReasons?: string;

  @OneToMany(() => AspirantMeeting, (meeting) => meeting.aspirant)
  meetings?: AspirantMeeting[];

  // Aspirant has met all submission requirements when they've (a) agreed
  // to the SOP and (b) uploaded a selfie. SOP is no longer a file upload.
  hasAllRequiredDocuments(): boolean {
    return !!(this.sopAgreed && this.selfieUrl);
  }

  getDocumentStatus(): "pending" | "completed" {
    return this.hasAllRequiredDocuments() ? "completed" : "pending";
  }
}
