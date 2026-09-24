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
  } else if (notebook.discovery?.connection) origin = { kind: 'bridge', title: notebook.discovery.connection.problem?.statement || notebook.discovery.connection.coreClaim || '' };
  else if (w.contentBridge?.projectOpportunity?.(projectId)) origin = { kind: 'bridge', title: w.contentBridge.projectOpportunity(projectId).coreClaim || '' };
  else if (w.db.prepare('SELECT seed_id FROM projects WHERE id=?').get(projectId)?.seed_id) origin = { kind: 'seed' };
  const experience = authorizedPersonalAssets(w.db, projectId).some(a => a.kind === 'experience');
  // 走到哪一步（列表卡片上的一句状态）：还没选角度 → 角度 · 还缺 N 项 → 初稿已写。
  const plan = notebook.plan && typeof notebook.plan === 'object' ? notebook.plan : {};
  const open = openItems(notebook.questions);
  const stage = plan.draftAt ? { key: 'draft', label: '初稿已写' }
    : plan.chosenAngle ? { key: 'angle', label: `角度：${plan.chosenAngle.how ? ({ knowledge: '讲知识', judgment: '讲判断', experience: '讲经历', demonstration: '讲展示' })[plan.chosenAngle.how] : '自己定的'}${open.length ? ` · 还缺 ${open.length} 项` : ''}` }
      : { key: 'new', label: plan.angles?.items?.length ? '角度已出，还没选' : '还没选角度' };
  return { researchId, origin, experience, stage, missing: [...(experience ? [] : [EXPERIENCE_ITEM]), ...open], thought: notebook.thought || '' };
}
