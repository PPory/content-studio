/**
 * 截图脚本：跑法 node tests/shots.mjs [宽度] [dark]
 * 用来肉眼验收视觉，不做断言。产物进 tmp/shot-*.png（不入库）。
 *
 * 冒烟测试只保证「渲染出来了」，保证不了「好不好看」。改完样式必须跑这个、真去看图。
 */

import { createServer, loadEnv } from "vite";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DIRS } from "../server/lib/vault-dirs.mjs";
import { localDate } from "../server/lib/plan.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// 端口可以从环境变量改：`strictPort` 下被别的进程占着就直接起不来，
// 而这台机器上跑着别的东西是常态（踩过一次：一个 python 服务占了 5198，
// 截图脚本整个挂掉，报错只有一句 "Port 5198 is already in use"）。
const PORT = Number(process.env.SHOTS_PORT) || 5198;
const WIDTH = Number(process.argv[2]) || 1600;
const HEIGHT = Number(process.env.SHOTS_HEIGHT) || 1000;
const DARK = process.argv.includes("dark");
const ONLY = new Set(process.argv.slice(3).filter((arg) => arg !== "dark"));
const SUFFIX = DARK ? "-dark" : "";

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve("playwright", { paths: [ROOT, "C:/Users/Lenovo"] }));

/**
 * 数据页要有数据才看得出好不好看——空着的图只能验收空态。
 *
 * 所以这里**临时**塞一份样例，截完原样还原（本来没有文件就删掉）。样例里故意留了
 * 三种真实的脏：有几条没有观看数、公众号没有「收藏」这一列、月中有一周一篇没发——
 * 缺口提示、空指标整格消失、0 篇的那根柱子，都得在图上看得见。
 */
const DATA = path.join(ROOT, "data");

/**
 * ⚠️ **本周那几条必须按「跑图的当天」算出来，不能写死日期。**
 * 首页那张图的口径是**本周**，而写死的样例日期过几天就不在本周了——
 * 于是首页永远截出一张「这周还没有发布记录」的空态，
 * 而**看着和「图坏了」一模一样**。这正是这个脚本存在的理由：它是用来看图的。
 */
const MONDAY = (() => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
})();
const dayOfWeek = (n) => {
  const d = new Date(MONDAY);
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const THIS_WEEK = [
  `${dayOfWeek(0)},小红书,做了个「内容封面生成」Skill,https://example.invalid/w1,391,17,2,24,3,,,`,
  `${dayOfWeek(1)},公众号,推荐一个公众号排版工具：Typeset,https://example.invalid/w2,104,2,0,,1,,,`,
  `${dayOfWeek(3)},小红书,推荐一个自己做的公众号排版工具：Typeset,https://example.invalid/w3,243,15,1,19,4,,,`,
  `${dayOfWeek(4)},抖音,把重复三遍的事情自动化,https://example.invalid/w4,8600,201,14,52,33,,,`,
].join(String.fromCharCode(10));

const SEED = [
  ["posts.csv", `date,platform,title,url,views,likes,comments,collects,shares,extra,doc,synced
2026-08-02,小红书,用 AI 帮朋友做了个很急的项目，分享一些思路,https://example.invalid/1,3085,103,7,105,17,,,2026-08-12
2026-08-03,公众号,2026 年，广告人应该如何开始学 AI,https://example.invalid/2,229,2,0,,24,,,2026-08-12
2026-08-04,小红书,警惕成为 AI 时代的信息蠢货,https://example.invalid/3,1268,48,4,15,6,,,2026-08-12
2026-08-05,抖音,10 分钟跑一套调性一致的详情页,https://example.invalid/4,12800,342,23,88,41,,,2026-08-12
2026-08-10,小红书,企业没办法逼每个人都学 AI,https://example.invalid/5,3200,89,7,68,12,,,2026-08-12
2026-08-11,小红书,一个 skill 解决四大业务场景,https://example.invalid/6,2173,102,8,90,17,,,2026-08-12
2026-08-11,抖音,把重复三遍的事情自动化,https://example.invalid/7,8600,201,14,52,33,,,2026-08-12
2026-08-12,小红书,今天刚发的，还没有数据,https://example.invalid/8,,,,,,,,
${THIS_WEEK}
`],
  ["metrics.csv", `date,platform,followers,views,note
2026-07-14,小红书,4120,,
2026-07-21,小红书,4310,,
2026-07-28,小红书,4680,,起量
2026-08-04,小红书,5020,,
2026-08-11,小红书,5240,,
2026-07-14,公众号,860,,
2026-07-28,公众号,905,,
2026-08-11,公众号,980,,
`],
];
/**
 * ⚠️ **恢复单先落盘，再动任何一份真文件。**
 *
 * 上一版只把原文存在内存里、靠 `process.on("exit")` 写回去——而 `exit` 在 Ctrl+C、
 * `Stop-Process`、被上层工具掐掉时**根本不会触发**。踩过一次，代价是 `data/posts.csv`
 * 里留着样例数据、数据页显示的全是编出来的数字，而**没有任何地方会报错**。
 *
 * 现在：原文先写进 `tmp/.shots-restore.json`，进程无论怎么死，**下次启动第一件事就是
 * 把它还回去**。这和 `safe-write.mjs` 那条「写坏了不能坏掉原来那份」是同一个道理。
 */
const RESTORE_FILE = path.join(ROOT, "tmp", ".shots-restore.json");

/**
 * `before === null` 表示这份文件本来不存在，该删掉。
 *
 * ⚠️ **但只在它现在的内容确实就是我们塞进去的样例时才删。** 恢复单是上一次跑留下的，
 * 中间可能隔了很久——这期间你完全可能真的导入过一份数据。删之前先比一次，比错了
 * 大不了留下一份样例（看得见、好清理），删错了是**真数据没了、而且不报错**。
 */
function restoreFrom(list) {
  for (const [p, before, seeded] of list) {
    if (before !== null) {
      fs.writeFileSync(p, before, "utf8");
      continue;
    }
    const now = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
    if (now === null || now === seeded) fs.rmSync(p, { force: true });
    else console.error(`⚠ ${p} 里不是样例数据了，没有删它。自己确认一下`);
  }
}

// 上一次跑没跑完的话，先把它欠的还了，再开始这一次
if (fs.existsSync(RESTORE_FILE)) {
  try {
    restoreFrom(JSON.parse(fs.readFileSync(RESTORE_FILE, "utf8")));
    console.log("↺ 上次的样例数据没还回去，已恢复");
  } catch (e) {
    console.error("⚠ 恢复上次的样例数据失败，去看 tmp/.shots-restore.json：", e.message);
  }
  fs.rmSync(RESTORE_FILE, { force: true });
}

// 第三项是「我们即将塞进去的样例」，恢复时用来确认那份文件确实还是样例（见 restoreFrom）
const saved = SEED.map(([f, body]) => {
  const p = path.join(DATA, f);
  return [p, fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null, body];
});

/**
 * 总览的「我的清单」同理：空清单只能验收空态，而这一块要看的恰恰是**打过钩的那一行**
 * （变灰 + 删除线）和进度环。所以临时塞一份今天的计划，截完原样还原。
 *
 * **走文件不走界面**：脚本里一律不碰「点了就写」的控件（这条是踩出来的）。路径从
 * `vault-dirs.mjs` 和 `plan.mjs` 取，不在这儿抄第二份——抄的那份迟早和真的对不上，
 * 而现象只是「图上这块一直是空的」。
 */
const VAULT = loadEnv("development", ROOT, "").VAULT_ROOT || "";
const PLAN_FILE = VAULT ? path.join(VAULT, ...DIRS.plan.split("/"), `${localDate()}.md`) : "";
const PLAN_SEED = `# ${localDate()} 计划

- [x] 把「深度思考」那篇的开头重写一遍
- [x] 回复三条小红书评论
- [ ] 先完成主稿：你以为自己在思考，其实只是在找一个让自己舒服的答案
- [ ] 剪完周四那条口播
- [ ] 把上周的洞察报告读完
- [ ] 给「杠杆」那篇配封面
`;
if (PLAN_FILE) saved.push([PLAN_FILE, fs.existsSync(PLAN_FILE) ? fs.readFileSync(PLAN_FILE, "utf8") : null, PLAN_SEED]);

// 恢复单落盘 → 然后才写样例。顺序反了的话，正好在这两步之间被掐掉就没得还了
fs.mkdirSync(path.dirname(RESTORE_FILE), { recursive: true });
fs.writeFileSync(RESTORE_FILE, JSON.stringify(saved), "utf8");

fs.mkdirSync(DATA, { recursive: true });
for (const [f, body] of SEED) fs.writeFileSync(path.join(DATA, f), body, "utf8");
if (PLAN_FILE) {
  fs.mkdirSync(path.dirname(PLAN_FILE), { recursive: true });
  fs.writeFileSync(PLAN_FILE, PLAN_SEED, "utf8");
}

let restored = false;
const restore = () => {
  if (restored) return;
  restored = true;
  restoreFrom(saved);
  fs.rmSync(RESTORE_FILE, { force: true });
};
process.on("exit", restore);
// `exit` 只在自然退出时触发。Ctrl+C 和 kill 走这两条，走完自己退出
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(sig, () => {
    restore();
    process.exit(1);
  });
}

const server = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, "vite.config.mjs"),
  server: { port: PORT, strictPort: true, open: false },
  logLevel: "error",
});
await server.listen();

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1.5,
  colorScheme: DARK ? "dark" : "light",
});

// 新的内容项目页要看得出阶段和下一步，空态截图验不了这两件事。
// 和上面的数据页样例一样，这里只拦截浏览器请求，不写真流水线。
const PROJECT_SHOT_SEED = [
  { id: "shot-planning", title: "AI 时代，什么才算真正的独立思考", stage: "策划中", stageReason: "缺少目标读者", nextAction: "补全创作简报", blockers: ["缺少目标读者"], topic: { id: "shot-planning" }, masterDraft: null, updatedAt: new Date().toISOString() },
  { id: "shot-writing", title: "别再把收藏当成学会", stage: "写作中", stageReason: "已有稿件，继续收紧观点", nextAction: "继续写作", blockers: [], topic: { id: "shot-writing" }, masterDraft: { id: "shot-draft" }, updatedAt: new Date(Date.now() - 3600000).toISOString() },
  { id: "shot-review", title: "信息过载最先杀死的是判断力", stage: "待复盘", stageReason: "内容已发布，尚未进行表现判断", nextAction: "开始复盘", blockers: [], topic: { id: "shot-review" }, masterDraft: { id: "shot-review-draft" }, updatedAt: new Date(Date.now() - 7200000).toISOString() },
];
/**
 * 项目详情页那一张图同样得有内容才验得了。
 *
 * ⚠️ **上面那条 `**\/api/pipe/projects*` 拦不到详情**：glob 的 `*` 不跨 `/`，
 * 所以 `/api/pipe/projects/<id>` 会漏过去打到真流水线，而那边不认识 `shot-planning`
 * 这种假 id，回的是 400——截出来的是一张「project id 不合法」的错误页。
 * 踩过一次，而且错得很像产品坏了。
 */
const PROJECT_SHOT_DETAIL = {
  id: "shot-writing",
  title: "别再把收藏当成学会",
  stage: "写作中",
  stageReason: "主稿正在编辑，还没提交发布",
  nextAction: "写完了，去发布",
  blockers: [],
  updatedAt: new Date(Date.now() - 3600000).toISOString(),
  brief: { audience: "想把输入变成产出的人", viewpoint: "收藏这个动作本身会带来「已经学会」的错觉", platform: "公众号", priority: "高" },
  masterDraft: {
    id: "shot-draft",
    platform: "公众号",
    status: "撰写中",
    title: "别再把收藏当成学会",
    body: [
      "## 收藏键是个情绪按钮",
      "",
      "点下收藏的那一刻，大脑得到的反馈和真的读完一篇长文几乎一样：一件事被处理掉了。",
      "但被处理掉的只是**焦虑**，不是内容本身。",
      "",
      "> 你收藏的不是知识，是「以后会看」这个承诺。",
      "",
      "## 检验的办法只有一个",
      "",
      "合上文章，用自己的话把它讲给一个不懂的人听。讲不下去的地方，就是你其实没读懂的地方——",
      "而收藏夹永远不会告诉你这些地方在哪。",
    ].join("\n"),
  },
  variants: [],
  materials: [
    { id: "m1", type: "核心观点", title: "收藏是把焦虑处理掉，不是把内容处理掉", content: "点收藏时大脑得到的反馈和读完几乎一样，被处理掉的是焦虑而不是内容。", inspirationId: "ib-shot-1" },
    { id: "m2", type: "金句/原话", title: "你收藏的不是知识，是「以后会看」这个承诺", content: "你收藏的不是知识，是「以后会看」这个承诺。", inspirationId: "ib-shot-1" },
    { id: "m3", type: "框架/模型", title: "费曼检验：讲不下去的地方就是没读懂的地方", content: "合上材料用自己的话讲一遍，卡住的位置就是理解的缺口所在。" },
    // ⚠️ m3/m4 故意**没有** inspirationId：手动入库的素材（`/金句` 那类）本来就没有来源，
    // 那时不画「看原文」——两种都在这张图里才看得出这条规则真的在生效
    { id: "m4", type: "反直觉点", title: "收藏夹越满，实际读完的比例越低", content: "清单一长，挑选成本就超过阅读成本，于是每一条都不再被打开。" },
  ],
  publication: { status: "未发布", latest: null },
  releaseOptions: [],
};
/**
 * 「待发布」那一档右栏整个换成发布准备（`ProjectReleaseRail`）——**两栏各是一套版面**，
 * 只截其中一张的话，另一张改坏了没有任何地方看得见。所以详情这一路可以切两份。
 */
const PROJECT_SHOT_RELEASE = {
  ...PROJECT_SHOT_DETAIL,
  stage: "待发布",
  stageReason: "主稿已写完，可以进入排版和发布",
  nextAction: "去排版发布",
  masterDraft: {
    ...PROJECT_SHOT_DETAIL.masterDraft,
    status: "已成稿",
    release: { spec: { coverLabel: "首图", coverRatio: "2.35:1" }, summary: "", cover: "" },
  },
  releaseOptions: [
    { platform: "小红书", coverLabel: "封面", coverRatio: "3:4" },
    { platform: "知乎", coverLabel: "题图", coverRatio: "16:9" },
  ],
};
let projectDetailShot = PROJECT_SHOT_DETAIL;
await page.route("**/api/pipe/projects/*", (route) => route.fulfill({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ ok: true, project: projectDetailShot }),
}));
await page.route("**/api/pipe/projects*", (route) => route.fulfill({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({
    ok: true,
    projects: PROJECT_SHOT_SEED,
    counts: { "策划中": 1, "生成中": 0, "写作中": 1, "待复盘": 1, "已完成": 0, "需处理": 0 },
    total: PROJECT_SHOT_SEED.length,
    nextCursor: null,
  }),
}));

let quickAssistantFixture = "";
const quickConversationRequests = [];
const quickConversation = () => ({
  id: "shot-global-conversation",
  scopeId: "global:assistant",
  title: "把输入变成判断",
  model: "claude-sonnet-4-6",
  permissionMode: "daily",
  messages: quickAssistantFixture === "two-turn" ? [
    { id: "u1", role: "user", text: "我收藏了很多资料，但总觉得没有真正形成自己的判断。", createdAt: new Date(Date.now() - 180000).toISOString() },
    { id: "a1", role: "assistant", text: "问题可能不在输入量，而在每次输入后都没有留下一个可反驳的结论。先挑最近的一条收藏，用一句话写下：你同意什么，又不同意什么。", createdAt: new Date(Date.now() - 160000).toISOString(), durationMs: 2300 },
    { id: "u2", role: "user", text: "我最常停在摘录原文，没有写自己的那一句。", createdAt: new Date(Date.now() - 90000).toISOString() },
    { id: "a2", role: "assistant", text: "那就把动作缩到足够小：每条摘录后只补一句“这对我意味着什么”。先不追求完整文章，让判断留下来。", createdAt: new Date(Date.now() - 70000).toISOString(), durationMs: 1800 },
  ] : [],
  actions: [],
  attachments: [],
});
await page.route("**/api/assistant/conversation?*", (route) => {
  const url = new URL(route.request().url());
  if (!quickAssistantFixture || url.searchParams.get("scope") !== "global:assistant") return route.continue();
  if (url.searchParams.get("conversationId")) quickConversationRequests.push(url.searchParams.get("conversationId"));
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, conversation: quickConversation() }) });
});
await page.route("**/api/assistant/conversations?*", (route) => {
  const url = new URL(route.request().url());
  if (!quickAssistantFixture || url.searchParams.get("scope") !== "global:assistant") return route.continue();
  const conversation = quickConversation();
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, conversations: { items: [{ id: conversation.id, title: conversation.title, updatedAt: new Date().toISOString() }] } }) });
});

// [文件名, hash, 等这个出现, 进页面后再做点什么]
const shots = [
  ["today", "/", ".today-focus, .project-setup, .note-danger"],
  ["content", "/#/content", ".act-cards, .ptable, .project-setup, .project-error"],
  /**
   * 项目详情页。⚠️ **它没有固定地址**（`#/project/<id>`，id 是库里的），
   * 所以从列表点进去，不写死一个 id——写死的那一刻这张图就绑在某一条数据上了。
   */
  ["project", "/#/content", ".ptable__row, .act-card, .project-setup", async () => {
    await page.waitForSelector(".ptable__row", { timeout: 25000 }).catch(() => {});
    await page.click(".ptable__row", { timeout: 8000 }).catch(() => {});
    await page.waitForSelector(".project-workspace, .project-workspace-load", { timeout: 25000 }).catch(() => {});
    // 等正文真的挂上来，不是等外壳——正文还在取的时候截出来的是一张骨架图
    await page.waitForSelector(".project-workspace .cm-content, .project-draft__empty, .project-review", { timeout: 25000 }).catch(() => {});
  }],
  // AI 协作的「聊一聊」是访谈的新位置：它跟着正文，不再是一条新建入口。
  ["project-ai", "/#/content", ".ptable__row, .act-card, .project-setup", async () => {
    await page.waitForSelector(".ptable__row", { timeout: 25000 }).catch(() => {});
    await page.click(".ptable__row", { timeout: 8000 }).catch(() => {});
    await page.waitForSelector(".writing-assist__trigger", { timeout: 25000 }).catch(() => {});
    await page.click(".writing-assist__trigger").catch(() => {});
    await page.click('.writing-assist__modes button:has-text("聊一聊")').catch(() => {});
    await page.waitForSelector(".writing-assist__welcome", { timeout: 8000 }).catch(() => {});
  }],
  ["project-release", "/#/content", ".ptable__row, .act-card, .project-setup", async () => {
    projectDetailShot = PROJECT_SHOT_RELEASE;
    await page.waitForSelector(".ptable__row", { timeout: 25000 }).catch(() => {});
    await page.click(".ptable__row", { timeout: 8000 }).catch(() => {});
    // 等页面本身，不是那个加载壳——壳在项目还在取的时候就渲染好了
    await page.waitForSelector(".project-publish, .project-rail", { timeout: 25000 }).catch(() => {});
    projectDetailShot = PROJECT_SHOT_DETAIL;
  }],
  ["ideas", "/#/ideas", ".ideas__sec"],
  ["seeds", "/#/seeds", ".seeds, .empty, .note-danger"],
  // 反应选择器：这一屏是「看到一个观点 → 说一句」的全部动作，光看列表看不出它长什么样
  ["seed-pick", "/#/seeds", ".seeds, .empty, .note-danger", async () => {
    await page.click(".page-bar__end .btn-primary", { timeout: 8000 }).catch(() => {});
    await page.waitForSelector(".rpick", { timeout: 8000 }).catch(() => {});
    await page.click(".rpick__opt >> nth=1").catch(() => {});
    // ⚠️ **只填不存**：建种子会往线上库写行（和设置面板那条同一个规矩）
    await page.fill(".rpick__take", "卡住的不是没归因到本质，是归到本质之后不知道下一步").catch(() => {});
  }],
  ["discover", "/#/discover", ".discover-grid"],
  ["overview", "/#/overview", ".todo-card, .note-title"],
  ["hot-boards", "/#/hot", ".board, .empty, .note-title"],
  ["hot-ai", "/#/hot", ".board, .empty, .note-title", async () => {
    await page.click('.pill-tab:has-text("AI 情报")', { timeout: 8000 }).catch(() => {});
    await page.waitForSelector(".ai-item, .empty", { timeout: 40000 }).catch(() => {});
  }],
  // 设置面板。**只开不存**：写 .env 会让这个脚本自己起的 dev server 重启，
  // 而写提示词改的是 content-pipeline 的真文件
  ["settings", "/", ".todo-card, .note-title", async () => {
    await page.click('.topbar__icon[aria-label="设置"]').catch(() => {});
    // 设置默认先打开「我的创作」；等工作台内置专家与风格都画出来再截。
    await page.waitForSelector(".writing-profile-settings .profile-source", { timeout: 15000 }).catch(() => {});
  }],
  // 「可选能力」：这一段自检最多，也是「已配」最容易堆成一排灰盒子的地方。
  // 现在绑了字段的那几条收成标题旁边一枚绿点，段尾只剩没有输入框可挂的那两条
  ["settings-optional", "/", ".todo-card, .note-title", async () => {
    await page.click(".conn__gear").catch(() => {});
    await page.click('.set-nav__item[data-key="optional"]').catch(() => {});
    await page
      .waitForSelector(".set-field__dot:not(.set-field__dot--wait), .set-check--ok, .set-check--bad, .set-check--warn, .set-check--off", { timeout: 40000 })
      .catch(() => {});
    // 滚到底：没绑字段的那两条自检（Firecrawl 二选一、AI 对话没有输入框）在段尾
    await page.$eval(".set-pane", (e) => e.scrollTo(0, e.scrollHeight)).catch(() => {});
  }],
  // 各环节模型：一行一个环节 + 一个下拉。**Worker 没部署这个端点时它是降级态**，
  // 图上应该看得见一条带下一步的话，而不是一片空白
  ["settings-models", "/", ".todo-card, .note-title", async () => {
    await page.click(".conn__gear").catch(() => {});
    await page.click('.set-nav__item[data-key="models"]').catch(() => {});
    await page.waitForSelector(".set-models__row, .set-pane .note-danger", { timeout: 20000 }).catch(() => {});
  }],
  // 提示词那一段：左边文件清单 + 右边编辑器，这是这一版最要看的一屏
  ["settings-prompts", "/", ".todo-card, .note-title", async () => {
    await page.click(".conn__gear").catch(() => {});
    await page.click('.set-nav__item[data-key="prompts-worker"]').catch(() => {});
    await page.waitForSelector(".set-pp__item, .set-pane .note-title", { timeout: 15000 }).catch(() => {});
    await page.click(".set-pp__item").catch(() => {});
    await page.waitForSelector(".set-pp__editor .cm-content", { timeout: 15000 }).catch(() => {});
  }],
  // 工作台自己的那两段 + 改不掉的安全约束
  ["settings-local-prompts", "/", ".todo-card, .note-title", async () => {
    await page.click(".conn__gear").catch(() => {});
    await page.click('.set-nav__item[data-key="prompts-local"]').catch(() => {});
    await page.waitForSelector(".set-guard", { timeout: 15000 }).catch(() => {});
  }],
  ["materials", "/#/materials", ".mflow, .empty, .note-title"],
  // 「已收纳」那一档三种类别都有，专门用来看类别那一列的三个颜色分不分得开
  ["materials-kept", "/#/materials", ".mflow, .empty, .note-title", async () => {
    await page.click('.mflow__steps button:has-text("已收纳")', { timeout: 8000 }).catch(() => {});
    await page.waitForSelector(".doc-row, .empty", { timeout: 20000 }).catch(() => {});
  }],
  ["topics-wall", "/#/topics", ".wall-card, .empty, .note-title"],
  ["topics-board", "/#/topics", ".wall-card, .empty, .note-title", async () => {
    await page.click('.seg button:has-text("看板")').catch(() => {});
    await page.waitForSelector(".kanban-col", { timeout: 15000 }).catch(() => {});
  }],
  ["gate", "/#/topics", ".wall-card, .empty", async () => {
    // 平台闸门：挑一条不在「撰写中」的选题，模拟改状态
    await page.click(".wall-card__open").catch(() => {});
    await page.waitForSelector(".reader .prose, .ws-main", { timeout: 25000 }).catch(() => {});
    await page.click(".select__btn").catch(() => {});
    await page.click('.select__pop button:has-text("撰写中")').catch(() => {});
    await page.waitForSelector(".pick-grid", { timeout: 8000 }).catch(() => {});
  }],
  ["reader", "/#/drafts", ".wall-card, .empty, .note-title", async () => {
    await page.click(".wall-card__open").catch(() => {});
    await page.waitForSelector(".reader .prose", { timeout: 25000 }).catch(() => {});
  }],
  // 洞察报告是这套界面里**信息最密**的一份文档（十几个分区、几十张表、卡片带元信息表），
  // 排版出问题只有看图才发现得了——之前一版把 frontmatter 里三个 sha256 整整齐齐
  // 铺在第一屏，冒烟测试全绿。
  // 跑批面板：页头按钮点开之后那一屏。它是这一页唯一的动作入口，
  // 而且里面全是「要不要花钱」这类需要看清楚的信息——不截图就等于没验。
  ["insight-run", "/#/insights", ".wall-card, .empty, .note-title", async () => {
    await page.click(".page-bar__end .btn-primary").catch(() => {});
    await page.waitForSelector(".run-panel", { timeout: 8000 }).catch(() => {});
  }],
  ["insight", "/#/insights", ".wall-card, .empty, .note-title", async () => {
    await page.click(".wall-card__open").catch(() => {});
    await page.waitForSelector(".reader .prose", { timeout: 25000 }).catch(() => {});
  }],
  // 第二张滚到第一张 Insight Card：卡片元信息那张表和一堆分区小标题都在下面，
  // 只截第一屏的话，正文密度到底怎么样一张也看不见。
  ["insight-card", "/#/insights", ".wall-card, .empty, .note-title", async () => {
    await page.click(".wall-card__open").catch(() => {});
    await page.waitForSelector(".reader .prose", { timeout: 25000 }).catch(() => {});
    await page.evaluate(() => {
      document.querySelector(".reader .prose h3")?.scrollIntoView({ block: "start" });
    });
  }],
  ["shelf", "/#/shelf", ".book-card, .empty, .note-title"],
  // 挑一本**多章**的书：单篇书直接进正文，看不到书详情那一层
  ["book", "/#/shelf", ".book-card, .empty", async () => {
    await page.click('.book-card:has-text("章")').catch(() => {});
    await page.waitForSelector(".book-hero, .empty", { timeout: 15000 }).catch(() => {});
  }],
  ["book-reader", "/#/shelf", ".book-card, .empty", async () => {
    await page.click('.book-card:has-text("章")').catch(() => {});
    await page.waitForSelector(".book-hero", { timeout: 15000 }).catch(() => {});
    await page.click(".chapter-row:nth-child(6)").catch(() => {});
    await page.waitForSelector(".reader .prose", { timeout: 25000 }).catch(() => {});
  }],
  // 阅读设置面板：字体分中文/拉丁两组、字号行宽这些是数值步进——这一屏光靠断言看不出好不好用
  ["prefs", "/#/shelf", ".book-card, .empty", async () => {
    await page.click('.book-card:has-text("章")').catch(() => {});
    await page.waitForSelector(".book-hero", { timeout: 15000 }).catch(() => {});
    await page.click(".chapter-row:nth-child(6)").catch(() => {});
    await page.waitForSelector(".reader .prose", { timeout: 25000 }).catch(() => {});
    await page.click(".reader-overlay__bar .prefs button[aria-expanded]").catch(() => {});
    await page.waitForSelector(".prefs__pop", { timeout: 6000 }).catch(() => {});
  }],
  // 对话区：权限模式在输入框旁边，空态要说清当前能做什么
  ["rail-chat", "/#/shelf", ".book-card, .empty", async () => {
    await page.click('.book-card:has-text("章")').catch(() => {});
    await page.waitForSelector(".book-hero", { timeout: 15000 }).catch(() => {});
    await page.click(".chapter-row:nth-child(6)").catch(() => {});
    await page.waitForSelector(".reader .prose", { timeout: 25000 }).catch(() => {});
    await page.click('.rail-tabs button:has-text("AI 助手")').catch(() => {});
    await page.waitForSelector(".composer", { timeout: 6000 }).catch(() => {});
  }],
  // 「理解」栏：模式芯片的三态（没问过 / 问过了 / 正在跑）+ 结果是叠着的。
  // 会真打一次 AI，但**不写任何东西**（划词 AI 默认不落盘），符合截图脚本的规矩。
  ["rail-ai", "/#/shelf", ".book-card, .empty", async () => {
    await page.click('.book-card:has-text("章")').catch(() => {});
    await page.waitForSelector(".book-hero", { timeout: 15000 }).catch(() => {});
    await page.click(".chapter-row:nth-child(6)").catch(() => {});
    await page.waitForSelector(".reader .prose", { timeout: 25000 }).catch(() => {});
    await page.evaluate(() => {
      const el = [...document.querySelectorAll(".reader .prose p")].find((p) => p.textContent.length > 40);
      const r = document.createRange();
      r.selectNodeContents(el);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    }).catch(() => {});
    await page.waitForSelector(".sel-bar", { timeout: 5000 }).catch(() => {});
    await page.click('.sel-bar button[aria-label="解释"]').catch(() => {});
    await page.waitForSelector(".rail .prose-sm, .rail .note-danger", { timeout: 60000 }).catch(() => {});
  }],
  // 入库抽屉：全工作台最常用的一个入口，值得每次改完都看一眼
  ["intake", "/", ".todo-card, .note-title", async () => {
    await page.click(".sidebar .btn-primary").catch(() => {});
    await page.waitForSelector(".drawer", { timeout: 6000 }).catch(() => {});
    await page.fill(".drawer textarea", "复利不是利滚利，是「同一件事做久了，别人再进来就追不上」。").catch(() => {});
  }],
  // 在工作台里读热点原文：抓得到出正文、抓不到出带引导的错误，两种都要能看
  ["hot-read", "/#/hot", ".board, .empty, .note-title", async () => {
    await page.click('.pill-tab:has-text("AI 情报")').catch(() => {});
    await page.waitForSelector(".ai-item", { timeout: 40000 }).catch(() => {});
    await page.click('.ai-item__acts button:has-text("在这里读")').catch(() => {});
    await page.waitForSelector(".reader-overlay .prose, .reader-overlay .note-danger", { timeout: 90000 }).catch(() => {});
  }],
  // 模型榜：一张表，数字要右对齐、小数点要对得上，光靠断言看不出来
  ["hot-models", "/#/hot", ".board, .empty, .note-title", async () => {
    await page.click('.pill-tab:has-text("模型榜")').catch(() => {});
    await page.waitForSelector(".lb__row, .empty", { timeout: 60000 }).catch(() => {});
  }],
  // 状态下拉：一行一个图标的浮层菜单，圆角和行高这些光靠断言看不出来
  ["select", "/#/drafts", ".wall-card, .empty, .note-title", async () => {
    await page.click(".wall-card__open").catch(() => {});
    await page.waitForSelector(".reader .prose", { timeout: 25000 }).catch(() => {});
    await page.click(".select__btn").catch(() => {});
    await page.waitForSelector(".select__pop", { timeout: 5000 }).catch(() => {});
  }],
  ["typeset", "/#/typeset", ".embed iframe"],
  ["metrics", "/#/metrics", ".stat-strip, .dropzone"],
  ["metrics-sources", "/#/metrics", ".stat-strip, .dropzone", async () => {
    await page.click('.pill-tab:has-text("数据来源")').catch(() => {});
    await page.waitForSelector(".dropzone", { timeout: 8000 }).catch(() => {});
  }],
  ["quick-hotspot", "/#/hot", ".board, .empty, .note-title", async () => {
    quickAssistantFixture = "empty";
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.dataset.shotShortcutInput = "true";
      input.style.cssText = "position:fixed;width:1px;height:1px;opacity:0";
      document.body.append(input);
      input.focus();
    });
    await page.keyboard.press("Control+i");
    await page.waitForSelector('.quick-assistant[data-open="true"] .assistant-composer textarea:focus', { timeout: 8000 });
    await page.evaluate(() => document.querySelector('[data-shot-shortcut-input]')?.remove());
    const draft = "关闭后还要保留的未发送问题";
    await page.fill(".quick-assistant .assistant-composer textarea", draft);
    await page.keyboard.press("Escape");
    await page.waitForSelector('.quick-assistant[data-open="true"]', { state: "detached", timeout: 8000 }).catch(async () => page.waitForSelector('.quick-assistant[data-open="true"]', { state: "hidden", timeout: 8000 }));
    await page.keyboard.press("Control+i");
    await page.waitForSelector('.quick-assistant[data-open="true"] .assistant-composer textarea:focus', { timeout: 8000 });
    if (await page.inputValue(".quick-assistant .assistant-composer textarea") !== draft) throw new Error("Quick Assistant draft was lost after Escape");
    await page.mouse.click(320, 240);
    await page.waitForSelector('.quick-assistant[data-open="true"]', { state: "detached", timeout: 8000 }).catch(async () => page.waitForSelector('.quick-assistant[data-open="true"]', { state: "hidden", timeout: 8000 }));
    await page.keyboard.press("Control+i");
    await page.waitForSelector('.quick-assistant[data-open="true"] .assistant-composer textarea:focus', { timeout: 8000 });
    if (await page.inputValue(".quick-assistant .assistant-composer textarea") !== draft) throw new Error("Quick Assistant draft was lost after outside click");
    await page.fill(".quick-assistant .assistant-composer textarea", "");
  }],
  ["quick-data", "/#/review-performance/总览", ".metric-page, .review-data, .note-title", async () => {
    quickAssistantFixture = "empty";
    await page.click("[data-assistant-summoner]");
    await page.waitForSelector('.quick-assistant[data-open="true"]', { timeout: 8000 });
  }],
  ["quick-two-turn", "/#/hot", ".board, .empty, .note-title", async () => {
    quickAssistantFixture = "two-turn";
    await page.keyboard.press("Control+i");
    await page.waitForSelector('.quick-assistant[data-open="true"] .assistant-message--assistant', { timeout: 8000 });
    await page.click(".quick-assistant .assistant-composer__continue");
    await page.waitForURL("**/#/assistant", { timeout: 8000 });
    await page.waitForSelector(".assistant-page .assistant-message--assistant", { timeout: 8000 });
    if (!quickConversationRequests.includes("shot-global-conversation")) throw new Error("Full Assistant did not continue the Quick conversationId");
    await page.keyboard.press("Control+i");
    await page.waitForSelector(".assistant-page .assistant-composer textarea:focus", { timeout: 8000 });
    if (await page.locator('.quick-assistant[data-open="true"]').count()) throw new Error("Full Assistant summon opened Quick Assistant");
    await page.goto("http://127.0.0.1:" + PORT + "/#/hot", { waitUntil: "networkidle" });
    await page.waitForSelector(".board, .empty, .note-title", { timeout: 60000 });
    await page.keyboard.press("Control+i");
    await page.waitForSelector('.quick-assistant[data-open="true"] .assistant-message--assistant', { timeout: 8000 });
  }],
  ["summon-project", "/#/content", ".ptable__row, .act-card, .project-setup", async () => {
    quickAssistantFixture = "";
    await page.waitForSelector(".ptable__row", { timeout: 25000 });
    await page.click(".ptable__row");
    await page.waitForSelector(".project-workspace .cm-content, .project-draft__empty", { timeout: 25000 });
    await page.keyboard.press("Control+i");
    await page.waitForSelector('.project-assistant .assistant-composer textarea:focus', { timeout: 8000 });
    if (await page.locator('.quick-assistant[data-open="true"]').count()) throw new Error("Project summon opened Quick Assistant");
  }],
  ["summon-reading", "/#/shelf", ".book-card, .empty", async () => {
    quickAssistantFixture = "";
    await page.click('.book-card:has-text("章")');
    await page.waitForSelector(".book-hero", { timeout: 15000 });
    await page.click(".chapter-row:nth-child(6)");
    await page.waitForSelector(".reader .prose", { timeout: 25000 });
    await page.keyboard.press("Control+i");
    await page.waitForSelector('.rail .assistant-composer textarea:focus', { timeout: 8000 });
    if (await page.locator('.quick-assistant[data-open="true"]').count()) throw new Error("Reading summon opened Quick Assistant");
  }],
];

for (const [name, hash, waitFor, after] of shots.filter(([name]) => !ONLY.size || ONLY.has(name))) {
  // 先回空白页再进：goto 到只有 hash 不同的地址**不会重新加载**，
  // 上一张图点出来的状态（切成卡片视图、打开了阅读区）会原样留到下一张图里。
  await page.goto("about:blank");
  await page.goto(`http://127.0.0.1:${PORT}${hash}`, { waitUntil: "networkidle" });
  await page.waitForSelector(waitFor, { timeout: 60000 }).catch(() => {});
  if (after) await after();
  await page.waitForTimeout(700);
  // 阅读覆盖层和内嵌工具是整屏布局，fullPage 会把 100vh 拉成一张怪图
  const inReader = ["reader", "insight", "insight-card", "book-reader", "gate", "typeset", "prefs", "rail-chat", "rail-ai", "intake", "hot-read", "select", "settings", "settings-optional", "settings-prompts", "settings-models", "settings-local-prompts", "project-ai", "quick-hotspot", "quick-data", "quick-two-turn", "summon-project", "summon-reading"].includes(name);
  const viewportSuffix = name.startsWith("quick-") || name.startsWith("summon-") ? `-${WIDTH}x${HEIGHT}` : "";
  await page.screenshot({ path: path.join(ROOT, "tmp", `shot-${name}${viewportSuffix}${SUFFIX}.png`), fullPage: !inReader });
  console.log("→", `tmp/shot-${name}${viewportSuffix}${SUFFIX}.png`);
}

await browser.close();
await server.close();
restore();
