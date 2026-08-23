// /api/insights/* → 洞察跑批。读的那一侧仍在 `/api/vault/insights`（列报告）。
//
// 这里只干三件事：**说清现在能不能跑**、起一次后台跑批、报进度。
// 真正的编排在 `lib/insight-run.mjs`。

import path from "node:path";
import fs from "node:fs/promises";
import { json, readJsonBody } from "../lib/http.mjs";
import { vaultRoot, safeJoin } from "../lib/vault.mjs";
import { DIRS } from "../lib/vault-dirs.mjs";
import { startRun, getRun, cancelRun, WORKBENCH_ROOT } from "../lib/insight-run.mjs";
import { insightWeeks, readRegistry } from "../lib/insight-candidates.mjs";
import { insightCards } from "../lib/insight-cards.mjs";

const SOURCES = ["reddit", "x", "aihot"];

/** ISO 周。和 `scripts/probe/ir.mjs` 里那份算法一致——两处都改的时候别只改一处。 */
function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 86400000 + 1) / 7)).padStart(2, "0")}`;
}

const size = async (p) => {
  try {
    return (await fs.stat(p)).size;
  } catch {
    return 0;
  }
};

/**
 * 这一周现在是什么状态。
 *
 * **这才是按钮真正解决的问题。** 跑洞察最大的摩擦不是敲那条命令，
 * 是「我不知道现在能不能跑、缺什么、上次挂了什么账」——每次都要翻好几个目录才能确认。
 */
async function readiness(env, week) {
  const root = vaultRoot(env);
  const matDir = safeJoin(root, `${DIRS.insight}/_material`);
  const materials = [];
  for (const s of SOURCES) {
    const p = path.join(matDir, `${week}-${s}.md`);
    materials.push({ source: s, bytes: await size(p) });
  }
  const missing = materials.filter((m) => !m.bytes).map((m) => m.source);

  const reportRel = `${DIRS.insight}/${week}-社媒洞察.md`;
  const reportPath = safeJoin(root, reportRel);
  const reportBytes = await size(reportPath);

  // 还没结的挂账。契约见 skill 的 references/run-artifacts.md §3.1。
  //
  // **扫所有周次，不是只看上一周。** 一条 open 的挂账不管哪周开的都还没结——
  // 只看上一周的话，隔一周没跑就把它漏了，而这类东西本来就是「一直没顾上做」才挂着的。
  // 路径从 WORKBENCH_ROOT 起算，不用 process.cwd()：dev server 的 cwd 取决于
  // 你在哪儿敲的 npm run dev，拿它拼路径是个安静出错的写法。
  /**
   * ⚠️ **扫周目录 + 读 registry 走 `lib/insight-candidates.mjs` 那一份。**
   * 这儿原来自己写了一遍，而「找题」那一屏也要读同一批文件——
   * 各写一份的话，改了工件布局会漏掉其中一处，而漏掉的那处**不报错**：
   * 读不到就当成「这一周没有」，界面显示的是空态引导，看着像「你还没跑过」。
   */
  const pending = [];
  for (const w of await insightWeeks()) {
    const reg = await readRegistry(w);
    for (const p of reg?.pending_actions || []) {
      if (p.status === "open") pending.push({ ...p, from_week: p.created_week || w });
    }
  }

  return {
    week,
    materials,
    missing,
    // 缺材料才需要付费抓取——**材料齐的那一周点按钮不花一分钱**，所以那种情况不该弹确认。
    willFetch: missing.length > 0,
    reportExists: reportBytes > 0,
    reportPath,
    reportRel,
    pending,
  };
}

export const insightsRoutes = [
  {
    /**
     * 「找题」那一屏第一段的数据。**跑批产出的候选原来进不了任何地方**——
     * 每周花着 credits 产出十来条带优先级和证据就绪度的候选，然后没有界面读它。
     */
    method: "GET",
    path: "/api/insights/candidates",
    async handler({ env, req, res }) {
      // `?refresh=1` 强制重出一次卡（改了提示词之后要用）
      const refresh = new URL(req.url, "http://127.0.0.1").searchParams.get("refresh") === "1";
      return json(res, { ok: true, ...(await insightCards(env, { refresh })) });
    },
  },

  {
    method: "GET",
    path: "/api/insights/ready",
    async handler({ env, req, res }) {
      const url = new URL(req.url, "http://127.0.0.1");
      const week = url.searchParams.get("week") || isoWeek();
      try {
        return json(res, { ok: true, ...(await readiness(env, week)) });
      } catch (e) {
        return json(res, { ok: false, error: e.message, hint: e.hint }, 503);
      }
    },
  },

  {
    method: "GET",
    path: "/api/insights/run",
    async handler({ res }) {
      return json(res, { ok: true, run: getRun() });
    },
  },

  {
    method: "POST",
    path: "/api/insights/run",
    async handler({ env, req, res }) {
      let body = {};
      try {
        body = await readJsonBody(req);
      } catch {
        /* 空 body 合法：默认跑当前周 */
      }
      const week = String(body.week || "").trim() || isoWeek();

      let ready;
      try {
        ready = await readiness(env, week);
      } catch (e) {
        return json(res, { ok: false, error: e.message, hint: e.hint }, 503);
      }

      try {
        const run = startRun({
          week,
          // 由服务端按材料实际情况决定，**不听前端的**：
          // 前端传一个 allowFetch=true 就能让它花掉 270 credits，那种事不该由参数决定。
          allowFetch: ready.willFetch,
          reportPath: ready.reportPath,
        });
        return json(res, { ok: true, run });
      } catch (e) {
        if (e.code === "BUSY") return json(res, { ok: false, error: e.message, run: getRun() }, 409);
        return json(res, { ok: false, error: e.message }, 500);
      }
    },
  },

  {
    method: "POST",
    path: "/api/insights/run/cancel",
    async handler({ res }) {
      const run = cancelRun();
      return json(res, { ok: true, run });
    },
  },
];
