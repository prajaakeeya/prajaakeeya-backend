import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds aspirants."candidacyStatus" — distinguishes an "idle" aspirant
 * (registered without an election/constituency yet) from one who has
 * "declared" a candidacy. electionId/constituencyId were already nullable;
 * this column makes that state explicit and queryable.
 */
export class AddCandidacyStatusToAspirants1782300000000
  implements MigrationInterface
{
  name = "AddCandidacyStatusToAspirants1782300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "aspirants"
      ADD COLUMN IF NOT EXISTS "candidacyStatus" character varying NOT NULL DEFAULT 'idle';
    `);
    // Backfill: any existing aspirant that already has an election +
    // constituency set is, by definition, "declared".
    await queryRunner.query(`
      UPDATE "aspirants"
      SET "candidacyStatus" = 'declared'
      WHERE "electionId" IS NOT NULL AND "constituencyId" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "aspirants" DROP COLUMN IF EXISTS "candidacyStatus";
    `);
  }
}
