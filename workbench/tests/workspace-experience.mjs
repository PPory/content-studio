import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {openWorkspace} from "../server/storage/workspace.mjs";
import {createBookRecord} from "../server/routes/books-local.mjs";
import {createUlid} from "../server/storage/ids.mjs";
import {createResearch,quickNote,getResearch,trashResearch,restoreResearch} from "../server/domain/research.mjs";
import {feedPreferences,saveFeedPreferences} from "../server/domain/intelligence-feed.mjs";
import {recordActivity,workspaceActivity,wikiConnections,researchSummary,refreshResearchSummary,workspaceAgenda,workspaceSetup,knowledgeBase,KB_SERIES,HOME_STAGE_ORDER,TOPIC_STAGE} from "../server/domain/workspace-experience.mjs";
const root=await fs.mkdtemp(path.join(os.tmpdir(),"xenho-experience-"));let w;
try {
 w=await openWorkspace({xenhoHome:path.join(root,"Xenho")});
 const note=quickNote(w,{text:"harness 疑问"});const research=createResearch(w,{question:"harness 为什么重要",notes:"我的笔记"});
 const before=getResearch(w,research.id);
 recordActivity(w,"research",research.id,{mode:"open"});
 recordActivity(w,"capture",note.id,{mode:"read",position:{progress:0.5,scrollTop:100}});
 assert.equal(workspaceActivity(w).opened[0].id,research.id);
 assert.equal(workspaceActivity(w).reading[0].position.progress,0.5);
 assert.deepEqual(getResearch(w,research.id),before,"visiting never edits content");
 for(const input of [{mode:"write"},{mode:"read",position:{body:"forbidden"}},{mode:"read",position:{progress:2}}])assert.throws(()=>recordActivity(w,"capture",note.id,input));
 assert.throws(()=>recordActivity(w,"wiki",note.id,{mode:"read"}));
 assert.throws(()=>recordActivity(w,"research",research.id,{mode:"read"}));
 assert.deepEqual(wikiConnections(w,"harness").items,[]);
 const wiki=createUlid();w.repository.createEntity({id:wiki,type:"wiki_page"});
 const stamp=new Date().toISOString();w.db.prepare("INSERT INTO wiki_pages(id,title,page_type,summary,body_markdown,schema_version,created_at,updated_at) VALUES(?,?,'concept',?,?,1,?,?)").run(wiki,"Harness 与上下文","摘要","Harness 把工具与上下文连接起来。",stamp,stamp);
 assert.equal(wikiConnections(w,"为什么 harness 很重要").items[0].id,wiki);
 assert.equal(wikiConnections(w,"不存在的西瓜知识").items.length,0);
 const chat=`chat-${createUlid()}`;w.repository.createEntity({id:chat,type:"ai_conversation"});
 let messages=[{role:"user",text:"我想理解 harness。"},{role:"assistant",text:"需要区分工具与模型。"}];
 const save=()=>w.db.prepare("UPDATE ai_conversations SET record_json=? WHERE id=?").run(JSON.stringify({messages}),chat);
 w.db.prepare("INSERT INTO ai_conversations(id,title,scope_type,scope_id,record_json) VALUES(?,'讨论','global',?,?)").run(chat,`research:${research.id}`,JSON.stringify({messages}));
 assert.equal(researchSummary(w,research.id),null);
 let calls=0;
 const env={WORKSPACE_EXPERIENCE_COMPLETE_JSON:async(_,request)=>{calls++;const source=JSON.parse(request.user).messages[0];return {model:"isolated-test",data:{text:"目前在讨论工具与模型的区别。",sources:[{id:source.id,quote:source.text}]}};}};
 const summary=await refreshResearchSummary(env,w,research.id);assert.equal(summary.stale,false);assert.equal(summary.sources[0].conversationId,chat);
 await refreshResearchSummary(env,w,research.id);assert.equal(calls,1,"fresh cached summary needs no new model call");
 assert.equal(getResearch(w,research.id).notes,"我的笔记","AI summary cannot overwrite user notes");
 messages.push({role:"user",text:"补充一个新问题"});save();assert.equal(researchSummary(w,research.id).stale,true);
 const invalid={WORKSPACE_EXPERIENCE_COMPLETE_JSON:async()=>({data:{text:"无来源",sources:[{id:"invented",quote:"伪造"}]}})};
 await assert.rejects(refreshResearchSummary(invalid,w,research.id),e=>e.status===502);
 assert.equal(researchSummary(w,research.id).text,summary.text,"invalid completion preserves prior summary");
 const stale={WORKSPACE_EXPERIENCE_COMPLETE_JSON:async(...args)=>{const result=await env.WORKSPACE_EXPERIENCE_COMPLETE_JSON(...args);messages.push({role:"user",text:"生成途中再补充"});save();return result;}};
 await assert.rejects(refreshResearchSummary(stale,w,research.id),e=>e.status===409);
 await refreshResearchSummary(env,w,research.id);
 w.db.prepare("UPDATE entities SET deleted_at=? WHERE id IN (?,?)").run(stamp,note.id,wiki);
 assert.equal(workspaceActivity(w).reading.length,0);
 assert.equal(wikiConnections(w,"harness").items.length,0);
 w.close();w=await openWorkspace({xenhoHome:path.join(root,"Xenho")});assert.equal(workspaceActivity(w).opened[0].id,research.id);assert.equal(researchSummary(w,research.id).stale,false);
 // ── 首页那一屏：状态、阶段轴、在等你决定、放久了才有时间戳 ──
 //
 // 上一版首页拿到的是 `标题 + 摘要 + 时间戳`，所以只能画出一条流水。这里断言的是
 // 它现在真的拿到了**状态**：哪一档、卡在什么上、下一步是什么。
 {
  const stampNow=new Date();
  const draft=w.domain.createProject({title:"写到一半的那一篇",audience:"个人创作者",viewpoint:"本地优先",confirmed:true,actor:"user",now:stampNow});
  const draftId=w.domain.createDraft({projectId:draft,title:"写到一半的那一篇",bodyMarkdown:"# 写到一半的那一篇\n\n这里有一些正文。",actor:"user",now:stampNow});
  w.domain.setPrimaryDraft(draft,draftId,{actor:"user",now:stampNow});

  const agenda=workspaceAgenda(w);
  assert.ok(agenda.resume,"首页第一层要有东西");
  assert.ok(HOME_STAGE_ORDER.includes(agenda.resume.stage),`resume 的阶段要在流水线上，实际 ${agenda.resume.stage}`);
  assert.equal(typeof agenda.resume.nextAction,"string");
  // ⚠️ 只发 `blockers`，**不发 `stageReason`**：那句话要么和阶段 pill 说的是同一件事
  // （「主稿已完成，可以发布」vs 待发布），要么和进展说的是同一件事（「主稿还是空的」vs
  // 「还是空的」）——同一张卡上同一个事实两遍。
  assert.ok(Array.isArray(agenda.resume.blockers),"卡在哪儿要发出来");
  assert.ok(!("stageReason" in agenda.resume),"不发和 pill 或进展重复的那句话");

  // ⚠️ **一个字正文都不发出去**：字数在服务端数完，只发那个数。
  // 卡上也不放摘要（理由见 workspaceAgenda），于是这条能直接断言而不是靠自觉。
  const payload=JSON.stringify(agenda);
  assert.ok(!payload.includes("这里有一些正文"),"agenda 不能把稿子正文一起发出去");
  assert.ok(!("masterDraft" in agenda.resume)&&!("excerpt" in agenda.resume),"agenda 不返回 masterDraft，也不放摘要");
  const draftRow=agenda.inHand.find(row=>row.id===draft);
  // 17 = `#写到一半的那一篇这里有一些正文。`（`countWords` 去空白后数字符，
  // 和合集目录、编辑器用的是同一个口径——这里不另数一遍）
  assert.equal(draftRow.progress,"17 字",`字数要数好，实际 ${draftRow?.progress}`);

  // 选题是流水线第一档，行里是它真实的计数，不是硬凑的 stage
  const topicRow=agenda.inHand.find(row=>row.kind==="research");
  assert.equal(topicRow.stage,TOPIC_STAGE);
  assert.match(topicRow.progress,/还没写成文章/);

  // 阶段轴：流水线顺序、只含有东西的那几档、计数等于真实条数
  assert.deepEqual(agenda.stages.map(s=>s.stage),HOME_STAGE_ORDER.filter(stage=>agenda.inHand.some(r=>r.stage===stage)),"阶段轴按流水线顺序，且只列非空的");
  for(const entry of agenda.stages)assert.equal(entry.count,agenda.inHand.filter(r=>r.stage===entry.stage).length);

  // 一周以内不带时间戳；把它改成 10 天前，那句「放了 N 天」才出现
  assert.equal(draftRow.staleDays,null,"刚动过的那一条不该带时间戳");
  const old=new Date(Date.now()-10*86400000).toISOString();
  // ⚠️ 时间在 `entities` 上，`drafts` 自己没有 updated_at（`projectDto` 也是 join 过去取的）。
  // 项目和主稿两条都要改——`recentWork` 取的是两者的 max。
  w.db.prepare("UPDATE entities SET updated_at=? WHERE id IN (?,?)").run(old,draft,draftId);
  assert.equal(workspaceAgenda(w).inHand.find(row=>row.id===draft).staleDays,10,"放了 10 天要报出来");

  // 「在等你决定」只列真有在等的；一个都没有时整块是空数组
  assert.ok(Array.isArray(agenda.waiting));
  assert.ok(agenda.waiting.every(entry=>entry.count>0),"不列 count 为 0 的");
  assert.ok(agenda.waiting.every(entry=>entry.view&&entry.unit&&entry.text),"每条都要有去处和措辞");
  w.db.prepare("INSERT INTO action_candidates(id,action_type,target_id,payload_json,payload_sha256,status,proposed_by,proposed_at) VALUES(?,'wiki.lint.review',?,'{}',?,'proposed','ai',?)")
    .run(createUlid(),research.id,"a".repeat(64),new Date().toISOString());
  const withQueue=workspaceAgenda(w).waiting.find(entry=>entry.key==="wiki");
  assert.equal(withQueue.count,1,"AI 提的候选要出现在「在等你决定」里");
  assert.equal(withQueue.view,"entries");
 }

 // ── 书能进「最近阅读」，而且带封面和读到第几章 ──
 //
 // ⚠️ 这一段钉的是**一个结构性的洞**：在这之前白名单里没有 `book`，所以书进不了
 // `workspace_activity`——首页那一栏只可能是 Wiki 和素材，于是永远没有封面可画。
 {
  const withCover=await createBookRecord(w,{title:"本地优先应用设计",kind:"藏书",sourceKind:"文章",
   coverAssetId:(await w.assets.importBuffer({bytes:Buffer.from("89504e470d0a1a0a","hex"),type:"image",originalName:"cover.png"})).id,
   chapters:[{title:"为什么本地优先",text:"# 为什么本地优先\n\n数据放在本机。"},{title:"同步的代价",text:"# 同步的代价\n\n冲突是产品问题。"}]});
  const plain=await createBookRecord(w,{title:"手建的空书",kind:"资料",sourceKind:"文章",chapters:[{title:"只有一章",text:"# 只有一章\n\n正文。"}]});
  const chapters=w.db.prepare("SELECT id,title,document_order AS at FROM book_documents WHERE book_id=? ORDER BY document_order").all(withCover.id);

  recordActivity(w,"book",withCover.id,{mode:"read",position:{progress:0.44,scrollTop:120,docId:chapters[1].id}});
  recordActivity(w,"book",plain.id,{mode:"read",position:{progress:0.1}});
  const reading=workspaceActivity(w).reading;
  const cover=reading.find(x=>x.id===withCover.id);
  assert.ok(cover,"书要能出现在最近阅读里");
  assert.match(cover.cover,/^asset:\/\//,"有封面的书要带 asset:// 地址");
  assert.deepEqual(cover.chapter,{at:chapters[1].at,title:"同步的代价"},"要说得出读到第几章");
  assert.deepEqual(cover.route,{view:"shelf",state:`book:${withCover.id}`},"书在书架里读，不在阅读区");

  // 没有封面不是错，走 Cover 的回落分支——所以给的是空串，不是 undefined
  assert.equal(reading.find(x=>x.id===plain.id).cover,"","没封面给空串");
  assert.equal(reading.find(x=>x.id===plain.id).chapter,null,"没记章就不报章");

  // ⚠️ 那道位置校验没有被放开：不认识的键仍然要拒
  assert.throws(()=>recordActivity(w,"book",plain.id,{mode:"read",position:{note:"随便塞"}}),/阅读位置无效/);
  assert.throws(()=>recordActivity(w,"book",plain.id,{mode:"read",position:{progress:2}}),/阅读位置无效/);
  assert.throws(()=>recordActivity(w,"book",plain.id,{mode:"read",position:{docId:"x".repeat(200)}}),/文字格式无效/);

  // 回收之后不该还挂在首页那一栏上（`domain.entity` 不挡 deleted_at，这一支自己挡）
  w.db.prepare("UPDATE entities SET deleted_at=? WHERE id=?").run(new Date().toISOString(),plain.id);
  assert.ok(!workspaceActivity(w).reading.some(x=>x.id===plain.id),"回收掉的书要从最近阅读里消失");
  w.db.prepare("UPDATE entities SET deleted_at=NULL WHERE id=?").run(plain.id);
 }

 // ── 首启那三步：完成与否只看真实数据 ──
 {
  // 这个工作区里已经有 capture 和 research 了（上面建的），关注方向还没自己设过
  assert.equal(feedPreferences(w).customized,false,"默认的三个方向不算「自己设过」");
  assert.ok(feedPreferences(w).directions.length>0,"没设过也仍然给默认方向——所以不能用「空不空」判断");
  // 上面那条 capture 已经被软删了，所以这会儿它是未完成——正好用来看它怎么翻过来
  let setup=workspaceSetup(w);
  assert.deepEqual(setup.steps.map(s=>[s.key,s.done]),[["directions",false],["capture",false],["research",true]]);
  assert.equal(setup.done,false);
  for(const step of setup.steps)assert.ok(step.title&&step.why&&step.action,`每一步都要说清是什么、为什么、点什么：${step.key}`);
  // ⚠️ 「记下第一个疑问」那一条**不跳页**（那一行输入框就在首页顶上），所以它没有 view
  assert.equal(setup.steps.find(s=>s.key==="capture").view,"");
  for(const step of setup.steps.filter(s=>s.key!=="capture"))assert.ok(step.view,`${step.key} 要有一个去处`);

  quickNote(w,{text:"存一条新的灵感，看那一步翻过来"});
  assert.equal(workspaceSetup(w).steps.find(s=>s.key==="capture").done,true,"存完之后那一条就勾上了");

  // 存过之后第一条才勾上，整块才收起来
  saveFeedPreferences(w,{directions:["本地优先应用","写作系统"]});
  setup=workspaceSetup(w);
  assert.equal(setup.steps.find(s=>s.key==="directions").done,true);
  assert.equal(setup.done,true,"三条都满足之后整块不再出现");
  assert.equal(workspaceAgenda(w).setup.done,true,"首页那一个请求里就带着它");

  // ⚠️ **删掉数据，引导要诚实地回来。** 这是「只看真实数据」的代价，也是它的价值：
  // 勾上了就一定是真配好了。
  const throwaway=createResearch(w,{question:"临时问题"});
  for(const row of w.db.prepare("SELECT r.id FROM researches r JOIN entities e ON e.id=r.id AND e.deleted_at IS NULL").all())trashResearch(w,row.id);
  assert.equal(workspaceSetup(w).steps.find(s=>s.key==="research").done,false,"选题都回收之后那一条要回到未完成");
  assert.equal(workspaceSetup(w).done,false);
  restoreResearch(w,research.id);restoreResearch(w,throwaway.id);
  assert.equal(workspaceSetup(w).done,true,"拿回来之后又完成了");
 }

 // ── 「本月产出」：真实发布记录，没有就整块不画 ──
 {
  // ⚠️ 判据改了：`output` 总是给对象，**`any` 才说「有没有发过」**。
  // 因为 KPI 那一排是一个形状，四张卡缺一张会让下沿参差；而「本月 0 · 上月 0」
  // 是带参照的 0。要不要画**独立那一块**的调用方看 `any`。
  {
   const before=workspaceAgenda(w).output;
   assert.equal(before.any,false,"一篇都没发过时 any 为 false");
   assert.deepEqual([before.thisMonth,before.lastMonth,before.total],[0,0,0],"而三个数照样给出来");
  }

  // 发布记录的外键要一份真实的稿 + 修订版本（`publication_records` 两条 FK 都是 RESTRICT）
  const pubProject=w.domain.createProject({title:"发过的那一篇",audience:"读者",viewpoint:"观点",confirmed:true,actor:"user",now:new Date()});
  const pubDraftId=w.domain.createDraft({projectId:pubProject,title:"发过的那一篇",bodyMarkdown:"正文。",actor:"user",now:new Date()});
  const pubRevisionId=w.domain.saveRevision(pubDraftId,{title:"发过的那一篇",bodyMarkdown:"正文。",now:new Date()});
  // ⚠️ `publication_revision_guard` 那个触发器要求发布记录的 content_sha256
  // **和那一版修订的完全一致**，不能随手编一个——发出去的内容必须可追溯到具体哪一版。
  const pubHash=w.db.prepare("SELECT content_sha256 AS h FROM revisions WHERE id=?").get(pubRevisionId).h;
  const mk=(publishedAt)=>{
   const id=createUlid();
   w.repository.createEntity({id,type:"publication"});
   // 直接插行：这一段只数数，不走发布流程（那条路要 revision、幂等键和平台校验）
   w.db.prepare(`INSERT INTO publication_records(id,draft_id,revision_id,content_sha256,platform,title,published_url,published_at,idempotency_key)
     VALUES(?,?,?,?,'公众号','一篇','https://example.com/x',?,?)`)
     .run(id,pubDraftId,pubRevisionId,pubHash,publishedAt,`key-${id}`);
   return id;
  };
  const thisM=new Date();thisM.setUTCDate(1);
  const lastM=new Date();lastM.setUTCDate(1);lastM.setUTCMonth(lastM.getUTCMonth()-1);
  const iso=(d)=>d.toISOString().slice(0,10);
  mk(`${iso(thisM)}T09:00:00.000Z`);
  mk(`${iso(thisM)}T10:00:00.000Z`);
  mk(iso(lastM));                    // ⚠️ 只有日期、没有时间：`strftime` 解析不了这种，`substr` 能
  const output=workspaceAgenda(w).output;
  assert.equal(output.thisMonth,2,`本月应该是 2，实际 ${output?.thisMonth}`);
  assert.equal(output.lastMonth,1,`上月应该是 1（那条只有日期没有时间，正是不能用 strftime 的原因）`);
  assert.equal(output.total,3);
  assert.equal(output.any,true,"发过之后 any 为 true");
  assert.equal(output.pendingReview,workspaceAgenda(w).stages.find(s=>s.stage==="待复盘")?.count||0,"待复盘不另算一遍，用阶段计数");

  // 软删一条就不该再数
  w.db.prepare("UPDATE entities SET deleted_at=? WHERE entity_type='publication' AND id=(SELECT id FROM publication_records WHERE substr(published_at,1,7)=? LIMIT 1)")
   .run(new Date().toISOString(),iso(thisM).slice(0,7));
  assert.equal(workspaceAgenda(w).output.thisMonth,1,"回收掉的发布记录不再计入");
 }

 // ── 知识库那张卡 + 那张周柱图 ──
 //
 // ⚠️ 画的是知识库增长而不是发布趋势：实测这个库只有 1 条发布记录，
 // 12 个月的发布柱图就是一根孤柱加 11 个空格。
 {
  const kb=knowledgeBase(w);
  const real=(t)=>w.db.prepare(`SELECT COUNT(*) n FROM ${t} x JOIN entities e ON e.id=x.id AND e.deleted_at IS NULL`).get().n;
  assert.equal(kb.wiki,real("wiki_pages"));
  assert.equal(kb.books,real("books"));
  assert.equal(kb.materials,real("materials"));
  assert.deepEqual(kb.series,[...KB_SERIES],"三段的名字由后端定，前端不自己写一份");

  // 12 周、按周、末项是本周
  assert.equal(kb.weeks.length,12);
  const monday=new Date();monday.setHours(0,0,0,0);monday.setDate(monday.getDate()-((monday.getDay()+6)%7));
  assert.equal(kb.weeks.at(-1).key,monday.toISOString().slice(0,10),"末项是本周的周一");
  for(const wk of kb.weeks){
   assert.deepEqual(Object.keys(wk.byPlatform),[...KB_SERIES],"每一周都给齐三段（缺键会让某一段静默消失）");
   assert.equal(wk.total,KB_SERIES.reduce((n,k)=>n+wk.byPlatform[k],0),"总数等于三段之和");
  }

  // 本周新增 / 周边界：自己造一条，别去动夹具里那些日期不确定的行
  const base=knowledgeBase(w).weekAdded;
  const fresh=await createBookRecord(w,{title:"这周刚导入的一本",kind:"资料",sourceKind:"文章",
   chapters:[{title:"章",text:"# 章\n\n这周刚导入的正文。"}]});
  assert.equal(knowledgeBase(w).weekAdded,base+1,"这周新导入一本，本周新增 +1");
  const lastWeekBars=knowledgeBase(w).weeks.at(-2).total;
  const lastWeekBooks=knowledgeBase(w).weeks.at(-2).byPlatform["书"];
  const moved=new Date(monday);moved.setDate(moved.getDate()-3);
  w.db.prepare("UPDATE entities SET created_at=? WHERE id=?").run(moved.toISOString(),fresh.id);
  const after=knowledgeBase(w);
  assert.equal(after.weekAdded,base,"挪到上周之后，本周新增回到原值");
  assert.equal(after.weeks.at(-2).total,lastWeekBars+1,"而上一周那根柱子多了一条");
  assert.equal(after.weeks.at(-2).byPlatform["书"],lastWeekBooks+1,"它落在「书」那一段");

  assert.ok(workspaceAgenda(w).kb,"首页那一个请求里带着它");
 }

 console.log("workspace experience: true activity, validated positions, real wiki matching, persisted AI summary, quote provenance, stale guard and cache passed");
}finally{w?.close();await fs.rm(root,{recursive:true,force:true});}
