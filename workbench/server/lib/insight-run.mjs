// 洞察跑批：后台 job runner。
//
// ## 为什么不复用 /api/agent/chat
//
// 那条通道是**只读的**（`--allowedTools Read Glob Grep`），而且 `--max-turns 12`。
// 跑一次洞察要写 vault、跑 python/node 脚本、几十轮工具调用。
// **放开那条通道等于对话框也拿到了写权限**——所以另起一条，各带各的白名单。
// 这条 runner 有 Write / Edit / Bash，聊天那条一个字都没动。
//
// ## 边界
//
// 它在你自己的机器上、由 127.0.0.1 上的工作台触发，能力等同于你在终端里敲那条命令。
// 工作台本来就只监听回环地址、有 Origin 校验——**这条 runner 不该被暴露到公网，
// 而工作台整体也从来不部署**。
//
// ## 进度不是编的
//
// skill 的工件契约（`references/run-artifacts.md`）规定了产物出现的**顺序**：
// manifest → evidence-ledger → candidate-registry → verification-queue →
// web/ → verification-ledger → 报告。盯着文件系统就能拿到真实进度，
// 不用挂一个匀速前进的假进度条——**假进度条在卡住的时候还在走，那比没有更糟**。

import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKBENCH_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** 一次跑批最多多久。洞察是几十分钟量级的活，但不能没有上限。 */
const HARD_TIMEOUT_MS = 90 * 60 * 1000;

/**
 * 轮数上限。聊天那条是 12，这里必须高得多：
 * 光工作流就 9 步，每步多次工具调用，再加联网核实的来回。
 * 给 200 是「够用且兜得住失控」的量级——真跑失控了 90 分钟的硬超时也会收掉。
 */
const MAX_TURNS = "200";

/**
 * 阶段表。`weight` 是耗时占比（拍的量级，不是测出来的，所以进度条只保证单调不保证线性）；
 * `probe` 回答「这一步做完了没」——**只看文件，不看 agent 说了什么**，
 * 因为 agent 说「我完成了 X」不等于 X 真的落盘了。
 */
const STAGES = [
  {
    key: "prepare",
    label: "分块与覆盖清单",
    weight: 10,
    probe: (c) => exists(path.join(c.workDir, "manifest.json")),
  },
  {
    key: "evidence",
    label: "逐块提取证据",
    weight: 28,
    probe: (c) => exists(path.join(c.workDir, "evidence-ledger.jsonl")),
  },
  {
    key: "candidates",
    label: "聚类与生成候选",
    weight: 12,
    probe: (c) => exists(path.join(c.workDir, "candidate-registry.json")),
  },
  {
    key: "queue",
    label: "建核实队列",
    weight: 6,
    probe: (c) => exists(path.join(c.workDir, "verification-queue.json")),
  },
  {
    key: "search",
    label: "联网找来源",
    weight: 12,
    probe: (c) => exists(path.join(c.workDir, "web", "search-results.json")),
  },
  {
    key: "verify",
    label: "抽正文并逐条核实",
    weight: 20,
    probe: (c) => exists(path.join(c.workDir, "verification-ledger.jsonl")),
  },
  {
    key: "report",
    label: "写报告",
    weight: 12,
    probe: (c) => c.reportPath && exists(c.reportPath),
  },
];

const exists = (p) => {
  try {
    return fs.statSync(p).size > 0;
  } catch {
    return false;
  }
};

/**
 * 当前这一次跑批。**同时只允许一个**——两个 agent 同时写同一周的工件，
 * 后写的会把先写的覆盖掉，而且谁也不报错。
 */
let current = null;

const stateFile = () => path.join(WORKBENCH_ROOT, "tmp", "insight-run.json");

/** 落一份状态到磁盘：dev server 一重启内存就没了，而跑批还在后台活着。 */
async function persist(job) {
  try {
    await fsp.mkdir(path.dirname(stateFile()), { recursive: true });
    await fsp.writeFile(
      stateFile(),
      JSON.stringify({ ...snapshot(job), logTail: undefined }, null, 2),
      "utf8"
    );
  } catch {
    /* 状态落盘失败不该影响跑批本身 */
  }
}

function snapshot(job) {
  if (!job) return null;
  return {
    id: job.id,
    week: job.week,
    status: job.status,
    percent: job.percent,
    stage: job.stage,
    stageLabel: job.stageLabel,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    error: job.error,
    reportPath: job.reportPath,
    willFetch: job.willFetch,
    // 尾部日志给界面上那个「它现在在干嘛」用。全量在 tmp/insight-run.log 里。
    logTail: job.log.slice(-40),
  };
}

/** 算当前百分比：已完成阶段的权重和 + 当前阶段给一半（否则一个阶段里进度条一动不动）。 */
function computeProgress(job) {
  let done = 0;
  let currentStage = null;
  for (const s of STAGES) {
    if (s.probe(job)) {
      done += s.weight;
    } else {
      currentStage = s;
      break;
    }
  }
  const total = STAGES.reduce((a, s) => a + s.weight, 0);
  const half = currentStage ? currentStage.weight / 2 : 0;
  const pct = Math.round(((done + half) / total) * 100);
  job.percent = Math.max(job.percent, Math.min(pct, 99)); // 只增不减；100 留给真正跑完
  job.stage = currentStage?.key || "report";
  job.stageLabel = currentStage?.label || "收尾";
}

/**
 * 无人值守运行的提示词。
 *
 * **关键在最后那段**：skill 的工作流里到处是「先 dry run，用户确认后再 --go」。
 * 那是给交互式会话写的规矩，在无人值守下会让它停在第一个 dry run 上等一个永远不来的确认。
 * 所以必须显式授权，并且把不该自动做的那件事（要人扫码的深取）明确划掉——
 * **授权要具体到哪几步，不能写「你看着办」**。
 */
function buildPrompt({ week, allowFetch }) {
  return [
    `跑一次社媒洞察，周次 ${week}。`,
    "",
    "**这是无人值守运行**，没有人在旁边回答问题。所以：",
    "",
    `1. 已授权的付费步骤：${allowFetch ? "`fetch-material.mjs --go`（抓三个源，约 270 credits）、" : ""}Brave Search、Firecrawl。**不要停下来问，直接跑。**`,
    allowFetch ? "" : "1b. 本周材料已存在，**不要重新抓取**。",
    "2. 已授权：Museon 站内探针的**发现步骤**（`--source museon`，服务端跑，不碰任何账号）。",
    "3. **不要跑** MediaCrawler 深取——那一步要人扫码，无人值守跑不了。",
    "   如果判断需要它，把命令写进报告的「下次运行先补」区当作一条 pending action，不要试图自己跑。",
    "4. 中途不要向用户提问。有拿不准的地方，按 skill 的规矩记进 `coverage_limit` 或 `pending_actions`，继续往下走。",
    "5. 全部做完之后跑一次 `lint_report.py`，把 error 修完再结束。",
    "",
    "工作目录就是当前目录（workbench）。工件落 `tmp/insight-work/<week>/`。",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 起一次跑批。
 *
 * @param {object} opts
 * @param {string} opts.week      ISO 周，例如 2026-W34
 * @param {boolean} opts.allowFetch 是否允许付费抓材料（材料齐全时调用方应传 false）
 * @param {string} opts.reportPath 报告最终落点，用来探测「写完了没」
 */
export function startRun({ week, allowFetch, reportPath }) {
  if (current && current.status === "running") {
    const e = new Error("已经有一次跑批在进行中");
    e.code = "BUSY";
    throw e;
  }

  const workDir = path.join(WORKBENCH_ROOT, "tmp", "insight-work", week);
  const logPath = path.join(WORKBENCH_ROOT, "tmp", "insight-run.log");

  const job = {
    id: `${week}-${Date.now()}`,
    week,
    workDir,
    reportPath,
    willFetch: Boolean(allowFetch),
    status: "running",
    percent: 0,
    stage: "prepare",
    stageLabel: STAGES[0].label,
    startedAt: new Date().toISOString(),
    endedAt: null,
    error: null,
    log: [],
    child: null,
    timer: null,
  };
  current = job;

  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logStream = fs.createWriteStream(logPath, { flags: "w" });

  const args = [
    "-p",
    buildPrompt({ week, allowFetch }),
    "--output-format", "stream-json",
    "--verbose",
    "--max-turns", MAX_TURNS,
    // 这条 runner 要写文件、跑脚本、联网核实。**和聊天那条的白名单是两回事，别合并。**
    "--allowedTools", "Read", "Glob", "Grep", "Write", "Edit", "Bash", "WebFetch", "WebSearch",
  ];

  const child = spawn("claude", args, {
    cwd: WORKBENCH_ROOT,
    windowsHide: true,
    // stdin 关掉：无人值守下它没有输入，留着反而可能让某些交互提示挂住
    stdio: ["ignore", "pipe", "pipe"],
  });
  job.child = child;

  const onLine = (line) => {
    if (!line.trim()) return;
    logStream.write(line + "\n");
    // 只往内存里留一小截给界面显示，全量在日志文件里
    job.log.push(line.slice(0, 400));
    if (job.log.length > 200) job.log.splice(0, job.log.length - 200);
  };

  let buf = "";
  const feed = (chunk) => {
    buf += chunk.toString();
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const l of lines) onLine(l);
  };
  child.stdout.on("data", feed);
  child.stderr.on("data", feed);

  // 每 3 秒按工件重算一次进度。轮询文件系统比解析 agent 的自述可靠得多。
  job.timer = setInterval(() => {
    computeProgress(job);
    persist(job);
  }, 3000);

  const finish = (status, error) => {
    if (job.status !== "running") return;
    clearInterval(job.timer);
    job.status = status;
    job.error = error || null;
    job.endedAt = new Date().toISOString();
    if (status === "done") job.percent = 100;
    logStream.end();
    persist(job);
  };

  const killTimer = setTimeout(() => {
    try {
      child.kill();
    } catch {}
    finish("failed", `超过 ${HARD_TIMEOUT_MS / 60000} 分钟仍未结束，已中止`);
  }, HARD_TIMEOUT_MS);

  child.on("error", (e) => {
    clearTimeout(killTimer);
    finish(
      "failed",
      e.code === "ENOENT" ? "找不到 claude 命令（确认命令行里 claude --version 可用）" : e.message
    );
  });

  child.on("close", (code) => {
    clearTimeout(killTimer);
    computeProgress(job);
    // **不要只看退出码。** agent 可能正常退出但报告根本没写出来——
    // 那种情况报「成功」比报失败更坏，因为你会拿着一份旧报告当新的读。
    const wrote = job.reportPath && exists(job.reportPath);
    if (code === 0 && wrote) finish("done");
    else if (code === 0) finish("failed", "跑批结束了，但报告文件没有产出——看 tmp/insight-run.log");
    else finish("failed", `claude 退出码 ${code}——看 tmp/insight-run.log`);
  });

  persist(job);
  return snapshot(job);
}

export function getRun() {
  if (current) {
    if (current.status === "running") computeProgress(current);
    return snapshot(current);
  }
  // 内存里没有就读磁盘：dev server 重启过，但用户想看上一次跑成什么样
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return null;
  }
}

export function cancelRun() {
  if (!current || current.status !== "running") return null;
  try {
    current.child?.kill();
  } catch {}
  return snapshot(current);
}

export { WORKBENCH_ROOT, STAGES };
