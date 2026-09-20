import { finishAcquisitionBatches } from './acquisition/batches.mjs';
import { scheduleAcquisition } from './acquisition/runner.mjs';
import { scheduleIntelligence } from "./domain/intelligence.mjs";
// 把本地 API 挂进 Vite dev server 的中间件链，而不是另起一个进程 + 配代理。
// 一个进程、一条 npm run dev、没有端口对不上的问题，也不需要 concurrently 这类依赖。
//
// 代价是 API 只在 dev 模式下存在。这是有意的：工作台是本地工具，永远跑 dev，
// `npm run build` 只用来验证前端能编译过。

import { createApi } from "./api.mjs";
import { applyPendingWorkspaceRestore, ensureAutomaticWorkspaceBackup } from "./backup/workspace-backup.mjs";
import {
  createDefaultJobHandlers,
  reconcileWikiIngestCandidates,
  recoverQueuedWikiIngests,
} from "./jobs/default-job-handlers.mjs";
import { startWorkspaceRuntime } from "./jobs/workspace-runtime.mjs";
import { installAutoExit } from "./lib/auto-exit.mjs";
import { serveTypeset } from "./routes/tools.mjs";
import { openWorkspace } from "./storage/workspace.mjs";
import { runtimeXenhoHome } from "./storage/workspace-paths.mjs";

export async function startLocalWorkspaceRuntime(env = {}, jobDependencies = {}) {
  const xenhoHome = runtimeXenhoHome(env);
  const pendingRestore = await applyPendingWorkspaceRestore({ xenhoHome });
  const workspace = await openWorkspace({ xenhoHome });
  try {
    const recoveredWikiJobs = recoverQueuedWikiIngests(workspace);
    const reconciledWikiCandidates = reconcileWikiIngestCandidates(workspace);
    let acquisitionStartup = true;
    const runtime = startWorkspaceRuntime(workspace, {
      handlers: createDefaultJobHandlers(workspace, env, jobDependencies),
      maintenance: (now) => ({
        acquisitionBatches: workspace.db.pragma('user_version',{simple:true})>=30 ? finishAcquisitionBatches(workspace) : null,
        acquisition: env.ACQUISITION_AUTOSTART === "true" ? scheduleAcquisition(workspace, { now, env, startup: acquisitionStartup && !(acquisitionStartup=false) }) : [],
        intelligence: scheduleIntelligence(workspace, { now }),
        recoveredWikiJobs: recoverQueuedWikiIngests(workspace, { now }),
        reconciledWikiCandidates: reconcileWikiIngestCandidates(workspace, { now }),
      }),
    });
    const automaticBackup = ensureAutomaticWorkspaceBackup(workspace).catch((error) => {
      console.warn(`[backup] 自动备份失败：${error instanceof Error ? error.message : String(error)}`);
      return { created: false, error: error instanceof Error ? error.message : String(error) };
    });
    return { workspace, runtime, automaticBackup, pendingRestore, recoveredWikiJobs, reconciledWikiCandidates };
  } catch (error) {
    workspace.close();
    throw error;
  }
}

export function workbenchApi(env, { jobDependencies = {} } = {}) {
  return {
    name: "creator-workbench-api",
    configureServer(server) {
      // 启动失败的原因要留住。只写日志的话，界面上只剩一句「尚未就绪」，
      // 而 tmp/dev-server.err.log 没有任何入口提到过——用户看到的是一个查不出原因的死局。
      let startupError = "";
      const localRuntime = startLocalWorkspaceRuntime(env, jobDependencies).catch((error) => {
        startupError = error instanceof Error ? error.message : String(error);
        server.config.logger.error(`本地工作区启动失败：${startupError}`);
        return null;
      });
      server.xenhoWorkspace = localRuntime.then((state) => state?.workspace || null);
      let closePromise = null;
      const closeLocalRuntime = () => closePromise ||= localRuntime.then(async (state) => {
        if (!state) return;
        await state.runtime.stop();
        await state.automaticBackup;
        state.workspace.close();
      });
      // 浏览器和扩展验收在删除临时工作区前等待 SQLite/WAL 句柄真正释放。
      server.xenhoClose = closeLocalRuntime;
      server.httpServer?.once("close", () => {
        void closeLocalRuntime();
      });

      // 放在最前面：/api/* 和 /tools/* 由我们接管，其余交回 Vite
      server.middlewares.use(createApi(env, { workspace: server.xenhoWorkspace, startupError: () => startupError }));
      // 公众号排版工具静态托管。放在 Vite 之前，否则会被它的 SPA 回退吃掉
      server.middlewares.use(serveTypeset(env));
      // 当桌面应用用的那次：关掉窗口就把这个进程也收掉（终端 npm run dev 不受影响）
      installAutoExit(server);
    },
  };
}
