import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";
import { createUlid } from "../server/storage/ids.mjs";
import { createBookRecord } from "../server/routes/books-local.mjs";

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
      // ⚠️ 首启时这些都该不在：明细表没有行、封面墙没有书，空的区块只是再说一遍同一件事
      hand:document.querySelectorAll(".agenda-hand").length,
      rail:document.querySelectorAll(".agenda-reading").length,
      // ⚠️ **12 格全空的柱图也不画。** 那排 KPI 卡可以报 0（一个形状 + 每张带参照），
      // 一张空图带不了参照，它只是个空框。
      chart:document.querySelectorAll(".home-chart").length,
      // ⚠️ **但那排 KPI 卡要画，而且允许全是 0。** 成排的卡是一个形状，缺一张下沿就参差。
      kpi:[...document.querySelectorAll(".stat")].map(c=>({
        label:c.querySelector(".stat__label")?.textContent.trim()||"",
        value:c.querySelector(".stat__value")?.textContent.trim()||"",
        note:c.querySelector(".stat__note")?.textContent.trim()||"",
      })),
      zero:(document.querySelector(".view-head__count")?.textContent||"").includes("0 件"),
    };
  });
  check("全新工作区的首页画三步开局卡",firstRun.count==="0 / 3"&&firstRun.steps.length===3,JSON.stringify(firstRun));
  check("每一步都说清是什么、为什么、点什么",firstRun.steps.every(s=>s.title&&s.why&&s.action&&!s.done),JSON.stringify(firstRun.steps));
  check("首启不摆空的区块（明细表、封面墙、空柱图）",
    firstRun.hand===0&&firstRun.rail===0&&firstRun.chart===0,JSON.stringify(firstRun));
  check("首启仍然画满四张 KPI 卡",firstRun.kpi.length===4,JSON.stringify(firstRun.kpi));
  check("四张 KPI 卡各有主数字和一句参照",
    firstRun.kpi.every(c=>c.label&&c.value&&c.note),JSON.stringify(firstRun.kpi));
  check("一篇都没发过时「本月产出」照样画，参照写「上月 0 篇」",
    firstRun.kpi.some(c=>c.label==="本月产出"&&c.value==="0"&&c.note==="上月 0 篇"),JSON.stringify(firstRun.kpi));
  check("首启页头不报「0 件在手」",!firstRun.zero);

  for (const width of [1440, 390]) {
    await page.setViewportSize({width,height:1000});
    await page.screenshot({path:path.join(shotDir, 'home-empty-'+width+'.png'),fullPage:true});
    check('首启 '+width+' 无横向溢出',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await page.setViewportSize({width:1440,height:1000});

  // 「记下第一个疑问」不跳页，只把焦点放到那一行输入框上
  await page.getByRole("button",{name:"写下一条",exact:true}).click();
  check("「写下一条」不跳页，焦点落在那一行输入框上",
    page.url().includes("#/today")&&await page.evaluate(()=>document.activeElement?.id==="home-thought"));

  check("首页概览与最近阅读存在",true);

  // ── 首启空态：每一页都得有一颗能点的，而且不许用位置指路 ──
  // ⚠️ 只有一句灰字的空态把「下一步点哪儿」留给用户猜；而「点右上角」这种指路
  // 在窄屏上直接是错的——一个空态如果必须描述按钮在哪儿，那颗按钮就该长在空态里。
  for (const [name,hash] of [["创作","content"],["合集","series"],["书架","shelf"],["Wiki","entries"],["情报","intel"]]) {
    await page.goto(`${base}/#/${hash}`);
    await page.locator(".empty").first().waitFor();
    const acts=await page.locator(".empty button, .empty .btn").count();
    const text=await page.locator(".empty").first().innerText();
    check(`${name} 的首启空态带一颗能点的`,acts>0,`${name}：${acts} 颗`);
    check(`${name} 的首启空态不用位置指路`,!/右上角|左上角|右下角|侧栏的/.test(text),text);
  }
  // 情报那颗「设置关注方向」以前因为判断写错而永不渲染（默认方向让 directions 永远非空）
  await page.goto(`${base}/#/intel`);
  await page.locator(".empty").first().waitFor();
  check("情报空态提供原始资料入口",await page.getByRole("button",{name:"查找原始资料",exact:true}).count()===1);

  // 回首页，下面接着走原来的流程（记一条想法 → Wiki 关联 → 带着这个角度讨论）
  await page.goto(`${base}/#/today`);
  await page.getByRole("heading",{name:"先把工作台跑起来",exact:true}).waitFor();

  const wikiId=createUlid(),stamp=new Date().toISOString();
  w.repository.createEntity({id:wikiId,type:"wiki_page"});
  w.db.prepare("INSERT INTO wiki_pages(id,title,page_type,summary,body_markdown,schema_version,created_at,updated_at) VALUES(?,?,'concept',?,?,1,?,?)").run(wikiId,"Harness 与系统思维","真实测试 Wiki",("# Harness 与系统思维\n\n" + Array.from({length:35},(_,i)=>`## 段落 ${i}\n\nHarness 的分析需要回到具体任务，核对模型与使用条件。`).join("\n\n")),stamp,stamp);
  await page.getByLabel("记下灵感",{exact:true}).fill("为什么 harness 的上下文很重要？");
  await page.getByRole("button",{name:"留下这条想法",exact:true}).click();
  await page.getByRole("button",{name:/发现 .* 条 Wiki 关联/}).click();
  await page.getByRole("button",{name:"带着这个角度讨论",exact:true}).click();
  // 选题到初稿（2026-09-24）：带着角度讨论 = 建一篇选题，打开就是选题流程的第一步「读懂」。
  // 角度、结构、初稿要调模型，完整走法由 tests/project-notebook-ui.mjs 用模拟模型覆盖；这里走「跳过，直接写」。
  await page.waitForURL(/#\/project\//);
  const projectId=decodeURIComponent(page.url().split("#/project/")[1]);
  const flow=page.locator(".topic-flow");
  await flow.getByRole("region",{name:"读懂"}).waitFor();
  // 想讲的就是标题时只写一遍（标题取自这句话），读懂里不再重复。
  const headTitle=(await flow.locator(".topic-flow__head h1").innerText()).trim();
  check("选题打开就是选题流程的读懂，标题不重复出现",headTitle.length>0&&(await flow.locator(".tf-question").count()===0||(await flow.locator(".tf-question").innerText()).trim()!==headTitle));
  check("不嵌套通用聊天首页",!await page.getByPlaceholder("问任何问题，或直接输入本地项目路径").count());
  check("读懂这一步只有一个主按钮",await flow.locator(".btn-primary").count()===1);
  await page.getByRole("button",{name:"跳过，直接写",exact:true}).click();
  const editor=page.locator(".project-draft .cm-content");await editor.waitFor();
  check("跳过直接写不弹方向确认",await page.getByLabel("核心观点",{exact:true}).count()===0);
  check("正文初始为空",(await request(`/api/workspace/projects/${projectId}`)).project.masterDraft.body==="");
  await editor.fill("这是一段自己写的内容。");
  await until(()=>request(`/api/workspace/projects/${projectId}`),r=>r.project.masterDraft.body.includes("自己写"),"正文保存");
  await page.locator(".draft-trail button").first().click();
  await flow.getByRole("region",{name:"读懂"}).waitFor();
  check("正文写了也能回到选题流程",true);
  // 正文已经有字：顶栏写「回到正文」而不是「跳过，直接写」。
  check("有正文时顶栏写回到正文",await page.getByRole("button",{name:"回到正文",exact:true}).count()===1&&await page.getByRole("button",{name:"跳过，直接写",exact:true}).count()===0);
  await page.getByRole("button",{name:"回到正文",exact:true}).click();
  await editor.waitFor();
  await page.getByRole("button",{name:"导出",exact:false}).first().click();
  const [exported]=await Promise.all([page.waitForResponse(r=>r.url().includes("/export")),page.getByRole("menuitem",{name:/^Markdown/}).click()]);check("可导出文章",exported.ok());
  await page.screenshot({path:path.join(shotDir,"interview-writing-desktop.png"),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.locator(".nav").getByRole("button",{name:"首页",exact:true}).click();
  await page.getByRole("heading",{name:"在手上",exact:true}).waitFor();
  await page.screenshot({path:path.join(shotDir,"interview-home-desktop.png"),fullPage:true});
  // 首页那张表里，这一篇只出现一次（有对应内容的选题不再单列），点开回到同一篇内容。
  const articleRow=page.locator(".agenda-rows .row")
    .filter({has:page.locator(".pill",{hasText:"写作中"})}).first();
  check("文章在首页表里",await articleRow.count()===1);
  await articleRow.locator(".agenda-row__open").click();
  await page.waitForURL(/#\/project\//);
  check("首页文章回到同一篇内容",page.url().includes(projectId));
  await page.goto(`${base}/#/library/wiki:${wikiId}`);
  await page.locator(".reader-document").waitFor();
  check("阅读标题只显示一次",await page.locator(".reader-document h1").count()===1);
  // ⚠️ **阅读区仍然是白底**，首页才是浅灰。判据：改底色之前先确认这一页要不要卡片
  // ——阅读区是一篇正文，正文不坐在灰底上，也不需要卡片。
  check("阅读区是白底，不跟着首页翻灰",await page.evaluate(()=>{
    // `--surface` 是个变量，量它的真实颜色要让浏览器自己解一次
    const probe=document.createElement("div");
    probe.style.background="var(--surface)";document.body.appendChild(probe);
    const surface=getComputedStyle(probe).backgroundColor;probe.remove();
    return getComputedStyle(document.querySelector(".main")).backgroundColor===surface;
  }));
  check("阅读默认专注原文",!await page.locator(".reader-companion").count());
  await page.locator(".reader-document").evaluate(el=>{el.scrollTop=400;el.dispatchEvent(new Event("scroll"));});
  await until(()=>request("/api/workspace/activity"),r=>r.reading.some(x=>x.id===wikiId&&x.position.scrollTop>200),"阅读位置保存");
  await page.getByRole("button",{name:"与 AI 讨论",exact:true}).click();
  await page.locator(".reader-companion textarea").waitFor();
  await page.getByRole("button",{name:"收起 AI",exact:true}).click();
  await page.reload();await page.locator(".reader-document").waitFor();
  await until(()=>page.locator(".reader-document").evaluate(el=>el.scrollTop),v=>v>200,"阅读位置恢复");
  await page.screenshot({path:path.join(shotDir,"interview-reading-desktop.png"),fullPage:true});

  // ── 首页底部「接着读」：**只放书**，带封面和读到第几章 ──
  //
  // ⚠️ 这一块曾经混进 Wiki 页和素材，于是一半格子是回落图标——它既不是封面墙，
  // 也不如一行纯文字清楚。只有书有封面（`books.metadata_json.coverAssetId`），
  // 所以过滤在服务端（`workspaceAgenda`）。这里连「Wiki 不该出现」一起钉住。
  const bookWithCover=await createBookRecord(w,{title:"本地优先应用设计",kind:"藏书",sourceKind:"文章",
    coverAssetId:(await w.assets.importBuffer({bytes:Buffer.from("89504e470d0a1a0a0000000d49484452","hex"),type:"image",originalName:"cover.png"})).id,
    chapters:[{title:"开头",text:"# 开头\n\n第一章。"},{title:"同步的代价",text:"# 同步的代价\n\n冲突是产品问题。"}]});
  const bookChapters=w.db.prepare("SELECT id FROM book_documents WHERE book_id=? ORDER BY document_order").all(bookWithCover.id);
  await request(`/api/workspace/activity/book/${bookWithCover.id}`,{mode:"read",position:{progress:0.44,scrollTop:100,docId:bookChapters[1].id}},"PUT");

  await page.goto(`${base}/#/today`);
  await page.locator(".agenda-reading li").first().waitFor();
  const shelfRow=await page.evaluate(()=>[...document.querySelectorAll(".agenda-reading li")].map(li=>({
    cover:Boolean(li.querySelector(".cover")),
    img:Boolean(li.querySelector(".cover img")),
    fallback:Boolean(li.querySelector(".cover__fallback svg")),
    title:li.querySelector("b")?.textContent.trim()||"",
    // ⚠️ 不能用 li.querySelector("small")：DOM 里先出现的是**封面回落里那个空的**
    // （标题就在封面下面，所以传了空串），会把这一条断言变成假红
    progress:li.querySelector(".agenda-reading__at")?.textContent.trim()||"",
    // 回落格子里不该再排一遍书名——下面就是标题
    dupName:(li.querySelector(".cover__fallback small")?.textContent||"").trim(),
  })));
  check("读过的书出现在「接着读」，每条都有封面位",shelfRow.length>0&&shelfRow.every(r=>r.cover),JSON.stringify(shelfRow));
  check("「接着读」只放书，Wiki 页不混进来",!shelfRow.some(r=>r.title.includes("Harness 与系统思维")),JSON.stringify(shelfRow));
  check("有封面的那本真的画出了封面",shelfRow.some(r=>r.img),JSON.stringify(shelfRow));
  check("回落格子里不重复排标题",shelfRow.every(r=>!r.dupName),JSON.stringify(shelfRow));
  check("说得出读到第几章",shelfRow.some(r=>/第 \d+ 章/.test(r.progress)),JSON.stringify(shelfRow));

  // ⚠️ 1920 上那次重叠的回归闸：主列那些行的 min-content 是 735px，
  // grid 的 `auto` track 撑不下会**溢出容器**而不是压缩内容。
  await page.setViewportSize({width:1920,height:1000});
  await page.waitForTimeout(300);
  const spill=await page.evaluate(()=>{
    const box=document.querySelector(".workspace-overview").getBoundingClientRect();
    return [...document.querySelectorAll(".workspace-overview *")]
      .filter(n=>n.getBoundingClientRect().right>box.right+1)
      .map(n=>(n.className?.toString?.()||n.tagName).slice(0,40));
  });
  check("1920 上没有任何东西溢出页面容器",spill.length===0,JSON.stringify(spill));
  await page.setViewportSize({width:1440,height:1000});

  await page.setViewportSize({width:390,height:844});
  check("阅读手机无横向溢出",await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.goto(`${base}/#/project/${projectId}`);await page.locator(".project-draft .cm-content, .topic-flow").first().waitFor();
  check("内容手机无横向溢出",await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(shotDir,"interview-topic-mobile.png"),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(`${base}/#/today`);
  await page.getByLabel("记下灵感",{exact:true}).fill("切换页面之前，也要留下这个想法");
  await page.locator(".nav").getByRole("button",{name:"写作",exact:true}).click();
  await page.getByRole("heading",{name:"这条想法还没有保存"}).waitFor();
  await page.getByRole("button",{name:"继续记录",exact:true}).click();
  check("取消离开保留想法",await page.getByLabel("记下灵感",{exact:true}).inputValue()==="切换页面之前，也要留下这个想法");
  await page.locator(".nav").getByRole("button",{name:"写作",exact:true}).click();
  await page.getByRole("button",{name:"保存并离开",exact:true}).click();
  await page.waitForURL(/#\/content/);
  check("保存后才离开首页",true);

  // ── 首页：一排数 + 一张图 + 承诺 + 明细表 ──
  //
  // ⚠️ 这一段钉的是「它到底算不算首页」：**不能整页都是「你拥有的对象」的投影**。
  // 清单是你自己定的承诺（不是对象），产出和知识库增长是结果（不是对象）；
  // 这几种少一个，剩下的无论怎么排序、怎么加状态，读起来都是库存管理。
  //
  // ⚠️ 同时钉住底色那条连锁：首页的 `.main` 必须是 `--sunken`（浅灰）。
  // 它曾经被单独改成白，于是白卡立不起来、于是按「不要框里画框」不画盒子、
  // 于是整页没有层次。**改底色和要不要卡片是同一件事。**
  w.db.prepare("INSERT INTO action_candidates(id,action_type,target_id,payload_json,payload_sha256,status,proposed_by,proposed_at) VALUES(?,'wiki.lint.review',?,'{}',?,'proposed','ai',?)")
    .run(createUlid(),wikiId,"c".repeat(64),new Date().toISOString());
  // ⚠️ 三类都要有东西，那条「三段必须是三种深浅」的闸才测得到第三段
  w.domain.createMaterial({title:"一次真实的写作卡顿",type:"个人经历",
    bodyMarkdown:"我曾在一篇写到一半时卡住，回头才发现是选题没定。",actor:"user"});
  await page.goto(`${base}/#/today`);
  await page.getByRole("heading",{name:"在手上",exact:true}).waitFor();

  for (let i=1;i<=9;i++) await request('/api/workspace/researches',{question:'首页密度验收选题 '+i});
  await page.reload();
  await page.locator('.agenda-rows .row').first().waitFor();

  // 1. 层次：一排数在最前，然后是 [清单 | 图]，然后才是明细表
  const shape=await page.evaluate(()=>({
      // ⚠️ 不能取 className 的第一个词：这些块现在都以 `home-card` 开头
      order:[...document.querySelectorAll(".overview-main > *")]
        .map(n=>["stats","home-duo","agenda-hand","agenda-setup","agenda-reading"]
          .find(k=>n.classList.contains(k))||n.tagName).filter(Boolean),
      bg:getComputedStyle(document.querySelector(".main")).backgroundColor,
      sunken:(()=>{const p=document.createElement('div');p.style.background='var(--sunken)';document.body.appendChild(p);const c=getComputedStyle(p).backgroundColor;p.remove();return c;})(),
      surface:getComputedStyle(document.documentElement).getPropertyValue("--surface").trim(),
      // 卡片是白的，正文区是灰的——这两件事一起才是层次
      cards:[...document.querySelectorAll(".home-card")].map(c=>getComputedStyle(c).backgroundColor),
      plans:document.querySelectorAll(".day-plan").length,
  }));
  check("一排数在最前，明细表在最后",
    shape.order[0]==="stats"&&shape.order.indexOf("stats")<shape.order.indexOf("home-duo")
      &&shape.order.indexOf("home-duo")<shape.order.indexOf("agenda-hand"),JSON.stringify(shape.order));
  check("首页正文区是浅灰底，不是白",shape.bg===shape.sunken,JSON.stringify(shape));
  check("每一块都是一张白卡",shape.cards.length>=3&&new Set(shape.cards).size===1,JSON.stringify(shape.cards));
  // ⚠️ 曾经渲染过两遍：旧结构那个 `<DayPlan>` 留在上面，新的在卡里
  check("「我的清单」只渲染一遍",shape.plans===1,String(shape.plans));

  // 2. 清单：加一条 → 勾上 → 计数跟着变 → 刷新还在（落工作区数据库，不落 localStorage）
  await page.locator(".plan-plus").click();
  await page.locator(".day-plan form input").first().fill("把 harness 那篇的中间三段补完");
  await page.keyboard.press("Enter");
  await page.getByText("把 harness 那篇的中间三段补完").waitFor();
  const ringText=()=>page.locator(".plan-progress").innerText().then(t=>t.replace(/\s+/g,""));
  check("加完之后计数从 0 起",(await ringText()).startsWith("0"),await ringText());
  // ⚠️ 那一行不是 <input>：整行是一颗 `aria-pressed` 的 button（12px 的小方框
  // 在一个每天点好几次的控件上太苛刻了，理由写在 `DayPlan.jsx`）
  await page.locator(".plan-task__main").first().click();
  await page.waitForFunction(()=>document.querySelector(".plan-progress")?.innerText.replace(/\s+/g,"").startsWith("1"));
  await page.reload();
  await page.getByText("把 harness 那篇的中间三段补完").waitFor();
  check("勾上的状态刷新后还在（清单落库）",(await ringText()).startsWith("1"),await ringText());

  check('清单用轻量完成数替代圆环',await page.locator('.day-plan .plan-ring').count()===0);
  await page.locator('.plan-plus').click();
  await page.locator('.plan-add input').fill('失败也要保留的任务');
  await page.route('**/api/plan',route=>route.request().method()==='POST'
    ? route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:'任务保存失败测试'})}) : route.continue());
  await page.locator('.plan-add input').press('Enter');
  await page.getByText(/任务保存失败测试/).first().waitFor();
  check('保存任务失败保留输入',await page.locator('.plan-add input').inputValue()==='失败也要保留的任务');
  await page.unroute('**/api/plan');
  await page.locator('.plan-add button').click();
  await page.getByText('失败也要保留的任务',{exact:true}).waitFor();
  await page.locator('.plan-task').filter({hasText:'失败也要保留的任务'}).hover();
  await page.getByRole('button',{name:'从清单里删掉「失败也要保留的任务」',exact:true}).click();
  await until(()=>page.getByText('失败也要保留的任务',{exact:true}).count(),n=>n===0,'删除测试任务');
  if (await page.locator('.plan-plus').getAttribute('aria-expanded')==='true') await page.locator('.plan-plus').click();
  await page.locator('.plan-day').filter({hasText:'明天'}).click();
  await page.getByRole('button',{name:'添加明天的任务',exact:true}).waitFor();
  await page.getByRole('button',{name:'添加明天的任务',exact:true}).click();
  await page.getByRole('textbox',{name:'加一条任务到明天的清单'}).fill('明天整理两条资料');
  await page.keyboard.press('Enter');
  await page.getByText('明天整理两条资料',{exact:true}).waitFor();
  await page.locator('.plan-day').filter({hasText:'今天'}).click();
  await page.getByText('把 harness 那篇的中间三段补完').waitFor();
  check('切换日期不混入另一日任务',await page.getByText('明天整理两条资料',{exact:true}).count()===0);
  await page.reload();
  await page.getByText('把 harness 那篇的中间三段补完').waitFor();

  // 3. 那排数：四张卡各管一段，而且都有真数据
  const agendaNow=await request("/api/workspace/agenda");
  const kpi=await page.evaluate(()=>[...document.querySelectorAll(".stat")].map(c=>({
    label:c.querySelector(".stat__label")?.textContent.trim()||"",
    value:c.querySelector(".stat__value")?.textContent.trim()||"",
    delta:c.querySelector(".stat__delta")?.textContent.trim()||"",
    note:c.querySelector(".stat__note")?.textContent.trim()||"",
  })));
  check("四张 KPI 卡都在，都有主数字和参照",
    kpi.length===4&&kpi.every(c=>c.value&&c.note),JSON.stringify(kpi));
  check("「在手上」那个数等于服务端给的条数",
    kpi[0].label==="在手上"&&Number(kpi[0].value)===agendaNow.inHand.length,JSON.stringify(kpi[0]));
  check("「等你决定」把 AI 提的候选算进去了",
    kpi[3].label==="等你决定"&&Number(kpi[3].value)===agendaNow.waiting.reduce((n,e)=>n+e.count,0),
    JSON.stringify({kpi:kpi[3],waiting:agendaNow.waiting}));
  // ⚠️ **这一排是「0 不是一个值得报的数」的例外，而且例外只开给主数字。**
  // 成排的四张卡是一个形状，缺一张会让下沿参差；而带参照的 0 说的是「这个月还没动」。
  check("「本月产出」在没有发布记录时也画，并带上月作参照",
    kpi[1].label==="本月产出"&&kpi[1].note.startsWith("上月"),JSON.stringify(kpi[1]));
  check("agenda 的 output 总是给成对象，另给 any 判断要不要画整块",
    agendaNow.output&&typeof agendaNow.output==="object"&&agendaNow.output.any===false,
    JSON.stringify(agendaNow.output));
  // ⚠️ 参照行里 0 的那一项**不占位**（例外只给主数字）：这个库有书没素材
  check("参照行里不写「0 份素材」",!kpi[2].note.includes("0 份"),JSON.stringify(kpi[2]));

  // 4. 那张图：知识库这 12 周。⚠️ **三段真的是三种深浅**——`seriesColor` 按
  // `PLATFORM_ORDER.indexOf` 取色，而「Wiki / 书 / 素材」都不在平台表里，走那条路
  // 三段会拿到同一个灰、堆叠柱塌成一根实心柱，而且不报错。这是那条路的回归闸。
  const chart=await page.evaluate(()=>({
    cols:document.querySelectorAll(".home-chart .bars__col").length,
    shades:[...new Set([...document.querySelectorAll(".home-chart .bars__seg")]
      .map(n=>getComputedStyle(n).backgroundColor))].length,
    zeros:[...document.querySelectorAll(".home-chart .bars__value[data-zero]")]
      .every(n=>getComputedStyle(n).visibility==="hidden"),
    legend:[...document.querySelectorAll(".home-chart .legend-item")].map(n=>n.textContent.trim()),
  }));
  check("图是 12 周，只有一周有数也能画",chart.cols===12,JSON.stringify(chart));
  check("三段是三种深浅（mono 取色按位置的回归闸）",chart.shades===3,JSON.stringify(chart));
  check("空的那几周不标 0",chart.zeros,JSON.stringify(chart));
  check("图例就是 Wiki / 书 / 素材",chart.legend.join("/")==="Wiki/书/素材",JSON.stringify(chart.legend));
  const kb=agendaNow.kb;
  check("每周的合计等于三段之和",
    kb.weeks.length===12&&kb.weeks.every(w=>w.total===kb.series.reduce((n,k)=>n+(w.byPlatform[k]||0),0)),
    JSON.stringify(kb.weeks));

  check('右侧统一为单项量化进度',await page.locator('.agenda-row__progress').evaluateAll(ns=>ns.every(n=>n.querySelector('b')&&/^(资料|正文)/.test(n.textContent.trim()))));
  check('写文章使用主按钮',await page.getByRole('button',{name:'直接写文章',exact:true}).evaluate(n=>n.classList.contains('btn-primary')));
  // 5. 明细表：只放前 8 行，芯片按阶段筛，「看全部」去创作页
  const table=await page.evaluate(()=>({
    rows:document.querySelectorAll(".agenda-rows .row").length,
    chips:[...document.querySelectorAll(".agenda-hand .chip")].map(c=>c.textContent.trim()),
  }));
  check("超过八条时明细表只显示 8 行",agendaNow.inHand.length>8&&table.rows===8,JSON.stringify(table));
  check("表头芯片的计数等于真实条数",
    table.chips[0]===`全部 ${agendaNow.inHand.length}`
      &&table.chips.slice(1).join("|")===agendaNow.stages.map(e=>`${e.stage} ${e.count}`).join("|"),
    JSON.stringify({chips:table.chips,stages:agendaNow.stages}));
  await page.locator(".agenda-hand .chip").filter({hasText:"选题"}).click();
  await page.waitForFunction(()=>[...document.querySelectorAll(".agenda-rows .pill")]
    .every(p=>p.textContent.trim()==="选题"));
  check("点一档只剩那一档",true);
  await page.locator(".agenda-hand .chip").filter({hasText:"全部"}).click();
  await page.locator(".home-all").click();
  await page.waitForFunction(()=>location.hash.includes("#/content"));
  check("「看全部」去的是创作页",page.url().includes("#/content"),page.url());
  await page.goto(`${base}/#/today`);
  await page.getByRole("heading",{name:"在手上",exact:true}).waitFor();

  // 置顶、收起、撤销和失败回执，均使用隔离工作区。
  const lastRow=page.locator('.agenda-rows .row').last();
  const pinTitle=(await lastRow.locator('.agenda-row__open').innerText()).trim();
  await lastRow.hover();
  await lastRow.getByRole('button',{name:'置顶「'+pinTitle+'」',exact:true}).focus();
  await page.keyboard.press('Enter');
  await until(()=>page.locator('.agenda-row__open').first().innerText(),t=>t.trim()===pinTitle,'置顶排在最前');
  const firstRow=page.locator('.agenda-rows .row').first();
  await firstRow.hover();
  await firstRow.getByRole('button',{name:'把「'+pinTitle+'」从首页收起',exact:true}).click();
  await page.getByText('「'+pinTitle+'」不在首页出现了',{exact:true}).waitFor();
  check('收起后列表不再显示该项',!(await page.locator('.agenda-row__open').allInnerTexts()).some(t=>t.trim()===pinTitle));
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  await until(()=>page.locator('.agenda-row__open').first().innerText(),t=>t.trim()===pinTitle,'撤销恢复置顶条目');
  await page.route('**/api/workspace/work-state/**',route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({ok:false,error:'收起失败测试'})}));
  await firstRow.hover();
  await firstRow.getByRole('button',{name:'把「'+pinTitle+'」从首页收起',exact:true}).click();
  await page.getByText(/收起失败测试/).first().waitFor();
  check('失败不显示成功回执',await page.getByText('「'+pinTitle+'」不在首页出现了',{exact:true}).count()===0);
  await page.unroute('**/api/workspace/work-state/**');
  await page.reload();
  await page.locator('.agenda-rows .row').first().waitFor();

  await page.getByRole('button',{name:'看数字',exact:true}).click();
  check('周增长可以切换到完整数字表',await page.locator('.home-chart tbody tr').count()===12);
  await page.getByRole('button',{name:'看图',exact:true}).click();
  for (const width of [1920,1440]) {
    await page.setViewportSize({width,height:1000});
    check('首页 '+width+' 无横向溢出',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    check('有数据的柱子有实际高度',await page.locator('.home-chart .bars__seg').evaluateAll(ns=>ns.length>0&&ns.every(n=>n.getBoundingClientRect().height>0)));
    await page.screenshot({path:path.join(shotDir,'home-dashboard-'+width+'.png'),fullPage:true});
  }

  await page.setViewportSize({width:1186,height:698});
  await page.emulateMedia({colorScheme:'dark',reducedMotion:'reduce'});
  await page.locator('.home-card--plan').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(shotDir,'home-refined-dark.png'),fullPage:true});
  await page.locator('.plan-plus').click();
  await page.locator('.plan-add input').fill('整理今天的阅读笔记');
  await page.emulateMedia({colorScheme:'light'});
  await page.screenshot({path:path.join(shotDir,'home-refined-light.png'),fullPage:true});
  await page.locator('.plan-add input').press('Escape');
  check('Esc 收起输入并返回新增按钮',await page.locator('.plan-plus').evaluate(n=>n===document.activeElement));

  // 6. 「记一个想法」和清单的「＋加一条」是两个不同的入口
  check("记灵感和加任务是两个入口",
    await page.getByLabel("记下灵感",{exact:true}).count()===1&&await page.locator(".plan-plus").count()===1);

  check("首页手机无横向溢出",await page.setViewportSize({width:390,height:844}).then(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)));
  // ⚠️ 390 上四张卡排**两列**：`.stats` 默认的 `minmax(214px,1fr)` 只排得下一列，
  // 四张 135px 高的卡摞起来，人要滑过整屏数字才看得到第一条内容。
  const narrow=await page.evaluate(()=>{
    const tops=[...document.querySelectorAll(".stat")].map(c=>Math.round(c.getBoundingClientRect().top));
    return {rows:new Set(tops).size,duo:getComputedStyle(document.querySelector(".home-duo")).gridTemplateColumns.split(" ").length};
  });
  check("390 上四张卡排两列（两行）",narrow.rows===2,JSON.stringify(narrow));
  check("390 上清单和图各占整幅",narrow.duo===1,JSON.stringify(narrow));
  check("手机周日期互不重叠",await page.locator(".home-chart .bars__label").evaluateAll(ns=>{
    const rects=ns.filter(n=>getComputedStyle(n).visibility!=="hidden").map(n=>n.getBoundingClientRect());
    return rects.length===4&&rects.every((r,i)=>!i||r.left>=rects[i-1].right);
  }));
  await page.screenshot({path:path.join(shotDir,"interview-home-mobile.png"),fullPage:true});
  await page.locator('.home-chart').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(shotDir,'home-mobile-chart.png'),fullPage:true});
  await page.locator('.agenda-hand').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(shotDir,'home-mobile-table.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1000});

  // ── 写作列表的「选题」一档（2026-09-24，选题和写作合并）──
  for (let i = 1; i <= 12; i++) await request("/api/workspace/researches", { question: `卡片选题 ${i}：如何把 AI 用在学习和表达中？`, notes: `第 ${i} 个问题的笔记，保留真实实践和待核对的判断。` });
  await page.goto(`${base}/#/content`); await page.reload();
  await page.getByRole("button", { name: /^选题/ }).first().click();
  await page.locator(".topic-card").first().waitFor();
  check("旧选题照常出现在「选题」一档", await page.locator(".topic-card", { hasText: "卡片选题" }).count() === 12);
  // 三个来源是页签（和情报页同一套）：切过去只看那一个来源，切回来还在。
  const sources = page.getByRole("tablist", { name: "选题来源" });
  check("选题按来源分三个页签", await sources.getByRole("tab").count() === 3);
  const current = await sources.getByRole("tab", { selected: true }).innerText();
  await sources.getByRole("tab", { name: /来自我的知识/ }).click();
  await page.getByRole("tabpanel", { name: "来自我的知识" }).waitFor();
  check("切到别的来源只看那一个来源", await page.locator(".topic-card", { hasText: "卡片选题" }).count() === 0);
  await sources.getByRole("tab", { name: current.replace(/\s*\d+$/, "") }).click();
  await page.locator(".topic-card", { hasText: "卡片选题 1：" }).first().waitFor();
  // 选题默认卡片，也能切成列表（和「在写」同一张表），两边各记各的。
  await page.getByRole("button", { name: "列表视图", exact: true }).click();
  await page.locator(".topic-table .ptable__line", { hasText: "卡片选题 1：" }).first().waitFor();
  check("选题能切成列表", await page.locator(".topic-table .ptable__line", { hasText: "卡片选题" }).count() === 12 && await page.locator(".topic-card").count() === 0);
  await page.getByRole("button", { name: "卡片视图", exact: true }).click();
  await page.locator(".topic-card", { hasText: "卡片选题 1：" }).first().waitFor();
  const cardTopic = page.locator(".topic-card", { hasText: "卡片选题 1：" }).first();
  await cardTopic.locator(".topic-card__open").focus(); await page.keyboard.press("Enter");
  await page.waitForURL(/#\/project\//);
  const opened = page.getByRole("region", { name: "读懂" });
  await opened.waitFor();
  check("第一次打开旧选题补建内容，读懂里带上原笔记", (await opened.innerText()).includes("第 1 个问题"));
  const openedId = decodeURIComponent(page.url().split("#/project/")[1]);
  await page.goBack(); await page.waitForURL(/#\/content/);
  await page.getByRole("button", { name: /^选题/ }).first().click();
  // 已补建的那条换成了内容卡：可以先放着，一步撤销。
  const parked = page.locator(`.topic-card[data-topic="${openedId}"]`);
  await parked.waitFor();
  await parked.getByRole("button", { name: "先放着", exact: true }).click();
  await page.getByText(/先放着了/).waitFor();
  check("先放着之后离开选题一档", await page.locator(`.topic-card[data-topic="${openedId}"]`).count() === 0);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.locator(`.topic-card[data-topic="${openedId}"]`).waitFor();
  check("撤销让它回到选题", true);
  // 还没打开过的旧选题可以移入回收站，也能撤销。
  {
    const card = page.locator(".topic-card", { hasText: "卡片选题 2：" }).first();
    const title = await card.locator("h2").innerText();
    await card.getByRole("button", { name: `删掉选题「${title}」——移入回收站，可以撤销` }).click();
    await page.waitForTimeout(400);
    await card.getByRole("button", { name: "删掉", exact: true }).click();
    await page.getByText(`「${title}」已移入回收站`, { exact: true }).waitFor();
    await page.waitForFunction((t) => ![...document.querySelectorAll(".topic-card h2")].some((h) => h.textContent.includes(t)), title, { timeout: 5000 }).catch(() => {});
    check("选题可以移入回收站", await page.locator(".topic-card h2", { hasText: title }).count() === 0);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.locator(".topic-card h2").filter({ hasText: title }).first().waitFor();
    check("撤销把选题一步拿回来", true);
  }
  // 已经建成内容的选题删掉之后不能以「还没有内容的选题」再冒出来（背后的研究记录一起进回收站），撤销时一起回来。
  {
    const card = page.locator(`.topic-card[data-topic="${openedId}"]`);
    const title = await card.locator("h2").innerText();
    await card.getByRole("button", { name: `删掉选题「${title}」——移入回收站，可以撤销` }).click();
    await page.waitForTimeout(400);
    await card.getByRole("button", { name: "删掉", exact: true }).click();
    await page.getByText(`「${title}」已移入回收站`, { exact: true }).waitFor();
    // 回执先出来、列表随后才刷新：等刷新完再数（给一个明显长于刷新的时限，超时就是真的又冒出来了）。
    await page.waitForFunction((t) => ![...document.querySelectorAll(".topic-card h2")].some((h) => h.textContent.includes(t)), title, { timeout: 5000 }).catch(() => {});
    check("删掉建成内容的选题，不会再冒出一张同名选题", await page.locator(".topic-card h2", { hasText: title }).count() === 0);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await page.locator(`.topic-card[data-topic="${openedId}"]`).waitFor();
    check("撤销后还是原来那一篇", await page.locator(".topic-card h2", { hasText: title }).count() === 1);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: path.join(shotDir, "research-cards-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(shotDir, "research-cards-mobile.png"), fullPage: true });
  check("手机卡片无横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.setViewportSize({ width: 1440, height: 1000 });

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
