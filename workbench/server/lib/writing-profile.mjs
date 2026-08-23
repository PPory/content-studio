// 我的创作：只保存那些会跨文章重复使用的选择。
//
// 目标读者、常用平台和默认风格都不是「这一篇的简报」，不该每次新建都再问一遍。
// 风格与专家本身不复制进工作台：它们继续读取 Boujoy Harness 在 vault 里的 Markdown，
// 这样两边改的是同一份内容，不会慢慢长成两套互相矛盾的预设。

import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite, pruneSnapshots, snapshotFile, snapshotKeepDays } from "./safe-write.mjs";
import { vaultRoot } from "./vault.mjs";
import { PLATFORMS } from "../../src/lib/platforms.js";

const FILE = path.resolve(process.cwd(), "config", "writing-profile.json");
const RECORD_DIRS = {
  expert: ["05-Prompts", "Boujoy-Harness", "Experts"],
  style: ["05-Prompts", "Boujoy-Harness", "Styles"],
};

export const DEFAULT_WRITING_PROFILE = Object.freeze({
  schemaVersion: 1,
  audience: "",
  platform: "公众号",
  styleId: "",
});

const cleanLine = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function normalizeWritingProfile(value = {}) {
  const platform = cleanLine(value.platform, 24);
  const styleId = cleanLine(value.styleId, 120);
  return {
    schemaVersion: 1,
    audience: cleanLine(value.audience, 80),
    platform: PLATFORMS.includes(platform) ? platform : DEFAULT_WRITING_PROFILE.platform,
    // Boujoy 的文件名只允许这一组字符；同一条边界在这里再守一次，避免把路径塞进配置。
    styleId: /^[\w\-\u4e00-\u9fff]+$/u.test(styleId) ? styleId : "",
  };
}

export async function loadWritingProfile() {
  try {
    return normalizeWritingProfile(JSON.parse(await fs.readFile(FILE, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("[writing-profile] 配置读失败，用默认值:", error.message);
    return { ...DEFAULT_WRITING_PROFILE };
  }
}

export async function saveWritingProfile(value) {
  const clean = normalizeWritingProfile(value);
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await snapshotFile(process.cwd(), "writing-profile", FILE);
  await atomicWrite(FILE, JSON.stringify(clean, null, 2));
  await pruneSnapshots(process.cwd(), "writing-profile", { keepDays: snapshotKeepDays() }).catch(() => 0);
  return clean;
}

function parseRecord(file, text) {
  const fields = {};
  if (text.startsWith("---")) {
    const pieces = text.split("---", 3);
    for (const line of String(pieces[1] || "").split(/\r?\n/)) {
      const [key, ...rest] = line.split(":");
      if (rest.length) fields[key.trim()] = rest.join(":").trim().replace(/^"|"$/g, "");
    }
  }
  const split = text.match(/^##\s+(?:指令|Instructions)\s*$/m);
  const instructions = split ? text.slice((split.index || 0) + split[0].length).trim() : text.trim();
  return {
    id: path.basename(file, ".md"),
    name: fields.name || path.basename(file, ".md"),
    description: fields.description || "",
    enabled: String(fields.enabled || "true").toLowerCase() !== "false",
    instructions,
    updated: fields.updated || "",
  };
}

async function recordsOf(root, kind) {
  const folder = path.join(root, ...RECORD_DIRS[kind]);
  try {
    const names = (await fs.readdir(folder)).filter((name) => name.toLowerCase().endsWith(".md")).sort();
    const records = await Promise.all(names.map(async (name) => {
      const file = path.join(folder, name);
      return parseRecord(file, await fs.readFile(file, "utf8"));
    }));
    return { records, folder };
  } catch (error) {
    if (error.code === "ENOENT") return { records: [], folder };
    throw error;
  }
}

export async function loadWritingRecords(env) {
  let root;
  try {
    root = vaultRoot(env);
  } catch (error) {
    return { styles: [], experts: [], source: "", hint: error.message };
  }
  try {
    const [styles, experts] = await Promise.all([recordsOf(root, "style"), recordsOf(root, "expert")]);
    return {
      styles: styles.records,
      experts: experts.records,
      source: path.join(root, "05-Prompts", "Boujoy-Harness"),
      hint: "在 Boujoy Harness 新增或编辑后，这里会自动读取同一份本地 Markdown。",
    };
  } catch (error) {
    return {
      styles: [],
      experts: [],
      source: path.join(root, "05-Prompts", "Boujoy-Harness"),
      hint: `Boujoy 预设暂时读不到：${error.message}`,
    };
  }
}

export function activeRecord(records, id) {
  return (records || []).find((item) => item.enabled && item.id === id) || null;
}
