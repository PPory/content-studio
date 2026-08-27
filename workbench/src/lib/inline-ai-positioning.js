const DEFAULT_PADDING = 8;
const DEFAULT_GAP = 8;

export function rectOf(value = {}) {
  const left = Number(value.left) || 0;
  const top = Number(value.top) || 0;
  const right = Number.isFinite(Number(value.right)) ? Number(value.right) : left + (Number(value.width) || 0);
  const bottom = Number.isFinite(Number(value.bottom)) ? Number(value.bottom) : top + (Number(value.height) || 0);
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export function intersectRects(first, second) {
  const a = rectOf(first);
  const b = rectOf(second);
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) return null;
  return rectOf({ left, top, right, bottom });
}

export function inlineAiBoundary(editorRect, viewport = {}) {
  return intersectRects(editorRect, {
    left: 0,
    top: 0,
    right: Number(viewport.width) || 0,
    bottom: Number(viewport.height) || 0,
  });
}

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

export function placeInlineAiMenu({
  anchorRect,
  boundaryRect,
  menuRect,
  preferredPlacement = "above",
  padding = DEFAULT_PADDING,
  gap = DEFAULT_GAP,
}) {
  const anchor = rectOf(anchorRect);
  const boundary = rectOf(boundaryRect);
  const menu = rectOf(menuRect);
  const usableWidth = Math.max(0, boundary.width - padding * 2);
  const usableHeight = Math.max(0, boundary.height - padding * 2);
  const width = Math.min(menu.width, usableWidth);
  const height = Math.min(menu.height, usableHeight);
  const spaceAbove = anchor.top - (boundary.top + padding) - gap;
  const spaceBelow = boundary.bottom - padding - anchor.bottom - gap;
  const preferredFits = preferredPlacement === "below" ? height <= spaceBelow : height <= spaceAbove;
  const alternateFits = preferredPlacement === "below" ? height <= spaceAbove : height <= spaceBelow;
  const placement = preferredFits
    ? preferredPlacement
    : alternateFits
      ? (preferredPlacement === "below" ? "above" : "below")
      : (spaceBelow >= spaceAbove ? "below" : "above");
  const idealTop = placement === "above" ? anchor.top - gap - height : anchor.bottom + gap;
  const left = clamp(anchor.left + anchor.width / 2 - width / 2, boundary.left + padding, boundary.right - padding - width);
  const top = clamp(idealTop, boundary.top + padding, boundary.bottom - padding - height);

  return {
    left,
    top,
    placement,
    maxWidth: usableWidth,
    maxHeight: usableHeight,
  };
}
