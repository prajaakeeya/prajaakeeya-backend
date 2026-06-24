import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Poll-of-ideas feature: an aspirant posts project/policy proposals
 * (markdown `details`, no file upload) and citizens can back a specific
 * proposal — reversibly — rather than the aspirant as a whole.
 */
export class CreateAspirantProposalsTables1782300000001
  implements MigrationInterface
{
  name = "CreateAspirantProposalsTables1782300000001";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "aspirant_proposals" (
        "id" SERIAL PRIMARY KEY,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "title" character varying NOT NULL,
        "details" text NOT NULL,
        "aspirantId" integer NOT NULL,
        CONSTRAINT "FK_aspirant_proposals_aspirantId"
          FOREIGN KEY ("aspirantId") REFERENCES "aspirants"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "proposal_supports" (
        "id" SERIAL PRIMARY KEY,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "userId" integer NOT NULL,
        "proposalId" integer NOT NULL,
        CONSTRAINT "FK_proposal_supports_proposalId"
          FOREIGN KEY ("proposalId") REFERENCES "aspirant_proposals"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_proposal_supports_userId_proposalId"
      ON "proposal_supports" ("userId", "proposalId");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "proposal_supports";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "aspirant_proposals";`);
  }
}
