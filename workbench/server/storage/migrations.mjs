import crypto from "node:crypto";
import fs from "node:fs";

const foundationSql = fs.readFileSync(new URL("./migrations/0001-foundation.sql", import.meta.url), "utf8");
const domainSql = fs.readFileSync(new URL("./migrations/0002-domain.sql", import.meta.url), "utf8");
const localClientsSql = fs.readFileSync(new URL("./migrations/0003-local-clients.sql", import.meta.url), "utf8");
const seriesSql = fs.readFileSync(new URL("./migrations/0004-series.sql", import.meta.url), "utf8");
const seriesEntriesSql = fs.readFileSync(new URL("./migrations/0005-series-entries.sql", import.meta.url), "utf8");
const wikiSql = fs.readFileSync(new URL("./migrations/0006-wiki.sql", import.meta.url), "utf8");
const sourceKindSql = fs.readFileSync(new URL("./migrations/0007-source-kind.sql", import.meta.url), "utf8");

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
  Object.freeze({
    version: 3,
    name: "local-clients",
    sql: localClientsSql,
    checksum: crypto.createHash("sha256").update(localClientsSql).digest("hex"),
  }),
  Object.freeze({
    version: 4,
    name: "content-series",
    sql: seriesSql,
    checksum: crypto.createHash("sha256").update(seriesSql).digest("hex"),
  }),
  Object.freeze({
    version: 5,
    name: "series-entries",
    sql: seriesEntriesSql,
    checksum: crypto.createHash("sha256").update(seriesEntriesSql).digest("hex"),
  }),
  Object.freeze({
    version: 6,
    name: "wiki",
    sql: wikiSql,
    checksum: crypto.createHash("sha256").update(wikiSql).digest("hex"),
  }),
  Object.freeze({
    version: 7,
    name: "source-kind",
    sql: sourceKindSql,
    checksum: crypto.createHash("sha256").update(sourceKindSql).digest("hex"),
  }),
]);

export const WORKSPACE_SCHEMA_VERSION = WORKSPACE_MIGRATIONS.at(-1)?.version || 0;
