// 流水线的提示词：`worker/prompt/**/*.md`。
//
// 这些是**另一个项目的文件**，而且是 Worker 的编译输入（`prompts.js` 用 wrangler 的
// Text 模块 import 进去）。所以：**改完必须 `npx wrangler deploy` 才生效**，
// 而忘了部署的表现是「改了没反应」——Worker 那边照旧按老提示词跑，不报错、
// 界面上也看不出来。这是这一段最大的坑，界面必须一直把它顶在前面。
//
// ⚠️ **工作台在这里写的是 workbench 之外的文件**（合仓之后是同一个仓的 worker/，
// 但仍然是另一个包、另一套部署），这是这个项目里唯一一处这样的能力。
// 四条防护，一条都不能省：
//
//  1. **认清单 id，不认路径。** 客户端提交的是我们自己列出来那份清单里的 id
//     （相对路径的哈希），不是路径本身。路径当参数等于开了个任意文件写入的口子——
//     和数据页 inbox 那条「接口认 id 不认路径」是同一条。
//  2. **落盘前再验一遍它确实在 `prompt/` 底下**（`safeJoin` 那套的相对路径检查）。
//     两道，因为第一道依赖「清单是我们生成的」这个前提，而前提是会被改坏的。
//  3. **只认 `.md`**。prompt 目录里以后可能有别的东西，而我们只该碰提示词。
//  4. **写前留快照**（落工作台自己的 `data/.snapshots/pipeline-prompt/`），写走
//     `atomicWrite`。别人的项目被我们写坏了，得能退回去。
//     快照**不进导出包**（`backup.mjs` 的 `DATA_FILES` 里没有它），理由和 `.env` 一样：
//     那个 zip 是「工作台的数据」，不该悄悄夹带 worker/ 的源文件。

import path from "node:path";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { atomicWrite, pruneSnapshots, snapshotFile, snapshotKeepDays } from "./safe-write.mjs";
import { workerDir } from "./settings-schema.mjs";

export const SNAPSHOT_KEY = "pipeline-prompt";

/** 部署命令。**界面上要照着显示并给复制按钮**，别让人去别处找。 */
export const DEPLOY_CMD = "npx wrangler deploy";

/** 提示词根目录。不存在时调用方给引导，不报错——没有 worker/ 也不影响工作台其余部分。 */
export const promptRoot = (env) => path.join(workerDir(env), "prompt");

const idOf = (rel) => createHash("sha1").update(rel).digest("hex").slice(0, 16);

/**
 * 每个文件是干什么的。**认不出的不猜**，回落到空说明——
 * 与其编一句「这是 xxx 提示词」，不如什么都不说，反正文件名本身还在。
 * 分组是为了让十几个文件不排成一堵墙：主流程 / 复用片段 / 平台指南。
 */
const NOTES = {
  "triage.md": ["主流程", "灵感初筛：判断一条随手存的东西值不值得留、归到哪一档"],
  "synthesize.md": ["主流程", "每日整理：把灵感消化成素材"],
  "draft.md": ["主流程", "成稿骨架。带 {{voice}} {{frameworks}} {{platform_guide}} 占位"],
  "adapt.md": ["主流程", "以长带短：把主稿改写成其他平台的版本"],
  "tweet.md": ["主流程", "推文体改写"],
  "explain.md": ["主流程", "划词 AI：阅读区选中一段之后的解释 / 展开 / 反驳 / 选题"],
  "tags.md": ["主流程", "素材打标签"],
  "voice.md": ["复用片段", "作者声音 / 人设。被 draft 和 adapt 一起引用"],
  "frameworks.md": ["复用片段", "可选的结构框架。被 draft 引用"],
};

const GROUP_ORDER = ["主流程", "复用片段", "平台指南", "其他"];

function describe(rel) {
  const base = path.basename(rel);
  if (rel.startsWith("platform/")) return ["平台指南", `成稿 / 改写时按平台注入的专属指南（${base.replace(/\.md$/, "")}）`];
  return NOTES[base] || ["其他", ""];
}

async function walk(root, sub = "") {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(path.join(root, sub), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(root, rel)));
    else if (e.name.toLowerCase().endsWith(".md")) out.push(rel);
  }
  return out;
}

/**
 * 列清单。返回的每一项带 `id`——**后续读写只认这个 id**。
 * 目录不存在时返回 `{ ok:false }` 形状的空清单，由路由翻成引导。
 */
export async function listPipelinePrompts(env) {
  const root = promptRoot(env);
  const rels = (await walk(root)).sort();
  const items = [];
  for (const rel of rels) {
    const [group, note] = describe(rel);
    let bytes = 0;
    let at = "";
    try {
      const s = await fs.stat(path.join(root, rel));
      bytes = s.size;
      at = s.mtime.toISOString();
    } catch {
      continue; // 刚被删掉，跳过
    }
    items.push({ id: idOf(rel), rel, name: path.basename(rel), group, note, bytes, at });
  }
  items.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.rel.localeCompare(b.rel));
  return { root, exists: !!rels.length, items };
}

/**
 * id → 绝对路径。**两道**：先在自己列出来的清单里找到它，再验一遍相对路径没越界。
 * 第一道依赖「清单是我们生成的」，第二道不依赖任何前提。
 */
async function resolveById(env, id) {
  const { root, items } = await listPipelinePrompts(env);
  const hit = items.find((i) => i.id === String(id || ""));
  if (!hit) throw Object.assign(new Error("没有这个提示词文件"), { status: 404, hint: "刷新一下设置面板，文件可能被改名或删掉了" });

  const abs = path.resolve(root, hit.rel);
  const inside = path.relative(root, abs);
  if (inside.startsWith("..") || path.isAbsolute(inside)) {
    throw Object.assign(new Error("路径越界，拒绝访问"), { status: 400 });
  }
  if (!abs.toLowerCase().endsWith(".md")) throw Object.assign(new Error("只允许改 .md"), { status: 400 });
  return { abs, item: hit };
}

export async function readPipelinePrompt(env, id) {
  const { abs, item } = await resolveById(env, id);
  const text = await fs.readFile(abs, "utf8");
  const s = await fs.stat(abs);
  // stamp 是乐观锁：这些文件在 worker/ 那边也可能被直接编辑
  return { ...item, text, stamp: String(s.mtimeMs) };
}

export async function writePipelinePrompt(env, id, text, stamp = "") {
  const { abs, item } = await resolveById(env, id);
  const before = await fs.stat(abs);
  // 对不上就 409 让人刷新，不硬覆盖——这些文件在编辑器里直接改也是常事
  if (stamp && String(before.mtimeMs) !== String(stamp)) {
    throw Object.assign(new Error("这个文件在别处被改过了"), {
      status: 409,
      hint: "刷新设置面板拿到最新内容，再把你的改动合上去",
    });
  }
  await snapshotFile(process.cwd(), SNAPSHOT_KEY, abs, ".md");
  await atomicWrite(abs, String(text ?? ""));
  await pruneSnapshots(process.cwd(), SNAPSHOT_KEY, { keepDays: snapshotKeepDays() }).catch(() => 0);
  const after = await fs.stat(abs);
  return { ...item, bytes: after.size, at: after.mtime.toISOString(), stamp: String(after.mtimeMs) };
}
