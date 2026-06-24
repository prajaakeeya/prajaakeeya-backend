import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * NEW-2 / M-PERF-3 follow-up: defence-in-depth unique constraint on
 * issue_hand_raises so a duplicate hand-raise can never be persisted even if
 * the advisory lock is ever missed (connection-pool churn / replica failover).
 *
 * electionId & constituencyId are nullable; Postgres treats NULLs as distinct,
 * so we index COALESCE(col, -1) to make NULL rows collide consistently — which
 * matches the advisory-lock key (electionId:constituencyId:userId:category).
 */
export class AddHandRaiseUnique1785000000000 implements MigrationInterface {
  name = "AddHandRaiseUnique1785000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Remove historical duplicates, keeping the earliest row per group.
    await queryRunner.query(`
      DELETE FROM "issue_hand_raises" a
      USING "issue_hand_raises" b
      WHERE a.id > b.id
        AND COALESCE(a."electionId", -1) = COALESCE(b."electionId", -1)
        AND COALESCE(a."constituencyId", -1) = COALESCE(b."constituencyId", -1)
        AND a."createdById" = b."createdById"
        AND a."category" = b."category"
    `);

    // 2. Enforce uniqueness going forward.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_hand_raise_user_category"
      ON "issue_hand_raises"
      (COALESCE("electionId", -1), COALESCE("constituencyId", -1), "createdById", "category")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_hand_raise_user_category"`,
    );
  }
}
