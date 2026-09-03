/**
 * 四条链各自的下一步。
 *
 * 这个工作台有四条链，**各自有终点，谁也不服务谁**：
 *
 *   知识  来源 → 划线 → 提取 → 审核 → 词条 → 体检 → 召回     我能想起我知道什么
 *   内容  声音 → 发现 → 构造 → 项目 → 发布 → 结算 → 议程     我讲出去了并且学到了
 *   情报  热点 → 洞察 → 收藏 → 素材                        我知道外面在发生什么
 *   运营  发布 → 数据 → 复盘 → 定位                        我知道发出去之后怎么样
 *
 * 读完一本书提炼出一条词条，这件事本身就结束了——不需要变成一篇内容才算完成。
 *
 * ⚠️ **侧栏给的是产出，不是待办。** 「Wiki 95」说的是已经做完的 95 条；
 * 而这条链今天真正的数字是「还有 1372 节没提炼」，它在界面上原本没有任何位置。
 * 这一层就是为了把那个数字算出来。
 *
 * ⚠️ **这里不调模型，一个字都不生成。** 每条链的下一步是**数出来的**。
 * 算不出来就说这条链现在没事——和长期议程阈值（`content-agenda.mjs`）同一条规矩：
 * 为了填满屏幕硬凑一件待办，比空着更糟，因为它会让人不再相信这块屏幕。
 */

const LANES = Object.freeze([
  { key: "knowledge", label: "知识", goal: "我能想起我知道什么" },
  { key: "content", label: "内容", goal: "我讲出去了，并且学到了" },
  { key: "intel", label: "情报", goal: "我知道外面在发生什么" },
  { key: "ops", label: "运营", goal: "我知道发出去之后怎么样" },
]);

export const LANE_KEYS = Object.freeze(LANES.map((lane) => lane.key));

const count = (db, sql, ...args) => {
  try { return db.prepare(sql).get(...args)?.n ?? 0; } catch { return 0; }
};
const list = (db, sql, ...args) => {
  try { return db.prepare(sql).all(...args); } catch { return []; }
};

/** 一条链的下一步。`view`/`state` 是点进去落到的地方——落到那件事上，不是那个库。 */
function step({ text, count: n = 0, detail = "", action, view, state = "" }) {
  return { text, count: n, detail, action, view, state };
}

/**
 * 知识：卡在哪一步。
 *
 * 顺序就是优先级——**先清已经提出来、等着你点头的东西**，再谈还没开始的。
 * 反过来的话，审核队列会被一个永远更大的「还没提炼」数字盖住。
 */
function knowledgeLane(db) {
  const pending = count(db, "SELECT COUNT(*) AS n FROM source_ingests WHERE status = 'proposed'");
  if (pending) {
    return step({
      text: "条提炼候选等着你点头", count: pending, action: "去审",
      view: "entries", state: "review",
      detail: "AI 已经从来源里读出来了，确认之后才进词条。",
    });
  }

  const unread = count(db, `SELECT COUNT(*) AS n FROM book_documents d
    WHERE NOT EXISTS (SELECT 1 FROM source_ingests s WHERE s.source_entity_id = d.id)`);
  if (unread) {
    const books = list(db, `SELECT b.title, COUNT(*) AS sections FROM book_documents d
      JOIN books b ON b.id = d.book_id
      WHERE NOT EXISTS (SELECT 1 FROM source_ingests s WHERE s.source_entity_id = d.id)
      GROUP BY b.id ORDER BY sections DESC LIMIT 3`);
    return step({
      text: "节还没提炼过", count: unread, action: "挑一节开始",
      view: "shelf",
      detail: books.map((row) => `《${row.title}》${row.sections} 节`).join(" · "),
    });
  }

  const failed = count(db, "SELECT COUNT(*) AS n FROM source_ingests WHERE status = 'failed'");
  if (failed) {
    return step({
      text: "份来源提炼失败了", count: failed, action: "看看为什么",
      view: "sources",
      detail: "失败的来源不会自己重试，也不会消失。",
    });
  }
  return null;
}

/**
 * 内容：卡在哪一步。
 *
 * ⚠️ **证据层薄的时候，它比「还有几篇在写」更该被说出来。**
 * 没有真实原话，后面整条链（发现、构造、议程）都只能空转——
 * 而屏幕上如果只写「6 个在写」，你根本看不出这件事。
 */
function contentLane(db) {
  const unread = count(db, "SELECT COUNT(*) AS n FROM audience_raw_sources WHERE analyzed_at IS NULL");
  if (unread) {
    return step({
      text: "段真实原话还没读过", count: unread, action: "读一下",
      view: "bridge",
      detail: "读出来的用户问题要你确认，AI 不会自己存。",
    });
  }

  const voices = count(db, "SELECT COUNT(*) AS n FROM audience_raw_sources");
  const projects = count(db, `SELECT COUNT(*) AS n FROM projects p
    JOIN entities e ON e.id = p.id AND e.deleted_at IS NULL WHERE p.status = 'active'`);
  const chances = count(db, "SELECT COUNT(*) AS n FROM content_opportunities WHERE status = 'active'");

  /**
   * ⚠️ **只在这条链真的开动了之后，才提证据层薄。**
   * 一个还没开始的工作区里说「只有 0 段原话，扫描看不出反复」，是在指责人
   * 没做一件他还没打算做的事。没动静就说这条链没事。
   */
  if (voices < 3 && (voices || projects || chances)) {
    return step({
      text: "段真实原话，扫描还看不出反复", count: voices, action: "去找找有没有人在说",
      view: "bridge",
      detail: projects ? `另有 ${projects} 个项目在写。` : "",
    });
  }
  if (projects) {
    return step({
      text: "个项目在写", count: projects, action: "继续写",
      view: "content",
      detail: "",
    });
  }

  if (chances) {
    return step({ text: "条内容机会还没立项", count: chances, action: "挑一条发展", view: "bridge" });
  }
  return null;
}

function intelLane(db) {
  const pending = count(db, `SELECT COUNT(*) AS n FROM captures c
    JOIN entities e ON e.id = c.id AND e.deleted_at IS NULL WHERE c.status = 'pending'`);
  if (pending) {
    const items = list(db, `SELECT c.title FROM captures c
      JOIN entities e ON e.id = c.id AND e.deleted_at IS NULL
      WHERE c.status = 'pending' ORDER BY e.created_at DESC LIMIT 3`);
    return step({
      text: "条收藏还没归", count: pending, action: "归一下",
      view: "inbox",
      detail: items.map((row) => row.title || "（无题）").join(" · "),
    });
  }
  return null;
}

/**
 * 运营：卡在哪一步。
 *
 * ⚠️ **「发出去了但工作台里没有对应的稿子」要单独说。**
 * 那些是从平台后台导进来的记录，工作台不知道是谁写的——`Review.jsx` 里已经
 * 记着这件事：以前「已发布 3 篇」和「0 篇等待复盘」会同时挂在屏幕上，
 * 没有任何地方解释。它是一条真实待办，不是数据错误。
 */
function opsLane(db) {
  const open = count(db, "SELECT COUNT(*) AS n FROM content_experiments WHERE verdict = 'open'");
  if (open) {
    return step({
      text: "个假设还没结算", count: open, action: "去结算",
      view: "review",
      detail: "有数据才结算，没有就说没有——不硬给结论。",
    });
  }

  const orphan = count(db, "SELECT COUNT(*) AS n FROM external_publication_records");
  if (orphan) {
    const items = list(db, "SELECT title, platform FROM external_publication_records ORDER BY published_at DESC LIMIT 3");
    return step({
      text: "篇发出去了，工作台里没有对应的稿子", count: orphan, action: "对上",
      view: "review", state: "unmatched",
      detail: items.map((row) => `${row.platform}《${row.title || "无题"}》`).join(" · "),
    });
  }
  return null;
}

const RESOLVERS = { knowledge: knowledgeLane, content: contentLane, intel: intelLane, ops: opsLane };

/**
 * 值班台：四条链此刻各自的下一步。
 *
 * 每条链要么给一个**算得出来的**动作，要么明说现在没事。
 * 顺序固定，不按紧急程度重排——每天同一个位置看同一条链，眼睛才不用重新找。
 */
export function observeLanes(workspace) {
  const db = workspace.db;
  const lanes = LANES.map((lane) => {
    const next = RESOLVERS[lane.key](db);
    return { ...lane, next, quiet: !next };
  });
  return {
    lanes,
    /** 有几条链真的有事。全 0 时界面说「四条链现在都没事」，而不是画一块空板。 */
    busy: lanes.filter((lane) => !lane.quiet).length,
  };
}
