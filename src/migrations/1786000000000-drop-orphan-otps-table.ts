import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * NEW-3: drop the orphaned `otps` table. The OTP feature (entity, DTOs,
 * MessageCentral/SES senders, cleanup timer) was removed entirely earlier in
 * this work; no application code reads or writes `otps` anymore — only the
 * historical migrations that created/altered it. The table sat orphaned,
 * accumulating nothing. Drop it.
 *
 * Irreversible (the stored OTP codes are ephemeral, already-expired data), so
 * down() is a no-op rather than recreating the multi-migration schema.
 */
export class DropOrphanOtpsTable1786000000000 implements MigrationInterface {
  name = "DropOrphanOtpsTable1786000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "otps"`);
  }

  public async down(): Promise<void> {
    // Intentionally irreversible — the OTP feature and its schema were removed.
  }
}
