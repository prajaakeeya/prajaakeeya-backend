import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Multi-constituency candidacy: an aspirant can now declare candidacy for
 * several election types at once (e.g. Lok Sabha + Gram Panchayat), each
 * tracked as its own row here. aspirants.electionId/constituencyId remain
 * as the "primary" race for code that only cares about one (Votes,
 * profile(), stats) — backfilled below from existing data.
 */
export class CreateAspirantCandidaciesTable1782300000002
  implements MigrationInterface
{
  name = "CreateAspirantCandidaciesTable1782300000002";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "aspirant_candidacies" (
        "id" SERIAL PRIMARY KEY,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "aspirantId" integer NOT NULL,
        "electionId" integer NOT NULL,
        "constituencyId" integer NOT NULL,
        "wardId" integer,
        CONSTRAINT "FK_aspirant_candidacies_aspirantId"
          FOREIGN KEY ("aspirantId") REFERENCES "aspirants"("id") ON DELETE CASCADE
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_aspirant_candidacies_aspirantId_electionId"
      ON "aspirant_candidacies" ("aspirantId", "electionId");
    `);

    // Backfill: every aspirant that already has an election + constituency
    // set becomes their own first candidacy row.
    await queryRunner.query(`
      INSERT INTO "aspirant_candidacies" ("aspirantId", "electionId", "constituencyId", "wardId")
      SELECT "id", "electionId", "constituencyId", "wardId"
      FROM "aspirants"
      WHERE "electionId" IS NOT NULL AND "constituencyId" IS NOT NULL
      ON CONFLICT DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "aspirant_candidacies";`);
  }
}
