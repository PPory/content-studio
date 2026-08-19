/**
 * 一键导出 / 恢复。
 *
 * 恢复对象分四类，这个模块只管其中两类，另外两类**明说自己不管**——
 * 一份「看着像全备份、其实漏了一半」的备份比没有备份更危险：
 *
 *  | 对象           | 谁负责                                    |
 *  | 代码           | git（每个迭代一个提交，稳定版打 tag）      |
 *  | vault 正文     | 你自己的文件级备份 / Obsidian 同步         |
 *  | 工作台数据     | **这里**：posts / metrics / 关注配置       |
 *  | 浏览器本地数据 | **这里**：由前端把 localStorage 交上来     |
 *
 * vault 只在清单里记**路径和状态**，绝不悄悄把整个知识库复制进这个 zip：
 * vault 动辄上 GB，而且它已经有自己的备份方式；一个「导出」按钮突然吐出一个几 GB
 * 的文件，用户根本不会预期。
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { atomicWrite, snapshotFile, listSnapshots, pruneSnapshots } from "./safe-write.mjs";

export const BUNDLE_VERSION = 1;

/**
 * 工作台数据文件的**唯一清单**。快照、导出、恢复三处都从这里取，
 * 加一个数据文件只改这一处——三处各写一份的话，新加的那个会安静地不进备份。
 *
 * `verify` 是恢复时的完整性检查：解出来的内容能不能被当前代码读懂。
 * 读不懂就整份不恢复，而不是写进去等下次打开数据页时白屏。
 *
 * ⚠️ **`.env` 和它的快照（`data/.snapshots/env/`）永远不进这份清单。**
 * 设置面板会改写 `.env` 并在 `data/.snapshots/env/` 留历史（见 `lib/env-file.mjs`），
 * 那里面是明文密钥；而这个 zip 是**要带走的**，`BackupDrawer` 的界面文案和包里的
 * 恢复说明都白纸黑字写着「不包含 .env 里的密钥」。加进来就是让那两句话变成假话，
 * 而没有任何地方会报错——用户只会在某天把这个包发给别人时才发现。
 * `tests/unit.mjs` 钉了这一条。
 */
export const DATA_FILES = [
  {
    key: "editor-revisions",
    rel: "data/editor-revisions.json",
    label: "AI 局部修订历史",
    verify: (text) => {
      const data = JSON.parse(text);
      if (data.schemaVersion !== 1 || !data.documents || typeof data.documents !== "object" || Array.isArray(data.documents)) {
        throw new Error("editor-revisions.json 结构不正确");
      }
    },
  },
  {
    key: "posts",
    rel: "data/posts.csv",
    label: "已发布内容（一条内容一行）",
    verify: (text) => {
      const head = text.split(/\r?\n/)[0] || "";
      if (!/(^|,)date(,|$)/.test(head) || !/(^|,)platform(,|$)/.test(head)) {
        throw new Error("posts.csv 的表头里没有 date / platform 列");
      }
    },
  },
  {
    key: "metrics",
    rel: "data/metrics.csv",
    label: "账号周录（粉丝数）",
    verify: (text) => {
      const head = text.split(/\r?\n/)[0] || "";
      if (!/(^|,)date(,|$)/.test(head)) throw new Error("metrics.csv 的表头里没有 date 列");
    },
  },
  {
    key: "attention",
    rel: "config/attention.json",
    label: "AI 情报的关注领域与关键词",
    verify: (text) => {
      const o = JSON.parse(text); // 解析不了自然抛
      if (!Array.isArray(o.domains)) throw new Error("attention.json 里没有 domains 数组");
    },
  },
];

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/**
 * 恢复说明。**跟着 zip 一起走，不是放在项目文档里**——需要它的那一刻，
 * 你手上往往只剩这个 zip（换了机器、仓库还没 clone 回来）。
 * 写给不看代码的人：每一步都是能照着做的动作。
 */
function readme(manifest) {
  const list = manifest.files.map((f) => `  - ${f.rel}（${f.label}，${f.bytes} 字节）`).join("\n");
  return `Xenho OS 创作工作台 · 数据备份
生成时间：${manifest.generatedAt}
备份格式版本：${manifest.version}

这个压缩包里有什么
${list}
  - browser-local.json（阅读进度、书签、阅读设置、排版草稿等浏览器本地数据）

这个压缩包里【没有】什么
  - 你的 Obsidian 知识库正文。它太大，而且有自己的备份方式；
    这里只记下路径：${manifest.vault.path || "（未配置）"}
  - 工作台的源代码。代码在 git 里，用 git 回退。
  - .env 里的密钥。密钥不进备份文件，换机器时手工重填。

怎么恢复（不需要懂代码）
  1. 打开工作台（开始菜单里的 Xenho OS）。
  2. 进「总览」页，最下面一行点「备份与恢复」。
  3. 点「从备份文件恢复」，选中这个 zip。
  4. 先看一眼预览：它会告诉你每份数据会从几条变成几条。
  5. 确认。恢复前工作台会自动把当前数据存成快照，
     万一恢复的结果不对，在同一个面板里可以退回去。

如果工作台起不来
  这些文件就是纯文本，解压后直接覆盖到工作台目录下的同名路径即可
  （data/posts.csv、data/metrics.csv、data/editor-revisions.json、config/attention.json）。
  browser-local.json 只有工作台自己能写回去，手工恢复时可以先跳过它，
  代价只是阅读进度和书签要重来。
`;
}

/**
 * 打包。`browser` 是前端交上来的 localStorage 快照（服务端读不到它）。
 */
export async function exportBundle(root, { browser = {}, vaultPath = "" } = {}) {
  const files = {};
  const entries = [];
  for (const f of DATA_FILES) {
    const abs = path.resolve(root, f.rel);
    let buf;
    try {
      buf = await fs.readFile(abs);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      continue; // 还没有这份数据就不进包，恢复时也不会去动它
    }
    files[f.rel] = new Uint8Array(buf);
    entries.push({ key: f.key, rel: f.rel, label: f.label, bytes: buf.length, sha256: sha256(buf) });
  }

  const browserJson = JSON.stringify(browser, null, 2);
  const manifest = {
    app: "creator-workbench",
    version: BUNDLE_VERSION,
    generatedAt: new Date().toISOString(),
    files: entries,
    browser: { keys: Object.keys(browser), bytes: Buffer.byteLength(browserJson), sha256: sha256(browserJson) },
    // vault 只记路径和「有没有配」，不复制内容。写清楚它没被包含，比默默不包含重要。
    vault: { path: vaultPath, included: false, note: "vault 正文不在这个包里，用你自己的文件级备份" },
  };

  files["browser-local.json"] = strToU8(browserJson);
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  files["恢复说明.txt"] = strToU8(readme(manifest));
  return { zip: Buffer.from(zipSync(files, { level: 6 })), manifest };
}

function openBundle(bytes) {
  let unpacked;
  try {
    unpacked = unzipSync(new Uint8Array(bytes));
  } catch {
    throw Object.assign(new Error("这不是一个能打开的 zip 文件"), { status: 400 });
  }
  if (!unpacked["manifest.json"]) {
    throw Object.assign(new Error("这个 zip 里没有 manifest.json，不像是工作台导出的备份"), { status: 400 });
  }
  let manifest;
  try {
    manifest = JSON.parse(strFromU8(unpacked["manifest.json"]));
  } catch {
    throw Object.assign(new Error("备份里的 manifest.json 读不出来"), { status: 400 });
  }
  if (manifest.app !== "creator-workbench") {
    throw Object.assign(new Error(`这个备份是 ${manifest.app || "别的程序"} 的，不是工作台的`), { status: 400 });
  }
  if (Number(manifest.version) > BUNDLE_VERSION) {
    throw Object.assign(
      new Error(`备份格式版本 ${manifest.version} 比当前工作台认识的 ${BUNDLE_VERSION} 新`),
      { status: 400, hint: "先把工作台更新到较新的版本再恢复" }
    );
  }
  return { unpacked, manifest };
}

const countRows = (text) => text.split(/\r?\n/).filter((l) => l.trim()).length - 1;

/**
 * 预览：这个备份要往里放什么、当前是什么、换过去之后是几条。
 *
 * **一个字节都不写。** 恢复是覆盖式的，用户点确认前必须看得见代价——
 * 「从 42 条变成 7 条」和「从 42 条变成 43 条」是完全不同的两个决定，
 * 而只显示「即将恢复 3 份数据」的话，这两者看起来一模一样。
 */
export async function previewBundle(root, bytes) {
  const { unpacked, manifest } = openBundle(bytes);
  const items = [];
  for (const f of DATA_FILES) {
    const inBundle = unpacked[f.rel];
    const abs = path.resolve(root, f.rel);
    let current = null;
    try {
      current = await fs.readFile(abs, "utf8");
    } catch {
      /* 当前还没有这份数据 */
    }
    if (!inBundle) {
      items.push({ key: f.key, rel: f.rel, label: f.label, action: "skip", reason: "备份里没有这一份，保持现状不动" });
      continue;
    }
    const text = strFromU8(inBundle);
    const meta = manifest.files?.find((m) => m.rel === f.rel);
    let broken = "";
    if (meta?.sha256 && meta.sha256 !== sha256(Buffer.from(inBundle))) broken = "校验值对不上，文件可能损坏";
    else {
      try {
        f.verify?.(text);
      } catch (e) {
        broken = e.message;
      }
    }
    items.push({
      key: f.key,
      rel: f.rel,
      label: f.label,
      action: broken ? "blocked" : "replace",
      reason: broken,
      isCsv: f.rel.endsWith(".csv"),
      currentRows: current === null ? null : f.rel.endsWith(".csv") ? countRows(current) : null,
      backupRows: f.rel.endsWith(".csv") ? countRows(text) : null,
      currentBytes: current === null ? null : Buffer.byteLength(current),
      backupBytes: Buffer.byteLength(text),
    });
  }
  const browserKeys = unpacked["browser-local.json"]
    ? Object.keys(JSON.parse(strFromU8(unpacked["browser-local.json"])))
    : [];
  return {
    generatedAt: manifest.generatedAt,
    version: manifest.version,
    vault: manifest.vault || null,
    items,
    browserKeys,
    blocked: items.some((i) => i.action === "blocked"),
  };
}

/**
 * 真恢复。顺序是**先备份当前、再校验、再替换、再复查、不对就回滚**。
 *
 * 复查这一步不能省：写进去了不等于读得出来。而回滚的素材就是上一步刚存的那份快照——
 * 所以快照必须在**任何写入之前**全部做完，不能边写边存。
 */
export async function restoreBundle(root, bytes, { keepDays = 30 } = {}) {
  const preview = await previewBundle(root, bytes);
  if (preview.blocked) {
    const bad = preview.items.filter((i) => i.action === "blocked");
    throw Object.assign(new Error(`备份里有 ${bad.length} 份数据不完整：${bad.map((b) => `${b.rel}（${b.reason}）`).join("；")}`), {
      status: 400,
      hint: "换一个备份文件；当前数据没有被改动。",
    });
  }
  const { unpacked } = openBundle(bytes);
  const targets = DATA_FILES.filter((f) => unpacked[f.rel]);

  // 1. 先把当前状态整个存成快照，回滚要靠它
  const rollback = [];
  for (const f of targets) {
    const abs = path.resolve(root, f.rel);
    const snap = await snapshotFile(root, f.key, abs);
    rollback.push({ f, abs, snap });
  }

  // 2. 替换。任何一份出错就把已经写过的全部退回去
  const done = [];
  try {
    for (const { f, abs } of rollback) {
      const text = strFromU8(unpacked[f.rel]);
      await atomicWrite(abs, text, { verify: f.verify });
      done.push({ f, abs });
    }
    // 3. 复查：重新读一遍，再过一次同一套校验
    for (const { f, abs } of done) {
      const back = await fs.readFile(abs, "utf8");
      f.verify?.(back);
    }
  } catch (e) {
    for (const { f, abs, snap } of rollback) {
      if (!snap) {
        await fs.rm(abs, { force: true }).catch(() => {}); // 恢复前本来就没有这份，退回「没有」
        continue;
      }
      await fs.copyFile(snap, abs).catch(() => {});
    }
    throw Object.assign(new Error(`恢复失败，已退回恢复前的状态：${e.message}`), { status: 500 });
  }

  for (const f of targets) await pruneSnapshots(root, f.key, { keepDays }).catch(() => 0);

  const browser = unpacked["browser-local.json"] ? JSON.parse(strFromU8(unpacked["browser-local.json"])) : {};
  return { restored: targets.map((f) => f.rel), browser, preview };
}

/**
 * 面板要显示的东西：每份数据现在多大、有几份快照、最近一份是什么时候。
 */
export async function backupStatus(root, { keepDays = 30 } = {}) {
  const items = [];
  for (const f of DATA_FILES) {
    const abs = path.resolve(root, f.rel);
    let bytes = null;
    let at = null;
    try {
      const s = await fs.stat(abs);
      bytes = s.size;
      at = s.mtime.toISOString();
    } catch {
      /* 还没有这份数据 */
    }
    const snaps = await listSnapshots(root, f.key);
    items.push({ key: f.key, rel: f.rel, label: f.label, bytes, at, snapshots: snaps.map((s) => ({ name: s.name, at: s.at, bytes: s.bytes })) });
  }
  return { items, keepDays };
}

/**
 * 从某一份快照退回去。**退之前先把「现在」也存成快照**——
 * 回滚本身也是一次数据变更，退错了同样要有得退。
 */
export async function restoreSnapshot(root, key, name, { keepDays = 30 } = {}) {
  const f = DATA_FILES.find((d) => d.key === key);
  if (!f) throw Object.assign(new Error(`没有这份数据：${key}`), { status: 400 });
  if (!/^[\w.\-]+$/.test(name)) throw Object.assign(new Error("快照名不合法"), { status: 400 });
  const snaps = await listSnapshots(root, key);
  const hit = snaps.find((s) => s.name === name);
  if (!hit) throw Object.assign(new Error("找不到这份快照，可能刚被清理掉了"), { status: 404 });

  const text = await fs.readFile(hit.abs, "utf8");
  try {
    f.verify?.(text);
  } catch (e) {
    throw Object.assign(new Error(`这份快照本身读不通：${e.message}`), { status: 400, hint: "换一份更早的快照试试。" });
  }
  const abs = path.resolve(root, f.rel);
  const before = await snapshotFile(root, key, abs);
  try {
    await atomicWrite(abs, text, { verify: f.verify });
    f.verify?.(await fs.readFile(abs, "utf8"));
  } catch (e) {
    if (before) await fs.copyFile(before, abs).catch(() => {});
    throw Object.assign(new Error(`回退失败，已保持原样：${e.message}`), { status: 500 });
  }
  await pruneSnapshots(root, key, { keepDays }).catch(() => 0);
  return { rel: f.rel, from: name, at: hit.at };
}
