// 流水线状态计数的唯一实现：Telegram /状态 与工作台 /wb/status 共用。
//
// Notion 时代这里是把每个库的行**整批拉回来数长度**（没有 count 接口），五个库并行、
// 每库每 100 行一个 subrequest，注释里还留着「库涨到几千行时要改成缓存或抽样」的告警。
// 换 D1 之后这个问题自己没了：五条 COUNT(*) 打包成一次 batch，一个往返，与行数无关。

import { batch, stmt } from "./db.js";

const QUERIES = [
  ["待初筛", "inbox", "待初筛"],
  ["待整理", "inbox", "待选题"],
  ["选题待写", "topics", "待写"],
  ["选题撰写中", "topics", "撰写中"],
  ["内容待修改", "drafts", "待修改"],
];

export async function pipelineCounts(env) {
  const rows = await batch(
    env,
    QUERIES.map(([, table, status]) =>
      stmt(env, `SELECT COUNT(*) AS n FROM ${table} WHERE status = ?`, status))
  );
  const counts = {};
  QUERIES.forEach(([label], i) => {
    counts[label] = rows[i]?.results?.[0]?.n ?? 0;
  });
  return counts;
}

export function formatCounts(counts) {
  return [
    "📊 流水线状态",
    `灵感库待初筛：${counts.待初筛}`,
    `待整理（待选题）：${counts.待整理}`,
    `选题待写：${counts.选题待写}`,
    `选题撰写中：${counts.选题撰写中}`,
    `稿件库待修改：${counts.内容待修改}`,
  ].join("\n");
}
