const CANDIDATE_TARGET_KINDS = new Set(["draft", "vault-document"]);

export const ASSISTANT_SCOPES = Object.freeze({
  global: Object.freeze({
    baseResults: Object.freeze(["answer", "action"]),
    session: () => "global:assistant",
    requestMode: "general",
    history: true,
    projectContext: false,
    documentContext: false,
    writingStyle: false,
    allExperts: true,
    knowledgeCardSource: "AI 助手对话",
  }),
  project: Object.freeze({
    baseResults: Object.freeze(["answer", "report", "action"]),
    session: (id) => `project:${id}`,
    requestMode: "content",
    history: false,
    projectContext: true,
    documentContext: true,
    writingStyle: true,
    allExperts: false,
    knowledgeCardSource: "内容项目对话",
  }),
  reading: Object.freeze({
    baseResults: Object.freeze(["answer"]),
    session: (kind, id) => `reading:${kind}:${id}`,
    requestMode: "content",
    history: false,
    projectContext: false,
    documentContext: true,
    writingStyle: true,
    allExperts: false,
    knowledgeCardSource: "内容项目对话",
  }),
});

export const ASSISTANT_SURFACES = Object.freeze({
  page: Object.freeze({ history: "sidebar", width: "column", dismiss: "route" }),
  overlay: Object.freeze({ history: "button", width: 520, dismiss: "escape" }),
  rail: Object.freeze({ history: "button", width: 336, dismiss: "collapse" }),
});

/**
 * Assistant 能做什么只由 scope + target 决定；surface 不得增加或削弱能力。
 */
export function resolveAssistantPolicy({ scope, target = {} }) {
  const base = ASSISTANT_SCOPES[scope];
  if (!base) throw new TypeError(`Unknown assistant scope: ${scope}`);

  const targetKind = target.kind || "none";
  const candidate = Boolean(target.editable && CANDIDATE_TARGET_KINDS.has(targetKind));
  const selectionCandidate = Boolean(candidate && target.selection?.text);

  return Object.freeze({
    scope,
    target: Object.freeze({ kind: targetKind, editable: Boolean(target.editable) }),
    results: Object.freeze(candidate ? [...base.baseResults, "candidate"] : [...base.baseResults]),
    requestMode: base.requestMode,
    knowledgeCardSource: base.knowledgeCardSource,
    capabilities: Object.freeze({
      candidate,
      insertCandidate: candidate,
      reviseSelection: selectionCandidate,
      history: base.history,
      projectContext: base.projectContext,
      projectMaterials: base.projectContext,
      projectReports: base.projectContext,
      documentContext: base.documentContext,
      writingStyle: base.writingStyle,
      allExperts: base.allExperts,
    }),
    session: base.session,
  });
}
