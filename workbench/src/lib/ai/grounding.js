const clean = (value) => String(value || "").trim();

function usedItem(item) {
  if (typeof item === "string") return { id: item, title: item };
  return { id: clean(item?.id || item?.title), title: clean(item?.title || item?.id) };
}

export function skippedNextStep(item = {}) {
  if (item.nextStep?.id && item.nextStep?.label) return item.nextStep;
  if (item.reasonCode === "unverified" || /待核验|未核验|待验证/.test(clean(item.reason))) {
    return { id: "verify", label: "去核验" };
  }
  return { id: "use-anyway", label: "仍然使用" };
}

export function normalizeGrounding(value) {
  if (!value) return null;
  const used = (Array.isArray(value.used) ? value.used : []).map(usedItem).filter((item) => item.id && item.title);
  const skipped = (Array.isArray(value.skipped) ? value.skipped : []).map((item) => {
    const normalized = typeof item === "string" ? { id: item, title: item, reason: "未说明跳过原因" } : {
      id: clean(item?.id || item?.title),
      title: clean(item?.title || item?.id),
      reason: clean(item?.reason) || "未说明跳过原因",
      reasonCode: clean(item?.reasonCode),
      nextStep: item?.nextStep,
    };
    return { ...normalized, nextStep: skippedNextStep(normalized) };
  }).filter((item) => item.id && item.title);
  const unverified = (Array.isArray(value.unverified) ? value.unverified : []).map((item) => ({
    quote: clean(item?.quote),
    why: clean(item?.why) || "尚未核验",
  })).filter((item) => item.quote);
  return {
    used,
    skipped,
    unverified,
    gate: value.gate === "rejected" ? "rejected" : "passed",
    gateDetail: clean(value.gateDetail),
  };
}

export function materialDraftGrounding(selected = [], result = {}) {
  const skipped = Array.isArray(result.skipped) ? result.skipped : [];
  const skippedIds = new Set(skipped.map((item) => clean(typeof item === "string" ? item : item?.id || item?.title)));
  return normalizeGrounding(result.grounding || {
    used: selected.filter((item) => !skippedIds.has(clean(item?.id)) && !skippedIds.has(clean(item?.title))),
    skipped,
    unverified: result.unverified || [],
    gate: result.gate || "passed",
    gateDetail: result.gateDetail,
  });
}
