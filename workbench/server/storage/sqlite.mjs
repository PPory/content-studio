import Database from "better-sqlite3";
import { WORKSPACE_MIGRATIONS } from "./migrations.mjs";

const isoNow = (now = new Date()) => new Date(now).toISOString();

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

export function configureWorkspaceDatabase(db) {
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
  db.pragma("busy_timeout = 5000");
  db.pragma("temp_store = MEMORY");
  if (db.pragma("foreign_keys", { simple: true }) !== 1) {
    throw new Error("SQLite 外键未能启用");
  }
  return db;
}

export function migrateWorkspaceDatabase(db, migrations = WORKSPACE_MIGRATIONS, { now } = {}) {
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  const seen = new Set();
  for (const migration of ordered) {
    if (!Number.isInteger(migration.version) || migration.version < 1 || seen.has(migration.version)) {
      throw new TypeError("SQLite migration 版本必须是从 1 开始且不重复的整数");
    }
    if (!migration.name || !migration.sql || !/^[a-f0-9]{64}$/.test(migration.checksum || "")) {
      throw new TypeError(`SQLite migration ${migration.version} 缺少名称、SQL 或 SHA-256`);
    }
    seen.add(migration.version);
  }
  for (let index = 0; index < ordered.length; index += 1) {
    if (ordered[index].version !== index + 1) {
      throw new TypeError("SQLite migration 版本必须从 1 连续递增");
    }
  }

  const applied = tableExists(db, "schema_migrations")
    ? db.prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version").all()
    : [];
  const expectedByVersion = new Map(ordered.map((item) => [item.version, item]));
  const userVersion = db.pragma("user_version", { simple: true });
  const appliedVersion = applied.at(-1)?.version || 0;
  if (applied.some((row, index) => row.version !== index + 1) || userVersion !== appliedVersion) {
    throw new Error("SQLite migration 历史或 user_version 不连续，拒绝继续");
  }
  for (const row of applied) {
    const expected = expectedByVersion.get(row.version);
    if (!expected || expected.name !== row.name || expected.checksum !== row.checksum) {
      throw new Error(`SQLite migration ${row.version} 校验和或名称不一致，拒绝继续`);
    }
  }

  const appliedVersions = new Set(applied.map((item) => item.version));
  for (const migration of ordered) {
    if (appliedVersions.has(migration.version)) continue;
    db.transaction(() => {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)")
        .run(migration.version, migration.name, migration.checksum, isoNow(now));
      db.pragma(`user_version = ${migration.version}`);
    })();
  }
  return db.pragma("user_version", { simple: true });
}

export function openWorkspaceDatabase(databaseFile, options = {}) {
  const db = new Database(databaseFile, {
    fileMustExist: options.fileMustExist === true,
    readonly: options.readonly === true,
  });
  try {
    configureWorkspaceDatabase(db);
    if (!options.readonly) migrateWorkspaceDatabase(db, options.migrations || WORKSPACE_MIGRATIONS, options);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function checkWorkspaceDatabase(db) {
  const integrity = db.pragma("integrity_check").map((row) => row.integrity_check);
  const foreignKeys = db.pragma("foreign_key_check");
  return {
    ok: integrity.length === 1 && integrity[0] === "ok" && foreignKeys.length === 0,
    integrity,
    foreignKeys,
  };
}
