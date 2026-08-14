// Bright Data Web Scraper API 客户端，reddit 和 x 两个源共用。
//
// 三步走：trigger 拿 snapshot_id → 轮询 progress 到 ready → 下载 snapshot。
// 端点来自官方文档，不是猜的（docs.brightdata.com/api-reference/rest-api/scraper）。
//
// ⚠️ 这份文档踩过三次坑，都记在这儿免得下次再踩：
//   1. Reddit 的 sort_by 文档写 `new/top/hot` 小写，实际只认首字母大写，
//      报错还只说「This value is not allowed」不列合法值。
//   2. progress 的 status 实际会回 `running`，不在文档列的
//      collecting/digesting/ready/failed 里。所以只认 ready 和 failed，其余一律继续等。
//   3. 入参 schema 比文档写的多字段（Reddit 还有 sort_by_time / start_date）。
//      好消息是 400 的报错里会把它**补全后的完整 payload** 回显出来，照着看就行。

import { proxyFetch } from "../../../server/lib/fetch.mjs";

const API = "https://api.brightdata.com/datasets/v3";

export class BrightDataError extends Error {
  constructor(message, hint) {
    super(message);
    this.hint = hint;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 触发一次采集，返回 snapshot_id。
 *
 * **不能只看 HTTP 200**：这套 API 失败时也可能回 200 带一个没有 snapshot_id 的 body。
 * 拿到 snapshot_id 才算成功。
 */
export async function trigger(key, datasetId, rows, { discoverBy, limitPerInput } = {}) {
  const q = new URLSearchParams({ dataset_id: datasetId, format: "json", include_errors: "true" });
  if (discoverBy) {
    q.set("type", "discover_new");
    q.set("discover_by", discoverBy);
  }
  if (limitPerInput) q.set("limit_per_input", String(limitPerInput));

  const r = await proxyFetch(`${API}/trigger?${q}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(rows),
  });
  const text = await r.text();
  if (!r.ok) {
    throw new BrightDataError(
      `触发采集失败（HTTP ${r.status}）：${text.slice(0, 300)}`,
      r.status === 401
        ? "key 不对或没权限，去控制台 Settings → API keys 重新生成"
        : "报错里的 line 字段会回显补全后的完整 payload，对着它改入参"
    );
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BrightDataError(`触发返回的不是 JSON：${text.slice(0, 200)}`);
  }
  if (!data.snapshot_id) {
    throw new BrightDataError(`触发没拿到 snapshot_id：${text.slice(0, 300)}`, "多半是 dataset_id 或 discover_by 不对");
  }
  return data.snapshot_id;
}

/**
 * 轮询到 ready。
 *
 * **网络抖动不算失败，要重试。** 踩过一次：轮询时一个没有任何细节的 `fetch failed`
 * 就让整个源挂掉，而服务端那个 job 还在正常跑——credits 已经花了，结果却没人去取。
 * 采集本来就要跑几分钟，这期间掉一两个包是常态，不是错误。
 *
 * 连续失败才放弃，中间成功一次就清零。
 */
export async function waitReady(key, id, label, log) {
  const deadline = Date.now() + 15 * 60 * 1000;
  const resume = `已经花掉的 credits 没浪费——用 --only <源> --snapshot ${id} 直接取回结果，不用重抓`;
  let last = "";
  let misses = 0;

  while (Date.now() < deadline) {
    let s;
    try {
      const r = await proxyFetch(`${API}/progress/${id}`, { headers: { Authorization: `Bearer ${key}` } });
      const d = await r.json().catch(() => ({}));
      s = d.status || "";
      misses = 0;
    } catch (e) {
      if (++misses >= 5) throw new BrightDataError(`${label} 连续 5 次查询进度都失败（${e.message}）`, resume);
      log(`    ${label}: 查询进度失败，10 秒后重试（${misses}/5）`);
      await sleep(10_000);
      continue;
    }

    if (s !== last) {
      log(`    ${label}: ${s}`);
      last = s;
    }
    if (s === "ready") return;
    if (s === "failed") throw new BrightDataError(`${label} 采集失败`, `去控制台看 snapshot ${id} 的报错`);
    await sleep(10_000);
  }
  // 超时不代表数据没了——snapshot 还在服务端跑着
  throw new BrightDataError(`${label} 等了 15 分钟还没好`, resume);
}

export async function download(key, id) {
  const r = await proxyFetch(`${API}/snapshot/${id}?format=json`, { headers: { Authorization: `Bearer ${key}` } });
  const text = await r.text();
  if (!r.ok) throw new BrightDataError(`下载 snapshot 失败（HTTP ${r.status}）：${text.slice(0, 300)}`);
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new BrightDataError(`snapshot 不是 JSON：${text.slice(0, 200)}`);
  }
  return Array.isArray(data) ? data : [];
}

/**
 * trigger + wait + download 一条龙。
 *
 * **拿到 snapshot_id 立刻打印**，别等到出错才说。id 一旦丢了，那次采集的 credits
 * 就成了付了钱又取不回的东西——而轮询失败、进程被 Ctrl-C、机器休眠都会丢。
 * 印在屏幕上的一行字，是这笔钱唯一的收据。
 */
export async function collect(key, datasetId, rows, opts, label, log) {
  const id = await trigger(key, datasetId, rows, opts);
  log(`    ${label}: snapshot ${id}`);
  await waitReady(key, id, label, log);
  return download(key, id);
}
