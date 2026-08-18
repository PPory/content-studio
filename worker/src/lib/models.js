// 每个环节用哪个模型。**真源是这张表，不是 wrangler var。**
//
// 起因很实际：初筛、成稿这种要判断力的活儿值得用贵模型，而「按意思挑素材」「补标签」
// 「提炼标题」这类只是把已有内容分个类，用便宜快的就够——一次搜索等十几秒是没道理的。
// 全局一个 `LLM_MODEL` 时这件事没法表达。
//
// **为什么存 D1 不存环境变量**：改一次模型就要 `wrangler deploy` 的话，没人会去调它；
// 而且三个调用方（cron 任务、两个 Bot、工作台）得读同一份，环境变量做不到「工作台里改完
// 立刻生效」。代价是每次 LLM 调用多一条 D1 查询——相对一次几秒到几分钟的生成，可以忽略，
// 所以**这里不做缓存**：缓存换来的是「改完不生效，等一会儿又生效了」这种最难解释的现象。

import { all, now } from "./db.js";

const PREFIX = "model:";

/**
 * 有哪些环节可以单独配。**这张表是真源**：工作台的设置面板整个从 `/wb/models` 渲染，
 * 前端一个字都不写死——加一个环节只改这里。
 *
 * `hint` 是给人看的选型建议，会显示在面板上。
 */
export const MODEL_TASKS = [
  { key: "triage", label: "灵感初筛", hint: "判断价值高低、拆素材卡。判断力要紧，值得用强模型。" },
  { key: "synthesize", label: "每日整理", hint: "把一天的灵感聚成选题，要跨条目找联系。" },
  { key: "knowledge", label: "知识卡片", hint: "把阅读对话沉淀成可复用知识，需区分原文证据与 AI 推断。" },
  { key: "draft", label: "成稿", hint: "最花 token 也最看质量的一步。" },
  { key: "tweet", label: "快速推文（/推）", hint: "短、要有网感，可以试试别的模型。" },
  { key: "explain", label: "划词理解", hint: "解释 / 展开 / 反驳 / 选题。要快，你在等着读。" },
  { key: "writing", label: "写作推动", hint: "卡住时的一问或续写。响应要快，完成全文时也要稳。" },
  { key: "pick", label: "按意思挑素材", hint: "只是在候选清单里排个序，便宜快的模型足够。" },
  { key: "utility", label: "打标签 · 分类 · 提标题", hint: "把已有内容归个类，用最便宜的那档就行。" },
];

const KEYS = new Set(MODEL_TASKS.map((t) => t.key));

/** 读全部覆盖值（只回真的配过的那几个）。表还没建时当作没配，不让整条链路挂掉。 */
export async function readModelMap(env) {
  try {
    const rows = await all(env, `SELECT key, value FROM settings WHERE key LIKE '${PREFIX}%'`);
    const map = {};
    for (const row of rows) {
      const task = String(row.key).slice(PREFIX.length);
      if (KEYS.has(task) && String(row.value || "").trim()) map[task] = String(row.value).trim();
    }
    return map;
  } catch (e) {
    console.warn("[models] 读设置失败，全部退回默认模型:", e.message);
    return {};
  }
}

/**
 * 这一步该用哪个模型。**没配过就用 `env.LLM_MODEL`**——所有环节的默认值只有这一个来源，
 * 于是「什么都没设」和迁移之前的行为逐字相同。
 */
export async function modelFor(env, task) {
  if (!KEYS.has(task)) return env.LLM_MODEL;
  const map = await readModelMap(env);
  return map[task] || env.LLM_MODEL;
}

/**
 * 写覆盖值。**空值 = 恢复默认**（删掉那一行），不是存一个空字符串——
 * 存空串的话 `modelFor` 那句 `|| env.LLM_MODEL` 照样能兜住，但库里留着一条毫无意义的记录，
 * 而「配过但等于没配」这种状态迟早会让人以为自己设的没生效。
 */
export async function writeModelMap(env, patch = {}) {
  const stamp = now();
  const stmts = [];
  for (const [task, raw] of Object.entries(patch)) {
    if (!KEYS.has(task)) continue;
    const value = String(raw ?? "").trim().slice(0, 120);
    stmts.push(
      value
        ? env.DB.prepare(
            `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
          ).bind(PREFIX + task, value, stamp)
        : env.DB.prepare(`DELETE FROM settings WHERE key = ?`).bind(PREFIX + task)
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  return readModelMap(env);
}

/**
 * LLM 代理当前供哪些模型（`GET {LLM_BASE_URL}/models`）。
 *
 * 面板上给一份**真实清单**而不是一个纯输入框：模型 id 打错一个字，不会在设置里报错，
 * 而是等到下一次初筛/成稿时才失败——那时候现象是「流水线不动了」，没人会想到是这儿。
 * 取不到就退回自由输入，不挡着用。
 */
export async function availableModels(env) {
  if (!env.LLM_BASE_URL || !env.LLM_API_KEY) return [];
  try {
    const res = await fetch(`${env.LLM_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${env.LLM_API_KEY}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (Array.isArray(data?.data) ? data.data : [])
      .map((m) => String(m?.id || "").trim())
      .filter(Boolean)
      .sort();
  } catch (e) {
    console.warn("[models] 取不到可用模型清单:", e.message);
    return [];
  }
}
