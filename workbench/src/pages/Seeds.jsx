// 种子池：今天写哪个。
//
// **种子 = 你看到的东西 + 你对它的一句话。** 设计见 `docs/工作流.md`。
//
// ⚠️ **这一页回答的是「今天写哪个」，不是「我攒了多少」。**
// 所以主角是**你那句话**（一整行、字号最大），触发物退到第二行——
// 你要挑的是"哪句话我还想接着说"，不是"哪条链接看着重要"。

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { FilterHeader, ViewTabs, StatePill, ErrorNote, Loading, Empty, relTime } from "../components/ui.jsx";
import { ReactionPicker } from "../components/ReactionPicker.jsx";
import { startWriting } from "../lib/start-writing.js";
import { IconArrowUpRight, IconBulb, IconLoader2, IconPencil, IconPlus, IconTrash } from "../components/icons.jsx";

const KEEPING = "攒着";

export function Seeds({ onGo, onChanged }) {
  // 正在建项目的那颗种子的 id（按钮上转圈用）。
  // ⚠️ **不是弹层**——「写这个」直接建项目跳 `#/project/:id`，写作只有那一个地方。
  const [writing, setWriting] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(KEEPING);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.seeds());
    } catch (e) {
      setError(e);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save({ reaction, take }) {
    setBusy(true);
    setSaveError("");
    try {
      // 干活时想到的那类没有触发物——`sourceKind` 就是 `none`，这是合法的一等公民
      await api.createSeed({ take, reaction, sourceKind: "none" });
      setPicking(false);
      await load();
    } catch (e) {
      setSaveError(e.message || "记不下来");
    } finally {
      setBusy(false);
    }
  }

  async function patch(id, body) {
    setBusy(true);
    try {
      await api.updateSeed(id, body);
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  /**
   * 写这颗种子。
   *
   * ⚠️ **不开弹层，直接建项目跳过去。** 写作统一在 `#/project/:id`——
   * 别处（首页、内容页、素材工作台）建完内容早就跳那儿了，只有这条曾经卡在弹层里。
   * 而那一屏上除了你填的那句话什么都没有：看不到来源，也看不到能用的素材。
   *
   * 常用平台和固定读者从「我的创作」继承，不在准备开始写的时候再问一遍。
   *
   * 标成「写了」和回填 `draft_id` 都在 `startWriting` 里做——**入库成功才记账**：
   * 反过来的话，建项目失败时那颗种子已经从「攒着」里消失了，而它明明还没写。
   */
  async function write(seed) {
    if (writing) return;
    setWriting(seed.id);
    setError(null);
    try {
      const profile = await api.writingProfile().then((value) => value.profile).catch(() => ({ platform: "公众号", audience: "" }));
      const projectId = await startWriting({ platform: profile.platform || "公众号", audience: profile.audience || "", mode: "blank", body: `${seed.take}

`, seed });
      onChanged?.();
      onGo("project", projectId);
    } catch (e) {
      setError(e);
      setWriting("");
    }
  }

  async function remove(id) {
    setBusy(true);
    try {
      await api.removeSeed(id);
      await load();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const counts = data?.counts || {};
  const shown = (data?.seeds || []).filter((s) => s.status === status);

  return (
    <div className="seed-page">
      <FilterHeader
        title="选题"
        desc="这里放的是你已经有一句判断的候选。决定今天写哪一条，再进入创作。"
        chips={
          <ViewTabs
            items={["攒着", "写了", "不写了"].map((s) => ({ key: s, label: s, count: counts[s] ?? 0 }))}
            value={status}
            onChange={setStatus}
            label="按状态筛选"
          />
        }
        action={
          /**
           * ⚠️ **「记一句」是这一页的主操作，收成紧挨着芯片的一颗 `+`。**
           * 干活时想到的那类没有触发物，而**那往往是你最有话说的**——
           * 入口不能藏起来。但它原来是右上角一条写着「记一句」的实心黑长条，
           * 那个位置和宽度让它看起来像页面级的「新建」，而它其实是这一排的一部分。
           * 字写进 `title` 和 `aria-label`，不占版面。
           */
          <button
            className="filter-head__add"
            onClick={() => { setSaveError(""); setPicking(true); }}
            aria-label="记一句"
            title="记一句：干活时想到的那类没有触发物，直接写下来"
          >
            <IconPlus size={16} aria-hidden="true" stroke={2.2} />
          </button>
        }
      />

      <ErrorNote error={error} what="读取种子" onRetry={load} />

      {!data && !error ? <Loading rows={3} /> : null}

      {data && !shown.length ? (
        <Empty icon={IconBulb}>
          {status === KEEPING ? (
            <p>
              还没有种子。<b>两条路：</b>右上角「记一句」记下你此刻想说的；
              或者去<button className="link-btn" onClick={() => onGo("hot")}>热点</button>那一页，
              对哪条有反应就点一下。
            </p>
          ) : <p>没有「{status}」的种子</p>}
        </Empty>
      ) : null}

      {shown.length ? (
        <div className="seeds">
          {shown.map((seed) => (
            <article className="seed" key={seed.id}>
              {/* 你那句话是主角：挑的时候看的是"哪句我还想接着说" */}
              <p className="seed__take">{seed.take}</p>

              <div className="seed__meta">
                {/* ⚠️ 反应可以为空——那时不画这颗 pill，而不是画一个「未分类」 */}
                {seed.reaction ? <StatePill state={seed.reaction} /> : null}
                {seed.source?.title ? (
                  seed.source.url ? (
                    <a className="seed__from" href={seed.source.url} target="_blank" rel="noreferrer" title={seed.source.title}>
                      {seed.source.title}
                      <IconArrowUpRight size={12} stroke={1.8} aria-hidden="true" />
                    </a>
                  ) : <span className="seed__from">{seed.source.title}</span>
                ) : (
                  <span className="seed__from seed__from--own">自己想到的</span>
                )}
                <time className="seed__time">{seed.updatedAt ? relTime(seed.updatedAt) : ""}</time>
              </div>

              <div className="seed__acts">
                {seed.status === KEEPING ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      disabled={!!writing}
                      onClick={() => write(seed)}
                      title="按「我的创作」里的常用平台直接开始"
                    >
                      {writing === seed.id ? <IconLoader2 className="spin" aria-hidden="true" /> : <IconPencil aria-hidden="true" />}写这个
                    </button>
                    <button className="btn btn-sm" disabled={busy || !!writing} onClick={() => patch(seed.id, { status: "不写了" })}>
                      不写了
                    </button>
                  </>
                ) : (
                  <button className="btn btn-sm" disabled={busy} onClick={() => patch(seed.id, { status: KEEPING })}>
                    放回「攒着」
                  </button>
                )}
                {/* ⚠️ 删除进入本地回收站，可恢复（Worker 那侧同一条）。
                    所以这颗只在「不写了」那一档出现——攒着的那些只该被标记，不该被误删 */}
                {seed.status === "不写了" ? (
                  <button className="icon-btn seed__del" disabled={busy} title="移入本地回收站，可恢复" onClick={() => remove(seed.id)}>
                    <IconTrash size={14} stroke={1.7} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <ReactionPicker
        open={picking}
        groups={data?.reactionGroups || []}
        source={null}
        busy={busy}
        error={saveError}
        onClose={() => setPicking(false)}
        onSave={save}
      />
    </div>
  );
}
