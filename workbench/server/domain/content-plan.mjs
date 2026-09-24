// 一篇内容在「选题」阶段要回答的几件事（2026-09-24）：从哪来、什么时候之前写、还缺什么。
//
// 全部从已有记录推出来，不另存状态、不调模型：
// - 来源：关联研究里的情报意图 → 情报；内容机会 → 我的知识；种子 → 记下的想法；都没有 → 自己新建。
// - 建议时效：情报加入时的 24 小时 / 本周，从加入时刻起算，过了就不再显示（不是截止日期）。
// - 还缺什么：构思清单里没勾的项，加上「你的实测」——它按这篇内容挂没挂经历类个人资产推算。
import { openItems } from '../../src/lib/content-checklist.js';
import { getProjectNotebook } from './project-notebook.mjs';
import { authorizedPersonalAssets } from './personal-assets.mjs';
import { researchIntelligenceIntents } from './intelligence-topic-intents.mjs';

const WINDOW_MS = { '24h': 86400000, week: 7 * 86400000 };
export const EXPERIENCE_ITEM = '你的实测 / 使用体验';

function linkedResearchId(w, projectId) {
  return w.db.prepare('SELECT r.id FROM researches r JOIN research_projects l ON l.research_id=r.id JOIN entities e ON e.id=r.id AND e.deleted_at IS NULL WHERE l.project_id=? ORDER BY l.created_at LIMIT 1').get(projectId)?.id || null;
}

export function projectPlanSummary(w, projectId, { now = Date.now() } = {}) {
  const notebook = getProjectNotebook(w, projectId);
  const researchId = linkedResearchId(w, projectId);
  const intents = researchId ? researchIntelligenceIntents(w, researchId).filter(i => !i.unavailable) : [];
  const latest = intents.at(-1) || null;
  let origin = { kind: 'own' };
  if (latest) {
    const ends = WINDOW_MS[latest.creation?.window] ? Date.parse(latest.createdAt) + WINDOW_MS[latest.creation.window] : null;
    origin = { kind: 'intel', title: latest.brief?.title || '', briefId: latest.brief?.id || latest.briefIds?.[0] || null, window: ends && ends > now ? latest.creation.window : null, windowEndsAt: ends && ends > now ? new Date(ends).toISOString() : null };
  } else if (w.contentBridge?.projectOpportunity?.(projectId)) origin = { kind: 'bridge', title: w.contentBridge.projectOpportunity(projectId).coreClaim || '' };
  else if (w.db.prepare('SELECT seed_id FROM projects WHERE id=?').get(projectId)?.seed_id) origin = { kind: 'seed' };
  const experience = authorizedPersonalAssets(w.db, projectId).some(a => a.kind === 'experience');
  return { researchId, origin, experience, missing: [...(experience ? [] : [EXPERIENCE_ITEM]), ...openItems(notebook.questions)], thought: notebook.thought || '' };
}
