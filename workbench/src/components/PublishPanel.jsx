/**
 * 记录发布 —— **一个按钮，不是一张常驻表单**。
 *
 * 原来它是稿件详情里一块永远摊开的绿卡片：七个输入框，压在正文上面，不看状态。
 * 三个毛病，改之前先记住，别再摊回去：
 *
 *  1. 打开一篇稿子的意图 99% 是读或改，登记发布一辈子只做一次，它却占着第一屏；
 *  2. 上面刚报「有内容缺少真实素材支撑」，下面就把「确认已发布」递到手上——系统自己打架；
 *  3. 五个指标框在「刚发出去那一刻」全是空的，那会儿根本没有数据。
 *
 * 现在按**两个不同的时刻**拆开，各自只问那一刻答得上来的东西：
 *
 *  - 还没发 →「确认已发布」：只要发布时间；链接有就填，视频号这类拿不到链接的也能登记。
 *  - 已经发了 →「更新数据并复盘」：这时才出现五个指标，因为这时才有数。
 *
 * ⚠️ **指标不能从这里整个搬走。** 复盘判定（`evaluatePostPerformance`）和「表现突出就把
 * 有效标题/角度沉淀回素材库」只挂在工作区发布与复盘流程上，数据页的导入和手录
 * 都不会触发它。把指标挪去数据页 = 沉淀这一环再也不会发生。
 */

import { useState } from "react";
import { useDialog } from "../lib/use-dialog.js";
import { api } from "../lib/api.js";
import { ErrorNote, Note } from "./ui.jsx";
import { IconCloudUpload, IconX } from "./icons.jsx";

const METRICS = [
  ["views", "阅读 / 播放"],
  ["likes", "点赞"],
  ["comments", "评论"],
  ["collects", "收藏"],
  ["shares", "分享"],
];

function localNow() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function PublishPanel({ item, doc, onPublished, blocked, blockedTitle = "先处理掉「待核实经历」再记录发布", buttonClassName = "btn btn-sm", buttonLabel = "" }) {
  const [open, setOpen] = useState(false);
  const published = (item.raw || {}).status === "已发布";
  return (
    <>
      <button
        className={buttonClassName}
        type="button"
        onClick={() => setOpen(true)}
        disabled={blocked}
        // 有真实性告警时不给点，但**要说清为什么**——灰着不解释的按钮只会让人以为坏了
        title={blocked ? blockedTitle : published ? "补上表现数据，跑一次复盘" : "登记发布时间，链接可以空着"}
      >
        <IconCloudUpload aria-hidden="true" stroke={1.7} />
        {buttonLabel || (published ? "更新数据并复盘" : "记录发布")}
      </button>
      {open ? (
        <PublishDrawer
          item={item}
          doc={doc}
          published={published}
          onClose={() => setOpen(false)}
          onPublished={onPublished}
        />
      ) : null}
    </>
  );
}

function PublishDrawer({ item, doc, published, onClose, onPublished }) {
  const raw = item.raw || {};
  const [form, setForm] = useState({
    url: raw.publishedUrl || "",
    publishedAt: raw.publishedAt ? raw.publishedAt.slice(0, 16) : localNow(),
    views: raw.views ?? "",
    likes: raw.likes ?? "",
    comments: raw.comments ?? "",
    collects: raw.collects ?? "",
    shares: raw.shares ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const boxRef = useDialog(true, onClose);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await api.publishDraft({
        draftId: item.key,
        title: doc?.title || item.title,
        platform: raw.platform,
        ...form,
      });
      setResult(response);
      onPublished?.(response, form);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="drawer" ref={boxRef} onSubmit={submit} role="dialog" aria-modal="true" aria-label="记录发布">
        <div className="drawer-head">
          <div>
            <span className="eyebrow">PUBLISH &amp; LEARN</span>
            <div className="drawer-title">{published ? "更新发布表现" : "记录发布"}</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} title="关闭（Esc）" aria-label="关闭">
            <IconX aria-hidden="true" stroke={1.8} />
          </button>
        </div>

        <div className="field">
          {/* 视频号、群发这些地方拿不到链接，没有也照样能登记「发出去了」 */}
          <label>发布链接<small className="field__optional">可留空</small></label>
          <input type="url" data-autofocus="" value={form.url} onChange={set("url")} placeholder="有就贴上，没有可以空着" />
        </div>
        <div className="field">
          <label>发布时间</label>
          <input type="datetime-local" value={form.publishedAt} onChange={set("publishedAt")} required />
        </div>

        {/* 指标只在「已发布」这一档出现：刚发出去的那一刻这五个格子必然是空的，
            摆在那儿只会让人以为自己漏填了什么。 */}
        {published ? (
          <div className="field">
            <label>表现数据</label>
            <div className="publish-metrics">
              {METRICS.map(([key, label]) => (
                <label className="field" key={key}>
                  <span>{label}</span>
                  <input type="number" min="0" inputMode="numeric" value={form[key]} onChange={set(key)} placeholder="选填" />
                </label>
              ))}
            </div>
            <div className="field-hint">留空 ≠ 0，是「这个平台没有这个指标」。导得出后台文件的平台去数据页导入更快。</div>
          </div>
        ) : (
          <div className="field-hint">
            {"数据不用现在填——发出去那一刻本来就没有。过几天回到这篇点「更新数据并复盘」，表现突出的话系统会把有效标题和角度沉淀回素材库。"}
          </div>
        )}

        <ErrorNote error={error} what="记录发布" />
        {result ? (
          <Note tone={result.performance?.status === "表现突出" ? "success" : "default"} title={result.performance?.status || "已记录"}>
            {result.performance?.summary}{result.feedbackCreated ? ` 已自动沉淀 ${result.feedbackCreated} 条有效素材。` : ""}
          </Note>
        ) : null}

        <div className="drawer-foot">
          <button type="button" className="btn" onClick={onClose}>{result ? "完成" : "取消"}</button>
          <button className="btn btn-primary" type="submit" disabled={busy || !form.publishedAt}>
            <IconCloudUpload aria-hidden="true" stroke={1.8} />
            {busy ? "记录中…" : published ? "更新数据并复盘" : "确认已发布"}
          </button>
        </div>
      </form>
    </div>
  );
}
