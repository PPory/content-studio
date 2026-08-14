// /api/metrics → 各平台数据的手动周录。
//
// 为什么是手动录入而不是自动采集：X 的 API 要 $200/月，公众号数据 API 只对认证服务号开放，
// 个人号一律拿不到。第一版先用最低成本的方式验证「你真的会每周看」——会看，再谈半自动。
//
// 存成 CSV 而不是 JSON：这份数据你可能想直接拖进 Excel 看，CSV 是零门槛的那个格式。
// 落在项目的 data/ 而不是 vault——它是工作台的运行数据，不是知识库内容（见 design.md 4.4）。

import path from "node:path";
import fs from "node:fs/promises";
import { json, fail, readJsonBody } from "../lib/http.mjs";
import { pruneSnapshots, snapshotFile, snapshotKeepDays } from "../lib/safe-write.mjs";

const FILE = path.resolve(process.cwd(), "data", "metrics.csv");
const HEADER = "date,platform,followers,views,note";
export const PLATFORMS = ["公众号", "X", "小红书", "抖音", "视频号", "YouTube"];

function csvEscape(s) {
  const v = String(s ?? "");
  return /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

// 只处理我们自己写出去的格式：逗号分隔、引号包裹、"" 转义
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

async function readRows() {
  let text;
  try {
    text = await fs.readFile(FILE, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  return text
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => l.trim())
    .map((l) => {
      const [date, platform, followers, views, note] = parseCsvLine(l);
      return {
        date,
        platform,
        followers: followers === "" ? null : Number(followers),
        views: views === "" ? null : Number(views),
        note: note || "",
      };
    })
    .filter((r) => r.date && r.platform)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export const metricsRoutes = [
  {
    method: "GET",
    path: "/api/metrics",
    async handler({ res }) {
      try {
        json(res, { ok: true, platforms: PLATFORMS, rows: await readRows() });
      } catch (e) {
        fail(res, e.message);
      }
    },
  },
  {
    method: "POST",
    path: "/api/metrics",
    async handler({ req, res }) {
      try {
        const b = await readJsonBody(req);
        const date = String(b.date || "").trim();
        const platform = String(b.platform || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(res, "日期格式要是 YYYY-MM-DD", { status: 400 });
        if (!platform) return fail(res, "平台不能为空", { status: 400 });
        if (b.followers == null && b.views == null) {
          return fail(res, "粉丝数和阅读/播放量至少填一个", { status: 400 });
        }

        // 追加之前留一版。这里**故意保留 appendFile 而不是改成整份重写**：
        // 追加天生比重写安全（原有内容一个字节都不动），最坏的情况是文件尾部多半行，
        // 而解析器本来就会把不完整的行滤掉。快照是给「录错了一行想退回去」用的。
        await snapshotFile(process.cwd(), "metrics", FILE);
        await fs.mkdir(path.dirname(FILE), { recursive: true });
        let head = "";
        try {
          await fs.access(FILE);
        } catch {
          head = HEADER + "\n"; // 文件第一次创建时补表头
        }
        const line = [date, platform, b.followers ?? "", b.views ?? "", b.note ?? ""].map(csvEscape).join(",");
        await fs.appendFile(FILE, head + line + "\n", "utf8");
        await pruneSnapshots(process.cwd(), "metrics", { keepDays: snapshotKeepDays() }).catch(() => 0);

        // 必须和 GET 返回同一个形状（带上 platforms）：前端拿它刷新整块状态，
        // 少一个键就等于把 platforms 抹成 undefined，下一次渲染直接白屏。
        json(res, { ok: true, platforms: PLATFORMS, rows: await readRows() });
      } catch (e) {
        fail(res, e.message);
      }
    },
  },
];
