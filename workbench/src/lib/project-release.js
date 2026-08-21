export function projectReleaseDrafts(project = {}) {
  const source = project || {};
  return [source.masterDraft, ...(source.variants || [])].filter(Boolean);
}

export function releaseForm(draft = {}) {
  return {
    title: draft.title || "",
    body: draft.body || "",
    summary: draft.release?.summary ?? draft.summary ?? "",
    coverUrl: draft.release?.coverUrl || "",
    coverText: draft.release?.coverText || "",
    coverNote: draft.release?.coverNote || "",
    keywords: (draft.release?.keywords || []).join("，"),
    interactionGoal: draft.release?.interactionGoal || "",
  };
}

export function releaseChanged(draft, form = {}) {
  const original = releaseForm(draft);
  return Object.keys(original).some((key) => String(form[key] ?? "") !== String(original[key] ?? ""));
}

export function releasePayload(form = {}) {
  return {
    ...form,
    keywords: String(form.keywords || "").split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean),
  };
}
