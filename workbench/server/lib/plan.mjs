// 每日计划：你晚上手写的任务清单，一天一个 `05 - 计划/YYYY-MM-DD.md`。
//
// **为什么落 vault 而不是 localStorage**：这是你自己写的字，是内容，而红线写着
// 「不用 localStorage 存内容」。落进 vault 换来三件具体的事：打钩就是把 `- [ ]` 改成
// `- [x]`（Obsidian 原生就认，两边看到的是同一份）、躺床上用手机在 Obsidian 里列明天的
// 清单第二天工作台里就有、不给这个项目新增任何存储层。
//
// **工作台不是这些文件的唯一编辑器**，所以两条贯穿本文件的规矩：
//
//  1. **只改那一行。** 打钩、删除、新增都只动对应的那一行，文件里其余的东西
//     （标题、你顺手写在任务底下的备注、空行）一个字节都不动。整份按自己的格式
//     重排一遍，是在拿我们的口味覆盖用户的文件。
//  2. **认不出的标记不装作没看见。** 只认 `[ ]` / `[x]` / `[X]`；Obsidian 主题里那些
//     `[/]`、`[-]` 自定义状态**原样留在文件里**，同时数出来交给界面照实说一句。
//     悄悄隐藏的话，用户会以为工作台把他写的东西弄丢了。

import { DIRS } from "./vault-dirs.mjs";
import { readFileOrEmpty, writeVaultFile, fileStamp } from "./vault.mjs";

// 一行任务：`- [ ] 文字`。列表符号 `-` / `*` / `+` 都收，**并且原样保留**——
// 用户在 Obsidian 里用哪个是他的习惯，打个钩不该顺手把符号也改了。
const TASK_RE = /^(\s*)([-*+])\s+\[([ xX])\]\s?(.*)$/;
// 认得出是个任务框、但方框里不是我们认识的字符。数出来给界面用，绝不改动。
const UNKNOWN_RE = /^\s*[-*+]\s+\[[^\]]\]\s/;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 本地日期的 `YYYY-MM-DD`。**不能用 `toISOString()`**——那是 UTC，晚上 8 点之后写的清单会落到明天。 */
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 相对某天的偏移日期。`offsetDate(0)` 是今天，`offsetDate(1)` 是明天。 */
export function offsetDate(days, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return localDate(d);
}

/**
 * 日期串 → vault 相对路径。
 *
 * **客户端提交的只有这个日期串，绝不是路径**——和数据页 inbox「接口认 id 不认路径」
 * 同一条。格式对不上直接抛，不去猜用户想要哪天。
 */
export function planPath(date) {
  if (!DATE_RE.test(String(date || ""))) {
    throw Object.assign(new Error("日期格式不对"), { status: 400, hint: "要 YYYY-MM-DD，比如 2026-08-16" });
  }
  return `${DIRS.plan}/${date}.md`;
}

/**
 * 把一份 Markdown 拆成任务列表。
 *
 * 每条都记着自己在原文里的**行号**（`line`），改写时才能只动那一行——和批注编辑
 * 记起止位置是同一个手法。`index` 是它在清单里的序号，界面拿这个来指认。
 */
export function parseTasks(text) {
  const lines = String(text || "").split("\n");
  const tasks = [];
  let unknownMarks = 0;
  lines.forEach((raw, line) => {
    const m = raw.match(TASK_RE);
    if (m) {
      tasks.push({
        index: tasks.length,
        line,
        indent: m[1],
        bullet: m[2],
        done: m[3] !== " ",
        text: m[4].trim(),
      });
    } else if (UNKNOWN_RE.test(raw)) {
      unknownMarks += 1;
    }
  });
  return { tasks, unknownMarks };
}

function taskAt(text, index) {
  const { tasks } = parseTasks(text);
  const task = tasks[index];
  if (!task) {
    throw Object.assign(new Error("这条任务不在清单里了"), {
      status: 409,
      hint: "计划文件可能刚在 Obsidian 里被改过，刷新一下再试",
    });
  }
  return task;
}

/** 一条任务渲染成一行。 */
function taskLine({ indent = "", bullet = "-", done = false, text = "" }) {
  return `${indent}${bullet} [${done ? "x" : " "}] ${text}`;
}

/** 打钩 / 取消打钩。**只重写那一行。** */
export function applyToggle(text, index, done) {
  const task = taskAt(text, index);
  const lines = String(text).split("\n");
  lines[task.line] = taskLine({ ...task, done: !!done });
  return lines.join("\n");
}

/** 删掉一条。**只删那一行**，底下你写的备注留着。 */
export function applyRemove(text, index) {
  const task = taskAt(text, index);
  const lines = String(text).split("\n");
  lines.splice(task.line, 1);
  return lines.join("\n");
}

/**
 * 任务文字清洗。一条任务是**一行**，所以换行全压成空格；用户顺手打的
 * `- [ ]` 前缀要剥掉，否则文件里会变成 `- [ ] - [ ] 买菜`。
 */
export function cleanTaskText(input) {
  const text = String(input || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/^\s*[-*+]\s+(\[[^\]]\]\s*)?/, "")
    .trim()
    .slice(0, 200);
  if (!text) throw Object.assign(new Error("任务内容是空的"), { status: 400, hint: "写一句话，比如「改完主稿」" });
  return text;
}

/**
 * 加一条。**插在最后一条任务后面**，不是文件末尾——你写在清单底下的备注
 * 应该一直待在清单底下。一条任务都没有时才追加到末尾。
 */
export function applyAdd(text, input) {
  const clean = cleanTaskText(input);
  const body = String(text || "");
  const { tasks } = parseTasks(body);
  const last = tasks[tasks.length - 1];
  const line = taskLine({ indent: last?.indent || "", bullet: last?.bullet || "-", text: clean });
  if (!last) return body ? `${body.replace(/\s*$/, "")}\n\n${line}\n` : `${line}\n`;
  const lines = body.split("\n");
  lines.splice(last.line + 1, 0, line);
  return lines.join("\n");
}

/** 新文件的样子。标题让这份文件在 Obsidian 的搜索结果里自己说得清是什么。 */
export function newPlanText(date) {
  return `# ${date} 计划\n\n`;
}

/** 读一天的计划。文件还没建 = 空清单，不是错误。 */
export async function readPlan(root, date) {
  const rel = planPath(date);
  const text = await readFileOrEmpty(root, rel);
  const { tasks, unknownMarks } = parseTasks(text);
  return {
    date,
    path: rel,
    stamp: await fileStamp(root, rel),
    exists: !!text,
    unknownMarks,
    tasks: tasks.map(({ index, done, text: t }) => ({ index, done, text: t })),
  };
}

/**
 * 改一天的计划。
 *
 * **带 stamp 做乐观锁**：这些文件的另一个编辑器是 Obsidian，对不上就 409 让人刷新，
 * 绝不拿旧的行号去删掉别的行。新建文件时 stamp 是空串，此时文件必须真的不存在。
 *
 * ⚠️ **`stamp === null` 表示这次操作不需要锁，只有「追加一条」这么传。** 锁保护的是
 * **按行号改写**（打钩、删除）——行号是在客户端手上那份快照里算的，文件一变就可能指向
 * 别的行。而追加不依赖任何旧状态：读当前内容、往最后一条任务后面插一行，谁也伤不着。
 *
 * 这条是踩出来的：add 也带锁的那一版，只要文件在别处被动过一下（在 Obsidian 里存一次、
 * 甚至跑一次截图脚本），**最无害的那个操作反而第一个被挡下来**，而用户看到的是
 * 「添加任务失败」。锁要保护该保护的，不该顺手把不需要它的操作也拦了。
 */
export async function writePlan(root, date, stamp, mutate) {
  const rel = planPath(date);
  const now = await fileStamp(root, rel);
  if (stamp !== null && String(stamp || "") !== now) {
    throw Object.assign(new Error("计划文件已经被改过了"), {
      status: 409,
      hint: "它可能正在 Obsidian 里开着。刷新一下，你的改动不会丢",
    });
  }
  const text = now ? await readFileOrEmpty(root, rel) : newPlanText(date);
  await writeVaultFile(root, rel, mutate(text));
  return readPlan(root, date);
}
