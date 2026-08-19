(() => {
  if (location.origin === "http://127.0.0.1:5180" || location.origin === "http://localhost:5180") return;

  const icons = {
    annotate: '<path d="M13 20h7"/><path d="M14.5 4.5a2.12 2.12 0 0 1 3 3L7 18l-4 1 1-4Z"/>',
    ask: '<path d="M9 18h6"/><path d="M10 22h4"/><path d="M8.4 14.6A6 6 0 1 1 15.6 14.6C14.5 15.5 14 16.2 14 18h-4c0-1.8-.5-2.5-1.6-3.4Z"/>',
    chat: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>',
    topic: '<path d="m15 4 5 5L7 22l-5 1 1-5Z"/><path d="m14 6 5 5"/><path d="M6 4V2"/><path d="M5 3h2"/><path d="M19 17v-2"/><path d="M18 16h2"/>',
    intake: '<path d="M4 5h16l-2 14H6Z"/><path d="M4 13h4l2 3h4l2-3h4"/><path d="M12 3v7"/><path d="m9 7 3 3 3-3"/>',
    "intake-menu": '<path d="m8 10 4 4 4-4"/>',
  };
  const actions = [
    ["annotate", "批注", "写下自己的想法"],
    ["ask", "提问", "解释、展开或反驳"],
    ["chat", "对话", "带着选区连续聊"],
    ["topic", "选题", "把片段变成内容方向"],
    ["intake", "收件箱", "点击直接收藏"],
    ["intake-menu", "选择入库位置", "收件箱、灵感库或素材库"],
  ];
  const host = document.createElement("div");
  host.id = "xenho-selection-assistant";
  const shadow = host.attachShadow({ mode: "closed" });
  const attachHost = () => {
    if (!host.isConnected) document.documentElement?.appendChild(host);
  };
  attachHost();
  shadow.innerHTML = `
    <style>
      :host{all:initial;position:fixed;z-index:2147483647;left:0;top:0;font-family:Inter,"Noto Sans SC","Microsoft YaHei UI",sans-serif;color:#f6f3ea}
      .wrap{position:fixed;display:none;align-items:center;gap:5px;filter:drop-shadow(0 12px 26px rgba(0,0,0,.32));transform-origin:center}
      .wrap.on{display:flex;animation:in .13s ease-out}
      @keyframes in{from{opacity:0;transform:translateY(3px) scale(.96)}to{opacity:1;transform:none}}
      button{all:unset;box-sizing:border-box;cursor:pointer;display:grid;place-items:center;color:inherit}
      .seed{width:30px;height:30px;border-radius:9px;background:#111318;border:1px solid rgba(255,255,255,.14);box-shadow:inset 0 1px rgba(255,255,255,.08)}
      .seed svg{width:16px;height:16px}
      .bar{position:relative;display:none;align-items:stretch;gap:2px;padding:4px;border-radius:12px;background:#111318;border:1px solid rgba(255,255,255,.14);box-shadow:inset 0 1px rgba(255,255,255,.07)}
      .wrap.open .seed{display:none}.wrap.open .bar{display:flex}
      .action{position:relative;width:34px;height:34px;border-radius:8px;transition:background .12s,color .12s}
      .action:hover,.action:focus-visible{background:#f0b84b;color:#111318;outline:none}
      .action svg{width:18px;height:18px}
      .action[data-action="intake"]{margin-left:4px;border-left:1px solid rgba(255,255,255,.16);border-radius:0;width:40px}
      .action[data-action="intake-menu"]{width:22px;border-radius:0 8px 8px 0}
      .tip{pointer-events:none;position:absolute;left:50%;bottom:calc(100% + 9px);transform:translateX(-50%);display:none;white-space:nowrap;background:#fff;color:#111318;border:1px solid #ded9cc;border-radius:7px;padding:7px 9px;font-size:11px;line-height:1.25;box-shadow:0 8px 22px rgba(0,0,0,.18)}
      .tip b{display:block;font-size:12px;margin-bottom:2px}.action:hover .tip,.action:focus-visible .tip{display:block}
      .wrap.fresh .tip,.wrap.choosing .action>.tip{display:none!important}
      .intake-menu{position:absolute;z-index:3;right:3px;top:calc(100% + 9px);width:118px;padding:4px;display:none;grid-template-columns:1fr;gap:2px;background:#fbfaf7;color:#3f4148;border:1px solid #d9d5ca;border-radius:9px;box-shadow:0 7px 16px rgba(0,0,0,.16)}
      .intake-menu::before{content:"";position:absolute;right:13px;top:-5px;width:8px;height:8px;transform:rotate(45deg);background:#fbfaf7;border-top:1px solid #d9d5ca;border-left:1px solid #d9d5ca}
      .wrap.choosing .intake-menu{display:grid}.wrap.menu-up .intake-menu{top:auto;bottom:calc(100% + 7px)}
      .wrap.menu-up .intake-menu::before{top:auto;bottom:-5px;transform:rotate(225deg)}
      .intake-choice{position:relative;width:100%;height:32px;border-radius:6px;display:flex;align-items:center;gap:8px;padding:0 9px;font-size:12px;line-height:1;transition:background .12s,color .12s}
      .intake-choice:hover{background:#efede7;color:#111318}.intake-choice:focus-visible{background:#f8e5b8;color:#111318;outline:1px solid #e3ad40;outline-offset:-1px}.intake-choice svg{flex:0 0 auto;width:15px;height:15px}.choice-label{display:block;white-space:nowrap}
      .toast{display:none;max-width:260px;background:#111318;color:#fff;border:1px solid rgba(255,255,255,.14);border-radius:9px;padding:9px 12px;font-size:12px;line-height:1.45}.wrap.toast-on .seed,.wrap.toast-on .bar{display:none}.wrap.toast-on .toast{display:block}
      svg{fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
      @media (prefers-reduced-motion:reduce){.wrap.on{animation:none}}
    </style>
    <div class="wrap" role="toolbar" aria-label="Xenho 网页助手">
      <button class="seed" type="button" aria-label="展开 Xenho 工具条"><svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg></button>
      <div class="bar"></div><div class="toast" role="status"></div>
    </div>`;
  const wrap = shadow.querySelector(".wrap");
  const bar = shadow.querySelector(".bar");
  const toast = shadow.querySelector(".toast");
  let snapshot = null;
  let timer = null;
  let captureTimer = null;
  let repositionFrame = null;
  let selectedRange = null;
  let selectionAnchor = null;
  let focusAtStart = false;

  const svg = (body) => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  for (const [key, label, hint] of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action";
    button.dataset.action = key;
    button.setAttribute("aria-label", label);
    button.innerHTML = `${svg(icons[key])}<span class="tip"><b>${label}</b>${hint}</span>`;
    bar.appendChild(button);
  }
  const intakeAction = bar.querySelector('[data-action="intake"]');
  intakeAction.setAttribute("aria-haspopup", "menu");
  intakeAction.setAttribute("aria-expanded", "false");
  const intakeMenu = document.createElement("div");
  intakeMenu.className = "intake-menu";
  intakeMenu.setAttribute("role", "menu");
  intakeMenu.setAttribute("aria-label", "选择入库位置");
  intakeMenu.innerHTML = `
    <button class="intake-choice" type="button" role="menuitem" data-target="collection" aria-label="收藏到收件箱">
      ${svg('<path d="M4 5h16l-2 14H6Z"/><path d="M4 13h4l2 3h4l2-3h4"/><path d="M12 3v7"/><path d="m9 7 3 3 3-3"/>')}
      <span class="choice-label">收件箱</span>
    </button>
    <button class="intake-choice" type="button" role="menuitem" data-target="inbox" aria-label="存入灵感库">
      ${svg('<path d="M12 3a6 6 0 0 0-3.7 10.7c.9.7 1.2 1.4 1.2 2.3h5c0-.9.3-1.6 1.2-2.3A6 6 0 0 0 12 3Z"/><path d="M10 20h4"/>')}
      <span class="choice-label">灵感库</span>
    </button>
    <button class="intake-choice" type="button" role="menuitem" data-target="material" aria-label="存入素材库">
      ${svg('<path d="M4 4h16v5H4z"/><path d="M6 9v11h12V9"/><path d="M10 13h4"/>')}
      <span class="choice-label">素材库</span>
    </button>`;
  bar.appendChild(intakeMenu);

  function blockedSelection(node) {
    const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return !!el?.closest("input,textarea,select");
  }

  function normalizePlainText(value) {
    return String(value || "")
      .replace(/\r\n?/g, "\n")
      .replace(/\u00a0/g, " ")
      .split("\n")
      .map((line) => line.replace(/[\t ]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function renderSelectionNode(node, depth = 0) {
    if (node.nodeType === Node.TEXT_NODE) return String(node.nodeValue || "").replace(/\s+/g, " ");
    if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return "";
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      return [...node.childNodes].map((child) => renderSelectionNode(child, depth)).join("");
    }
    const tag = node.tagName.toLowerCase();
    if (["script", "style", "noscript", "template", "svg", "button", "input", "textarea", "select", "option"].includes(tag)) return "";
    if (tag === "br") return "\n\n";
    if (tag === "img") {
      const alt = String(node.getAttribute("alt") || "").trim();
      return alt ? ` ${alt} ` : "";
    }
    if (tag === "pre") {
      const code = String(node.textContent || "").replace(/\r\n?/g, "\n").trim();
      return code ? `\n\n\`\`\`\n${code}\n\`\`\`\n\n` : "";
    }
    const inner = [...node.childNodes].map((child) => renderSelectionNode(child, depth + 1)).join("");
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      return `\n\n${"#".repeat(level)} ${inner.trim()}\n\n`;
    }
    if (tag === "li") {
      const parent = node.parentElement?.tagName.toLowerCase();
      const index = parent === "ol" ? `${[...node.parentElement.children].indexOf(node) + 1}.` : "-";
      return `${index} ${inner.trim()}\n`;
    }
    if (tag === "blockquote") {
      const quoted = normalizePlainText(inner).split("\n").map((line) => `> ${line}`).join("\n");
      return `\n\n${quoted}\n\n`;
    }
    if (tag === "tr") {
      const cells = [...node.children].map((cell) => normalizePlainText(renderSelectionNode(cell, depth + 1))).filter(Boolean);
      return cells.length ? `\n${cells.join(" | ")}\n` : "";
    }
    if (["p", "div", "section", "article", "main", "aside", "figure", "figcaption", "table", "ul", "ol", "dl", "dt", "dd"].includes(tag)) {
      return `\n\n${inner.trim()}\n\n`;
    }
    return inner;
  }

  function selectionMarkdown(range, fallback) {
    try {
      const rendered = renderSelectionNode(range.cloneContents());
      const normalized = rendered
        .replace(/\u00a0/g, " ")
        .replace(/[\t ]+\n/g, "\n")
        .replace(/\n[\t ]+/g, "\n")
        .replace(/[\t ]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      if (normalized.length >= 2) return normalized;
    } catch { /* selection DOM may be replaced while the event is settling */ }
    return normalizePlainText(fallback);
  }

  function nearby(node) {
    const el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    const root = el?.closest("article,main,[role=main],section") || document.querySelector("article,main,[role=main]") || document.body;
    return normalizePlainText(root?.innerText).slice(0, 6000);
  }

  function hide() {
    clearTimeout(timer);
    clearTimeout(captureTimer);
    wrap.classList.remove("on", "open", "toast-on", "fresh", "choosing", "menu-up");
    intakeAction.setAttribute("aria-expanded", "false");
    snapshot = null;
    selectedRange = null;
    selectionAnchor = null;
    focusAtStart = false;
  }

  function place(rect) {
    const width = wrap.classList.contains("open") ? 230 : 30;
    const height = wrap.classList.contains("open") ? 42 : 30;
    const gapX = wrap.classList.contains("open") ? 6 : 2;
    const gapY = wrap.classList.contains("open") ? 7 : -3;
    let left = rect.right + gapX;
    if (left + width > innerWidth - 8) left = rect.left - width - gapX;
    let top = rect.bottom + gapY;
    if (top + height > innerHeight - 8) top = rect.top - height - 6;
    left = Math.max(8, Math.min(innerWidth - width - 8, left));
    top = Math.max(8, Math.min(innerHeight - height - 8, top));
    wrap.style.left = `${Math.round(left)}px`;
    wrap.style.top = `${Math.round(top)}px`;
  }

  // Range#getBoundingClientRect() 返回多行选区的整块外框，right 会落到最长那一行，
  // 于是按钮可能离真正的收笔位置几百像素。优先取用户松开鼠标的 focus 端点；
  // 浏览器不给折叠光标矩形时，再回退到选区最后一个可见片段。
  function endpointRect(selection, range) {
    try {
      const caret = document.createRange();
      caret.setStart(selection.focusNode, selection.focusOffset);
      caret.collapse(true);
      const rect = caret.getBoundingClientRect();
      if (rect.height || rect.width) return rect;
    } catch { /* DOM may change between selection and capture */ }
    const fragments = [...range.getClientRects()].filter((rect) => rect.height || rect.width);
    return fragments.at(-1) || range.getBoundingClientRect();
  }

  function storedEndpointRect(range) {
    try {
      const caret = range.cloneRange();
      caret.collapse(focusAtStart);
      const rect = caret.getBoundingClientRect();
      if (rect.height || rect.width) return rect;
    } catch { /* the source DOM may have been replaced */ }
    const fragments = [...range.getClientRects()].filter((rect) => rect.height || rect.width);
    return (focusAtStart ? fragments[0] : fragments.at(-1)) || range.getBoundingClientRect();
  }

  function reposition() {
    repositionFrame = null;
    if (!wrap.classList.contains("on") || !selectedRange) return;
    try {
      const rect = storedEndpointRect(selectedRange);
      if (!rect.width && !rect.height) return;
      selectionAnchor = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      place(selectionAnchor);
    } catch { /* keep the last safe viewport position */ }
  }

  function scheduleReposition() {
    if (!repositionFrame) repositionFrame = requestAnimationFrame(reposition);
  }

  function capture() {
    const selection = document.getSelection();
    const rawText = selection?.toString() || "";
    if (!rawText.trim() || rawText.trim().length < 2 || !selection.rangeCount) return;
    if (blockedSelection(selection.anchorNode) || blockedSelection(selection.focusNode)) return hide();
    const range = selection.getRangeAt(0).cloneRange();
    const rect = endpointRect(selection, range);
    if (!rect.width && !rect.height) return;
    const text = selectionMarkdown(range, rawText);
    if (text.length < 2) return;
    selectedRange = range;
    focusAtStart = range.startContainer === selection.focusNode && range.startOffset === selection.focusOffset;
    selectionAnchor = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    snapshot = { selection: text.slice(0, 8000), context: nearby(selection.anchorNode), title: document.title, url: location.href };
    wrap.classList.remove("open", "toast-on", "fresh", "choosing", "menu-up");
    intakeAction.setAttribute("aria-expanded", "false");
    wrap.classList.add("on");
    place(selectionAnchor);
  }

  function showToast(text, error = false, duration = error ? 3500 : 1800) {
    toast.textContent = text;
    toast.style.borderColor = error ? "#d25c4d" : "#e0ad49";
    wrap.classList.add("on", "toast-on");
    clearTimeout(timer);
    timer = setTimeout(hide, duration);
  }

  async function sendToExtension(payload) {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.sendMessage) throw new Error("扩展已更新，请刷新当前页面后再试");
    try {
      return await runtime.sendMessage(payload);
    } catch (error) {
      if (!globalThis.chrome?.runtime?.sendMessage || /extension context invalidated/i.test(String(error?.message || error))) {
        throw new Error("扩展已更新，请刷新当前页面后再试");
      }
      throw error;
    }
  }

  function toggleIntakeMenu() {
    const opening = !wrap.classList.contains("choosing");
    wrap.classList.toggle("choosing", opening);
    wrap.classList.remove("fresh", "menu-up");
    intakeAction.setAttribute("aria-expanded", String(opening));
    if (!opening) return;
    const barRect = bar.getBoundingClientRect();
    const menuHeight = intakeMenu.offsetHeight || 38;
    wrap.classList.toggle("menu-up", barRect.bottom + menuHeight + 16 > innerHeight);
    intakeMenu.querySelector("button")?.focus({ preventScroll: true });
  }

  function scheduleCapture(delay = 0) {
    clearTimeout(captureTimer);
    captureTimer = setTimeout(capture, delay);
  }

  function captureAfterSelectionGesture(event, delay = 0) {
    if (event.composedPath().includes(host)) return;
    scheduleCapture(delay);
  }

  document.addEventListener("pointerup", (event) => captureAfterSelectionGesture(event), true);
  document.addEventListener("mouseup", (event) => captureAfterSelectionGesture(event), true);
  document.addEventListener("touchend", (event) => captureAfterSelectionGesture(event, 40), true);
  document.addEventListener("selectionchange", () => {
    if (document.getSelection()?.toString().trim()) scheduleCapture(70);
  }, true);
  document.addEventListener("keyup", (event) => {
    if (event.key === "Escape") return hide();
    if (event.shiftKey || event.key.startsWith("Arrow")) scheduleCapture();
  }, true);
  document.addEventListener("pointerdown", (event) => {
    if (event.composedPath().includes(host)) return;
    setTimeout(() => {
      if (!document.getSelection()?.toString().trim()) hide();
    }, 0);
  }, true);
  addEventListener("scroll", scheduleReposition, true);
  addEventListener("resize", scheduleReposition, true);
  new MutationObserver(attachHost).observe(document.documentElement, { childList: true });

  shadow.querySelector(".seed").addEventListener("click", (event) => {
    if (!event.isTrusted || !selectedRange || !selectionAnchor) return;
    wrap.classList.add("open", "fresh");
    place(selectionAnchor);
  });
  bar.addEventListener("pointermove", (event) => {
    if (event.movementX || event.movementY) wrap.classList.remove("fresh");
  });
  bar.addEventListener("keydown", () => wrap.classList.remove("fresh"));
  shadow.addEventListener("pointerdown", (event) => event.preventDefault());
  bar.addEventListener("click", async (event) => {
    const choice = event.target.closest("button[data-target]");
    const button = choice || event.target.closest("button[data-action]");
    if (!button || !event.isTrusted || !snapshot) return;
    let action = choice ? "intake" : button.dataset.action;
    if (action === "intake-menu") return toggleIntakeMenu();
    const target = choice?.dataset.target || (action === "intake" ? "collection" : "");
    wrap.classList.remove("choosing", "menu-up");
    intakeAction.setAttribute("aria-expanded", "false");
    for (const item of bar.querySelectorAll("button")) item.disabled = true;
    if (action === "intake") showToast(target === "collection" ? "正在收藏…" : target === "inbox" ? "正在存入灵感库…" : "正在存入素材库…");
    try {
      const result = await sendToExtension({ type: "XENHO_CAPTURE", action, target, context: snapshot, eventTrusted: true });
      if (!result?.ok) throw new Error(result?.error || "操作失败");
      if (action === "intake") showToast(result.message || (target === "collection" ? "已收藏到收件箱" : target === "inbox" ? "已存入灵感库" : "已存入素材库"), false, result.queued ? 4200 : 1800);
      else hide();
    } catch (error) {
      showToast(error.message || "工作台暂时不可用", true);
    } finally {
      for (const item of bar.querySelectorAll("button")) item.disabled = false;
    }
  });
})();
