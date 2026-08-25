// 写盘的两条底线：**写坏了不能坏掉原来那份**，**改之前留一份回得去的**。
//
// 这个工作台的数据文件都是「整份重写」式的（posts.csv、metrics.csv、attention.json、
// vault 里的正文和批注）。整份重写最怕的就是写到一半停电／进程被杀：
// `fs.writeFile` 会先把文件截成 0 字节再往里写，中断的那一刻磁盘上留下的是**半份文件**，
// 而原来那份已经没了。现象不是报错，是下次打开发现内容少了一截——而且没人说得清是什么时候没的。

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/**
 * 先写临时文件、落盘、再原子替换。
 *
 * 三步缺一不可：
 *  - 临时文件和目标**在同一个目录**里。跨盘符的 rename 在 Windows 上会退化成
 *    「复制 + 删除」，那就不是原子操作了，中途断掉照样留半份。
 *  - `fsync` 之后再 rename。不 fsync 的话，rename 可能先于数据真正落盘生效，
 *    断电后得到的是一个「名字对、内容是空的」文件——比半份还糟，因为它看着很正常。
 *  - 失败要把临时文件收掉，否则 data/ 里会慢慢堆满 `.tmp-xxxx`。
 *
 * `verify` 是可选的一道自检：拿到即将写下去的字符串，觉得不对就抛。
 * 校验放在替换**之前**，所以校验不过时原文件一个字节都没动过。
 */
const writeQueues = new Map();

async function atomicWriteNow(abs, content) {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}-${Date.now().toString(36)}-${crypto.randomUUID()}`;
  let fh;
  try {
    fh = await fs.open(tmp, "w");
    await fh.writeFile(content, typeof content === "string" ? "utf8" : undefined);
    await fh.sync();
    await fh.close();
    fh = null;
    await fs.rename(tmp, abs);
  } catch (e) {
    if (fh) await fh.close().catch(() => {});
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw e;
  }
  return abs;
}

export async function atomicWrite(abs, content, { verify } = {}) {
  if (verify) verify(content);
  const key = path.resolve(abs);
  const previous = writeQueues.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => atomicWriteNow(key, content));
  writeQueues.set(key, next);
  try { return await next; }
  finally { if (writeQueues.get(key) === next) writeQueues.delete(key); }
}

/**
 * 快照保留天数。默认 30，`.env` 里 `SNAPSHOT_KEEP_DAYS` 可改。
 *
 * 读的是 `process.env` 而不是路由拿到的那份 `env`：快照发生在 `posts.mjs` 这类
 * 库函数里，它们**没有**也不该有 env 参数（为了一个保留天数给整条调用链加一个参数，
 * 那才是本末倒置）。`vite.config.mjs` 会把这一个变量搬进 `process.env`——
 * 只搬这一个，密钥一律不搬。
 */
export function snapshotKeepDays() {
  return snapshotKeepDaysOf(process.env.SNAPSHOT_KEEP_DAYS);
}

/**
 * 同一条规则，但能对**任意**值算一遍——设置面板要显示「你填的这个数实际会生效成几天」。
 * 抽出来是为了让判据只有一处：面板上算一套、真正清理时算另一套的话，
 * 面板会告诉你「保留 5000 天」而实际是 3650，而没有任何地方会说出这个差别。
 */
export function snapshotKeepDaysOf(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 3650) : 30;
}

/**
 * 快照目录：`data/.snapshots/<key>/<时间戳>.<后缀>`。
 *
 * 放 `data/` 下面而不是文件旁边，是为了让「数据」和「数据的历史」在同一处、一起被
 * `.gitignore` 挡在版本库外，也方便一次性打包导出。点开头的目录 Obsidian 和
 * 各种扫描器都会跳过。
 */
export function snapshotDir(root, key) {
  return path.resolve(root, "data", ".snapshots", key);
}

/**
 * 快照文件名 = 本地时间戳，**带毫秒**。
 *
 * 秒级精度是不够的：恢复的流程本身就是「先给当前存一份、再覆盖」，两步在同一秒内完成，
 * 秒级名字会让第二份把第一份直接覆盖掉——现象是「明明说恢复前留了快照，列表里却没有」。
 * 毫秒还留在文件名里的另一个好处是排序仍然是纯字典序，不用解析日期。
 */
const stamp = (d = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 23).replace(/[:T.]/g, "-");

/**
 * 改之前先留一份。文件不存在（第一次写）就什么都不做——那种情况没有「上一版」。
 * 返回快照的绝对路径，失败时返回空串：**快照失败不能挡住正常写入**，
 * 否则一个磁盘满的小毛病会让整个工作台不能保存。
 */
export async function snapshotFile(root, key, abs, ext = path.extname(abs) || ".bak") {
  try {
    const buf = await fs.readFile(abs);
    const dir = snapshotDir(root, key);
    await fs.mkdir(dir, { recursive: true });
    const target = path.join(dir, `${stamp()}${ext}`);
    await atomicWrite(target, buf);
    return target;
  } catch (e) {
    if (e.code !== "ENOENT") console.warn(`[snapshot] ${key} 快照失败（不影响本次保存）：${e.message}`);
    return "";
  }
}

/**
 * 列出某个数据文件的快照，新的在前。
 */
export async function listSnapshots(root, key) {
  const dir = snapshotDir(root, key);
  let names;
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (name.startsWith(".") || name.includes(".tmp-")) continue;
    try {
      const s = await fs.stat(path.join(dir, name));
      if (s.isFile()) out.push({ name, at: s.mtime.toISOString(), bytes: s.size, abs: path.join(dir, name) });
    } catch {
      /* 正在被清理，跳过 */
    }
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : -1));
}

/**
 * 清理旧快照。
 *
 * 规则是「保留 keepDays 天内的**全部**，外加**永远保留最近 minKeep 份**」。
 *
 * 后半条不是保险丝，是主逻辑：只按天数清的话，两个月不打开工作台、回来导一次数据，
 * 那一刻所有快照都已经过期了——**恰好在最需要能回退的时候，一份都不剩**。
 * 而按天数清的收益（省几十 KB）根本不值得为它承担这个。
 */
export async function pruneSnapshots(root, key, { keepDays = 30, minKeep = 5 } = {}) {
  const items = await listSnapshots(root, key);
  const cutoff = Date.now() - keepDays * 86400_000;
  let removed = 0;
  for (const [i, it] of items.entries()) {
    if (i < minKeep) continue;
    if (new Date(it.at).getTime() >= cutoff) continue;
    await fs.rm(it.abs, { force: true }).catch(() => {});
    removed++;
  }
  return removed;
}
