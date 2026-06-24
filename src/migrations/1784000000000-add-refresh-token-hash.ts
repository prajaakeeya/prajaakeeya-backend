import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds users.refresh_token_hash — the SHA-256 hash of each user's current
 * refresh token (single active session). Nullable; cleared on logout/revoke.
 */
export class AddRefreshTokenHash1784000000000 implements MigrationInterface {
  name = "AddRefreshTokenHash1784000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "refresh_token_hash" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "refresh_token_hash"`,
    );
  }
}
