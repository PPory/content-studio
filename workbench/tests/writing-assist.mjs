/** AI 协作的真实浏览器闭环：推动、梳理和候选写作都必须由用户明确采用。 */
import { createServer } from "vite";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 5202;

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const roots = [ROOT, "C:/Users/Lenovo", process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules") : ""];
  for (const root of roots.filter(Boolean)) {
    try { return require(require.resolve("playwright", { paths: [root] })); } catch { /* 下一处 */ }
  }
  throw new Error("找不到 playwright");
}

const server = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, "vite.config.mjs"),
  server: { port: PORT, strictPort: true, open: false },
  logLevel: "error",
});
await server.listen();

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (message) => {
  if (message.type() === "error" && !/Failed to load resource/i.test(message.text())) errors.push(message.text());
});

let nudges = 0;
const requests = [];
const brainstormRequests = [];
const revisionRequests = [];
const revisionDocuments = new Map();
await page.route("**/api/pipe/writing-assist", async (route) => {
  const body = route.request().postDataJSON();
  requests.push(body);
  if (body.mode === "nudge") {
    nudges += 1;
    await new Promise((resolve) => setTimeout(resolve, 260));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, mode: "nudge", kind: nudges === 1 ? "问题" : "新角度", text: nudges === 1 ? "你真正改变看法的那个瞬间是什么？" : "如果从读者最可能反对的地方往回写呢？" }),
    });
  }
  const text = body.mode === "finish"
    ? Array.from({ length: 18 }, (_, index) => `第 ${index + 1} 步，把判断落到一个具体选择上。真正的结束不是再总结一次，而是让读者知道明天可以少做什么。`).join("\n\n")
    : "这不是缺少更多方法，而是还没有把眼前的矛盾说透。先把最不愿承认的那个代价写下来，下一步往往就会自己出现。";
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mode: body.mode, kind: body.mode === "finish" ? "完成全文" : "续写一段", text }) });
});
await page.route("**/api/agent/chat", async (route) => {
  const body = route.request().postDataJSON();
  brainstormRequests.push(body);
  const text = body.phase === "summary"
    ? "## 核心判断\n收藏处理的是焦虑，不是内容。\n\n## 可用经历或例子\n一次收藏后再也没打开。\n\n## 可能展开的要点\n用复述代替收藏。\n\n## 仍待回答的问题\n哪次真正改变了习惯？"
    : "最近一次你点完收藏、却再也没有打开，具体是什么内容？";
  return route.fulfill({
    status: 200,
    contentType: "text/plain; charset=utf-8",
    headers: { "x-session-id": "12345678-1234-1234-1234-123456789abc" },
    body: text,
  });
});
await page.route("**/api/pipe/text-revision", async (route) => {
  const body = route.request().postDataJSON();
  revisionRequests.push(body);
  const text = revisionRequests.length === 1
    ? "第一版候选：把最重要的判断说清楚，再删掉不服务于这个判断的句子。"
    : "第二版候选：先说清最重要的判断，再删掉无关句子。";
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, mode: body.mode, kind: "润色", text }) });
});
await page.route("**/api/revisions**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (request.method() === "GET") {
    const items = revisionDocuments.get(url.searchParams.get("scope")) || [];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, items }) });
  }
  const body = request.postDataJSON();
  if (url.pathname.endsWith("/move")) {
    const items = [...(revisionDocuments.get(body.from) || []), ...(revisionDocuments.get(body.to) || [])];
    revisionDocuments.set(body.to, items);
    revisionDocuments.delete(body.from);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, items }) });
  }
  const current = revisionDocuments.get(body.scope) || [];
  const items = [body.item, ...current.filter((item) => item.id !== body.item.id)];
  revisionDocuments.set(body.scope, items);
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, items }) });
});

function assert(value, message) {
  if (!value) throw new Error(message);
}

function editorValue(selector) {
  return page.$eval(selector, (content) => Array.from(content.children).filter((line) => line.classList.contains("cm-line")).map((line) => line.textContent).join("\n"));
}

try {
  /**
   * ⚠️ **上半段原来走的是创作弹层里那块编辑器，那一屏整个撤了。**
   * 写作只有一个地方（`#/project/:id`），所以「新稿编辑器」不再是一个独立的东西——
   * 这一段现在和下半段一样，测的都是**真正在用的那块编辑器**，只是入口不同：
   * 这儿从项目页进，下半段从稿件库的阅读区进。
   */
  await page.goto(`http://127.0.0.1:${PORT}/#/content`, { waitUntil: "networkidle" });
  await page.waitForSelector(".act-card, .project-table, .empty", { timeout: 20000 });
  /**
   * ⚠️ **必须挑一个正文可编辑的项目。**
   * 「推动一下」（`WritingAssist`）只在 `writingEditable` 时才画——待发布、待复盘那几档
   * 正文是只读的。盲点第一个的话，这一段会挂在「等 `.writing-assist__trigger`」上超时，
   * 看着像功能坏了，而其实只是打开了一篇锁住的稿子。
   */
  const opened = await page.evaluate(() => {
    const card = [...document.querySelectorAll(".act-card")].find((c) => /继续写作|开始写/.test(c.textContent));
    const go = card?.querySelector(".act-card__go") || card;
    if (go) { go.click(); return "卡片"; }
    const row = [...document.querySelectorAll(".project-table tbody tr")].find((r) => /写作中/.test(r.textContent));
    if (row) { row.click(); return "表格行"; }
    return "";
  });
  assert(opened, "库里此刻没有一个「写作中」的项目，这一段验不了（不是缺陷，换条数据再跑）");
  await page.waitForSelector(".project-draft .cm-content", { timeout: 20000 });

  await page.click(".writing-assist__trigger");
  await page.waitForSelector(".writing-assist__result");
  const firstStarter = await page.textContent(".writing-assist__result > p");
  assert((await page.textContent(".writing-assist__result footer")).includes("2,560"), "没有显示真实的起始句库数量");
  const modes = await page.$$eval(".writing-assist__modes button", (buttons) => buttons.map((button) => button.textContent.trim()));
  assert(modes.join("/") === "想一想/聊一聊/帮我写", `协作方式不完整：${modes.join("/")}`);
  const iconActions = await page.evaluate(() => Array.from(document.querySelectorAll(".writing-assist__result footer button"), (button) => ({
    label: button.getAttribute("aria-label"),
    title: button.getAttribute("title"),
    text: button.textContent.trim(),
    icons: button.querySelectorAll("svg").length,
  })));
  assert(iconActions.every((item) => item.label && item.title && !item.text && item.icons === 1), "结果操作没有全部使用带悬停说明的图标按钮");
  await page.click('.writing-assist__result button[aria-label="换一句起始句"]');
  const secondStarter = await page.textContent(".writing-assist__result > p");
  assert(firstStarter !== secondStarter, "换一句没有换内容");
  await page.click('.writing-assist__result button[aria-label="用这句开头"]');
  await page.waitForFunction((text) => document.querySelector(".cm-content")?.textContent.includes(text), secondStarter);

  // 新稿编辑器同样支持选区工具条；Esc 只收起工具条，不改正文。
  await page.click(".project-draft .cm-content");
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < 6; index += 1) await page.keyboard.press("Shift+ArrowRight");
  await page.waitForSelector(".text-revision-menu");
  const newEditorActions = await page.$$eval(".text-revision-menu__actions button:not(.text-revision-menu__close)", (buttons) => buttons.map((button) => button.textContent.trim()));
  assert(newEditorActions.join("/") === "润色/纠错/缩写/扩写/改写", `新稿选区工具不完整：${newEditorActions.join("/")}`);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".text-revision-menu", { state: "detached" });

  // 光标放在正文中间：请求位置、浮层位置和等待动画必须都以真实界面为准。
  await page.click(".project-draft .cm-content");
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.click(".writing-assist__trigger");
  await page.waitForSelector(".writing-assist__wait");
  const loadingUi = await page.evaluate(() => {
    const card = document.querySelector(".writing-assist__card");
    const spinner = document.querySelector(".writing-assist__wait svg");
    const rect = card.getBoundingClientRect();
    return {
      position: getComputedStyle(card).position,
      centerOffset: Math.abs((rect.left + rect.right) / 2 - innerWidth / 2),
      top: rect.top,
      animation: getComputedStyle(spinner).animationName,
    };
  });
  assert(loadingUi.position === "fixed" && loadingUi.centerOffset < 2 && loadingUi.top < 120, "推动浮层没有固定在页面顶部中央");
  assert(loadingUi.animation !== "none", "等待图标没有播放转动动画");
  await page.waitForFunction(() => document.querySelector(".writing-assist__result > p")?.textContent.includes("改变看法"));
  assert(requests.find((item) => item.mode === "nudge")?.cursor === 3, "新建文章没有把当前光标位置发给 AI");

  // 连续两次小推动：第二次必须真的再发请求，而不是重复展示第一次缓存。
  await page.click('.writing-assist__result button[aria-label="再生成一个"]');
  await page.waitForFunction(() => document.querySelector(".writing-assist__result > p")?.textContent.includes("读者最可能反对"));
  assert(nudges === 2, `小推动请求次数不对：${nudges}`);

  await page.click('.writing-assist__modes button:has-text("帮我写")');
  await page.click('.writing-assist__choice button:has-text("续写一段")');
  await page.waitForFunction(() => document.querySelector(".writing-assist__result > p")?.textContent.includes("缺少更多方法"));
  const before = await editorValue(".cm-content");
  assert(!before.includes("缺少更多方法"), "候选在确认前就写进了正文");
  await page.click('.writing-assist__result button[aria-label="插入光标处"]');
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("缺少更多方法"));
  await page.waitForSelector(".writing-assist__card", { state: "detached" });
  const after = await editorValue(".cm-content");
  const paragraph = "这不是缺少更多方法，而是还没有把眼前的矛盾说透。先把最不愿承认的那个代价写下来，下一步往往就会自己出现。";
  assert(after === before.slice(0, 3) + paragraph + before.slice(3), "续写没有精确插入当前光标，或额外添加了换行");
  assert((await page.$$(".cm-ai-draft")).length > 0, "AI 续写插入后没有轻量底纹");
  const aiWash = await page.$eval(".cm-ai-draft", (node) => getComputedStyle(node).backgroundColor);
  assert(aiWash !== "rgba(0, 0, 0, 0)" && aiWash !== "transparent", "AI 续写底纹没有实际颜色");
  await page.screenshot({ path: path.join(ROOT, "tmp", "writing-assist-ai-pending.png"), fullPage: false });
  await page.keyboard.type("再补一句。");
  assert((await editorValue(".cm-content")).includes(paragraph + "再补一句。"), "不能直接在 AI 底纹范围内修改");
  await page.click('.ai-draft-review button[aria-label="回看 AI 插入时的原稿"]');
  await page.waitForSelector(".ai-draft-history");
  assert((await page.textContent(".ai-draft-history")).includes(paragraph), "回看历史里没有保留 AI 插入时的原稿");
  assert((await page.textContent(".ai-draft-history")).includes("已修改"), "修改 AI 续写后历史没有标出状态");
  await page.click('.ai-draft-history button[aria-label="关闭 AI 历史"]');
  await page.click('.ai-draft-review button[aria-label="确认采用这段，移除底纹"]');
  await page.waitForSelector(".ai-draft-review", { state: "detached" });
  assert((await page.$$(".cm-ai-draft")).length === 0, "确认采用后 AI 底纹没有消失");
  assert((await page.$$(".md-editor__ai-history")).length === 1, "确认采用后没有保留原稿回看入口");
  await page.click(".md-editor__ai-history");
  await page.waitForSelector(".ai-draft-history");
  assert((await page.textContent(".ai-draft-history")).includes(paragraph), "确认采用后无法再次回看 AI 原稿");
  await page.screenshot({ path: path.join(ROOT, "tmp", "writing-assist-ai-history.png"), fullPage: false });
  await page.click('.ai-draft-history button[aria-label="关闭 AI 历史"]');

  await page.click(".writing-assist__trigger");
  await page.waitForSelector(".writing-assist__wait");
  await page.waitForSelector(".writing-assist__result");
  await page.click('.writing-assist__modes button:has-text("帮我写")');
  await page.waitForSelector(".writing-assist__choice");
  await page.click('.writing-assist__choice button:has-text("完成全文")');
  await page.waitForFunction(() => document.querySelector(".writing-assist__result > p")?.textContent.includes("真正的结束"));
  const overflow = await page.evaluate(() => {
    const card = document.querySelector(".writing-assist__card");
    const content = document.querySelector(".writing-assist__result > p");
    return {
      cardHeight: card.getBoundingClientRect().height,
      scrolls: content.scrollHeight > content.clientHeight,
      overflowY: getComputedStyle(content).overflowY,
    };
  });
  assert(overflow.cardHeight <= 461 && overflow.scrolls && overflow.overflowY === "auto", "长结果没有限制窗口高度并在内部滚动");
  assert(!(await page.textContent(".cm-content")).includes("真正的结束"), "完成全文在确认前就写进了正文");
  await page.click('.writing-assist__result button[aria-label="插入光标处"]');
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("真正的结束"));

  // 「聊一聊」只逐问和整理线索：总结出现前后都不能静默改正文，最后由用户明确插入。
  await page.click(".writing-assist__trigger");
  await page.click('.writing-assist__modes button:has-text("聊一聊")');
  await page.waitForSelector(".writing-assist__welcome");
  await page.waitForTimeout(350);
  assert(!(await page.$(".writing-assist__error")), "切换到聊一聊时串进了上一种模式的错误");
  const beforeChat = await editorValue(".cm-content");
  await page.click('.writing-assist__welcome button:has-text("开始梳理")');
  await page.waitForFunction(() => document.querySelector(".writing-assist__log")?.textContent.includes("具体是什么内容"));
  assert((await editorValue(".cm-content")) === beforeChat, "第一问自动改了正文");
  await page.click('.writing-assist__chat-actions button:has-text("整理线索")');
  await page.waitForSelector('.writing-assist__chat-actions button:has-text("插入正文")');
  assert((await editorValue(".cm-content")) === beforeChat, "整理线索在确认前改了正文");
  assert(brainstormRequests.length === 2 && brainstormRequests[1].phase === "summary", "聊一聊没有先问再整理");
  await page.click('.writing-assist__chat-actions button:has-text("插入正文")');
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("写作线索"));

  // 用户日常改稿走的是稿件库覆盖层，不是上面的新建弹层；这里必须单独守住入口。
  await page.goto(`http://127.0.0.1:${PORT}/#/drafts`, { waitUntil: "networkidle" });
  /**
   * ⚠️ **浏览层早就从卡片墙换成列表行了**（`.wall-card__open` → `.doc-row__open`），
   * 这几行一直指着一个不存在的类名——**这个脚本没进 `package.json`，
   * 所以烂了很久也没人发现**。要加断言就顺手把它跑一遍。
   *
   * 挑一条**真有正文**的：后面几条量的是编辑器里的字，空稿会让它们全部落空。
   */
  await page.waitForSelector(".doc-row__open, .empty", { timeout: 25000 });
  assert((await page.$$(".doc-row__open")).length > 0, "稿件库没有可用于验证的稿件");
  const pickDraft = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".doc-row")];
    const full = rows.find((r) => (r.querySelector(".doc-row__excerpt")?.textContent || "").trim().length > 10);
    return rows.indexOf(full || rows[0]);
  });
  await page.click(`.doc-row__open >> nth=${Math.max(pickDraft, 0)}`);
  await page.waitForSelector('.doc-actions button:has-text("编辑")', { timeout: 25000 });
  await page.click('.doc-actions button:has-text("编辑")');
  await page.waitForSelector(".ws-edit .cm-content", { timeout: 8000 });
  assert((await page.$$(".ws-edit .writing-assist__trigger")).length === 1, "正式编辑器里没有推动按钮");
  await page.click(".ws-edit .cm-content");
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < 12; index += 1) await page.keyboard.press("ArrowRight");
  const existingBefore = await editorValue(".ws-edit .cm-content");
  await page.click(".ws-edit .writing-assist__trigger");
  await page.waitForSelector(".ws-edit .writing-assist__result");
  const existingNudge = requests.filter((item) => item.mode === "nudge").at(-1);
  assert(existingNudge?.cursor === 12 && existingNudge.cursor < existingNudge.content.length, "正式编辑器仍然按文末而不是当前光标请求");
  await page.click('.ws-edit .writing-assist__modes button:has-text("帮我写")');
  await page.click('.ws-edit .writing-assist__choice button:has-text("续写一段")');
  await page.waitForFunction(() => document.querySelector(".ws-edit .writing-assist__result > p")?.textContent.includes("缺少更多方法"));
  await page.screenshot({ path: path.join(ROOT, "tmp", "writing-assist-existing-editor.png"), fullPage: false });
  await page.click('.ws-edit .writing-assist__result button[aria-label="插入光标处"]');
  await page.waitForFunction(() => document.querySelector(".ws-edit .cm-content")?.textContent.includes("缺少更多方法"));
  const existingAfter = await editorValue(".ws-edit .cm-content");
  assert(existingAfter === existingBefore.slice(0, 12) + paragraph + existingBefore.slice(12), "正式编辑器没有在当前光标精确插入");
  assert((await page.$$(".ws-edit .cm-ai-draft")).length > 0, "正式编辑器里的 AI 续写没有底纹");

  // 正式改稿：选区 → 自定义润色 → 对比 → 重写 → 编辑候选 → 采纳。
  await page.click(".ws-edit .cm-content");
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < 12; index += 1) await page.keyboard.press("Shift+ArrowRight");
  await page.waitForSelector(".text-revision-menu");
  await page.click('.text-revision-menu__actions button:has-text("润色")');
  await page.fill('.text-revision-menu__command input[aria-label="润色要求"]', "更克制");
  await page.click('.text-revision-menu__command button[aria-label="开始润色"]');
  await page.waitForSelector(".text-revision-review textarea");
  assert(revisionRequests[0]?.instruction === "更克制", "自定义润色要求没有发给 AI");
  const compareDocument = await editorValue(".ws-edit .cm-content");
  const visuallySplitDocument = `${existingAfter.slice(0, 12)}\n${existingAfter.slice(12)}`;
  assert(compareDocument === visuallySplitDocument, "对比阶段除候选卡片占位外改变了正文内容");
  const compareStyle = await page.evaluate(() => ({
    strike: getComputedStyle(document.querySelector(".cm-text-revision-original")).textDecorationLine,
    wash: getComputedStyle(document.querySelector(".text-revision-review textarea")).backgroundColor,
  }));
  assert(compareStyle.strike.includes("line-through"), "对比状态的原文没有删除线");
  assert(compareStyle.wash !== "transparent" && compareStyle.wash !== "rgba(0, 0, 0, 0)", "修订候选没有轻量底纹");
  await page.fill('.text-revision-review__command input[aria-label="调整修订要求"]', "更克制、更直接");
  await page.click('.text-revision-review__command button[aria-label="重新生成"]');
  await page.waitForFunction(() => document.querySelector(".text-revision-review textarea")?.value.includes("第二版候选"));
  assert(revisionRequests[1]?.instruction === "更克制、更直接", "重新生成没有沿用调整后的要求");
  await page.fill('.text-revision-review textarea[aria-label="AI 修订候选，可直接编辑"]', "这是用户调整后的最终候选。 ");
  await page.screenshot({ path: path.join(ROOT, "tmp", "text-revision-review.png"), fullPage: false });
  await page.click('.text-revision-review__decide button:has-text("采纳")');
  await page.waitForSelector(".text-revision-review", { state: "detached" });
  const revisedAfter = await editorValue(".ws-edit .cm-content");
  assert(revisedAfter === `这是用户调整后的最终候选。${existingAfter.slice(12)}`, "采纳没有精确替换原选区");
  await page.click(".ws-edit .md-editor__ai-history");
  await page.waitForSelector(".ai-draft-history");
  const historyText = await page.textContent(".ai-draft-history");
  assert(historyText.includes("已采纳") && historyText.includes(existingAfter.slice(0, 12)) && historyText.includes("这是用户调整后的最终候选。"), "修订历史没有同时保留原文和最终候选");
  await page.screenshot({ path: path.join(ROOT, "tmp", "text-revision-history.png"), fullPage: false });
  await page.click('.ai-draft-history button[aria-label="关闭 AI 历史"]');
  await page.click('.ws-edit__foot button:has-text("取消")');

  // 编辑器卸载再打开，记录仍从持久层读回来。
  await page.click('.doc-actions button:has-text("编辑")');
  await page.waitForSelector(".ws-edit .md-editor__ai-history", { timeout: 8000 });
  await page.click(".ws-edit .md-editor__ai-history");
  await page.waitForSelector(".ai-draft-history");
  assert((await page.textContent(".ai-draft-history")).includes("已采纳"), "重新打开稿件后修订历史没有恢复");
  await page.click('.ai-draft-history button[aria-label="关闭 AI 历史"]');

  // 弃用只记录决定，不改变正文；结果同样进入持久历史。
  const beforeDiscard = await editorValue(".ws-edit .cm-content");
  await page.click(".ws-edit .cm-content");
  await page.keyboard.press("Control+Home");
  for (let index = 0; index < 6; index += 1) await page.keyboard.press("Shift+ArrowRight");
  await page.click('.text-revision-menu__actions button:has-text("纠错")');
  await page.waitForSelector(".text-revision-review textarea");
  await page.click('.text-revision-review__decide button:has-text("弃用")');
  await page.waitForSelector(".text-revision-review", { state: "detached" });
  assert(await editorValue(".ws-edit .cm-content") === beforeDiscard, "弃用修订后正文发生了变化");
  await page.click(".ws-edit .md-editor__ai-history");
  await page.waitForSelector(".ai-draft-history");
  assert((await page.textContent(".ai-draft-history")).includes("已弃用"), "弃用决定没有进入持久修订历史");
  await page.click('.ai-draft-history button[aria-label="关闭 AI 历史"]');
  await page.click('.ws-edit__foot button:has-text("取消")');
  assert(errors.length === 0, `浏览器报错：${errors.join(" | ")}`);
  console.log("✓ 起始句可换、可插入");
  console.log("✓ 连续两次 AI 小推动都返回新结果");
  console.log("✓ 浮层位于页面顶部中央，等待图标实际播放转动动画");
  console.log("✓ AI 续写先预览，并在当前光标精确插入、不额外换行");
  console.log("✓ 长结果限制高度并在浮层内部滚动");
  console.log("✓ 新建文章与稿件库正式编辑器都把当前光标发给 AI");
  console.log("✓ 图标按钮都有名称和悬停说明");
  console.log("✓ AI 续写可在底纹内修改、确认后退底纹，并能回看原稿");
  console.log("✓ 两个编辑入口都有选区修订工具，采纳前正文保持不变");
  console.log("✓ 局部修订支持自定义要求、重新生成、直接编辑和精确采纳");
  console.log("✓ 弃用修订不改变正文，并持久记录弃用决定");
  console.log("✓ 修订历史跨编辑器重开仍可回看原文与最终候选");
  console.log("✓ 浏览器控制台 0 错误");
} finally {
  await browser.close();
  await server.close();
}
