// 单选组的键盘：↑↓←→ 在选项间移动并选中，空格 / 回车选中当前项（WAI-ARIA radiogroup 的约定）。
// 角度、结构、标题三组共用；焦点跟着选中项走（roving tabindex 由各组件按选中项给 0 / -1）。
const STEP = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

export function radioKeys(count, index, select) {
  return (e) => {
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); select(index); return; }
    if (!(e.key in STEP) || count < 2) return;
    e.preventDefault();
    const next = (index + STEP[e.key] + count) % count;
    select(next);
    const group = e.currentTarget.closest('[role="radiogroup"]');
    requestAnimationFrame(() => group?.querySelectorAll(':scope > [role="radio"]')[next]?.focus());
  };
}
