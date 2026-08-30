import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { loadEnv } from "vite";
import { resolveWorkspacePaths } from "../server/storage/workspace-paths.mjs";

const loaded = loadEnv("development", process.cwd(), "");
const env = { ...loaded, XENHO_HOME: process.env.XENHO_HOME || loaded.XENHO_HOME };
const results = [];

const add = (level, name, detail) => results.push({ level, name, detail });
const ok = (name, detail) => add("ok", name, detail);
const warn = (name, detail) => add("warn", name, detail);
const bad = (name, detail) => add("bad", name, detail);

let paths = null;
try {
  paths = resolveWorkspacePaths({ env });
  const root = path.parse(paths.root).root;
  if (paths.root === root) bad("工作区路径", "不能把磁盘根目录作为 Xenho 工作区");
  else ok("工作区路径", paths.root);
} catch (error) {
  bad("工作区路径", error.message);
}

if (paths) {
  const protectedPaths = [paths.databaseFile, paths.assetsDir, paths.backupsDir, paths.exportsDir];
  const escaped = protectedPaths.filter((target) => {
    const relative = path.relative(paths.root, target);
    return relative.startsWith("..") || path.isAbsolute(relative);
  });
  if (escaped.length) bad("路径边界", `发现越界路径：${escaped.join("、")}`);
  else ok("路径边界", "SQLite、资源、备份和导出均位于 Xenho 根目录内");

  if (!fs.existsSync(paths.root)) {
    warn("工作区状态", "目录尚不存在；首次启动会创建");
  } else if (!fs.existsSync(paths.databaseFile)) {
    warn("工作区状态", "根目录存在，SQLite 尚未初始化；启动工作台后会创建");
  } else {
    try {
      const db = new Database(paths.databaseFile, { readonly: true, fileMustExist: true });
      const integrity = db.pragma("integrity_check", { simple: true });
      const foreign = db.pragma("foreign_key_check");
      db.close();
      if (integrity !== "ok") bad("SQLite 完整性", String(integrity));
      else if (foreign.length) bad("SQLite 外键", `发现 ${foreign.length} 条异常`);
      else ok("SQLite 完整性", "integrity_check 与 foreign_key_check 通过");
    } catch (error) {
      bad("SQLite 完整性", error.message);
    }
  }
}

const model = ["AGENT_LLM_BASE_URL", "AGENT_LLM_MODEL", "AGENT_LLM_API_KEY"].filter((key) => String(env[key] || "").trim());
if (model.length === 0) warn("本机 AI", "未配置模型；其余本地功能可正常使用");
else if (model.length < 3) bad("本机 AI", "模型地址、模型 ID 和密钥必须一起填写");
else ok("本机 AI", "模型配置完整，密钥未输出");

const icon = { ok: "✓", warn: "!", bad: "✗" };
console.log("");
for (const item of results) console.log(` ${icon[item.level]} ${item.name.padEnd(12, "　")} ${item.detail}`);
console.log("");

if (results.some((item) => item.level === "bad")) process.exit(1);
