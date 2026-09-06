import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";
import { createUlid } from "../server/storage/ids.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-product-ui-"));
const screenshots = { desktop: path.join(os.tmpdir(), "xenho-notebook-desktop.png"), mobile: path.join(os.tmpdir(), "xenho-notebook-mobile.png") };
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
async function request(route, body, method = "POST") {
  const response = await fetch(`${base}${route}`, body === undefined ? {} : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  assert(response.ok && result.ok, JSON.stringify(result));
  return result;
}
async function until(read, predicate, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const value = await read();
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`等待超时：${label}`);
}
try {
  server = await createServer({ root: ROOT, configFile: path.join(ROOT, "vite.config.mjs"), server: { host: "127.0.0.1", port: 5210, strictPort: true, open: false }, logLevel: "error" });
  await server.listen(); base = "http://127.0.0.1:5210";
  const shotDir = path.join(ROOT, "output", "playwright"); await fs.mkdir(shotDir, { recursive: true });
  browser = await playwright().chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  const w=await server.xenhoWorkspace;
  const wikiId=createUlid(),stamp=new Date().toISOString();
  w.repository.createEntity({id:wikiId,type:"wiki_page"});
  w.db.prepare("INSERT INTO wiki_pages(id,title,page_type,summary,body_markdown,schema_version,created_at,updated_at) VALUES(?,?,'concept',?,?,1,?,?)").run(wikiId,"Harness 与系统思维","真实测试 Wiki",Array.from({length:35},(_,i)=>`## 段落 ${i}\n\nHarness 的分析需要回到具体任务，核对模型与使用条件。`).join("\n\n"),stamp,stamp);
  await page.goto(`${base}/#/today`);
  await page.getByRole("heading",{name:"从一个问题，开始今天",exact:true}).waitFor();
  check("首页概览与最近阅读存在",await page.getByRole("heading",{name:"最近阅读",exact:true}).count()===1);
  await page.getByLabel("记下灵感",{exact:true}).fill("为什么 harness 的上下文很重要？");
  await page.getByRole("button",{name:"留下这条想法",exact:true}).click();
  await page.getByRole("button",{name:/发现 .* 条 Wiki 关联/}).click();
  await page.getByRole("button",{name:"带着这个角度讨论",exact:true}).click();
  await page.waitForURL(/#\/research\//);
  const researchId=page.url().split("#/research/")[1],rp=`/api/workspace/researches/${researchId}`;
  await page.getByLabel("我的笔记",{exact:true}).waitFor();
  check("选题默认笔记与讨论并排",await page.locator(".topic-chat textarea").isVisible());
  check("不嵌套通用聊天首页",!await page.getByPlaceholder("问任何问题，或直接输入本地项目路径").count());
  await page.getByLabel("我的笔记",{exact:true}).fill("先区分任务条件和模型能力，保留待核对的问题。");
  await until(()=>request(rp),r=>r.research.notes.includes("待核对"),"笔记自动保存");
  const notes=(await request(rp)).research.notes;
  await page.route(`**/api/workspace/researches/${researchId}`,async route=>{if(route.request().method()==="PUT")await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({ok:false,error:"模拟保存失败"})});else await route.continue();});
  await page.getByLabel("我的笔记",{exact:true}).fill(notes+" 失败后仍保留。");
  await page.getByText("模拟保存失败",{exact:false}).first().waitFor();
  check("失败时输入保留",(await page.getByLabel("我的笔记",{exact:true}).inputValue()).includes("失败后"));
  await page.unroute(`**/api/workspace/researches/${researchId}`);
  await page.getByRole("button",{name:"保存笔记",exact:true}).click();
  await until(()=>request(rp),r=>r.research.notes.includes("失败后"),"重试保存");
  const chats=[];
  for(const title of ["主要讨论","另一个角度"]){const cid=`chat-${createUlid()}`;w.repository.createEntity({id:cid,type:"ai_conversation"});w.db.prepare("INSERT INTO ai_conversations(id,title,scope_type,scope_id,record_json) VALUES(?,?,'global',?,?)").run(cid,title,`research:${researchId}`,JSON.stringify({id:cid,title,messages:[{id:`${cid}-u`,role:"user",text:"我想理解这个问题",createdAt:stamp},{id:`${cid}-a`,role:"assistant",text:`${title}的实际回答，仍需核实。`,createdAt:stamp}],actions:[],attachments:[]}));chats.push(cid);}
  await page.reload();await page.getByLabel("我的笔记",{exact:true}).waitFor();
  await page.getByLabel("当前讨论",{exact:true}).selectOption(chats[0]);
  await page.getByText("主要讨论的实际回答，仍需核实。",{exact:false}).first().waitFor();
  await page.getByRole("button",{name:"摘进我的笔记",exact:true}).first().click();
  await page.getByRole("button",{name:"不采用",exact:true}).click();
  check("不采用不写入笔记",!(await request(rp)).research.notes.includes("实际回答"));
  await page.getByLabel("当前讨论",{exact:true}).selectOption(chats[1]);
  await page.getByText("另一个角度的实际回答，仍需核实。",{exact:false}).first().waitFor();
  await page.getByRole("button",{name:"开始写文章",exact:true}).click();
  await page.getByRole("button",{name:"创建文章",exact:true}).click();
  await page.getByLabel("文章标题",{exact:true}).waitFor();
  const research=(await request(rp)).research,projectId=research.projects[0].id;
  check("写作仍留在同一选题",page.url().includes(researchId));
  check("讨论持续保留",await page.getByText("另一个角度的实际回答，仍需核实。",{exact:false}).first().isVisible());
  check("正文初始为空",(await request(`/api/workspace/projects/${projectId}`)).project.masterDraft.body==="");
  const editor=page.locator(".topic-article .cm-content");await editor.fill("这是一段自己写的内容。");
  await until(()=>request(`/api/workspace/projects/${projectId}`),r=>r.project.masterDraft.body.includes("自己写"),"正文保存");
  await page.getByRole("button",{name:"根据笔记起初稿",exact:true}).click();
  check("方向从真实笔记预填",(await page.getByLabel("核心观点",{exact:true}).inputValue()).includes("待核对"));
  await page.getByRole("button",{name:"暂不采用",exact:true}).click();
  const download=page.waitForEvent("download");await page.getByRole("button",{name:"导出文章",exact:true}).click();check("可导出文章",(await download).suggestedFilename().endsWith(".md"));
  await page.screenshot({path:path.join(shotDir,"interview-writing-desktop.png"),fullPage:true});
  await page.getByRole("button",{name:"思考",exact:true}).click();
  await page.screenshot({path:path.join(shotDir,"interview-topic-desktop.png"),fullPage:true});
  await page.locator(".nav").getByRole("button",{name:"首页",exact:true}).click();
  await page.getByRole("heading",{name:"最近打开",exact:true}).waitFor();
  await page.screenshot({path:path.join(shotDir,"interview-home-desktop.png"),fullPage:true});
  await page.locator(".overview-panel").filter({has:page.getByRole("heading",{name:"文章",exact:true})}).locator(".overview-items button").first().click();
  await page.getByLabel("文章标题",{exact:true}).waitFor();
  check("首页文章回到同一选题的写作位置",page.url().includes(researchId));
  check("重新打开文章仍保留讨论",await page.getByText("另一个角度的实际回答，仍需核实。",{exact:false}).first().isVisible());
  await page.goto(`${base}/#/library/wiki:${wikiId}`);
  await page.locator(".reader-document").waitFor();
  check("阅读默认专注原文",!await page.locator(".reader-companion").count());
  await page.locator(".reader-document").evaluate(el=>{el.scrollTop=400;el.dispatchEvent(new Event("scroll"));});
  await until(()=>request("/api/workspace/activity"),r=>r.reading.some(x=>x.id===wikiId&&x.position.scrollTop>200),"阅读位置保存");
  await page.getByRole("button",{name:"与 AI 讨论",exact:true}).click();
  await page.locator(".reader-companion textarea").waitFor();
  await page.getByRole("button",{name:"收起 AI",exact:true}).click();
  await page.reload();await page.locator(".reader-document").waitFor();
  await until(()=>page.locator(".reader-document").evaluate(el=>el.scrollTop),v=>v>200,"阅读位置恢复");
  await page.screenshot({path:path.join(shotDir,"interview-reading-desktop.png"),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  check("阅读手机无横向溢出",await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.goto(`${base}/#/research/${researchId}`);await page.getByRole("button",{name:"思考",exact:true}).click();await page.getByLabel("我的笔记",{exact:true}).waitFor();
  await page.getByRole("button",{name:"AI 讨论",exact:true}).click();await page.locator(".topic-chat textarea").waitFor();
  check("手机可切换对话",await page.locator(".topic-chat textarea").isVisible());
  check("选题手机无横向溢出",await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(shotDir,"interview-topic-mobile.png"),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(`${base}/#/today`);
  await page.getByLabel("记下灵感",{exact:true}).fill("切换页面之前，也要留下这个想法");
  await page.getByRole("button",{name:"全部选题 →",exact:true}).click();
  await page.getByRole("heading",{name:"这条想法还没有保存"}).waitFor();
  await page.getByRole("button",{name:"继续记录",exact:true}).click();
  check("取消离开保留想法",await page.getByLabel("记下灵感",{exact:true}).inputValue()==="切换页面之前，也要留下这个想法");
  await page.getByRole("button",{name:"全部选题 →",exact:true}).click();
  await page.getByRole("button",{name:"保存并离开",exact:true}).click();
  await page.getByRole("heading",{name:"选题空间",exact:true}).waitFor();
  check("保存后才离开首页",true);
  check("浏览器无页面错误",errors.length===0);
  console.log("访谈版实际产品流程验收通过");
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(os.tmpdir(), "xenho-product-failure.png"), fullPage: true }).catch(() => {});
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
