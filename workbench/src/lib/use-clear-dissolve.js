/**
 * 清空搜索框时，字**升起来散掉**，不是瞬间消失。取自 transitions.dev 的
 * *Input clear with dissolve*。
 *
 * ⚠️ **为什么这一处值得有动效**（`AGENTS.md`：说不清目的就不加）：
 * 点 `×` 之后屏幕上会同时发生两件事——框里的字没了，**底下的列表整个换一批**。
 * 瞬时清空的时候这两件事在同一帧发生，看起来像「点了一下，页面刷新了」；
 * 而这一下动效把「是我把它清掉的」和「所以结果变了」在时间上分开 300ms，
 * 因果关系就读得出来了。这不是装饰：搜索框是这个工作台里**唯一**一个
 * 一次点击就换掉整屏内容的控件。
 *
 * ⚠️ **必须逐帧写**（`requestAnimationFrame`），写不成一条 `@keyframes`：
 * 那道流光的「升起 → 峰值 → 落下」包络要按**每个词各自的位置**画一层
 * `radial-gradient`，而词的位置只有量过才知道。这是原版注释里也点明的一条。
 *
 * ⚠️ **镜像层只在这一下里存在**，平时 DOM 里没有它。
 * 原版是「一直挂着一个镜像、把真 input 的字设成透明」，那样得时刻同步两份文本；
 * 而这里只在点下去的那一刻把当时的字复制出来、让它自己飞走，真 input 立刻就空了。
 * 少一份要同步的状态，就少一类「两边对不上」的 bug。
 *
 * 用法：
 *   const { wrapRef, clear } = useClearDissolve(() => onChange(""));
 *   <label className="search-box t-clear" ref={wrapRef}>
 *     <input ... />
 *     <button onClick={() => clear(value)}>×</button>
 *   </label>
 * 包裹层必须能当定位父级（`position: relative`）并且 `overflow: hidden`。
 */
import { useCallback, useEffect, useRef } from "react";

const num = (styles, name, fallback) => {
  const raw = parseFloat(styles.getPropertyValue(name));
  return Number.isFinite(raw) ? raw : fallback;
};

/**
 * 按词切段，每段给一条自己的流光。
 *
 * ⚠️ **中文没有空格，只按空格切等于整句一段**——那样流光是一整条横扫，
 * 和「一个词一个词散掉」完全是两个东西。所以西文按空格切，长段再按 2 个字符切碎。
 */
function segments(text) {
  const out = [];
  let index = 0;
  for (const chunk of text.split(/(\s+)/)) {
    if (!chunk.trim()) {
      index += chunk.length;
      continue;
    }
    // 纯 ASCII 的当一个词；带汉字的按两字一段
    const step = /^[\x20-\x7e]+$/.test(chunk) ? chunk.length : 2;
    for (let at = 0; at < chunk.length; at += step) {
      out.push([index + at, index + Math.min(at + step, chunk.length)]);
    }
    index += chunk.length;
  }
  return out;
}

export function useClearDissolve(onCleared) {
  const wrapRef = useRef(null);
  const raf = useRef(0);
  const nodes = useRef([]);

  const cleanup = useCallback(() => {
    cancelAnimationFrame(raf.current);
    for (const node of nodes.current) node.remove();
    nodes.current = [];
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const clear = useCallback((text) => {
    const wrap = wrapRef.current;
    const input = wrap?.querySelector("input");
    // 动效失败绝不能挡住清空这件事本身：拿不到节点就直接清，用户不会知道少了什么
    if (!wrap || !input || !text) {
      onCleared?.();
      return;
    }
    cleanup();

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (reduced) {
      onCleared?.();
      return;
    }

    const styles = getComputedStyle(document.documentElement);
    const dur = num(styles, "--clear-dur", 1000);
    const outDur = num(styles, "--clear-out-dur", 400);
    const inDur = num(styles, "--clear-in-dur", 400);
    const outFly = num(styles, "--clear-out-fly", 12);
    const inFly = num(styles, "--clear-in-fly", 12);
    const blur = num(styles, "--clear-blur", 2);
    const glowDelay = num(styles, "--glow-delay", 50);
    const peakAt = num(styles, "--glow-peak-at", 0.15);
    const glowOpacity = num(styles, "--glow-opacity", 0.42);
    const spread = num(styles, "--glow-spread", 1.5);
    const ink = styles.getPropertyValue("--glow-ink").trim() || "10, 10, 10";

    const inputBox = input.getBoundingClientRect();
    const wrapBox = wrap.getBoundingClientRect();
    const inputStyle = getComputedStyle(input);

    // 镜像：盖在真 input 上，字号字族内边距全抄过来，**位置按量出来的偏移**放，
    // 不靠重写一遍布局——搜索框前面有图标、各页内边距还不一样。
    const mirror = document.createElement("div");
    mirror.className = "t-clear-mirror";
    mirror.setAttribute("aria-hidden", "true");
    mirror.textContent = text;
    mirror.style.left = `${inputBox.left - wrapBox.left}px`;
    mirror.style.top = `${inputBox.top - wrapBox.top}px`;
    mirror.style.width = `${inputBox.width}px`;
    mirror.style.height = `${inputBox.height}px`;
    mirror.style.font = inputStyle.font;
    mirror.style.letterSpacing = inputStyle.letterSpacing;
    mirror.style.color = inputStyle.color;
    mirror.style.paddingLeft = inputStyle.paddingLeft;
    mirror.style.paddingRight = inputStyle.paddingRight;

    const glow = document.createElement("div");
    glow.className = "t-clear-glow";
    glow.setAttribute("aria-hidden", "true");

    wrap.append(mirror, glow);
    nodes.current = [mirror, glow];

    // 每一段的横向中心：拿 Range 去量镜像里的真实字形，不去估算字宽
    const textNode = mirror.firstChild;
    const bands = [];
    const range = document.createRange();
    for (const [from, to] of segments(text)) {
      try {
        range.setStart(textNode, from);
        range.setEnd(textNode, to);
        const box = range.getBoundingClientRect();
        if (box.width > 0) {
          bands.push({
            x: box.left - wrapBox.left + box.width / 2,
            y: box.top - wrapBox.top + box.height / 2,
            r: Math.max(box.width, box.height) * spread,
            // 从右往左依次亮：视线正是从最后一个字往回收的
            at: bands.length,
          });
        }
      } catch {
        /* 量不到就少一段流光，不影响清空 */
      }
    }
    const total = Math.max(1, bands.length);

    // 真 input 立刻空掉；它自己的 placeholder 先按住，换成一份会飞进来的假的
    const placeholderText = input.placeholder;
    let placeholder = null;
    if (placeholderText) {
      input.placeholder = "";
      placeholder = document.createElement("div");
      placeholder.className = "t-clear-placeholder";
      placeholder.setAttribute("aria-hidden", "true");
      placeholder.textContent = placeholderText;
      placeholder.style.cssText = mirror.style.cssText;
      placeholder.style.color = "";
      wrap.append(placeholder);
      nodes.current.push(placeholder);
    }
    onCleared?.();

    const start = performance.now();
    const step = (now) => {
      const elapsed = now - start;

      const out = Math.min(1, elapsed / outDur);
      const eased = 1 - Math.pow(1 - out, 3);
      mirror.style.transform = `translateY(${-outFly * eased}px)`;
      mirror.style.opacity = String(1 - eased);
      mirror.style.filter = `blur(${blur * eased}px)`;

      if (placeholder) {
        const into = Math.min(1, Math.max(0, (elapsed - glowDelay) / inDur));
        const easedIn = 1 - Math.pow(1 - into, 3);
        placeholder.style.transform = `translateY(${inFly * (1 - easedIn)}px)`;
        placeholder.style.opacity = String(easedIn);
        placeholder.style.filter = `blur(${blur * (1 - easedIn)}px)`;
      }

      // 流光：每一段各有各的包络（升起 → 峰值 → 落下），所以只能逐帧算
      const layers = [];
      for (const band of bands) {
        const offset = glowDelay + (band.at / total) * (dur - outDur);
        const life = (elapsed - offset) / (dur * 0.45);
        if (life <= 0 || life >= 1) continue;
        const envelope = life < peakAt
          ? life / peakAt
          : 1 - (life - peakAt) / (1 - peakAt);
        const alpha = Math.max(0, envelope) * glowOpacity;
        layers.push(
          `radial-gradient(${band.r}px ${band.r * 0.8}px at ${band.x}px ${band.y}px,` +
          ` rgba(${ink},${alpha.toFixed(3)}) 0%, rgba(${ink},0) 70%)`
        );
      }
      glow.style.background = layers.join(", ");
      glow.style.opacity = layers.length ? "1" : "0";

      if (elapsed < dur) {
        raf.current = requestAnimationFrame(step);
        return;
      }
      if (placeholderText) input.placeholder = placeholderText;
      cleanup();
    };
    raf.current = requestAnimationFrame(step);
  }, [cleanup, onCleared]);

  return { wrapRef, clear };
}
