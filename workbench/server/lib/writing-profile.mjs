// 我的创作：只保存那些会跨文章重复使用的选择。
//
// 目标读者、常用平台和默认风格都不是「这一篇的简报」，不该每次新建都再问一遍。
// 专家和风格属于工作台自己的产品能力。Boujoy 只用于参考“预设如何被调用”，
// 不能成为运行时依赖，否则对方目录为空、移动或改格式时，工作台会凭空失去能力。

import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite, pruneSnapshots, snapshotFile, snapshotKeepDays } from "./safe-write.mjs";
import { WRITING_EXPERTS, WRITING_STYLES } from "./writing-presets.mjs";
import { PLATFORMS } from "../../src/lib/platforms.js";

const FILE = path.resolve(process.cwd(), "config", "writing-profile.json");
const STYLE_FILE = path.resolve(process.cwd(), "config", "writing-styles.json");

export const DEFAULT_WRITING_PROFILE = Object.freeze({
  schemaVersion: 1,
  audience: "",
  platform: "公众号",
  styleId: "",
});

const cleanLine = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const cleanPrompt = (value, max = 6_000) => String(value ?? "")
  .replace(/\r\n?/g, "\n")
  .split("\n")
  .map((line) => line.replace(/[\t ]+$/g, ""))
  .join("\n")
  .trim()
  .slice(0, max);

export function normalizeWritingProfile(value = {}) {
  const platform = cleanLine(value.platform, 24);
  const styleId = cleanLine(value.styleId, 120);
  return {
    schemaVersion: 1,
    audience: cleanLine(value.audience, 80),
    platform: PLATFORMS.includes(platform) ? platform : DEFAULT_WRITING_PROFILE.platform,
    // 只保存工作台内置预设 id；这条边界也避免把路径或任意提示词塞进配置。
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

export function normalizeWritingStyleOverrides(value = {}) {
  const allowed = new Set(WRITING_STYLES.map((item) => item.id));
  return Object.fromEntries(Object.entries(value || {})
    .filter(([id]) => allowed.has(id))
    .map(([id, instructions]) => [id, cleanPrompt(instructions)])
    .filter(([, instructions]) => instructions));
}

export async function loadWritingStyleOverrides() {
  try {
    return normalizeWritingStyleOverrides(JSON.parse(await fs.readFile(STYLE_FILE, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") console.warn("[writing-profile] 风格提示词读取失败，用内置版本:", error.message);
    return {};
  }
}

export async function saveWritingStyle({ id, instructions }) {
  const preset = WRITING_STYLES.find((item) => item.id === cleanLine(id, 120));
  if (!preset) {
    const error = new Error("找不到这套写作风格");
    error.status = 404;
    throw error;
  }
  const prompt = cleanPrompt(instructions);
  if (!prompt) {
    const error = new Error("风格提示词不能为空");
    error.status = 400;
    throw error;
  }
  const overrides = await loadWritingStyleOverrides();
  if (prompt === preset.instructions) delete overrides[preset.id];
  else overrides[preset.id] = prompt;
  await fs.mkdir(path.dirname(STYLE_FILE), { recursive: true });
  await snapshotFile(process.cwd(), "writing-styles", STYLE_FILE);
  await atomicWrite(STYLE_FILE, JSON.stringify(overrides, null, 2));
  await pruneSnapshots(process.cwd(), "writing-styles", { keepDays: snapshotKeepDays() }).catch(() => 0);
  return { ...preset, instructions: prompt, customized: prompt !== preset.instructions };
}

export async function loadWritingRecords() {
  const overrides = await loadWritingStyleOverrides();
  return {
    styles: WRITING_STYLES.map((item) => ({
      ...item,
      defaultInstructions: item.instructions,
      instructions: overrides[item.id] || item.instructions,
      customized: !!overrides[item.id],
    })),
    experts: WRITING_EXPERTS.map((item) => ({ ...item })),
    source: "workbench/server/lib/writing-presets.mjs",
    hint: "这是 Xenho OS 自带的写作团队，不依赖外部项目或知识库目录。",
  };
}

export function activeRecord(records, id) {
  return (records || []).find((item) => item.enabled && item.id === id) || null;
}
