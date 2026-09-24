// 选题流程的真实浏览器验收（2026-09-24 起取代原来的「构思表单」验收：那张表单已从界面撤掉，
// 构思的存取规则仍由 tests/project-notebook.mjs 覆盖）。
//
// 读懂 → 选角度（推荐标记、默认选中推荐、键盘可选）→ 补齐（每项自己的「记下实测」、这条不写了）→
// 定结构 → 写初稿（正文里【待补】高亮、编辑器上方进度线能回到任一步）→ 390px 无横向溢出。
// 独立的临时 XENHO_HOME；AI 结果在测试进程里用模拟模型生成（同一个工作区），不发任何外部请求。
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";
import { createResearch, ensureResearchProject } from "../server/domain/research.mjs";
import { proposeAngles, proposeStructures, writeDraft, planView } from "../server/domain/content-plan-ai.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-notebook-ui-"));
const screenshots = { desktop: path.join(os.tmpdir(), "xenho-topic-flow-desktop.png"), mobile: path.join(os.tmpdir(), "xenho-topic-flow-mobile.png"), draft: path.join(os.tmpdir(), "xenho-topic-flow-draft.png") };
const variables = { XENHO_HOME: path.join(tempRoot, "Xenho"), WB_KEEP_ALIVE: "1", HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", NO_PROXY: "127.0.0.1,localhost" };
const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]));
Object.assign(process.env, variables);
const check = (name, condition) => { assert(condition, name); console.log(` ✓ ${name}`); };
function playwright() {
  const require = createRequire(import.meta.url);
  for (const root of [ROOT, "C:/Users/Lenovo", process.env.APPDATA && path.join(process.env.APPDATA, "npm", "node_modules")].filter(Boolean)) {
    try { return require(require.resolve("playwright", { paths: [root] })); } catch {}
  }
  throw new Error("找不到 playwright");
}
let server, browser, base, page;

const env = {
  CONTENT_PLAN_COMPLETE_JSON: async (_env, input) => /写作角度/.test(input.system)
    ? { data: { angles: [
      { how: "knowledge", recommended: true, why: "你的笔记正好能讲清机制", title: "写到一半心慌，不是你不行", was: "卡住 = 没天赋。", is: "心慌是大脑在为难的任务调资源，被误读成了「我不行」。", audience: "写长文总在中段放弃的人", gain: "分清身体在准备和我不行", wiki: null, gaps: [{ label: "几条真实读者的原话", why: "问题是推导出来的", kind: "find", where: ["公众号留言"] }] },
      { how: "experience", title: "我是怎么走出写到一半就卡住的", was: "只有天赋好的人写得完长文。", is: "用一次真实的卡文经历展示过程。", audience: "同样困扰的写作者", gain: "一个可借鉴的过程", wiki: null, gaps: [{ label: "你的一次卡文经历", why: "只能来自你", kind: "exp" }, { label: "坚持一段时间后的变化", why: "只能来自你", kind: "exp" }, { label: "一份讲写作结构的资料", why: "结构型卡顿要另外解释", kind: "find", where: ["搜：长文 结构 卡住"] }] },
    ] }, model: "mock" }
    : { data: { structures: [
      { name: "场景 → 误读 → 真相 → 下一次怎么办", fit: "先让读者认出自己", sections: [{ heading: "一个熟悉的场景", purpose: "写到第三段突然心慌", uses: [] }, { heading: "你以为：我不行", purpose: "说出读者心里那句话", uses: [] }] },
      { name: "问答体", fit: "短平快", sections: [{ heading: "问：卡住是不是没天赋", purpose: "答：不是", uses: [] }] },
    ], titles: [{ text: "写到一半心慌，不是你不行", why: "反常识" }, { text: "每次写到一半就卡住？", why: "问题式" }] }, model: "mock" },
  CONTENT_PROJECT_COMPLETE_JSON: async () => ({ data: { title: "写到一半心慌，不是你不行", body_markdown: "你一定有过这种时刻：写到第三段，突然心慌。\n\n## 卡住，真的说明没天赋吗\n\n【待补：几条真实读者的原话】\n\n## 身体在准备，不是你不行\n\n心跳加快是大脑在调资源。", note: "" } }),
};

try {
  server = await createServer({ root: ROOT, configFile: path.join(ROOT, "vite.config.mjs"), server: { host: "127.0.0.1", port: 5208, strictPort: true, open: false }, logLevel: "error" });
  await server.listen();
  base = "http://127.0.0.1:5208";
  const w = await server.xenhoWorkspace;
  const research = createResearch(w, { question: "写到一半就卡住，是不是没天赋？", notes: "依据：\n\n> 焦虑感并非才华匮乏的客观证明。", openQuestions: "" });
  const { projectId } = ensureResearchProject(w, research.id);
  await proposeAngles(env, w, { projectId });

  browser = await playwright().chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // 结构和初稿要调模型：在测试进程里用模拟模型跑同一段领域代码，界面走的仍是真实的请求与返回。
  await page.route("**/plan/structures", async (route) => { const r = await proposeStructures(env, w, { projectId, force: true }); await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, ...r }) }); });
  await page.route("**/plan/draft", async (route) => { const r = await writeDraft(env, w, { projectId }); await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, ...r, ...planView(w, env, projectId) }) }); });

  await page.goto(`${base}/#/project/${projectId}`);
  const flow = page.locator(".topic-flow");
  await flow.waitFor();
  check("有选题简报的内容打开就是选题流程", await page.getByRole("button", { name: "跳过，直接写", exact: true }).count() === 1);
  check("角度已经想过：直接停在选角度", await page.getByRole("region", { name: "选角度" }).count() === 1);
  await flow.locator(".topic-flow__trail button").first().click();
  await flow.getByRole("region", { name: "读懂" }).waitFor();
  check("写过的笔记按 Markdown 读，不露出 > 记号", (await flow.locator(".tf-quote").innerText()).includes("焦虑感并非") && !(await flow.innerText()).includes("> 焦虑"));
  check("一屏只有一个主按钮", await flow.locator(".btn-primary").count() === 1);
  await flow.getByRole("button", { name: "看看可以从哪几个角度写" }).click();

  // 角度：推荐标记 + 默认选中推荐的；键盘能换选中项。
  const options = flow.getByRole("radio");
  await options.first().waitFor();
  check("推荐的角度有标记和理由", await flow.locator(".tf-rec").count() === 1 && (await flow.locator(".tf-why").innerText()).includes("笔记"));
  check("默认选中推荐的角度", await options.nth(0).getAttribute("aria-checked") === "true");
  await options.nth(1).focus(); await page.keyboard.press("Enter");
  check("键盘能换选中的角度", await options.nth(1).getAttribute("aria-checked") === "true");
  await page.screenshot({ path: screenshots.desktop, fullPage: true });
  await flow.getByRole("button", { name: "用这个角度", exact: true }).click();

  // 补齐：两项「只能你来」各自展开自己的表单；「这条不写了」划掉那一项。
  await flow.getByRole("region", { name: "补齐" }).waitFor();
  await flow.getByRole("button", { name: "记下我的实测" }).first().click();
  check("记下实测只展开这一项的表单", await flow.locator(".experience-note").count() === 1);
  await flow.getByRole("button", { name: "取消", exact: true }).click();
  const findGap = flow.locator(".tf-gap").filter({ hasText: "一份讲写作结构的资料" });
  await findGap.getByRole("button", { name: "这条不写了" }).click();
  await findGap.locator(".tf-tag", { hasText: "不写了" }).waitFor();
  check("这条不写了被划掉", true);
  await flow.getByRole("button", { name: "搭结构", exact: true }).click();

  // 结构 → 初稿：正文里【待补】高亮；上方进度线能回到任一步。
  await flow.getByRole("region", { name: "定结构" }).waitFor();
  check("两种结构都在", await flow.locator(".tf-options--two .tf-option").count() === 2);
  await flow.getByRole("button", { name: "按这个结构写初稿" }).click();
  await page.locator(".cm-content").waitFor();
  await page.locator(".cm-gap").first().waitFor();
  check("初稿直接出现在正文里，【待补】高亮", (await page.locator(".cm-content").innerText()).includes("你一定有过这种时刻"));
  check("编辑器上方有进度线", await page.locator(".draft-trail").count() === 1);
  await page.screenshot({ path: screenshots.draft, fullPage: false });
  await page.locator(".draft-trail button").nth(1).click();
  await page.getByRole("region", { name: "选角度" }).waitFor();
  check("写完初稿还能回到选角度", true);
  await page.locator(".topic-flow__trail button", { hasText: "初稿" }).click();
  await page.locator(".cm-gap").first().click();
  await page.getByRole("region", { name: "补齐" }).waitFor();
  check("点【待补】回到补齐", true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: screenshots.mobile, fullPage: true });
  check("小屏页面没有横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  check("浏览器无页面异常", errors.length === 0);
  console.log(`截图保留至人工复核：\n${screenshots.desktop}\n${screenshots.draft}\n${screenshots.mobile}`);
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(os.tmpdir(), "xenho-topic-flow-failure.png"), fullPage: true }).catch(() => {});
    console.log("PAGE STATE", await page.locator("body").innerText().catch(() => ""));
  }
  throw error;
} finally {
  await browser?.close().catch(() => {});
  await server?.close().catch(() => {});
  await server?.xenhoClose?.().catch(() => {});
  for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  const relative = path.relative(os.tmpdir(), tempRoot);
  assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "只清理系统临时测试目录");
  await fs.rm(tempRoot, { recursive: true, force: true });
}
