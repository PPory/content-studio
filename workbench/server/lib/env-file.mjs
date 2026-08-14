// 改写 `.env`，**一次只动那一行**。
//
// 为什么不是「读成对象、改一改、整份序列化回去」：`.env` 里超过一半的行是注释，
// 而那些注释是资产（「同一串要同时填在这里 + 在 content-pipeline 里 wrangler secret put」
// 这种话，丢了就没有第二个地方写着）。整份重新序列化会把它们全抹掉，
// 而且这个错**不报错、不影响运行**——直到几个月后你想改一个变量、发现没人告诉你它是干什么的。
//
// 和 `books.mjs` 的 `setFrontmatterField` 是同一条规矩：只 splice 那一截，其余原样留着。
//
// ⚠️ **`.env` 的快照绝不进导出包。** 见文件末尾 `ENV_SNAPSHOT_KEY` 的注释。

import fs from "node:fs/promises";
import path from "node:path";
import { atomicWrite, snapshotFile, snapshotKeepDays, pruneSnapshots } from "./safe-write.mjs";

/**
 * 快照桶的名字。**它故意不在 `backup.mjs` 的 `DATA_FILES` 里**——那份清单是
 * 「导出 zip 会打包什么」的唯一真源，而 `.env` 里是密钥。
 * `BackupDrawer` 的界面文案和 zip 里的恢复说明都已经白纸黑字写了「不包含 .env 里的密钥」,
 * 把它加进去就是让那两句话变成假话，而没有任何地方会报错。
 */
export const ENV_SNAPSHOT_KEY = "env";

export const envFilePath = (root) => path.resolve(root, ".env");

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
// 一行赋值：允许前导空白和可选的 `export `，key 后面允许空格再等号
const LINE_RE = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=)(.*)$/;

/**
 * 值要不要加引号。dotenv 会把首尾的引号剥掉，所以加了是安全的；
 * 而**不加**在这几种情况下会静默读错：
 *  - 含 `#`：dotenv 把它当行内注释，`#` 之后整段丢掉
 *  - 首尾有空白：会被 trim 掉（Windows 路径粘贴时很容易带上尾随空格）
 *  - 含换行：一行变两行，第二行会被当成一个非法赋值整行忽略
 */
function quote(value) {
  const v = String(value ?? "");
  if (v === "") return "";
  if (!/[#\s"'\\]/.test(v) && v === v.trim()) return v;
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

/**
 * 把 `changes`（`{KEY: "值"}`）写进 `.env` 的文本里，返回新文本。
 *
 * - 已有的行**就地改值**，前导空白、`export `、等号两边的写法、行尾注释以外的一切原样保留
 * - 同一个 key 出现多次时**每一处都改**：dotenv 的取值规则（后面的覆盖前面的）不该
 *   变成用户要理解的东西——改完之后不管哪一行生效，值都是他填的那个
 * - 原来没有的 key **追加到末尾**
 * - 换行风格跟着原文件走（Windows 上 `.env` 多半是 CRLF，混进 LF 会让整份文件看着很乱）
 */
export function setEnvValues(text, changes) {
  const entries = Object.entries(changes).filter(([k]) => KEY_RE.test(k));
  if (!entries.length) return text;
  const wanted = new Map(entries);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const seen = new Set();

  const lines = text.split(/\r?\n/).map((line) => {
    // 注释行不碰：`# WORKER_URL=…` 是说明，不是赋值
    if (/^\s*#/.test(line)) return line;
    const m = LINE_RE.exec(line);
    if (!m) return line;
    const [, lead, key, eq] = m;
    if (!wanted.has(key)) return line;
    seen.add(key);
    return `${lead}${key}${eq}${quote(wanted.get(key))}`;
  });

  const missing = entries.filter(([k]) => !seen.has(k));
  if (missing.length) {
    // 追加前先保证正好一个空行分隔，不在文件末尾堆出一串空行
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push("", "# 以下由工作台的设置面板追加");
    for (const [k, v] of missing) lines.push(`${k}=${quote(v)}`);
  }
  if (lines[lines.length - 1] !== "") lines.push("");
  return lines.join(eol);
}

/**
 * 极简 dotenv 解析，**只用来自检**（真正加载 `.env` 的是 Vite 的 `loadEnv`）。
 * 规则要和上面 `quote()` 写出去的形状对得上，否则自检会把对的写入判成错的。
 */
export function parseEnv(text) {
  const out = {};
  for (const raw of String(text || "").split(/\r?\n/)) {
    if (/^\s*(#|$)/.test(raw)) continue;
    const m = LINE_RE.exec(raw);
    if (!m) continue;
    const key = m[2];
    let v = m[4].trim();
    if (v.length >= 2 && ((v[0] === '"' && v.at(-1) === '"') || (v[0] === "'" && v.at(-1) === "'"))) {
      const q = v[0];
      v = v.slice(1, -1);
      if (q === '"') v = v.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    } else {
      v = v.replace(/\s+#.*$/, "").trim(); // 行内注释
    }
    out[key] = v;
  }
  return out;
}

/**
 * 落盘。顺序是**先快照、再校验、最后原子替换**：
 *  - 快照在写之前 —— 填错一个路径想撤回时，「上一版」得真的存在
 *  - 校验在替换之前（`atomicWrite` 的 `verify`）—— 引号加错时原文件一个字节都没动过
 *  - 原子替换 —— `fs.writeFile` 会先把 `.env` 截成 0 字节，那一刻中断就是密钥全没了
 */
export async function updateEnvFile(root, changes) {
  const abs = envFilePath(root);
  let before = "";
  try {
    before = await fs.readFile(abs, "utf8");
  } catch (e) {
    if (e.code !== "ENOENT") throw e; // 没有 .env 就从空文件长出来
  }
  const after = setEnvValues(before, changes);
  if (after === before) return { abs, changed: false, snapshot: "" };

  const snapshot = await snapshotFile(root, ENV_SNAPSHOT_KEY, abs, ".env");
  await atomicWrite(abs, after, {
    verify: (text) => {
      const got = parseEnv(text);
      for (const [k, v] of Object.entries(changes)) {
        if (!KEY_RE.test(k)) continue;
        if (got[k] !== String(v ?? "")) throw new Error(`写出来的 .env 里 ${k} 读回来不是填进去的值，已放弃这次保存`);
      }
    },
  });
  await pruneSnapshots(root, ENV_SNAPSHOT_KEY, { keepDays: snapshotKeepDays() }).catch(() => 0);
  return { abs, changed: true, snapshot };
}
