import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAdminAuditLogsTable1785000000000
  implements MigrationInterface
{
  name = "CreateAdminAuditLogsTable1785000000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "admin_audit_logs" (
        "id" SERIAL PRIMARY KEY,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "admin_id" integer NOT NULL,
        "admin_email" varchar,
        "action" varchar NOT NULL,
        "resource" varchar,
        "resource_id" integer,
        "metadata" jsonb
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_admin_audit_logs_admin_id" ON "admin_audit_logs" ("admin_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_admin_audit_logs_action" ON "admin_audit_logs" ("action")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_admin_audit_logs_created_at" ON "admin_audit_logs" ("created_at" DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_audit_logs"`);
  }
}
