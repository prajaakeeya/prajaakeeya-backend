import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAuditEvents1788000000000 implements MigrationInterface {
  async up(qr: QueryRunner): Promise<void> {
    await qr.query(`
      CREATE TABLE audit_events (
        id          SERIAL PRIMARY KEY,
        actor_id    INTEGER,
        actor_role  VARCHAR(16) NOT NULL DEFAULT 'system',
        action      VARCHAR(64) NOT NULL,
        target_type VARCHAR(64),
        target_id   INTEGER,
        metadata    JSONB,
        ip_address  VARCHAR(45),
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await qr.query(
      `CREATE INDEX idx_audit_action  ON audit_events(action)`,
    );
    await qr.query(
      `CREATE INDEX idx_audit_actor   ON audit_events(actor_id)`,
    );
    await qr.query(
      `CREATE INDEX idx_audit_target  ON audit_events(target_type, target_id)`,
    );
    await qr.query(
      `CREATE INDEX idx_audit_created ON audit_events(created_at DESC)`,
    );
  }

  async down(qr: QueryRunner): Promise<void> {
    await qr.query(`DROP TABLE IF EXISTS audit_events`);
  }
}
