import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Removes the aspirant "pledge" Q&A fields and the unused document-type
 * columns — no longer part of the aspirant model.
 *
 * Pledge (10): identityBackground, resignationPledge, financialIntegrity,
 *   noHighCommand, technicalCompetence, transparency, emergencyProtocol,
 *   expertConsultation, voterFeedback, primaryRule.
 * Documents (8 url/status pairs): sopKannada, agreement, propertyDeclaration,
 *   codeOfConduct, resume, epicCard, epicCardBack, addressProof.
 *
 * Kept: sop / sopAgreed, recentPhoto, selfie, social links, etc.
 *
 * Irreversible (data is being intentionally dropped), so down() is a no-op.
 */
export class DropAspirantPledgeAndDocFields1787000000000
  implements MigrationInterface
{
  name = "DropAspirantPledgeAndDocFields1787000000000";

  private readonly columns = [
    // Pledge Q&A
    "identityBackground",
    "resignationPledge",
    "financialIntegrity",
    "noHighCommand",
    "technicalCompetence",
    "transparency",
    "emergencyProtocol",
    "expertConsultation",
    "voterFeedback",
    "primaryRule",
    // Document url + status pairs
    "sopKannadaUrl",
    "sopKannadaStatus",
    "agreementUrl",
    "agreementStatus",
    "propertyDeclarationUrl",
    "propertyDeclarationStatus",
    "codeOfConductUrl",
    "codeOfConductStatus",
    "resumeUrl",
    "resumeStatus",
    "epicCardUrl",
    "epicCardStatus",
    "epicCardBackUrl",
    "epicCardBackStatus",
    "addressProofUrl",
    "addressProofStatus",
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const col of this.columns) {
      await queryRunner.query(
        `ALTER TABLE "aspirants" DROP COLUMN IF EXISTS "${col}"`,
      );
    }
  }

  public async down(): Promise<void> {
    // Intentionally irreversible — these fields were removed as no longer needed.
  }
}
