// 精选列表右侧的详情面板。
//
// **为什么是面板不是整页。** 情报这一屏要做的事是「一批进来，逐条判断留/弃/展开」。
// 整页跳转的代价不是多一次点击，是**每读一条就把列表位置和已选的那几条丢一次**——
// 挑一批十条的东西要来回二十次，每次回来都得重新找刚才读到哪儿。
// 面板打开时列表还在左边、当前那条高亮着，读完按 ↓ 就是下一条。
//
// ⚠️ **三段结构照 `SideRail.jsx`：固定上下文 → 滚动正文 → 固定动作条。**
// 那边踩过的坑在这儿一样成立：动作条跟着内容滚的话，正文长一点就得先滚到底才能点
//「加入选题」，而按钮的位置每条都不一样，肌肉记忆立不住。
//
// 键盘不在这里监听——↑/↓/Esc/s/e 由列表那一层统一处理（见 `IntelligenceFeed.jsx`）。
// 拆成两处的话，面板有焦点和没焦点时会是两套行为，而用户不知道焦点在哪儿。

import { BriefReading } from "./BriefReading.jsx";
import { ErrorNote, Loading } from "./ui.jsx";
import { IconArrowsDiagonal, IconArrowUp, IconArrowDown, IconBookmark, IconBookmarkFilled, IconX } from "./icons.jsx";

export function BriefPeek({
  brief,
  loading,
  error,
  position,
  total,
  busy,
  onRetry,
  onClose,
  onFull,
  onPrev,
  onNext,
  onFeedback,
  onMerge,
  onGo,
  onBlock,
}) {
  const saved = Boolean(brief?.saved);
  return (
    <aside className="brief-peek" aria-label="情报详情">
      <header className="brief-peek__head">
        <span className="brief-peek__pos">
          {position} / {total}
        </span>
        <div className="brief-peek__tools">
          <button type="button" className="btn-icon" onClick={onPrev} disabled={!onPrev} title="上一条（↑）" aria-label="上一条">
            <IconArrowUp size={15} stroke={1.8} aria-hidden="true" />
          </button>
          <button type="button" className="btn-icon" onClick={onNext} disabled={!onNext} title="下一条（↓）" aria-label="下一条">
            <IconArrowDown size={15} stroke={1.8} aria-hidden="true" />
          </button>
          {brief ? (
            <button
              type="button"
              className="btn-icon"
              aria-pressed={saved}
              disabled={Boolean(busy)}
              onClick={() => onFeedback({ saved: !saved })}
              title={saved ? "取消收藏（S）" : "收藏（S）"}
              aria-label={saved ? "已收藏" : "收藏"}
            >
              {saved ? <IconBookmarkFilled size={15} aria-hidden="true" /> : <IconBookmark size={15} stroke={1.8} aria-hidden="true" />}
            </button>
          ) : null}
          <button type="button" className="btn-icon" onClick={onFull} disabled={!brief} title="全屏打开（Enter）" aria-label="全屏打开">
            <IconArrowsDiagonal size={15} stroke={1.8} aria-hidden="true" />
          </button>
          <button type="button" className="btn-icon" onClick={onClose} title="关闭（Esc）" aria-label="关闭详情">
            <IconX size={15} stroke={1.8} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="brief-peek__body">
        {error ? (
          <ErrorNote error={{ message: error }} what="打开这条解读" onRetry={onRetry} />
        ) : !brief ? (
          <Loading rows={4} />
        ) : (
          <BriefReading brief={brief} onGo={onGo} onBlock={onBlock} dense />
        )}
        {loading && brief ? <p role="status">正在读取…</p> : null}
      </div>

      {/* 反馈是安静的两颗，「加入选题」是这一栏唯一的主操作——
          三颗一样重的描边按钮读起来是三个并列的选项，而实际上只有一颗会改变你手上的活。 */}
      <footer className="brief-peek__foot">
        <button
          type="button"
          className="brief-text-action"
          disabled={!brief || Boolean(busy)}
          aria-pressed={Boolean(brief?.helpful)}
          onClick={() => onFeedback({ helpful: !brief.helpful })}
        >
          {brief?.helpful ? "已记为有启发" : "有启发"}
        </button>
        <button
          type="button"
          className="brief-text-action"
          disabled={!brief || Boolean(busy)}
          onClick={() => onFeedback({ dismissed: !brief.dismissed })}
        >
          {brief?.dismissed ? "恢复推荐" : "不感兴趣"}
        </button>
        <button type="button" className="btn btn-sm btn-primary" disabled={!brief} onClick={onMerge}>
          加入选题
        </button>
      </footer>
    </aside>
  );
}
