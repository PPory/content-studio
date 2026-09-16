import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { createServer } from "vite";
const ROOT = path.resolve(import.meta.dirname, "..");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "xenho-intake-ui-"));
const shots = process.env.XENHO_SHOTS_DIR || temporary;
const vars = { XENHO_HOME: path.join(temporary, "workspace"), WB_KEEP_ALIVE: "1", HTTP_PROXY: "http://127.0.0.1:9", HTTPS_PROXY: "http://127.0.0.1:9", NO_PROXY: "127.0.0.1,localhost", AGENT_LLM_BASE_URL: "http://127.0.0.1:9/v1", AGENT_INGEST_BASE_URL: "http://127.0.0.1:9/v1" };
const old = Object.fromEntries(Object.keys(vars).map(k => [k, process.env[k]])); Object.assign(process.env, vars);
const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve("playwright", { paths: [ROOT, "C:/Users/Lenovo", path.join(process.env.APPDATA || "", "npm/node_modules")] }));
let server, browser, page, base;
const narrative = "我花了三个月开发自己的写作工作台，开始时最难的是把零散想法变成真正可用的流程。";
const check = (name, value = true) => { assert(value, name); console.log(` ✓ ${name}`); };
async function request(route, body, method = "POST") {
 const response = await fetch(base + route, body === undefined ? {} : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
 const result = await response.json(); assert(response.ok && result.ok, JSON.stringify(result)); return result;
}
async function screenshot(name) { await page.screenshot({ path: path.join(shots, name + ".png"), fullPage: true }); }
try {
 await fs.mkdir(shots, { recursive: true });
 server = await createServer({ root: ROOT, configFile: path.join(ROOT, "vite.config.mjs"), server: { host: "127.0.0.1", port: 0, open: false }, logLevel: "error" });
 await server.listen(); base = `http://127.0.0.1:${server.httpServer.address().port}`;
 await request("/api/workspace/status");
 const asset = (await request("/api/workspace/personal-assets", { kind:"current", title:"目前的创作方向", body:"目前主要整理写作资料。", usage:"ask", confirmed:true })).item;
 await request("/api/workspace/personal-assets", { kind:"identity", title:"独立内容创作者", body:"我是一名独立内容创作者。", usage:"private", confirmed:true });
 browser = await chromium.launch(); page = await browser.newPage({ viewport: { width:1538, height:970 } });
 const errors = []; page.on("pageerror", e => errors.push(e.message));
 await page.goto(base + "/#/personal-assets"); await page.locator(".asset-row").first().waitFor();
 check("overview从已保存信息计数", await page.locator(".asset-overview__summary > strong").innerText() === "2");
 await page.getByPlaceholder("搜索个人资产").fill("独立"); check("统一搜索过滤", await page.locator(".asset-row").count() === 1);
 await page.getByPlaceholder("搜索个人资产").fill("");
 await page.getByRole("button", { name: /当前状况.*目前的创作方向/ }).click();
 await page.getByRole("dialog", {name:"个人资产详情"}).locator(":scope > .asset-detail__body").waitFor();
 await page.getByRole("button", {name:"关闭个人资产详情"}).click();
 await screenshot("personal-assets-overview-light");
 await page.emulateMedia({colorScheme:"dark"});
 await screenshot("personal-assets-overview-dark");
 await page.emulateMedia({colorScheme:"light"});
 const destination = "https://model.example.test/v1";
 await page.route("**/api/workspace/personal-assets/intake", route => route.fulfill({json:{ok:true,destination,model:"test-model",local:false,configured:true}}));
 let previewCalls=0, confirmPayload;
 await page.route("**/api/workspace/personal-assets/intake/preview", route => {
   previewCalls++; const sent=route.request().postDataJSON(); check("发送预览带确认地址与自述", sent.confirmed && sent.destination===destination && sent.text===narrative);
   return route.fulfill({json:{ok:true,previewId:"ui-preview-only",destination,candidates:[{id:"candidate-1",kind:"current",title:"开发自己的写作工作台",body:narrative,eventDate:"",usage:"ask",evidenceQuote:narrative,duplicates:[asset]}]}});
 });
 await page.route("**/api/workspace/personal-assets/intake/confirm", route => { confirmPayload=route.request().postDataJSON(); return route.fulfill({json:{ok:true,items:[asset]}}); });
 await page.getByRole("button", {name:"整理一段自述"}).click();
 const modal=page.getByRole("dialog",{name:"从自述整理个人资产"});
 await modal.getByLabel("关于我的自述").fill(narrative);
 check("未确认发送前按钮禁用",await modal.getByRole("button",{name:"确认发送并整理"}).isDisabled());
 check("输入不会触发模型", previewCalls===0);
 await modal.getByText(destination,{exact:true}).waitFor();
 await screenshot("personal-intake-consent-light");
 await modal.getByRole("checkbox").check(); await modal.getByRole("button",{name:"确认发送并整理"}).click();
 await modal.getByLabel("标题",{exact:true}).waitFor();
 await modal.getByLabel("保留这条信息").uncheck(); check("没有选中候选不能确认保存", await modal.getByRole("button",{name:"确认保存 0 条"}).isDisabled());
 await modal.getByLabel("保留这条信息").check();
 await modal.getByLabel("保存方式").selectOption(asset.id);
 await modal.getByText("原内容 · 第 1 版").waitFor(); await modal.getByText(asset.body,{exact:true}).waitFor();
 await modal.getByLabel("标题",{exact:true}).fill("更新后的创作方向");
 check("编辑候选焦点保持", await modal.getByLabel("标题",{exact:true}).evaluate(el=>el===document.activeElement));
 await screenshot("personal-intake-preview-light");
 await page.emulateMedia({colorScheme:"dark"}); await screenshot("personal-intake-preview-dark");
 await page.setViewportSize({width:390,height:844}); await page.emulateMedia({reducedMotion:"reduce"});
 await screenshot("personal-intake-preview-mobile-dark");
 check("小屏无横向溢出",await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.emulateMedia({colorScheme:"light"}); await screenshot("personal-intake-preview-mobile-light");
 await modal.getByRole("button",{name:"确认保存 1 条"}).click(); await modal.waitFor({state:"hidden"});
 check("确认payload携带更新目标与版本",confirmPayload.selections[0].action==="update" && confirmPayload.selections[0].assetId===asset.id && confirmPayload.selections[0].expectedVersion===asset.version);
 check("mock确认不声称真实写入",(await request("/api/workspace/personal-assets")).items.length===2);
 await screenshot("personal-assets-overview-mobile");
 check("无浏览器运行时错误", errors.length===0);
 console.log("LIMITATION: intake preview/confirm are UI mocks; CRUD, overview and detail use isolated real API. Domain tests verify actual intake persistence.");
 console.log("SCREENSHOTS",shots);
} catch (e) { if(page) await screenshot("personal-intake-failure").catch(()=>{}); throw e; }
finally {
 await browser?.close().catch(() => {}); await server?.close().catch(() => {}); await server?.xenhoClose?.().catch(() => {});
 for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
 const relative = path.relative(os.tmpdir(), temporary); assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative)); await fs.rm(temporary, { recursive: true, force: true });
}
