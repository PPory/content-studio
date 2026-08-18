// 「目标读者」的预设清单（`config/audiences.json`）。
//
// 为什么要有这个：目标读者这一格每次都得手打，而实际上一个人常写的读者就那么三五种——
// **能推断的不让用户填**。做成下拉之后，它同时还答了另一个问题：「我到底在写给谁」这件事
// 有了一份看得见的清单，而不是每篇稿子里各写一遍、彼此还不一样。
//
// 存 `config/` 不存 localStorage：它是**内容配置**，和 `attention.json`、`prompts.json`
// 同一类（换个浏览器还得在，手改文件也该能改）。不属于「工作台无状态」那条红线管的内容——
// 那条管的是批注、笔记、稿子这些**你写的字**。
//
// 存储套路和 `prompts.mjs` 一模一样：默认值在代码里、文件不存在就用默认、
// 读的时候逐条兜底、写走 snapshotFile + atomicWrite + pruneSnapshots。

import path from "node:path";
import fs from "node:fs/promises";
import { atomicWrite, pruneSnapshots, snapshotFile, snapshotKeepDays } from "./safe-write.mjs";

const FILE = path.resolve(process.cwd(), "config", "audiences.json");
const MAX = 24;        // 再多就不是「选一个」而是「再搜一遍」了
const MAX_LEN = 60;

/**
 * 默认值只在**还没有这个文件**时用得上，之后以文件为准。
 *
 * 故意写得具体：「职场人」这种谁都算的词，对成稿的语气没有任何约束力，
 * 等于没填。列在这儿的每一条都该能让模型改变措辞。
 */
export const DEFAULT_AUDIENCES = [
  "想用 AI 提效的独立开发者",
  "工程师出身的内容创作者",
  "刚开始做自媒体的上班族",
  "在做知识管理的重度笔记用户",
  "对 AI 好奇但还没上手的普通人",
];

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LEN);

/**
 * 去重 + 掐长度 + 限量。**顺序就是最近用过的在前**，所以不排序。
 *
 * 导出是给单测的：这三条里任何一条错了都不报错，只会让下拉里慢慢堆出重复项、
 * 或者把「最近用的」挤到看不见的地方。
 */
export function normalizeAudiences(list) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const value = clean(item);
    if (value && !out.includes(value)) out.push(value);
    if (out.length >= MAX) break;
  }
  return out;
}

export async function loadAudiences() {
  try {
    const cfg = JSON.parse(await fs.readFile(FILE, "utf8"));
    const list = normalizeAudiences(cfg.list);
    return list.length ? list : [...DEFAULT_AUDIENCES];
  } catch (e) {
    if (e.code !== "ENOENT") console.warn("[audiences] 配置读失败，用默认值:", e.message);
    return [...DEFAULT_AUDIENCES];
  }
}

export async function saveAudiences(list) {
  const clean = normalizeAudiences(list);
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await snapshotFile(process.cwd(), "audiences", FILE);
  await atomicWrite(FILE, JSON.stringify({ schemaVersion: 1, list: clean }, null, 2));
  await pruneSnapshots(process.cwd(), "audiences", { keepDays: snapshotKeepDays() }).catch(() => 0);
  return clean;
}

/**
 * 用过一次就记下来，**新的排最前**。
 *
 * 这是这套预设唯一的维护方式：没有「管理预设」那种页面。写过一次的读者下次就在下拉里，
 * 不用先去某个设置页添加——**能自己长出来的清单，不该要求用户先去建**。
 * 已经在清单里的会被提到最前（最近用过的更可能再用），所以返回值总是要写回去的。
 */
export async function rememberAudience(value) {
  const one = clean(value);
  if (!one) return null;
  const list = await loadAudiences();
  const next = [one, ...list.filter((item) => item !== one)];
  // 顺序变了也照写：那正是「最近用过的在前」的全部实现
  return saveAudiences(next);
}
