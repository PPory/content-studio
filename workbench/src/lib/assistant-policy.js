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
    history: true,
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

/**
 * surface 只描述**呈现方式**，不影响能力（见文件开头那条不变式）。
 *
 * ⚠️ **这里不再记宽度。** 原来每个 surface 都带一个 `width`（520 / 336 / "column"），
 * 而**没有任何地方读它**——真正决定宽度的一直是 CSS。于是它成了一份安静的假数：
 * 侧栏从浮层的 520px 改成 420px 之后，这里还写着 520，谁也不会发现，
 * 而下一个来读代码的人会拿它当真。宽度的唯一真源是 `quick-assistant.css` / `--asst-measure`。
 */
export const ASSISTANT_SURFACES = Object.freeze({
  page: Object.freeze({ history: "sidebar", dismiss: "route" }),
  overlay: Object.freeze({ history: "button", dismiss: "escape" }),
  rail: Object.freeze({ history: "button", dismiss: "collapse" }),
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
      writeAtCursor: candidate,
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
