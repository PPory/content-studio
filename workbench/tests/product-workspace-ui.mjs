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
  w.db.prepare("INSERT INTO wiki_pages(id,title,page_type,summary,body_markdown,schema_version,created_at,updated_at) VALUES(?,?,'concept',?,?,1,?,?)").run(wikiId,"Harness 与系统思维","真实测试 Wiki",("# Harness 与系统思维\n\n" + Array.from({length:35},(_,i)=>`## 段落 ${i}\n\nHarness 的分析需要回到具体任务，核对模型与使用条件。`).join("\n\n")),stamp,stamp);
  // ── 首启：全新工作区上首页是一张三步开局卡，不是一屏空白 ──
  await page.goto(`${base}/#/today`);
  await page.getByRole("heading",{name:"先把工作台跑起来",exact:true}).waitFor();
  check("首页不再介绍自己",await page.getByRole("heading",{name:"从一个问题，开始今天"}).count()===0);
  const firstRun=await page.evaluate(()=>{
    const card=document.querySelector(".agenda-setup");
    return {
      count:card?.querySelector(".agenda-setup__count")?.textContent.trim()||"",
      steps:[...card.querySelectorAll("li")].map(li=>({
        title:li.querySelector("b")?.textContent.trim(),
        why:li.querySelector("small")?.textContent.trim(),
        action:li.querySelector(".btn")?.textContent.trim()||"",
        done:li.hasAttribute("data-done"),
      })),
      // ⚠️ 首启时这些都该不在：「接着写」没有对象可写，空的区块也只是再说一遍同一件事
      resume:document.querySelectorAll(".agenda-resume").length,
      hand:document.querySelectorAll(".agenda-hand").length,
      rail:document.querySelectorAll(".overview-rail").length,
      zero:(document.querySelector(".view-head__count")?.textContent||"").includes("0 件"),
    };
  });
  check("全新工作区的首页画三步开局卡",firstRun.count==="0 / 3"&&firstRun.steps.length===3,JSON.stringify(firstRun));
  check("每一步都说清是什么、为什么、点什么",firstRun.steps.every(s=>s.title&&s.why&&s.action&&!s.done),JSON.stringify(firstRun.steps));
  check("首启不画「接着写」那张卡",firstRun.resume===0);
  check("首启不摆空的区块",firstRun.hand===0&&firstRun.rail===0,JSON.stringify(firstRun));
  check("首启页头不报「0 件在手」",!firstRun.zero);

  // 「记下第一个疑问」不跳页，只把焦点放到那一行输入框上
  await page.getByRole("button",{name:"写下一条",exact:true}).click();
  check("「写下一条」不跳页，焦点落在那一行输入框上",
    page.url().includes("#/today")&&await page.evaluate(()=>document.activeElement?.id==="home-thought"));

  check("首页概览与最近阅读存在",true);
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
  await page.getByRole("tab",{name:"思考",exact:true}).click();
  const chatBefore=await page.locator(".topic-chat textarea").boundingBox();
  await page.getByRole("tab",{name:/^资料 \d/}).click();
  const chatAfter=await page.locator(".topic-chat textarea").boundingBox();
  check("资料切换不挤走讨论输入框",Math.abs(chatBefore.y-chatAfter.y)<2);
  await page.getByRole("tab",{name:"思考",exact:true}).click();
  check("资料切换后笔记仍在",(await page.getByLabel("我的笔记",{exact:true}).inputValue()).includes("待核对"));
  await page.setViewportSize({width:1505,height:1045});
  await page.screenshot({path:path.join(shotDir,"interview-topic-desktop.png"),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.locator(".nav").getByRole("button",{name:"首页",exact:true}).click();
  await page.getByRole("heading",{name:"在手上",exact:true}).waitFor();
  await page.screenshot({path:path.join(shotDir,"interview-home-desktop.png"),fullPage:true});
  // 选题和文章现在在同一条列表里，所以按标题挑那一篇——顺便证明它真的在这条列表上
  // 行以阶段 pill 开头（「写作中」），按它挑那一篇文章——顺带证明那一列真的在渲染
  await page.locator(".agenda-rows:not(.agenda-rows--rail) .row").filter({has:page.locator(".pill",{hasText:"写作中"})}).first().locator(".agenda-row__open").click();
  await page.getByLabel("文章标题",{exact:true}).waitFor();
  check("首页文章回到同一选题的写作位置",page.url().includes(researchId));
  check("重新打开文章仍保留讨论",await page.getByText("另一个角度的实际回答，仍需核实。",{exact:false}).first().isVisible());
  await page.goto(`${base}/#/library/wiki:${wikiId}`);
  await page.locator(".reader-document").waitFor();
  check("阅读标题只显示一次",await page.locator(".reader-document h1").count()===1);
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
  await page.goto(`${base}/#/research/${researchId}`);await page.getByRole("tab",{name:"思考",exact:true}).click();await page.getByLabel("我的笔记",{exact:true}).waitFor();
  await page.getByRole("button",{name:"AI 讨论",exact:true}).click();await page.locator(".topic-chat textarea").waitFor();
  check("手机可切换对话",await page.locator(".topic-chat textarea").isVisible());
  const composerBox=await page.locator(".topic-chat textarea").boundingBox();
  check("手机讨论输入框在屏幕内",composerBox.y+composerBox.height<=844);
  check("选题手机无横向溢出",await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(shotDir,"interview-topic-mobile.png"),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(`${base}/#/today`);
  await page.getByLabel("记下灵感",{exact:true}).fill("切换页面之前，也要留下这个想法");
  await page.locator(".nav").getByRole("button",{name:"选题空间",exact:true}).click();
  await page.getByRole("heading",{name:"这条想法还没有保存"}).waitFor();
  await page.getByRole("button",{name:"继续记录",exact:true}).click();
  check("取消离开保留想法",await page.getByLabel("记下灵感",{exact:true}).inputValue()==="切换页面之前，也要留下这个想法");
  await page.locator(".nav").getByRole("button",{name:"选题空间",exact:true}).click();
  await page.getByRole("button",{name:"保存并离开",exact:true}).click();
  await page.getByRole("heading",{name:"选题空间",exact:true}).waitFor();
  check("保存后才离开首页",true);

  // ── 首页：三层、层次来自状态、放久了才有时间戳 ──
  // 造一条「AI 提了、等你审阅」的候选，好让「在等你决定」那一块真的有东西可点。
  w.db.prepare("INSERT INTO action_candidates(id,action_type,target_id,payload_json,payload_sha256,status,proposed_by,proposed_at) VALUES(?,'wiki.lint.review',?,'{}',?,'proposed','ai',?)")
    .run(createUlid(),wikiId,"c".repeat(64),new Date().toISOString());
  await page.goto(`${base}/#/today`);
  await page.getByRole("heading",{name:"在手上",exact:true}).waitFor();

  const HAND=".agenda-rows:not(.agenda-rows--rail)";
  const homeRows=()=>page.evaluate(sel=>[...document.querySelectorAll(`${sel} .row .agenda-row__open`)].map(b=>b.textContent.trim()),HAND);
  const shown=await homeRows();

  // 1. 同一个东西不再被列两遍（上一版量到 15 行 / 8 个东西）
  check("首页不再把同一个东西列两遍",shown.length>0&&new Set(shown).size===shown.length,JSON.stringify(shown));
  const everyRow=await page.evaluate(()=>[...document.querySelectorAll(".agenda-rows .row .agenda-row__open")].map(b=>b.textContent.trim()));
  check("两块列表也不互相重复",new Set(everyRow).size===everyRow.length,JSON.stringify(everyRow));

  // 2. **层次来自状态**：每一行以阶段 pill 开头，而不是以相对时间戳结尾
  const rowShape=await page.evaluate(sel=>{
    const rows=[...document.querySelectorAll(`${sel} .row`)];
    return {
      withPill:rows.filter(r=>r.querySelector(".pill")).length,
      total:rows.length,
      stamped:rows.filter(r=>r.querySelector(".agenda-row__stale")).length,
      withProgress:rows.filter(r=>r.querySelector(".agenda-row__progress")?.textContent.trim()).length,
    };
  },HAND);
  check("每一行都以阶段开头",rowShape.withPill===rowShape.total,JSON.stringify(rowShape));
  check("每一行中间那一列是进展，不是摘要",rowShape.withProgress===rowShape.total);
  // ⚠️ 这一条是「看着像流水」的直接反面：一周以内的行**一个时间戳都不该有**
  check("刚动过的那些行不带时间戳",rowShape.stamped===0,`带时间戳的行数 ${rowShape.stamped}`);

  // 3. 第一层那张卡说的是状态和下一步的动词，不是时间
  const card=await page.evaluate(()=>{
    const el=document.querySelector(".agenda-resume");
    if(!el)return null;
    return {
      stage:el.querySelector(".pill")?.textContent.trim()||"",
      action:el.querySelector("footer .btn")?.textContent.trim()||"",
      top:Math.round(el.getBoundingClientRect().top),
      hasStamp:Boolean(el.querySelector(".agenda-resume__stale")),
      text:el.innerText,
    };
  });
  check("第一层那张卡带阶段和一个下一步动词",Boolean(card&&card.stage&&card.action),JSON.stringify(card));
  check("那张卡落在首屏上半屏",card.top<420,`卡 y=${card.top}`);
  check("那张卡上没有相对时间戳",!card.hasStamp&&!/前$/m.test(card.text.trim()));
  // 空壳不该被选成「接着写」——你没法接着一件还不存在的事
  check("那张卡不是一个还没起名字的空壳",!(card.text.includes("还没起名字")&&card.text.includes("还是空的")),card.text);

  // 4. 阶段轴：流水线顺序、计数等于真实条数、点一档只剩那一档
  const chips=await page.evaluate(()=>[...document.querySelectorAll(".agenda-hand .chip")].map(c=>c.textContent.trim()));
  check("阶段轴按流水线顺序排（选题在最前）",chips.length>1&&chips[0].startsWith("全部")&&chips[1].startsWith("选题"),JSON.stringify(chips));
  const pickedStage=chips[1].replace(/\s+\d+$/,"");
  const pickedCount=Number(chips[1].match(/(\d+)$/)[1]);
  await page.getByRole("button",{name:chips[1],exact:true}).click();
  const filtered=await page.evaluate(sel=>[...document.querySelectorAll(`${sel} .row`)].map(r=>r.querySelector(".pill")?.textContent.trim()),HAND);
  check("点一档只剩那一档，条数和芯片上的数一致",filtered.length===pickedCount&&filtered.every(v=>v===pickedStage),JSON.stringify({pickedStage,pickedCount,filtered}));
  await page.getByRole("button",{name:chips[0],exact:true}).click();

  // 5. 「在等你决定」：只列真有在等的，每条都点得过去
  const waiting=await page.evaluate(()=>[...document.querySelectorAll(".agenda-waiting li")].map(l=>l.innerText.replace(/\n/g," ").trim()));
  check("在等你决定只列真有在等的",waiting.every(line=>!/^0/.test(line)),JSON.stringify(waiting));
  check("「在等你决定」把 AI 提的候选抬上来了",waiting.some(line=>line.includes("待审阅")),JSON.stringify(waiting));
  if(waiting.length){
    await page.locator(".agenda-waiting li > button").first().click();
    await page.waitForFunction(()=>!location.hash.startsWith("#/today"));
    check("点「在等你决定」的一条会离开首页，落在对应那一页",!page.url().includes("#/today"),page.url());
    await page.goto(`${base}/#/today`);
    await page.getByRole("heading",{name:"在手上",exact:true}).waitFor();
  }

  // 6. 置顶：那一条排到最前，刷新之后还在最前——也就是「卡挑错了」有解
  const lastTitle=(await homeRows()).at(-1);
  const rowOf=(title)=>page.locator(`${HAND} .row`).filter({has:page.locator(".agenda-row__open",{hasText:title})}).first();
  await rowOf(lastTitle).hover();
  await rowOf(lastTitle).getByRole("button",{name:/^置顶/}).click();
  await page.waitForFunction(([sel,t])=>document.querySelector(`${sel} .row .agenda-row__open`)?.textContent.includes(t),[HAND,lastTitle]);
  await page.reload();
  await page.getByRole("heading",{name:"在手上",exact:true}).waitFor();
  check("置顶把那一条排到最前，而且刷新后仍在最前",(await homeRows())[0]===lastTitle);
  check("置顶之后第一层那张卡就是它",(await page.locator(".agenda-resume h2").innerText()).trim()===lastTitle);

  // 7. 从首页收起：列表里没了，撤销拿回来
  await rowOf(lastTitle).hover();
  await rowOf(lastTitle).getByRole("button",{name:/从首页收起$/}).click();
  await page.getByText("不在首页出现了",{exact:false}).waitFor();
  check("收起之后这条不在首页列表里",!(await homeRows()).includes(lastTitle));
  await page.getByRole("button",{name:"撤销",exact:true}).click();
  await page.waitForFunction(([sel,t])=>[...document.querySelectorAll(`${sel} .row .agenda-row__open`)].some(b=>b.textContent.includes(t)),[HAND,lastTitle]);
  check("撤销把它拿回首页",(await homeRows()).includes(lastTitle));

  // 8. 这一屏的数据一次给完，而且不含正文
  const agenda=await request("/api/workspace/agenda");
  check("首页一个请求拿到阶段、在等你决定和阶段轴",Array.isArray(agenda.inHand)&&Array.isArray(agenda.stages)&&Array.isArray(agenda.waiting)&&Boolean(agenda.resume));
  check("agenda 不把正文发出来",!JSON.stringify(agenda).includes("这是一段自己写的内容"));

  check("首页手机无横向溢出",await page.setViewportSize({width:390,height:844}).then(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)));
  await page.screenshot({path:path.join(shotDir,"interview-home-mobile.png"),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  for (let i = 1; i <= 12; i++) await request("/api/workspace/researches", { question: `卡片选题 ${i}：如何把 AI 用在学习和表达中？`, notes: `第 ${i} 个问题的笔记，保留真实实践和待核对的判断。` });
  await page.goto(`${base}/#/research`); await page.reload();
  await page.locator(".research-card").first().waitFor();
  check("选题总览每页最多十二张卡片", await page.locator(".research-card").count() === 12);
  // 卡片 / 列表双视图，而且这个选择要记住（localStorage，每页一份）。
  await page.getByRole("button", { name: "列表视图", exact: true }).click();
  check("能切成列表，条目一条不少", await page.locator(".research-rows .row").count() === 12
    && await page.locator(".research-card").count() === 0);
  await page.reload();
  await page.locator(".research-rows .row").first().waitFor();
  check("刷新之后还是列表——视图偏好被记住了", await page.locator(".research-card").count() === 0);
  await page.locator(".research-rows .row-title").first().click();
  await page.getByRole("tab", { name: "思考", exact: true }).waitFor();
  check("列表里点标题照样打开选题", page.url().includes("#/research/"));
  await page.goBack();
  await page.getByRole("button", { name: "卡片视图", exact: true }).click();
  check("切回卡片", await page.locator(".research-card").count() === 12);
  const firstTitle = await page.locator(".research-card h2").first().innerText();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  check("翻页切换选题", await page.locator(".research-card h2").first().innerText() !== firstTitle);
  await page.getByRole("textbox", { name: "搜索选题", exact: true }).fill("第 1 个问题的笔记");
  check("可用笔记搜索全部选题", await page.locator(".research-card").count() === 1 && await page.getByRole("button", { name: "上一页", exact: true }).isDisabled());
  await page.locator(".research-card__open").focus(); await page.keyboard.press("Enter");
  await page.getByLabel("我的笔记", { exact: true }).waitFor();
  check("键盘打开卡片回到选题工作区", (await page.getByLabel("我的笔记", { exact: true }).inputValue()).includes("第 1 个问题"));
  // 详情页也有同一颗，删完把回执交接回列表页（外壳页头在这一页是藏起来的，
  // 所以它落在页面自己那条动作栏上）。
  await page.goto(`${base}/#/research/${researchId}`);
  await page.getByRole("tab", { name: "思考", exact: true }).waitFor();
  {
    const detailTitle = await page.getByLabel("选题问题", { exact: true }).inputValue();
    await page.getByRole("button", { name: `移入回收站：${detailTitle}` }).click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "移入回收站", exact: true }).click();
    await page.locator(".research-card").first().waitFor();
    check("详情页删掉之后回到列表，并在那一页给出回执", (await page.getByText(`「${detailTitle}」已移入回收站`, { exact: true }).count()) === 1);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.getByRole("tab", { name: "思考", exact: true }).waitFor();
    check("撤销把选题拿回来并回到它自己那一页", page.url().includes(researchId));
  }

  // 选题也能移入回收站，而且能一步撤销回来（软删除，资料和讨论都留着）。
  await page.goto(`${base}/#/research`);
  {
    // ⚠️ 别数卡片：这一页每页固定六张，删掉一条会有第七条补上来，数字不会变。
    const titles = () => page.locator(".research-card h2").allInnerTexts();
    const card = page.locator(".research-card").first();
    const title = await card.locator("h2").innerText();
    await card.getByRole("button", { name: `移入回收站：${title}` }).click();
    await page.waitForTimeout(400);
    await card.getByRole("button", { name: "移入回收站", exact: true }).click();
    await page.getByText(`「${title}」已移入回收站`, { exact: true }).waitFor();
    check("选题可以移入回收站", (await titles()).includes(title) === false);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.locator(".research-card h2").filter({ hasText: title }).first().waitFor();
    check("撤销把选题一步拿回来", (await titles()).includes(title));
  }
  await page.goto(`${base}/#/research`);
  await page.getByRole("textbox", { name: "搜索选题", exact: true }).fill("完全没有的选题");
  await page.getByRole("heading", { name: "没有找到匹配的选题", exact: true }).waitFor();
  await page.locator(".research-overview-empty").getByRole("button", { name: "清空搜索", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: path.join(shotDir, "research-cards-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(shotDir, "research-cards-mobile.png"), fullPage: true });
  check("手机卡片无横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole("button", { name: "＋ 新建选题", exact: true }).click();
  check("空问题不能创建选题", await page.getByRole("button", { name: "开始展开", exact: true }).isDisabled());
  await page.getByLabel("你想弄明白什么", { exact: true }).fill("卡片视图中新建的真实测试选题");
  await page.getByRole("button", { name: "开始展开", exact: true }).click();
  await page.getByLabel("我的笔记", { exact: true }).waitFor();
  check("展开新建后仍可创建并进入选题", (await request("/api/workspace/researches")).researches.some(r => r.question === "卡片视图中新建的真实测试选题"));

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
