// AI Discovery 的本地 API。
//
// ⚠️ **扫描一律不写业务数据。** 唯一允许留下的痕迹是：这次读过哪几段原话
// （`analyzed_at`）和这次的扫描结果缓存。前者是上下文预算需要的，后者是为了
// 不让每次打开页面都重跑一遍模型。用户问题、内容机会和项目一条都不许多出来。

import { fail, json, readJsonBody } from "../lib/http.mjs";
import {
  buildDiscoveryContext,
  discoveryCacheState,
  discoveryReadiness,
  readDiscoveryCache,
  writeDiscoveryCache,
} from "../domain/content-discovery.mjs";
import { discoverConnections } from "../domain/content-discovery-ai.mjs";

const clean = (value, max = 500) => String(value ?? "").trim().slice(0, max);

async function ready(source) {
  const workspace = await source;
  if (!workspace?.db?.open) throw Object.assign(new Error("本地工作区尚未就绪"), { status: 503 });
  return workspace;
}

function guard(handler) {
  return async (context) => {
    try { await handler({ ...context, workspace: await ready(context.workspace) }); }
    catch (error) {
      fail(context.res, error.message || "内容发现失败", {
        status: error.status || (/不存在/.test(error.message || "") ? 404 : 400),
        hint: error.hint,
      });
    }
  };
}

/** 业务表的行数快照。扫描前后必须一模一样。 */
function businessCounts(workspace) {
  const count = (table) => workspace.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  return {
    problems: count("audience_problems"),
    problemSources: count("audience_problem_sources"),
    opportunities: count("content_opportunities"),
    projects: count("projects"),
    rawSources: count("audience_raw_sources"),
  };
}

export const contentDiscoveryRoutes = [
  {
    method: "GET",
    path: "/api/workspace/content-discovery",
    handler: guard(async ({ workspace, res, url }) => {
      const agendaId = clean(url.searchParams.get("agendaId"), 120);
      const focus = clean(url.searchParams.get("focus"));
      const state = discoveryCacheState(workspace, { agendaId, focus });
      json(res, {
        ok: true,
        scan: state.cached,
        stale: state.stale,
        staleReason: state.reason,
        voices: workspace.audienceRaw.stats(),
        agendas: workspace.contentBridge.agendas(),
      });
    }),
  },
  {
    method: "POST",
    path: "/api/workspace/content-discovery/scan",
    handler: guard(async ({ env, workspace, req, res }) => {
      const body = await readJsonBody(req);
      const agendaId = clean(body.agendaId, 120);
      const focus = clean(body.focus);
      const state = discoveryCacheState(workspace, { agendaId, focus });
      /**
       * 数据没变就直接复用。⚠️ 这不只是省钱：**同样的输入给出不一样的三条连接**，
       * 会让人以为自己错过了什么，然后一遍遍点重新扫描。
       */
      if (!body.force && state.cached && !state.stale) {
        return json(res, { ok: true, reused: true, scan: state.cached, stale: false, staleReason: "" });
      }

      const context = buildDiscoveryContext(workspace, { agendaId, focus });
      const readiness = discoveryReadiness(context);
      const scannedAt = new Date().toISOString();
      if (!readiness.ready) {
        // 连一头都没有的时候不跑模型：那一定是空的，白花一次调用还要等十几秒。
        const scan = {
          scannedAt,
          agendaId,
          focus,
          connections: [],
          nothingFoundReason: readiness.reason,
          missing: readiness.missing,
          model: "",
          read: { ...context.read, voiceTotalAtScan: workspace.audienceRaw.stats().total },
          fingerprint: context.fingerprint,
        };
        writeDiscoveryCache(workspace, scan);
        return json(res, { ok: true, reused: false, scan, stale: false, staleReason: "" });
      }

      const before = businessCounts(workspace);
      const result = await discoverConnections(env, workspace, context, { limit: body.limit });
      const after = businessCounts(workspace);
      for (const key of Object.keys(before)) {
        if (before[key] !== after[key]) throw new Error("内容发现扫描产生了不应有的写入");
      }

      const scan = {
        scannedAt,
        agendaId,
        focus,
        connections: result.connections,
        nothingFoundReason: result.nothingFoundReason,
        missing: [],
        model: result.model,
        read: { ...context.read, voiceTotalAtScan: workspace.audienceRaw.stats().total },
        fingerprint: context.fingerprint,
      };
      /**
       * 读过的原话记上一笔。⚠️ 这是本次扫描唯一的写入，而且它只碰 `analyzed_at`——
       * 触发器保证正文一个字都动不了。不记的话，每次重新扫描都要把全部历史群聊
       * 重新发一遍给模型。
       */
      workspace.audienceRaw.markAnalyzed(context.voices.map((voice) => voice.id));
      writeDiscoveryCache(workspace, scan);
      json(res, { ok: true, reused: false, scan, stale: false, staleReason: "" });
    }),
  },
  {
    method: "POST",
    path: "/api/workspace/content-discovery/forget",
    handler: guard(async ({ workspace, res }) => {
      // 只清缓存，不动任何证据或业务数据。
      writeDiscoveryCache(workspace, null);
      json(res, { ok: true, scan: readDiscoveryCache(workspace) });
    }),
  },
];
