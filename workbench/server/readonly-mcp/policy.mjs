// This is an explicit data contract, not a SQL or filesystem interface.
export const POLICY_VERSION = 1;
export const LIMITS = Object.freeze({ rows: 20000, perDataset: 3000, text: 100000, bytes: 32 * 1024 * 1024, refreshMs: 5000, cooldownMs: 300000, maxAgeMs: 86400000, callsPerMinute: 60, auditBytes: 10 * 1024 * 1024 });
const entity = (columns, extra = '') => ({ columns: columns.split(' '), entity: true, extra });
export const DATASETS = Object.freeze({
  entries: entity('id name entry_kind definition definition_source_id'),
  project_notebooks: { columns: ['project_id', 'version', 'notes_json', 'agenda_id'], entity: true, key: 'project_id' },
  intel_briefs: { columns: ['id', 'data_json', 'version', 'saved', 'helpful', 'edition_date', 'created_at', 'updated_at'], extra: 't.dismissed=0' },
  intel_cards: { columns: ['id', 'data_json', 'status', 'research_id', 'created_at', 'updated_at'] },
  intel_reports: { columns: ['id', 'data_json', 'created_at'] },
  intel_sources: { columns: ['id', 'data_json', 'created_at'], extra: "t.capture_id IS NULL OR EXISTS (SELECT 1 FROM entities p WHERE p.id=t.capture_id AND p.deleted_at IS NULL)" },
  captures: entity('id title body_markdown capture_kind capture_bucket status reaction'),
  seeds: entity('id title reaction status source_entity_id'),
  materials: entity('id title body_markdown material_type verification_status verification_note source_entity_id'),
  projects: entity('id title brief_markdown viewpoint audience primary_platform priority status'),
  drafts: entity('id title body_markdown project_id platform workflow_status publication_status', "EXISTS (SELECT 1 FROM entities p WHERE p.id=t.project_id AND p.deleted_at IS NULL)"),
  content_series: entity('id title description_markdown audience outcome status'),
  books: entity('id title author reading_status'),
  book_documents: entity('id title body_markdown book_id document_order', "EXISTS (SELECT 1 FROM entities p WHERE p.id=t.book_id AND p.deleted_at IS NULL)"),
  book_marks: entity('id book_id document_id mark_kind quote_text note_markdown', "EXISTS (SELECT 1 FROM entities p WHERE p.id=t.book_id AND p.deleted_at IS NULL) AND EXISTS (SELECT 1 FROM entities p WHERE p.id=t.document_id AND p.deleted_at IS NULL)"),
  knowledge_items: entity('id title body_markdown quote_text knowledge_kind book_id'),
  wiki_pages: entity('id title page_type summary body_markdown source_entity_id current_revision'),
  researches: entity('id question notes open_questions version'),
  content_agendas: entity('id title audience problem_space desired_judgment value_commitment status'),
  audience_problems: entity('id statement summary pattern status'),
  content_opportunities: entity('id wiki_page_id audience_problem_id agenda_id core_claim knowledge_explanation cognitive_gap dominant_action fit fit_reason status'),
  content_experiments: entity('id project_id hypothesis_markdown recorded_at publication_id outcome_markdown learning_markdown verdict settled_at'),
  publication_records: entity('id draft_id title platform published_at'),
  external_publication_records: entity('id title platform published_at views likes comments collects shares'),
  metric_snapshots: entity('id publication_id captured_at views likes comments collects shares'),
  account_metric_snapshots: entity('id metric_date platform followers views note'),
  reviews: entity('id publication_id status basis_markdown conclusion_markdown next_experiment_markdown reviewed_at'),
  ai_conversations: entity('id title record_json', "t.scope_id IS NULL OR t.scope_id NOT LIKE 'personal%'") ,
  ai_messages: entity('id conversation_id sequence role body_markdown', "t.role IN ('user','assistant') AND EXISTS (SELECT 1 FROM entities p JOIN ai_conversations c ON c.id=p.id WHERE p.id=t.conversation_id AND p.deleted_at IS NULL AND (c.scope_id IS NULL OR c.scope_id NOT LIKE 'personal%'))"),
  personal_assets: entity('id kind title body event_date usage version', "t.usage='reference'"),
});

// Defense in depth for free text. This cannot prove arbitrary prose contains no secrets.
export function redact(text) {
  return String(text)
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, '[REDACTED_PRIVATE_KEY]')
    .replace(/\b(?:sk-[\w-]{12,}|gh[pousr]_[\w]{16,}|github_pat_[\w]{16,}|AKIA[A-Z0-9]{16}|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g, '[REDACTED_TOKEN]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|authorization|password|passwd|secret|密钥|密码)["']?\s*[:=：]\s*)[^\r\n,;}]+/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [REDACTED]')
    .replace(/https?:\/\/[^\s<>"')]+/gi, value => { try { const u = new URL(value); u.username = ''; u.password = ''; u.search = ''; u.hash = ''; return u.href; } catch { return '[REDACTED_URL]'; } })
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g, '[REDACTED_PHONE]')
    .replace(/\b\d{17}[\dXx]\b/g, '[REDACTED_ID]')
    .replace(/[A-Z]:[\\/][^\s"'<>]+/gi, '[REDACTED_PATH]');
}

export function projectRow(row) {
  const result = {};
  let truncated = false;
  for (const [key, value] of Object.entries(row)) {
    if (key === 'data_json' || key === 'notes_json') {
      const content = {};
      if (typeof value === 'string' && value.length <= LIMITS.text) {
        try {
          const data = JSON.parse(value);
          const allowed = key === 'notes_json'
            ? ['thought', 'audience', 'intent', 'questions', 'evidenceNotes']
            : ['title', 'summary', 'body', 'technical', 'whyNow', 'whyItMatters', 'claim', 'judgment', 'question', 'url', 'publishedAt'];
          for (const field of allowed) if (typeof data[field] === 'string') content[field] = redact(data[field]);
          if (Array.isArray(data.evidence)) content.evidence = data.evidence.slice(0, 100).map(e => ({ sourceId: redact(e.sourceId || ''), quote: redact(e.quote || '') }));
        } catch { truncated = true; }
      } else truncated = true;
      result[key === 'data_json' ? 'data' : 'notebook'] = content;
    } else if (key === 'record_json') {
      if (typeof value !== 'string' || value.length > LIMITS.text) { result.messages = []; truncated = true; continue; }
      try {
        const messages = JSON.parse(value).messages;
        result.messages = (Array.isArray(messages) ? messages : []).filter(m => ['user', 'assistant'].includes(m?.role) && typeof m.text === 'string')
          .slice(-100).map(m => ({ role: m.role, text: redact(m.text).slice(0, LIMITS.text) }));
        if (Array.isArray(messages) && messages.length > 100) truncated = true;
      } catch { result.messages = []; truncated = true; }
    } else if (typeof value === 'string') {
      if (value.length > LIMITS.text) truncated = true;
      result[key] = redact(value).slice(0, LIMITS.text);
    } else if (value === null || typeof value === 'number') result[key] = value;
  }
  return { ...result, truncated };
}
