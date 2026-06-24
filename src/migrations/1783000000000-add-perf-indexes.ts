import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Additive indexes for the second perf audit batch:
 * - activity_ratings: covers the getActivityRatingsBulk GROUP BY
 *   (aspirantId, type, activityId, rating) so the bulk rating aggregation runs
 *   index-only instead of scanning the table.
 * - aspirant_messages (aspirant_id, user_id): covers the single-JOIN recipient
 *   lookup in notifyAspirantChatMessage (H-PERF-6).
 *
 * All statements are guarded by IF NOT EXISTS so this migration is safe to
 * re-run. The tables are young, so plain (non-CONCURRENT) builds are cheap.
 */
export class AddPerfIndexes1783000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    const stmts = [
      // H-PERF-2: covers getActivityRatingsBulk's
      // GROUP BY (aspirantId, type, activityId, rating).
      `CREATE INDEX IF NOT EXISTS idx_activity_ratings_lookup
         ON activity_ratings ("aspirantId", type, "activityId", rating)`,

      // H-PERF-6: covers notifyAspirantChatMessage's recipient JOIN/lookup.
      `CREATE INDEX IF NOT EXISTS idx_aspirant_messages_aspirant_user
         ON aspirant_messages (aspirant_id, user_id)`,
    ];

    for (const sql of stmts) {
      try {
        await queryRunner.query(sql);
      } catch (e: any) {
        // Some tables/columns may not yet exist in older schema snapshots.
        // Log and continue so the migration is non-fatal.
        console.warn(
          `[AddPerfIndexes] Skipped statement: ${sql.split("\n")[0].trim()} (${e.message})`,
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const drops = [
      "idx_activity_ratings_lookup",
      "idx_aspirant_messages_aspirant_user",
    ];
    for (const idx of drops) {
      await queryRunner.query(`DROP INDEX IF EXISTS ${idx}`);
    }
  }
}
