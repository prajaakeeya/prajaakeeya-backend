import { Column, Entity, ManyToOne, JoinColumn } from "typeorm";
import { BaseEntity, dateToEpoch } from "../common/base.entity";
import { User } from "../users/user.entity";
import { AdminDocument } from "../admin/admin-document.entity";

export type SignedDocumentStatus =
  | "pending"
  | "signed"
  | "verified"
  | "rejected";

@Entity("user_signed_documents")
export class UserSignedDocument extends BaseEntity {
  @Column()
  userId!: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column()
  adminDocumentId!: number;

  @ManyToOne(() => AdminDocument)
  @JoinColumn({ name: "adminDocumentId" })
  adminDocument!: AdminDocument;

  @Column({ type: "text", nullable: true })
  signedDocumentUrl?: string;

  @Column({ type: "varchar", default: "pending" })
  status!: SignedDocumentStatus;

  @Column({ type: "text", nullable: true })
  rejectionReason?: string;

  @Column({
    type: "timestamp",
    nullable: true,
    transformer: dateToEpoch,
  })
  signedAt?: number | Date;

  @Column({
    type: "timestamp",
    nullable: true,
    transformer: dateToEpoch,
  })
  verifiedAt?: number | Date;
}
