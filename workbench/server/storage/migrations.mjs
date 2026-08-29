import crypto from "node:crypto";
import fs from "node:fs";

const sql = fs.readFileSync(new URL("./migrations/0001-foundation.sql", import.meta.url), "utf8");

export const WORKSPACE_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    name: "foundation",
    sql,
    checksum: crypto.createHash("sha256").update(sql).digest("hex"),
  }),
]);

export const WORKSPACE_SCHEMA_VERSION = WORKSPACE_MIGRATIONS.at(-1)?.version || 0;
