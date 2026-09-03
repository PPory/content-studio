import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { Empty, ErrorNote, Loading, Note, PageHeader, SearchBox } from "../components/ui.jsx";
import { IconNotebook } from "../components/icons.jsx";
import { IngestReview } from "../components/IngestReview.jsx";
import { ScrollToTop } from "../components/ScrollToTop.jsx";

const TYPE_ORDER = ["overview", "topic", "synthesis", "comparison", "concept", "method", "person", "organization", "work", "stance", "source_summary"];

function when(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
}

export function Entries({ onGo, focusSourceId = "", focusBookId = "" }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [lintBusy, setLintBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = () => api.wiki().then(setData).catch(setError);
  useEffect(() => { load(); }, []);

  // 「来源」页点「影响页面 85」进来时带的书 id。名字从库里查，不塞进 URL。
  const focusBook = useMemo(
    () => (data?.sourceBooks || []).find((book) => book.id === focusBookId) || null,
    [data, focusBookId],
  );
  const scoped = useMemo(() => (data?.pages || [])
    .filter((page) => !focusBookId || (page.sourceBookIds || []).includes(focusBookId)),
  [data, focusBookId]);

  /**
   * ⚠️ **按类型分节那一版撤了，改成「筛选 + 一条平铺列表」。**
   *
   * 分节的机器一直在（`TYPE_ORDER` 十一档、`typeLabels` 十一个名字），但**真实数据里
   * 只落到三档**：主题 1 张、概念 42 张、方法 52 张。也就是屏幕上会出现一个
   * 只有一条成员的「主题」小节，另外两节各几十条——分节几乎没做任何分类工作，
   * 却多出三行标题和三段上下留白，还把一条本可以连续扫的列表切成三段。
   *
   * 类型改成**筛选**（复用创作页那排 `.chips-sm`，同一个问题同一套语汇），
   * 列表平铺成一条。`TYPE_ORDER` 留着，它现在管的是筛选钮的顺序。
   */
  const typeCounts = useMemo(() => {
    const counts = {};
    for (const page of scoped) counts[page.pageType] = (counts[page.pageType] || 0) + 1;
    return TYPE_ORDER.filter((key) => counts[key]).map((key) => ({
      key, label: data?.typeLabels?.[key] || key, count: counts[key],
    }));
  }, [data, scoped]);

  /**
   * 排序：**连接数降序**，同分再按最近更新。
   *
   * 一条九十多行的列表，打开时第一屏该回答「这个库的骨架是什么」——
   * 连接最多的那几页就是骨架（《写作》16 条连接 7 份来源）。
   * 找具体某一条靠上面那个搜索框，不靠在字母序里翻。
   */
  const listed = useMemo(() => {
    const term = query.trim().toLowerCase();
    return scoped
      .filter((page) => (!type || page.pageType === type)
        && (!term || `${page.title} ${page.summary}`.toLowerCase().includes(term)))
      .sort((a, b) => (b.linkCount - a.linkCount)
        || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }, [scoped, query, type]);

  const runLint = async () => {
    setLintBusy(true);
    setNotice(null);
    try {
      const result = await api.runKnowledgeLint("network", 1);
      setNotice({
        title: result.queued ? "体检已加入队列" : "体检任务已在队列中",
        detail: "完成后会在这里生成诊断报告，不会自动修改 Wiki。",
      });
    } catch (failure) {
      setError(failure);
    } finally {
      setLintBusy(false);
    }
  };

  if (error) return <ErrorNote error={error} what="Wiki" onRetry={load} />;
  if (!data) return <Loading rows={8} />;

  const { totals, health, log = [] } = data;
  return (
    <div className="view-body wiki-home">
      {/**
        * ⚠️ **那块 hero 撤了，别加回来**（绿色眉标「持续编译的知识」+ 42px 的
        * 「我的 Wiki」+ 一句说明 + 两颗按钮）。它把第一条真内容压到了 470px 以下，
        * 而页名「知识 / Wiki」在外壳页头里已经写着了。
        * 那句说明搬进了空态——它是讲给第一次来的人听的，不该每天占着第一屏。
        * 那枚绿眉标还是全站唯一一处拿 `--brand` 当装饰文字的地方，
        * 而墨绿在这套配色里管的是「进展」，不是标签（见 styles.css 的 token 注释）。
        *
        * ⚠️ **「查看 Raw 来源」那颗按钮也撤了。** 它换的是整个页面，而换页归侧栏
        *（知识 › 来源 一直在那儿）；真正需要顺手过去的时刻是「还有 N 篇没编译」，
        * 那句话现在自己就是入口（见下面的 `.wiki-bar`）。
        * 于是这一页只剩「全库体检」一颗主操作。
        */}
      <PageHeader
        title="Wiki"
        count={totals.pages ? `${totals.pages} 张页面` : ""}
        aside={
          <button type="button" className="btn btn-primary" disabled={lintBusy || !totals.pages} onClick={runLint}>
            {lintBusy ? "正在启动…" : "全库体检"}
          </button>
        }
      />

      {notice ? (
        <div className="wiki-notice" role="status" aria-live="polite">
          <Note tone="default" title={notice.title}>{notice.detail}</Note>
        </div>
      ) : null}
      <IngestReview onDone={load} focusSourceId={focusSourceId} />

      {focusBookId ? (
        <div className="wiki-scope" role="status">
          <span>
            只看<b>{focusBook ? `《${focusBook.title}》` : "这份来源"}</b>影响的
            <b> {scoped.length} </b>张页面
          </span>
          <button type="button" className="link-btn" onClick={() => onGo?.("entries")}>看全部 {totals.pages} 张</button>
        </div>
      ) : null}

      {/**
        * ⚠️ **顶上那四格大数字压成了这一行，别再摆回去。**
        *
        * 原来是 `.wiki-pulse`：四个 26px 衬线数字各占一格（95 页面 / 29 来源 /
        * 216 连接 / 1262 篇 Raw 尚未编译），最后一格还是橙色的——**全屏最亮的数字，
        * 而它是四个里唯一你可能想动手的那个，却也只是个数字，点不了。**
        * 另外三个是虚荣指标：知道 216 条连接之后没有任何一件事会因此发生。
        *
        * 现在：**页面数进外壳页头的计数位**（和创作页「6 个内容项目」同一处），
        * 其余退成列表的一行注脚——它们本来就是「这个库有多大、健不健康」，
        * 是索引的注解，不是这一页的主角。
        *
        * ⚠️ **只有「还有 N 篇没编译」是个链接**，因为只有它对应一个动作
        *（去来源页挑一份编译）。其余是事实，不假装可点。
        */}
      <div className="wiki-bar">
        <SearchBox value={query} onChange={setQuery} placeholder="搜索页面、主题或来源" ariaLabel="搜索 Wiki" />
        {/* 类型从分节头变成筛选钮。同一个问题（「现在只看哪一部分」）在这个工作台里
            只有一套语汇——`.chips-sm`，和创作页按阶段筛、数据页按渠道筛是同一颗控件 */}
        {typeCounts.length > 1 ? (
          <div className="chips chips-sm wiki-bar__types" aria-label="按页面类型筛选">
            <button className="chip" aria-pressed={!type} onClick={() => setType("")}>全部 {scoped.length}</button>
            {typeCounts.map((item) => (
              <button key={item.key} className="chip" aria-pressed={type === item.key}
                onClick={() => setType(type === item.key ? "" : item.key)}>
                {item.label} {item.count}
              </button>
            ))}
          </div>
        ) : null}
        <p className="wiki-bar__facts">
          <span><b>{totals.sources}</b> 份来源</span>
          <span><b>{totals.links}</b> 条连接</span>
          <span>{health.orphans ? <><b>{health.orphans}</b> 个孤立页面</> : "页面连接正常"}</span>
          {health.missingCitations ? <span><b>{health.missingCitations}</b> 页缺少来源</span> : null}
          {health.staleCitations ? <span><b>{health.staleCitations}</b> 页的来源已变化</span> : null}
          {health.pendingSources ? (
            <button type="button" className="wiki-bar__todo" onClick={() => onGo?.("sources")}>
              <b>{health.pendingSources}</b> 篇 Raw 待编译
            </button>
          ) : null}
        </p>
      </div>

      {!totals.pages ? (
        /* ⚠️ 这一页唯一解释自己的地方，页头那句说明撤到了这里。
           用 `Empty` 不用 `Note`：`Note` 默认是 warn 语气（带感叹号图标），
           而「还没开始」不是警告——空态该说的是怎么开始。 */
        <Empty icon={IconNotebook}>
          这里不是原文仓库，而是 AI 根据你读过的资料持续维护的当前认识。
          还没有 Wiki 页面——先从侧栏的「来源」挑一份资料开始编译，
          一次编译会生成来源资料卡，并更新所有相关知识页面。
        </Empty>
      ) : (
        <div className="wiki-layout">
          <main className="wiki-index">
            {!listed.length ? (
              <div className="wiki-search-empty">
                {query.trim()
                  ? `没有找到“${query.trim()}”相关的知识页面。`
                  : type ? "这一类下面还没有页面。"
                  : "这份来源还没有影响任何 Wiki 页面。"}
              </div>
            ) : listed.map((page) => (
              <button key={page.id} type="button" className="wiki-page-row" onClick={() => onGo?.(`entries/${page.id}`)}>
                <span className="wiki-page-row__title">{page.title}</span>
                <span className="wiki-page-row__summary">{page.summary}</span>
                {/* 类型跟着行走：筛到「全部」时它才是这一行唯一说不清的东西 */}
                <span className="wiki-page-row__type">{data?.typeLabels?.[page.pageType] || page.pageType}</span>
                {/* ⚠️ 连接数排在前面，因为列表就是按它排的——扫下来能看出这一列在递减 */}
                <span className="wiki-page-row__meta">{page.linkCount} 连接 · {page.sourceCount} 来源 · v{page.revision}</span>
              </button>
            ))}
          </main>

          <aside className="wiki-log">
            <div className="wiki-section__head"><h3>最近演化</h3><span>Log</span></div>
            {log.length ? (
              <ol>
                {log.map((item) => (
                  <li key={item.id}>
                    <time>{when(item.createdAt)}</time>
                    <div><b>{item.title}</b><p>{item.summary}</p></div>
                  </li>
                ))}
              </ol>
            ) : <p className="entry-empty">每次编译、探索归档和体检都会追加在这里。</p>}
          </aside>
        </div>
      )}
      <ScrollToTop label="返回 Wiki 顶部" />
    </div>
  );
}
