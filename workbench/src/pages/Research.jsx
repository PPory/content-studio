import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { TopicArticle } from "../components/TopicArticle.jsx";
import "./topic-workspace.css";
import "./research-list.css";
import { renderMarkdown } from "../lib/markdown.js";
import { IconChevronLeft, IconFileText, IconLink, IconSearch } from "../components/icons.jsx";
import { api } from "../lib/api.js";
import { ErrorNote, Loading, RowDelete, SearchBox, Toast, ViewTabs } from "../components/ui.jsx";
import { AssistantPane } from "../components/assistant/AssistantPane.jsx";
import { LibraryBrowser } from "../components/LibraryBrowser.jsx";
import { useAssistantSummonTarget } from "../lib/assistant-summoner.js";
import { useDialog } from "../lib/use-dialog.js";
import { handOffUndo, useUndoToast } from "../lib/use-undo-toast.js";

export function Research({ researchId, onGo, onForceGo, registerNavigationGuard }) {
  return researchId ? <ResearchDetail key={researchId} id={researchId} onGo={onGo} onForceGo={onForceGo} registerNavigationGuard={registerNavigationGuard} /> : <ResearchList onGo={onGo} />;
}
function ResearchList({ onGo }) {
  const [items, setItems] = useState(null);
  const [question, setQuestion] = useState("");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [page, setPage] = useState(0);
  const [error, setError] = useState(null);
  const [createError, setCreateError] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  // 确认态让整张卡钉住，不再靠 hover 显形
  const [confirmRow, setConfirmRow] = useState("");
  const [toast, setToast] = useUndoToast();
  function openCreate() { setCreating(true); requestAnimationFrame(() => input.current?.focus()); }
  const load = useCallback(async () => {
    setError(null);
    try { const r = await api.researches(); setItems(r.researches || []); }
    catch (e) { setError(e); }
  }, []);

  /**
   * 移入回收站。**软删除**：资料引用、讨论和已带入的记录都留着，
   * 恢复回来还是原来那一条——所以回执上那颗「撤销」是真的能一步走回去。
   */
  async function trash(item) {
    const title = item.question || item.title;
    try {
      await api.trashResearch(item.id);
      setToast({
        text: `「${title}」已移入回收站`,
        detail: "资料、讨论和已写的文章都还在。",
        undo: async () => { await api.restoreResearch(item.id); setToast(null); load(); },
      });
      load();
    } catch (e) { setError(e); }
  }
  useEffect(() => { load(); }, [load]);
  async function create(e) {
    e.preventDefault(); if (!question.trim() || busy) return;
    setBusy(true); setCreateError(null);
    try { const r = await api.createResearch({ question: question.trim() }); onGo("research", r.research.id); }
    catch (e) { setCreateError(e); } finally { setBusy(false); }
  }
  const term = query.trim().toLowerCase();
  const filtered = (items || []).filter(item => !term || `${item.question || item.title} ${item.notes || item.excerpt || ""}`.toLowerCase().includes(term))
    .sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  const pages = Math.max(1, Math.ceil(filtered.length / 6));
  const currentPage = Math.min(page, pages - 1);
  return <section className="task-page research-overview">
    <header className="task-page-head"><div><h1>选题空间</h1><p>围绕一个问题，读资料、记想法、讨论和写作。</p></div><div className="research-overview-actions"><button className="btn btn-sm" onClick={() => onGo("assistant")}>以前的对话</button><button className="btn btn-primary btn-sm" aria-expanded={creating || items?.length === 0} onClick={() => creating ? setCreating(false) : openCreate()}>{creating ? "收起新建" : "＋ 新建选题"}</button></div></header>
    <form className="research-create" hidden={!creating && items?.length !== 0} onSubmit={create}><label>你想弄明白什么？<input ref={input} aria-label="你想弄明白什么" value={question} maxLength={300} onChange={(e) => setQuestion(e.target.value)} placeholder="从一个真实的疑问开始" /></label><button className="btn btn-primary" disabled={busy || !question.trim()}>{busy ? "正在创建…" : "开始展开"}</button></form>
    <ErrorNote error={createError} what="创建选题" />
    <div className="research-overview-toolbar"><h2>我的选题 <span>{items?.length ?? "—"}</span></h2><SearchBox value={query} onChange={value => { setQuery(value); setPage(0); }} placeholder="搜索选题或笔记…" ariaLabel="搜索选题" /></div>
    <ErrorNote error={error} what="读取选题" onRetry={load} />
    {items === null && !error ? <Loading rows={3} /> : null}
    {items !== null && !filtered.length ? <div className="research-overview-empty"><h3>{term ? "没有找到匹配的选题" : "从你想弄明白的问题开始"}</h3><p>{term ? "试试更短的关键词，或清空搜索查看全部选题。" : "资料、想法和讨论会留在同一个空间，需要时再写成文章。"}</p><button className="btn btn-sm" onClick={() => { setQuery(""); setPage(0); if (!term) openCreate(); }}>{term ? "清空搜索" : "写下一个问题"}</button></div> : null}
    <div className="research-card-grid">{filtered.slice(currentPage * 6, (currentPage + 1) * 6).map(item => {
      const title = item.question || item.title;
      const date = new Date(item.updatedAt);
      /* ⚠️ 整张卡不再是一颗 `<button>`：删除入口要待在卡里，而按钮里套按钮是非法 HTML。
         和 Wiki 列表行、素材列表行同一个形状。 */
      return <article key={item.id} className="research-card" data-confirm={confirmRow === item.id ? "" : undefined}>
        <button type="button" className="research-card__open" aria-label={`打开选题：${title}`} onClick={() => onGo("research", item.id)}>
          <h2>{title}</h2><p>{item.notes?.trim() || item.excerpt || "还没有留下笔记，可以先和 AI 聊聊这个问题。"}</p>
          <div className="research-card-counts"><span>{item.references?.length || 0} 份资料</span><span>{item.conversations?.length || 0} 段讨论</span><span>{item.projects?.length || 0} 篇文章</span></div>
          <footer><span>{Number.isNaN(date.getTime()) ? "" : `${date.toLocaleDateString("zh-CN")} 更新`}</span><span>继续展开 →</span></footer>
        </button>
        <span className="research-card__acts">
          <RowDelete
            onDelete={() => trash(item)}
            title={`移入回收站：${title}`}
            onOpenChange={(open) => setConfirmRow(open ? item.id : "")}
          />
        </span>
      </article>;
    })}</div>
    <Toast text={toast?.text} detail={toast?.detail} onUndo={toast?.undo} onClose={() => setToast(null)} />
    {filtered.length > 0 ? <nav className="research-pagination" aria-label="选题分页"><span aria-live="polite">{currentPage * 6 + 1}–{Math.min((currentPage + 1) * 6, filtered.length)} / {filtered.length} 个选题 · 最近更新优先</span><div><button className="btn btn-sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{currentPage + 1} / {pages}</span><button className="btn btn-sm" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>下一页</button></div></nav> : null}
  </section>;
}
function ResearchDetail({ id, onGo, onForceGo = onGo, registerNavigationGuard }) {
  const [record,setRecord]=useState(null),[error,setError]=useState(null),[busy,setBusy]=useState(false),[edited,setEdited]=useState(false),[status,setStatus]=useState("");
  const latest=useRef(null),dirty=useRef(false),saving=useRef(null),remoteVersion=useRef(null),alive=useRef(true);
  const [remote,setRemote]=useState(null),[pending,setPending]=useState(null);
  const [tab,setTab]=useState("notes"),[mobileChat,setMobileChat]=useState(false),[showSources,setShowSources]=useState(false);
  const [conversation,setConversation]=useState(null),[chatKey,setChatKey]=useState(0),[prompt,setPrompt]=useState(null),[ready,setReady]=useState(false);
  const [summary,setSummary]=useState(null),[summaryBusy,setSummaryBusy]=useState(false),[summaryError,setSummaryError]=useState(null);
  const [wiki,setWiki]=useState(null),[find,setFind]=useState(false),[findPurpose,setFindPurpose]=useState(""),[findScope,setFindScope]=useState("本地知识库与公开原始资料");
  const [transfer,setTransfer]=useState(null),[projectId,setProjectId]=useState(""),[articleContext,setArticleContext]=useState(null),[articleDirty,setArticleDirty]=useState(false);
  const [excerpt,setExcerpt]=useState(null),[referencePreview,setReferencePreview]=useState(null);
  const notesRef=useRef(null),chatRef=useRef(null),articleSave=useRef(null),requestKey=useRef(""),linkedConversation=useRef(""),summaryRunning=useRef(false);
  const [handoff,setHandoff]=useState(null);
  useLayoutEffect(() => {
    const el=notesRef.current;
    if(el?.offsetWidth){el.style.height="auto";el.style.height=`${Math.max(190,el.scrollHeight)}px`;}
  },[record?.notes,tab,showSources]);
  const positionKey=`xenho:research-position:${id}`;
  const modalOpen=find || transfer!==null || excerpt!==null || Boolean(pending);
  const dialog=useDialog(modalOpen,()=>{if(!busy){setFind(false);setTransfer(null);setExcerpt(null);setPending(null);}});
  useEffect(()=>{alive.current=true;let active=true;api.research(id).then(({research:r})=>{if(!active)return;latest.current=r;setRecord(r);let stored={};try{stored=JSON.parse(localStorage.getItem(positionKey)||"{}")}catch{}const found=r.conversations?.find(c=>c.id===stored.conversation?.id)||r.conversations?.[0]||null;setConversation(found);linkedConversation.current=found?.id||"";setProjectId(r.projects?.find(p=>p.id===stored.projectId)?.id||r.projects?.[0]?.id||"");setTab(stored.tab==="article"&&r.projects?.length?"article":"notes");setReady(true);api.recordActivity("research",id,{mode:"open"}).catch(()=>{});api.researchSummary(id).then(x=>{if(active)setSummary(x.summary)}).catch(e=>{if(active)setSummaryError(e)});}).catch(setError);return()=>{active=false;alive.current=false;};},[id]);
  useEffect(()=>{if(!ready)return;try{localStorage.setItem(positionKey,JSON.stringify({tab,conversation,projectId}));}catch{}},[tab,conversation,projectId,ready]);
  const summon=useCallback(()=>{setMobileChat(true);requestAnimationFrame(()=>chatRef.current?.querySelector("textarea")?.focus());},[]);
  useAssistantSummonTarget("research",summon);
  function change(key,value){latest.current={...latest.current,[key]:value};dirty.current=true;setEdited(true);setRecord(latest.current);setStatus("尚未保存");}
  async function save(){if(saving.current){if(!await saving.current)return false;return dirty.current?save():true;}if(!dirty.current)return true;const snapshot=latest.current;setBusy(true);setError(null);saving.current=(async()=>{try{const {research}=await api.saveResearch(id,{expectedVersion:remoteVersion.current??snapshot.version,question:snapshot.question,notes:snapshot.notes,openQuestions:snapshot.openQuestions});remoteVersion.current=null;setRemote(null);const clean=latest.current===snapshot;latest.current=clean?research:{...latest.current,version:research.version};dirty.current=!clean;if(alive.current){setEdited(!clean);setRecord(latest.current);setStatus(clean?"已保存":"尚未保存");}return true;}catch(e){if(alive.current)setError(e);return false;}finally{saving.current=null;if(alive.current)setBusy(false);}})();const ok=await saving.current;return ok&&dirty.current?save():ok;}
  async function saveAll(){return await save() && (!articleSave.current || await articleSave.current());}
  useEffect(()=>{if(!edited||error||busy)return;const t=setTimeout(save,900);return()=>clearTimeout(t);},[record,edited,error,busy]);
  useEffect(()=>{if(!edited&&!articleDirty)return;const warn=e=>{e.preventDefault();e.returnValue="";};window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);},[edited,articleDirty]);
  useEffect(()=>registerNavigationGuard?.(next=>{if((!dirty.current&&!articleDirty)||(next.view==="research"&&next.state===id))return false;setPending(next);return true;}),[id,articleDirty,registerNavigationGuard]);
  async function relations(){const {research:r}=await api.research(id);if(!alive.current)return;latest.current={...latest.current,references:r.references,conversations:r.conversations,projects:r.projects};setRecord(latest.current);}
  const conversationChanged=useCallback(async cid=>{if(!cid||linkedConversation.current===cid)return;linkedConversation.current=cid;try{await api.researchConversation(id,cid);if(!alive.current)return;setConversation(old=>old?.id===cid?old:{id:cid,scopeId:`research:${id}`});await relations();}catch(e){linkedConversation.current="";if(alive.current)setError(e);}},[id]);
  const refreshSummary=useCallback(async()=>{if(summaryRunning.current)return;summaryRunning.current=true;setSummaryBusy(true);setSummaryError(null);try{const result=await api.refreshResearchSummary(id);if(alive.current)setSummary(result.summary);}catch(e){if(alive.current)setSummaryError(e);}finally{summaryRunning.current=false;if(alive.current)setSummaryBusy(false);}},[id]);
  const settled=useCallback(async completed=>{try{if(completed?.id)await api.researchConversation(id,completed.id);await relations();await refreshSummary();}catch(e){if(alive.current)setSummaryError(e);}},[id,refreshSummary]);
  async function ask(text){if(!await saveAll())return;setPrompt({id:crypto.randomUUID(),text});summon();}
  async function switchTab(next){if(!await saveAll())return;setShowSources(false);if(next==="article"&&!projectId){requestKey.current=crypto.randomUUID();setTransfer(latest.current.notes||latest.current.question);return;}setTab(next);setMobileChat(false);}
  async function createArticle(){setBusy(true);setError(null);try{const result=await api.researchProject(id,{requestKey:requestKey.current,selectedText:transfer});await relations();setProjectId(result.projectId);setTransfer(null);setTab("article");setMobileChat(false);}catch(e){setError(e);}finally{setBusy(false);}}
  async function reference(item,remove=false){try{if(!await save())return false;await api.researchReference(id,{kind:item.kind,id:item.id},remove);await relations();return true;}catch(e){setError(e);return false;}}
  async function wikiMatches(){try{setWiki((await api.wikiConnections(latest.current.question)).items||[]);}catch(e){setError(e);}}
  async function viewOriginal(item){try{setReferencePreview((await api.libraryItem(item.kind,item.id)).item);}catch(e){setError(e);}}
  async function selectConversation(value){if(!await saveAll())return;setConversation(record.conversations.find(c=>c.id===value)||null);linkedConversation.current=value;setChatKey(k=>k+1);setPrompt(null);setHandoff(null);}
  async function newConversation(){if(!await saveAll())return;setConversation(null);linkedConversation.current="";setChatKey(k=>k+1);setPrompt(null);setHandoff(null);summon();}
  if(!record||!ready)return <section className="task-page"><ErrorNote error={error} what="读取选题"/>{!error?<Loading rows={3}/>:null}</section>;
  const articleMode=tab==="article"&&Boolean(projectId);
  const summaryText=summary?.text?.replace(/chat-[a-zA-Z0-9_-]+:\d+/g, token => {
    const index=summary.sources?.findIndex(source=>source.id===token);return index>=0?`[${index+1}]`:"[讨论记录]";
  });
  const tools=<div className="topic-chat-tools">
    <button className="btn btn-sm" onClick={wikiMatches}><IconLink size={16}/>连接 Wiki</button>
    <button className="btn btn-sm" onClick={()=>setFind(true)}><IconSearch size={16}/>帮我找资料</button>
    <button className="btn btn-sm" disabled={!record.references?.length} onClick={()=>ask("请综合当前选题已关联资料，比较共识、分歧和未核实之处，标出原始出处。再从解释一个读者熟悉的现象、提出有依据的判断等不同角度给出候选讲法；不能虚构经历，不自动创建文章。")}>综合分析</button>
  </div>;
  return <section className="topic-workspace">
    <div className="topic-mobile-switch" aria-label="切换工作区">
      <button className="btn btn-sm" aria-pressed={!mobileChat} onClick={()=>setMobileChat(false)}>{articleMode?"文章":"思考区"}</button>
      <button className="btn btn-sm" aria-pressed={mobileChat} onClick={summon}>AI 讨论</button>
    </div>
    <div className={`topic-split${mobileChat?" is-chat":""}`}>
      <div className="topic-left">
        <header className="topic-heading">
          {/* ⚠️ **删除不能走 `PageHeader` 的插槽。** 这一页把外壳页头整条藏了
              （`topic-workspace.css`: `.app__frame:has(.topic-workspace) > .view-head{display:none}`），
              portal 进去等于画在一个 `display:none` 的容器里——不会报错，只是按钮不存在。
              所以它落在这一页自己的那条动作栏上，和「所有选题」分坐两端。
              删完把回执交接给列表页：它该出现在你被送到的那一页上。 */}
          <div className="topic-breadcrumb"><button className="btn btn-sm" onClick={()=>onGo("research")}><IconChevronLeft size={15}/>所有选题</button><RowDelete
            label="移入回收站"
            title={`移入回收站：${record.question || "这个选题"}`}
            onDelete={async()=>{
              try {
                await api.trashResearch(id);
                handOffUndo({
                  text: `「${record.question || "这个选题"}」已移入回收站`,
                  detail: "资料、讨论和已写的文章都还在。",
                  undo: async()=>{await api.restoreResearch(id);onForceGo("research",id);},
                });
                onForceGo("research");
              } catch(e) { setError(e); }
            }}
          /></div>
          <div className="topic-title-row"><textarea rows={1} aria-label="选题问题" value={record.question} maxLength={300} onChange={e=>change("question",e.target.value)} onBlur={save}/>{!articleMode?<button className="btn btn-primary" aria-label="开始写文章" onClick={()=>switchTab("article")}>{projectId?"继续写作":"写成文章"}</button>:null}</div>
        </header>
        {/* ⚠️ 页签走 `ui.jsx` 的 `ViewTabs`。这里原来是第五种页签长相——而
            「这一页现在看哪一档」在这个工作台里只该有一个样子（找题 / 选题 / 复盘 / 数据 / 热点 共用那一颗）。 */}
        <nav className="topic-tabs" aria-label="选题工作区">
          <ViewTabs
            label="选题工作区"
            value={showSources?"sources":articleMode?"article":"notes"}
            onChange={async key=>{if(key==="sources"){if(await saveAll())setShowSources(true);}else switchTab(key);}}
            items={[
              {key:"notes",label:"思考"},
              {key:"article",label:"文章"},
              {key:"sources",label:"资料",count:record.references?.length||0},
            ]}
          />
          {articleMode&&record.projects?.length>1?<select aria-label="切换文章" value={projectId} onChange={async e=>{const value=e.target.value;if(await saveAll()){setArticleContext(null);setProjectId(value);}}}>{record.projects.map(p=><option key={p.id} value={p.id}>{p.title||"未命名文章"}</option>)}</select>:null}
          {articleMode?<button className="topic-add-article" onClick={async()=>{if(await saveAll()){requestKey.current=crypto.randomUUID();setTransfer(record.notes||record.question);}}}>另写一篇</button>:null}
        </nav>
        <div className="topic-scroll">
          <ErrorNote error={error} what="选题" onRetry={save}/>
          {error?.status===409?<div className="topic-conflict"><button className="btn" onClick={async()=>setRemote((await api.research(id)).research)}>核对另一处修改</button>{remote?<><pre>{remote.notes}</pre><button className="btn" onClick={()=>{remoteVersion.current=remote.version;save();}}>确认用当前笔记替换此版本</button></>:null}</div>:null}
          {showSources?<section className="topic-sources"><header className="row-actions"><h2>选题资料</h2><button className="btn btn-sm" onClick={()=>setFind(true)}>让 AI 帮我找</button></header><p className="topic-hint">关联已有资料，或先让 AI 帮你查找。</p><div className="topic-linked">{record.references?.map(r=><article key={r.id}><button disabled={r.missing} onClick={()=>viewOriginal(r)}><IconFileText size={16}/>{r.title||"来源已失效"}</button><button className="btn btn-sm" onClick={()=>reference(r,true)}>取消关联</button></article>)}</div>{referencePreview?<section className="library-original"><button className="btn btn-sm" onClick={()=>setReferencePreview(null)}>收起原文</button><h3>{referencePreview.title}</h3><div className="markdown-body" dangerouslySetInnerHTML={{__html:renderMarkdown(referencePreview.body||"")}}/><button className="btn btn-sm" onClick={()=>onGo("library",`${referencePreview.kind}:${referencePreview.id}`)}>进入阅读页</button></section>:null}<LibraryBrowser onChoose={item=>reference(item)} onGo={onGo}/></section>:null}
          <div hidden={showSources}>
            {articleMode?<TopicArticle key={projectId} projectId={projectId} onContext={setArticleContext} onDirty={setArticleDirty} saveRef={articleSave} onGo={onGo} onDiscuss={payload=>{setHandoff({id:crypto.randomUUID(),prompt:payload.prompt,answer:payload.answer});summon();}}/>:
            <div className="topic-thinking">
              <details className="topic-summary" open><summary><strong>目前的理解</strong><span>{summaryBusy?"正在整理…":"AI 整理"}</span></summary>
                {summaryText?<div className="markdown-body" dangerouslySetInnerHTML={{__html:renderMarkdown(summaryText)}}/>:<p className="topic-hint">讨论后会整理在这里，你的笔记始终独立保留。</p>}
                {summary?.stale?<small>讨论有更新，摘要等待重新整理。</small>:null}
                {summary?.sources?.length?<details className="topic-evidence"><summary>查看讨论依据</summary>{summary.sources.map((source,index)=><blockquote key={index}>{source.quote||source.text}<small>依据 {index+1} · {source.role==="user"?"你的表达":"AI 的分析"}</small><button className="btn btn-sm" onClick={()=>selectConversation(source.conversationId)}>回到这次讨论</button></blockquote>)}</details>:null}
                {summaryError?<div role="status"><small>摘要暂时没有更新：{summaryError.message}</small><button className="btn btn-sm" disabled={summaryBusy} onClick={refreshSummary}>重试整理</button></div>:null}
              </details>
              <section className="topic-notebook">{/* 保存的结果贴着保存动作。它原来吊在左上角「所有选题」旁边——离你刚才动手的地方一整屏远。 */}
              <header><h2>我的笔记</h2><small role="status">{busy?"保存中…":status||"已保存"}</small><button className="btn btn-sm" disabled={!edited||busy} onClick={save}>保存笔记</button></header><textarea ref={notesRef} aria-label="我的笔记" className="topic-notes" rows={6} value={record.notes||""} onChange={e=>change("notes",e.target.value)} onBlur={save} placeholder="写下自己的判断，或从右侧讨论中摘录。"/></section>
              <details className="topic-detail"><summary>未解的问题{record.openQuestions?.trim()?" · 有记录":""}</summary><textarea aria-label="未解问题" rows={4} placeholder="还有哪些地方需要核实或继续讨论？" value={record.openQuestions||""} onChange={e=>change("openQuestions",e.target.value)} onBlur={save}/></details>
              <details className="topic-detail" open><summary>关联资料 <span>{record.references?.length||0}</span></summary><div className="topic-linked">{record.references?.map(r=><article key={r.id}><button disabled={r.missing} onClick={()=>onGo("library",`${r.kind}:${r.id}`)}><IconFileText size={16}/>{r.title||"来源已失效"}</button></article>)}</div><button className="btn btn-sm" onClick={()=>setShowSources(true)}>{record.references?.length?"管理资料":"关联一份资料"}</button></details>
            </div>}
          </div>
        </div>
      </div>
      <aside className="topic-chat" ref={chatRef}>
        <header className="topic-chat-heading"><strong>AI 讨论</strong><div><select aria-label="当前讨论" value={conversation?.id||""} onChange={e=>selectConversation(e.target.value)}><option value="">新的讨论</option>{record.conversations?.map(c=><option key={c.id} value={c.id}>{c.title||"未命名讨论"}</option>)}</select><button className="btn btn-sm" onClick={newConversation}>另开讨论</button></div></header>
        <AssistantPane key={chatKey} embedded composerTools={tools} emptyMessage="从你最想弄明白的地方聊起，也可以先连接 Wiki 或补一份资料。" scope={articleMode?"project":"global"} surface="page" scopeId={conversation?.scopeId||record.scopeId} initialConversationId={conversation?.id||""} document={articleMode&&articleContext?articleContext.document:{title:record.question,body:record.notes,researchId:id}} materials={articleMode?articleContext?.materials||[]:[]} target={articleMode&&articleContext?articleContext.target:{kind:"none",editable:false}} onConversationChange={conversationChanged} onSettled={settled} onExcerpt={setExcerpt} promptRequest={prompt} handoffRequest={handoff} draftStorageKey={`research-discussion:${id}`}/>
        {wiki!==null?<section className="topic-wiki"><header className="row-actions"><h3>相关 Wiki</h3><button className="btn btn-sm" onClick={()=>setWiki(null)}>收起</button></header>{wiki.length?wiki.map(w=><article key={w.id}><button className="btn btn-sm" onClick={()=>onGo(w.route.view,w.route.state)}>{w.title}</button><p>{w.reason}</p><button className="btn btn-sm" onClick={async()=>{if(!await reference(w))return;await ask(`请阅读当前选题关联的 Wiki「${w.title}」，说明它与问题有什么连接，可以从哪些角度解释。区分原文依据和推测，不把概念联系当作事实证明。`);setWiki(null);}}>关联并讨论</button></article>):<p>没有找到相关 Wiki，可以换一个更具体的问题。</p>}</section>:null}
      </aside>
    </div>
    {modalOpen?<div className="modal-backdrop"><section ref={dialog} className="quick-note" role="dialog" aria-modal="true" aria-label={pending?"保存后离开":find?"确定查找范围":transfer!==null?"开始一篇文章":"摘进我的笔记"}><ErrorNote error={error} what="操作"/>{pending?<><h2>还有未保存的修改</h2><button className="btn btn-primary" onClick={async()=>{if(await saveAll()){const next=pending;setPending(null);onForceGo(next.view,next.state);}}}>保存后离开</button><button className="btn" onClick={()=>setPending(null)}>继续编辑</button></>:find?<><h2>先确定这次要找什么</h2><label>查找目的<textarea aria-label="查找目的" value={findPurpose} onChange={e=>setFindPurpose(e.target.value)} placeholder="例如：找实际案例，同时保留反对观点"/></label><label>范围<select aria-label="查找范围" value={findScope} onChange={e=>setFindScope(e.target.value)}><option>本地知识库与公开原始资料</option><option>只查当前本地 Wiki</option><option>公开原始文档与可核对案例</option></select></label><p>先检索与阅读，给简短导读和原始出处。正式入库仍需确认。</p><button className="btn btn-primary" disabled={!findPurpose.trim()||busy} onClick={async()=>{await ask(`请按确认范围查找资料。目的：${findPurpose}。范围：${findScope}。先搜索并读取实际原文，列出每份资料讲什么、共识和分歧，给出处。不能把搜索摘要当证据；读不到就说明。不要直接起稿。适合收藏的资料用现有工具提出候选，让我确认。`);setFind(false);}}>确认范围，查找并导读</button><button className="btn" onClick={()=>setFind(false)}>取消</button></>:transfer!==null?<><h2>带着哪些理解开始写？</h2><textarea aria-label="带入文章的内容" rows={8} value={transfer} onChange={e=>setTransfer(e.target.value)}/><p>建立一篇空白正文，所选文字留在文章构思中；讨论仍在右侧继续。</p><button className="btn btn-primary" disabled={busy||!transfer.trim()} onClick={createArticle}>创建文章</button><button className="btn" onClick={()=>setTransfer(null)}>取消</button></>:<><h2>留下这段理解</h2><textarea aria-label="摘录内容" rows={8} value={excerpt||""} onChange={e=>setExcerpt(e.target.value)}/><p>确认后追加到你的笔记，不覆盖已有文字。</p><button className="btn btn-primary" disabled={!excerpt?.trim()} onClick={()=>{change("notes",[latest.current.notes,excerpt].filter(Boolean).join("\n\n"));setExcerpt(null);}}>确认摘录</button><button className="btn" onClick={()=>setExcerpt(null)}>不采用</button></>}</section></div>:null}
  </section>;
}
