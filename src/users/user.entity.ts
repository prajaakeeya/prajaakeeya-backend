import { Column, Entity, ManyToOne } from "typeorm";
import { BaseEntity } from "../common/base.entity";
import { Ward } from "../wards/ward.entity";

export type UserRole = "admin" | "voter" | "aspirant";

@Entity("users")
export class User extends BaseEntity {
  @Column({ unique: true, nullable: true })
  email?: string;

  @Column({ nullable: true })
  phone?: string;

  @Column({ default: "" })
  name!: string;

  @Column({ name: "relative_name", nullable: true })
  relativeName?: string;

  @Column({ name: "epic_id", nullable: true })
  epicId?: string;

  @Column({ nullable: true })
  gender?: string;

  @Column({ type: "varchar", default: "voter" })
  role!: UserRole;

  @Column({ nullable: true })
  wardId?: number;

  @ManyToOne(() => Ward, (ward) => ward.users, { nullable: true })
  ward?: Ward;

  @Column({ name: "is_blocked", type: "boolean", default: false })
  isBlocked!: boolean;

  @Column({ name: "is_self_deleted", type: "boolean", default: false })
  isSelfDeleted!: boolean;

  @Column({ name: "profile_picture", type: "text", nullable: true })
  profilePicture?: string;

  // Electoral API fields
  @Column({ name: "voter_epic", nullable: true })
  voterEpic?: string;

  @Column({ name: "name_en", nullable: true })
  nameEn?: string;

  @Column({ name: "name_kn", nullable: true })
  nameKn?: string;

  @Column({ name: "corporation_name", nullable: true })
  corporationName?: string;

  @Column({ name: "corporation_name_l1", nullable: true })
  corporationNameL1?: string;

  @Column({ name: "ward_name", nullable: true })
  wardName?: string;

  @Column({ name: "ward_name_l1", nullable: true })
  wardNameL1?: string;

  @Column({ name: "ps_name", nullable: true, type: "text" })
  psName?: string;

  @Column({ name: "ps_name_l1", nullable: true, type: "text" })
  psNameL1?: string;

  @Column({
    name: "ps_long",
    type: "decimal",
    precision: 10,
    scale: 6,
    nullable: true,
  })
  psLong?: number;

  @Column({
    name: "ps_lat",
    type: "decimal",
    precision: 10,
    scale: 6,
    nullable: true,
  })
  psLat?: number;

  @Column({ type: "int", nullable: true })
  age?: number;

  // Interaction tracking flags
  @Column({ name: "is_chat", type: "boolean", default: false })
  isChat!: boolean;

  @Column({ name: "is_meeting", type: "boolean", default: false })
  isMeeting!: boolean;

  @Column({ name: "is_direct_meet", type: "boolean", default: false })
  isDirectMeet!: boolean;

  @Column({ name: "is_phone_call", type: "boolean", default: false })
  isPhoneCall!: boolean;

  @Column({ name: "last_interaction_message", type: "text", nullable: true })
  lastInteractionMessage?: string;

  @Column({ name: "password_hash", type: "text", nullable: true })
  passwordHash?: string;

  @Column({
    name: "password_salt",
    type: "varchar",
    length: 64,
    nullable: true,
  })
  passwordSalt?: string;

  @Column({ name: "lok_sabha_constituency_id", type: "int", nullable: true })
  lokSabhaConstituencyId?: number;

  @Column({
    name: "state_assembly_constituency_id",
    type: "int",
    nullable: true,
  })
  stateAssemblyConstituencyId?: number;

  @Column({
    name: "municipal_corporation_constituency_id",
    type: "int",
    nullable: true,
  })
  municipalCorporationConstituencyId?: number;

  @Column({
    name: "gram_panchayat_constituency_id",
    type: "int",
    nullable: true,
  })
  gramPanchayatConstituencyId?: number;

  // Bumped on logout/block/password-change to invalidate outstanding JWTs.
  @Column({ name: "token_version", type: "int", default: 0 })
  tokenVersion!: number;
}
