import crypto from "node:crypto";
import fs from "node:fs";

const foundationSql = fs.readFileSync(new URL("./migrations/0001-foundation.sql", import.meta.url), "utf8");
const domainSql = fs.readFileSync(new URL("./migrations/0002-domain.sql", import.meta.url), "utf8");

export const WORKSPACE_MIGRATIONS = Object.freeze([
  Object.freeze({
    version: 1,
    name: "foundation",
    sql: foundationSql,
    checksum: crypto.createHash("sha256").update(foundationSql).digest("hex"),
  }),
  Object.freeze({
    version: 2,
    name: "domain",
    sql: domainSql,
    checksum: crypto.createHash("sha256").update(domainSql).digest("hex"),
  }),
]);

export const WORKSPACE_SCHEMA_VERSION = WORKSPACE_MIGRATIONS.at(-1)?.version || 0;
