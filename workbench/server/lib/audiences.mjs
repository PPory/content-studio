const MAX = 24;
const MAX_LEN = 60;

export const DEFAULT_AUDIENCES = [
  "想用 AI 提效的独立开发者",
  "工程师出身的内容创作者",
  "刚开始做自媒体的上班族",
  "在做知识管理的重度笔记用户",
  "对 AI 好奇但还没上手的普通人",
];

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LEN);

export function normalizeAudiences(list) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const value = clean(item);
    if (value && !out.includes(value)) out.push(value);
    if (out.length >= MAX) break;
  }
  return out;
}
