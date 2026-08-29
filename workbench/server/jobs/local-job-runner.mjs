export class LocalJobRunner {
  constructor(jobStore, { handlers = {} } = {}) {
    this.jobStore = jobStore;
    this.handlers = new Map(Object.entries(handlers));
  }

  async runNext({ leaseOwner, handlers = null, leaseSeconds = 90, now } = {}) {
    const currentNow = () => typeof now === "function" ? now() : now;
    const job = this.jobStore.claim({ leaseOwner, leaseSeconds, now: currentNow() });
    if (!job) return null;
    const available = handlers ? new Map(Object.entries(handlers)) : this.handlers;
    const handler = available.get(job.kind);
    if (typeof handler !== "function") {
      return this.jobStore.fail(job.id, {
        leaseOwner,
        leaseToken: job.leaseToken,
        error: `没有允许执行的本地任务处理器：${job.kind}`,
        retryDelaySeconds: 0,
        now: currentNow(),
        retry: false,
      });
    }
    let heartbeatError = null;
    const heartbeat = () => this.jobStore.heartbeat(job.id, { leaseOwner, leaseToken: job.leaseToken, leaseSeconds, now: currentNow() });
    const timer = setInterval(() => {
      try { heartbeat(); } catch (error) { heartbeatError = error; }
    }, Math.max(10_000, Math.floor(leaseSeconds * 1000 / 3)));
    timer.unref?.();
    try {
      const result = await handler(job.payload, job, { heartbeat });
      if (heartbeatError) throw heartbeatError;
      return this.jobStore.complete(job.id, { leaseOwner, leaseToken: job.leaseToken, result, now: currentNow() });
    } catch (error) {
      return this.jobStore.fail(job.id, {
        leaseOwner,
        leaseToken: job.leaseToken,
        error: error instanceof Error ? error.message : String(error),
        now: currentNow(),
      });
    } finally {
      clearInterval(timer);
    }
  }
}
