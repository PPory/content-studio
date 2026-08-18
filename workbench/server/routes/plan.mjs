// /api/plan → vault 里的每日任务清单（`99 - 个人工作台/05 - 计划/YYYY-MM-DD.md`）。
//
// 规则全在 `lib/plan.mjs`，这里只做参数校验和错误翻译。**请求体里没有路径**，
// 只有一个 `YYYY-MM-DD` 的日期串——路径当参数等于开了个任意文件写入的口子。

import { json, fail, readJsonBody } from "../lib/http.mjs";
import { vaultRoot } from "../lib/vault.mjs";
import { localDate, offsetDate, readPlan, writePlan, applyAdd, applyToggle, applyRemove } from "../lib/plan.mjs";

// 写操作各自是什么意思。做成一张表而不是 if/else 链：加一种动作只加一行，
// 而且**表以外的字符串一律拒**——请求体里的动作名不能直接拿去调函数。
const ACTIONS = {
  add: ({ text }) => (body) => applyAdd(body, text),
  toggle: ({ index, done }) => (body) => applyToggle(body, index, done),
  remove: ({ index }) => (body) => applyRemove(body, index),
};

export const planRoutes = [
  {
    method: "GET",
    path: "/api/plan",
    async handler({ env, res, url }) {
      try {
        const date = url.searchParams.get("date") || localDate();
        const plan = await readPlan(vaultRoot(env), date);
        // 「今天 / 明天」两档由服务端算：客户端的时区和本机可能不一样，
        // 而文件名是按**本机日期**建的，两边各算各的会让晚上写的清单落到不同的文件里。
        json(res, { ok: true, today: localDate(), tomorrow: offsetDate(1), ...plan });
      } catch (e) {
        fail(res, e.message, { status: e.status || 500, hint: e.hint });
      }
    },
  },
  {
    method: "POST",
    path: "/api/plan",
    async handler({ env, req, res }) {
      try {
        const body = await readJsonBody(req);
        const { date, action, stamp = "" } = body || {};
        const make = ACTIONS[action];
        if (!make) return fail(res, `认不出的动作：${action}`, { status: 400 });
        if ((action === "toggle" || action === "remove") && !Number.isInteger(body.index)) {
          return fail(res, "缺少任务序号", { status: 400 });
        }
        // 「追加一条」不需要乐观锁，见 `lib/plan.mjs` 的 writePlan
        const lock = action === "add" ? null : stamp;
        const plan = await writePlan(vaultRoot(env), date || localDate(), lock, make(body));
        json(res, { ok: true, today: localDate(), tomorrow: offsetDate(1), ...plan });
      } catch (e) {
        fail(res, e.message, { status: e.status || 500, hint: e.hint });
      }
    },
  },
];
