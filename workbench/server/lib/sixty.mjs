// 60s API 客户端（自建实例）。接入规范见 docs/60s-api.md，**改这里之前先读那份文档**。
//
// 这里只用「热门榜单」那一组，六个大众榜。它们**故意不过滤**：
// 平台热榜回答的是「现在大众在关心什么」，用你的关注词去筛它等于把它筛没了
// （实测拿关键词过滤这六个榜，50 条里剩不到 1 条）。要筛的是 AI 情报那一侧。
//
// 每个榜独立抓、独立失败：这是免费聚合接口，B 站和小红书在 2026-08-10 就是长期 500
// （上游拿到的是 HTML 说明被风控）。挂掉的如实标出来，别悄悄少一列。

import { proxyFetch } from "./fetch.mjs";

// 占位地址。60s API（github.com/vikiboss/60s）需要自己部署一个实例，
// 把地址填进 .env 的 SIXTY_SECONDS_API_BASE_URL。没配的话这里会请求失败——
// 这是有意的：与其偷偷少一列数据，不如让它明确地挂掉并在界面标出来。
const DEFAULT_BASE = "https://your-60s-instance.example.com";
const TIMEOUT_MS = 10_000;

// id 就是路由后缀。加榜单只往这里加一行，别的地方不用动。
//
// **这个数组的顺序就是界面上的顺序**（`fetchBoards` 原样 map，前端不再排一次）。
// 排在前面的是内容离自己近、看得最勤的那几个。
//
// ⚠️ **`sixtyPing` 拿 `BOARDS[0]` 当「地址通不通」的探针**，所以第一项要挑一个
// 长期稳定的榜——把一个正在被风控的榜换到第一位，探针会一直说地址不通。
export const BOARDS = [
  { id: "weibo", path: "/v2/weibo", label: "微博热搜" },
  { id: "douyin", path: "/v2/douyin", label: "抖音热搜" },
  { id: "toutiao", path: "/v2/toutiao", label: "今日头条热搜" },
  { id: "zhihu", path: "/v2/zhihu", label: "知乎话题榜" },
  { id: "bili", path: "/v2/bili", label: "哔哩哔哩热搜" },
  { id: "rednote", path: "/v2/rednote", label: "小红书热点" },
];

export function sixtyBase(env) {
  return (env?.SIXTY_SECONDS_API_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
}

/**
 * 地址到底填没填。
 *
 * ⚠️ **「没配地址」和「上游挂了」必须分成两件事**，因为下一步完全不同：
 * 前者要去设置面板填一行，后者只能等。上一版两者长得一模一样——占位域名 DNS 解析失败，
 * 六个榜整整齐齐 `fetch failed`，界面照旧退回快照并说一句「今天都没抓到」，
 * 看起来就是「上游今天不行」。而真相是这台机器从来就没配过地址，
 * 那句话永远为真，热榜那一栏会一直显示一份越来越旧的快照——**只有看时间戳才发现**。
 */
export function sixtyConfigured(env) {
  const base = sixtyBase(env);
  return Boolean(base) && base !== DEFAULT_BASE;
}

// 热度是个裸数字（23214926），直接显示没人读得出来。折成「2321.5万」。
function formatHot(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return String(n);
}

const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();

// 上游的失败原因是给日志看的（「Unexpected token '<', "<!DOCTYPE "... is not valid JSON」），
// 直接铺到界面上会把整行状态芯片撑爆，而且用户也看不懂。**短句给界面，原文留 tooltip。**
function shortReason(msg) {
  const s = String(msg || "");
  if (/DOCTYPE|not valid JSON|返回不是 JSON/i.test(s)) return "上游返回了网页，多半被风控";
  // undici 把 DNS 失败、连接被拒、代理不通全压成一句光秃秃的 "fetch failed"。
  // 原样铺到界面上没有任何信息量，而它恰恰是「地址填错了」最常见的样子
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|socket hang up/i.test(s)) return "连不上（地址不对或网络不通）";
  if (/Cannot read propert|undefined|map/i.test(s)) return "上游解析失败";
  if (/超时|timeout|abort/i.test(s)) return "超时";
  if (/空列表/.test(s)) return "返回空列表";
  const http = s.match(/HTTP (\d{3})/);
  if (http) return `上游 ${http[1]}`;
  return s.slice(0, 18) || "暂时不可用";
}

/**
 * 抓一个榜。**不抛**：一个榜挂了不该让整页红掉。
 * @returns {{id, label, ok, error?, count, items}}
 */
async function fetchBoard(base, board, limit) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await proxyFetch(`${base}${board.path}`, {
      headers: { Accept: "application/json" },
      signal: ac.signal,
    });
    // 文档第 3.2 条：不能只看 HTTP 200，业务失败是写在 body 的 code 里的
    let body = null;
    try {
      body = await res.json();
    } catch {
      throw new Error(`返回不是 JSON（HTTP ${res.status}）`);
    }
    if (!res.ok || body?.code !== 200) {
      // message 里可能带上游的整段异常，截短再展示
      throw new Error(clean(body?.message).slice(0, 60) || `HTTP ${res.status}`);
    }

    const raw = Array.isArray(body.data) ? body.data : Array.isArray(body.data?.items) ? body.data.items : [];
    const items = raw
      .map((it, i) => ({
        rank: i + 1,
        title: clean(it.title),
        link: it.link || "",
        hot: formatHot(it.hot_value),
        // 知乎带一段问题详情，别的榜没有；有就用来做卡片摘要
        detail: clean(it.detail).slice(0, 160),
      }))
      .filter((it) => it.title)
      .slice(0, limit);

    if (!items.length) throw new Error("返回空列表");
    return { id: board.id, label: board.label, ok: true, count: items.length, items };
  } catch (e) {
    const error = e.name === "AbortError" ? "超时" : e.message;
    return { id: board.id, label: board.label, ok: false, error, reason: shortReason(error), count: 0, items: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** 六个榜一起抓，互不影响。 */
export async function fetchBoards(env, { limit = 10 } = {}) {
  const base = sixtyBase(env);
  // 没配地址就**不去打那个占位域名**：六次 DNS 失败要占满超时，而结果是已知的。
  // 如实回「没配」，界面据此给的是「去设置里填」，不是「上游挂了，过会儿再刷」
  if (!sixtyConfigured(env)) {
    return BOARDS.map((b) => ({
      id: b.id,
      label: b.label,
      ok: false,
      error: "没填 SIXTY_SECONDS_API_BASE_URL",
      reason: "没配数据源地址",
      count: 0,
      items: [],
    }));
  }
  return Promise.all(BOARDS.map((b) => fetchBoard(base, b, limit)));
}

/**
 * 自检用：只探一个榜，不探六个。
 * 设置面板那一枚点回答的是「这个实例还活不活着」，一条就够——
 * 某个榜被上游风控（B 站长期如此）不代表实例有问题，那种事热点页自己会逐榜标出来。
 */
export async function probeSixty(env) {
  return fetchBoard(sixtyBase(env), BOARDS[0], 1);
}
