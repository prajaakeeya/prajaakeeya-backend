import "dotenv/config";
import * as fs from "fs";
import { DataSource } from "typeorm";

// Mirrors the SSL resolution order in app.module.ts.
// In development, SSL is disabled so local Postgres works without certs.
// In all other environments we use the same RDS SSL logic as the app itself.
function buildSsl() {
  if (process.env.NODE_ENV === "development") return false;
  if (process.env.RDS_SSL_INSECURE === "true")
    return { rejectUnauthorized: false };
  const caPath = process.env.RDS_CA_PATH ?? "/opt/rds/global-bundle.pem";
  if (fs.existsSync(caPath)) return { ca: fs.readFileSync(caPath).toString() };
  return { rejectUnauthorized: false };
}

export default new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL,
  ssl: buildSsl(),
  entities: ["dist/**/*.entity.js"],
  migrations: ["dist/migrations/[0-9]*.js"],
});
