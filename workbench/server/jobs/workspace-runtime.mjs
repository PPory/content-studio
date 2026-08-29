import { LocalJobRunner } from "./local-job-runner.mjs";
import { DEFAULT_LOCAL_SCHEDULES, enqueueStartupCatchup, registerDefaultSchedules } from "./startup-scheduler.mjs";

export class WorkspaceJobRuntime {
  constructor(workspace, {
    handlers = {},
    schedules = DEFAULT_LOCAL_SCHEDULES,
    leaseOwner = `workspace-${process.pid}`,
    pollIntervalMs = 30_000,
    now,
  } = {}) {
    const allowed = new Set(Object.keys(handlers));
    const unsupported = schedules.filter((schedule) => !allowed.has(schedule.kind));
    if (unsupported.length) throw new Error(`本地计划缺少允许执行的处理器：${unsupported.map((item) => item.kind).join("、")}`);
    this.workspace = workspace;
    this.schedules = schedules;
    this.leaseOwner = leaseOwner;
    this.pollIntervalMs = Math.max(1_000, Number(pollIntervalMs) || 30_000);
    this.now = typeof now === "function" ? now : () => now ? new Date(now) : new Date();
    this.runner = new LocalJobRunner(workspace.jobs, { handlers });
    this.timer = null;
    this.currentTick = null;
    this.lastError = null;
    this.lastResult = null;
  }

  async tick() {
    if (this.currentTick) return this.currentTick;
    this.currentTick = (async () => {
      const current = this.now();
      const startupJobs = enqueueStartupCatchup(this.workspace.db, this.workspace.jobs, { now: current });
      const results = [];
      while (true) {
        const result = await this.runner.runNext({ leaseOwner: this.leaseOwner, now: () => this.now() });
        if (!result) break;
        results.push(result);
      }
      this.lastResult = { startupJobs, results };
      this.lastError = null;
      return this.lastResult;
    })().catch((error) => {
      this.lastError = error;
      throw error;
    }).finally(() => {
      this.currentTick = null;
    });
    return this.currentTick;
  }

  start() {
    if (this.timer) return this;
    registerDefaultSchedules(this.workspace.db, { schedules: this.schedules, now: this.now() });
    this.ready = this.tick();
    this.ready.catch(() => {});
    this.timer = setInterval(() => { this.tick().catch(() => {}); }, this.pollIntervalMs);
    this.timer.unref?.();
    return this;
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.currentTick) await this.currentTick.catch(() => {});
  }
}

export function startWorkspaceRuntime(workspace, options = {}) {
  return new WorkspaceJobRuntime(workspace, options).start();
}