/**
 * 编辑器 AI 修订历史。正文只保留最终采用的文字；原文、候选和指令单独落在 data/。
 *
 * 同一个 Node 进程里把写操作串起来，避免两个编辑器几乎同时保存时都读到旧文件、
 * 后写的那一次把先写的修订安静覆盖掉。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite, pruneSnapshots, snapshotFile, snapshotKeepDays } from "./safe-write.mjs";

export const REVISION_FILE = "data/editor-revisions.json";
const FILE = () => path.resolve(process.cwd(), REVISION_FILE);
const MAX_SCOPE = 400;
const MAX_ITEMS = 100;
const MAX_TEXT = 20_000;
const MAX_INSTRUCTION = 600;
const MAX_GENERATIONS = 10;
const MAX_ALIASES = 500;

let writes = Promise.resolve();

const cleanText = (value, max = MAX_TEXT) => String(value || "").slice(0, max);

export function cleanRevisionScope(value) {
  const scope = String(value || "").trim();
  if (!scope || scope.length > MAX_SCOPE || /[\u0000-\u001f]/.test(scope)) {
    throw Object.assign(new Error("稿件修订身份不合法"), { status: 400 });
  }
  return scope;
}

export function normalizeRevision(item = {}) {
  const id = String(item.id || "").trim();
  if (!/^[0-9A-Za-z_.:-]{8,100}$/.test(id)) {
    throw Object.assign(new Error("修订记录 id 不合法"), { status: 400 });
  }
  const status = ["pending", "adopted", "discarded"].includes(item.status) ? item.status : "pending";
  const mode = ["polish", "correct", "shorten", "expand", "rewrite"].includes(item.mode) ? item.mode : "polish";
  const generations = (Array.isArray(item.generations) ? item.generations : [])
    .slice(-MAX_GENERATIONS)
    .map((entry) => ({ text: cleanText(entry?.text), at: String(entry?.at || new Date().toISOString()) }))
    .filter((entry) => entry.text.trim());
  return {
    id,
    mode,
    label: cleanText(item.label, 40),
    instruction: cleanText(item.instruction, MAX_INSTRUCTION),
    original: cleanText(item.original),
    candidate: cleanText(item.candidate),
    generations,
    status,
    createdAt: String(item.createdAt || new Date().toISOString()),
    updatedAt: new Date().toISOString(),
  };
}

export function verifyRevisionStore(text) {
  const data = JSON.parse(String(text || "{}"));
  if (data.schemaVersion !== 1 || !data.documents || typeof data.documents !== "object" || Array.isArray(data.documents)) {
    throw new Error("editor-revisions.json 结构不正确");
  }
  const aliases = data.aliases && typeof data.aliases === "object" && !Array.isArray(data.aliases) ? data.aliases : {};
  return { ...data, aliases };
}

async function readStore() {
  try {
    return verifyRevisionStore(await fs.readFile(FILE(), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return { schemaVersion: 1, documents: {}, aliases: {} };
    throw e;
  }
}

function resolveScope(store, initial) {
  let scope = initial;
  const seen = new Set();
  for (let depth = 0; depth < 8 && store.aliases?.[scope] && !seen.has(scope); depth += 1) {
    seen.add(scope);
    scope = cleanRevisionScope(store.aliases[scope]);
  }
  return scope;
}

async function writeStore(store) {
  const file = FILE();
  await snapshotFile(process.cwd(), "editor-revisions", file);
  await atomicWrite(file, `${JSON.stringify(store, null, 2)}\n`, { verify: verifyRevisionStore });
  await pruneSnapshots(process.cwd(), "editor-revisions", { keepDays: snapshotKeepDays() }).catch(() => 0);
}

function queued(task) {
  const run = writes.then(task, task);
  writes = run.catch(() => {});
  return run;
}

export async function listEditorRevisions(rawScope) {
  const requested = cleanRevisionScope(rawScope);
  await writes;
  const store = await readStore();
  const scope = resolveScope(store, requested);
  return Array.isArray(store.documents[scope]?.items) ? store.documents[scope].items : [];
}

export function saveEditorRevision(rawScope, rawItem) {
  const requested = cleanRevisionScope(rawScope);
  const item = normalizeRevision(rawItem);
  return queued(async () => {
    const store = await readStore();
    const scope = resolveScope(store, requested);
    const current = Array.isArray(store.documents[scope]?.items) ? store.documents[scope].items : [];
    const items = [item, ...current.filter((entry) => entry.id !== item.id)].slice(0, MAX_ITEMS);
    store.documents[scope] = { updatedAt: item.updatedAt, items };
    await writeStore(store);
    return items;
  });
}

export function moveEditorRevisions(rawFrom, rawTo) {
  const requestedFrom = cleanRevisionScope(rawFrom);
  const requestedTo = cleanRevisionScope(rawTo);
  if (requestedFrom === requestedTo) return listEditorRevisions(requestedTo);
  return queued(async () => {
    const store = await readStore();
    const from = resolveScope(store, requestedFrom);
    const to = resolveScope(store, requestedTo);
    if (from === to) {
      if (requestedFrom !== to) {
        store.aliases[requestedFrom] = to;
        await writeStore(store);
      }
      return Array.isArray(store.documents[to]?.items) ? store.documents[to].items : [];
    }
    const source = Array.isArray(store.documents[from]?.items) ? store.documents[from].items : [];
    const target = Array.isArray(store.documents[to]?.items) ? store.documents[to].items : [];
    const seen = new Set();
    const items = [...source, ...target].filter((item) => item?.id && !seen.has(item.id) && seen.add(item.id)).slice(0, MAX_ITEMS);
    if (items.length) store.documents[to] = { updatedAt: new Date().toISOString(), items };
    delete store.documents[from];
    for (const [alias, targetScope] of Object.entries(store.aliases || {})) {
      if (targetScope === from) store.aliases[alias] = to;
    }
    if (requestedFrom !== to) store.aliases[requestedFrom] = to;
    if (from !== to) store.aliases[from] = to;
    store.aliases = Object.fromEntries(Object.entries(store.aliases).slice(-MAX_ALIASES));
    await writeStore(store);
    return items;
  });
}
