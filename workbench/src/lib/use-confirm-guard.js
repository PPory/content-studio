import { useEffect, useRef } from "react";

/**
 * 危险动作「点两下确认」的第二道闸：**挡住一次物理双击**。
 *
 * ⚠️ **两步确认本身挡不住双击。** 量出来的事实（`tmp/verify-design.mjs` 那种量矩形的
 * 临时脚本，断言测不出来）：在卡片上点完垃圾桶，指针停在原地不动，而确认态的
 * 「移入回收站」**正好长在那个位置上**——它比旁边的「打开」宽，右对齐时向左伸得更远，
 * 换按钮顺序也躲不开。于是**手快连点两下垃圾桶 = 直接删掉**，而这条删除可以恢复
 *（本地工作区有回收站）。两步确认这道闸当场失效，而屏幕上看不出任何异常。
 *
 * 320ms 卡在两个真实间隔之间：双击的第二下约 100ms 内就到，而真人读完
 * 「移入回收站」四个字再按怎么也得半秒。**所以正常点是感觉不到它的。**
 *
 * **不做成 `disabled`**：那会让按钮刚出现时闪一下灰，看着像还没加载好；
 * 而这一瞬间本来就没人该点得到它。
 *
 * **为什么抽成 hook**：卡片和阅读区各有一个删除入口，规则一样。阅读区那份此刻
 * 「碰巧安全」——它的「删除」按钮带文字、比较宽，指针正好落在「取消」上；
 * 但那是宽度的巧合，**改一次文案就会翻**。同一条规则只能有一份实现。
 *
 * 用法：`const armed = useConfirmGuard(confirm)`，危险按钮的 onClick 开头
 * `if (!armed.current) return;`。
 */
export function useConfirmGuard(open, delay = 320) {
  const armed = useRef(false);
  useEffect(() => {
    if (!open) {
      armed.current = false;
      return;
    }
    const t = setTimeout(() => { armed.current = true; }, delay);
    return () => clearTimeout(t);
  }, [open, delay]);
  return armed;
}
