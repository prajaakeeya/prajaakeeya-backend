import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds bookkeeping flags used by the meeting/visit reminder scheduler so each
 * reminder is sent exactly once:
 *   aspirant_meetings.reminder_before_sent  — "15 min before start" reminder
 *   aspirant_meetings.reminder_start_sent   — "starting now" notification
 *   aspirant_visits.reminder_before_sent    — "15 min before start" reminder
 *   aspirant_visits.reminder_start_sent     — "starting now" notification
 */
export class AddReminderFlags1775900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "aspirant_meetings"
      ADD COLUMN IF NOT EXISTS "reminder_before_sent" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "reminder_start_sent" boolean NOT NULL DEFAULT false;
    `);
    await queryRunner.query(`
      ALTER TABLE "aspirant_visits"
      ADD COLUMN IF NOT EXISTS "reminder_before_sent" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "reminder_start_sent" boolean NOT NULL DEFAULT false;
    `);

    // Partial indexes so the per-minute scheduler queries stay cheap: each only
    // ever scans the few rows whose reminder hasn't been sent yet.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_meetings_pending_before_reminder"
      ON "aspirant_meetings" ("startTime")
      WHERE "reminder_before_sent" = false;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_meetings_pending_start_reminder"
      ON "aspirant_meetings" ("startTime")
      WHERE "reminder_start_sent" = false;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_visits_pending_before_reminder"
      ON "aspirant_visits" ("startTime")
      WHERE "reminder_before_sent" = false;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_visits_pending_start_reminder"
      ON "aspirant_visits" ("startTime")
      WHERE "reminder_start_sent" = false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_visits_pending_start_reminder";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_visits_pending_before_reminder";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_meetings_pending_start_reminder";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_meetings_pending_before_reminder";`,
    );
    await queryRunner.query(`
      ALTER TABLE "aspirant_visits"
      DROP COLUMN IF EXISTS "reminder_start_sent",
      DROP COLUMN IF EXISTS "reminder_before_sent";
    `);
    await queryRunner.query(`
      ALTER TABLE "aspirant_meetings"
      DROP COLUMN IF EXISTS "reminder_start_sent",
      DROP COLUMN IF EXISTS "reminder_before_sent";
    `);
  }
}
