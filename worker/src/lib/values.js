// 库里所有枚举值的**唯一副本**。
//
// 真源是 schema.sql 的 CHECK 约束，这里是给 JS 侧用的镜像——两边必须逐字一致，
// 对不上的话写入会被数据库直接拒掉（这正是想要的：Notion 时代改个选项名，代码
// 要到某个半年才走一次的分支里才 400，现在是立刻炸在写入处）。
//
// 为什么单独一个文件而不是塞进 db.js：integrity.js 要用其中几个值，而它的约定是
// 「不依赖 Notion、LLM 或 Workers 绑定，以便用 Node 内置测试直接覆盖」。常量文件
// 保持零依赖，两边都能引。
//
// 改这里之前先改 schema.sql，并且写一条迁移语句——CHECK 约束不能靠 ALTER 改，
// SQLite 要重建表。别在生产库上手改。

/**
 * 素材类型。
 *
 * 这一份是原来 triage.js（8 种）和 store.js（11 种）两份定义的并集。它们原先不一致，
 * 症状是「延展问题」能被初筛写进库、却不在手工入库的白名单里——同一个库两套规矩，
 * 谁也没报错。
 */
export const MATERIAL_TYPES = new Set([
  "核心观点", "金句/原话", "数据/事实", "案例/故事", "框架/模型",
  "反直觉点", "个人经历", "延展问题",
  // 以下三类由发布复盘自动产生，不要求用户手填
  "标题样本", "内容角度", "平台反馈",
]);

export const DEFAULT_MATERIAL_TYPE = "核心观点";

/** LLM 输出用 `·`（金句·原话），库里用 `/`（金句/原话）。归一并兜底到默认类型。 */
export function normMaterialType(value) {
  const s = String(value || "").replaceAll("·", "/").trim();
  return MATERIAL_TYPES.has(s) ? s : DEFAULT_MATERIAL_TYPE;
}

export const INBOX_KINDS = new Set(["文章链接", "视频链接", "想法", "摘录"]);

export const INBOX_STATUS = {
  PENDING: "待初筛",
  TO_CLUSTER: "待选题",
  CLUSTERED: "已选题",
  ARCHIVED: "存档备用",
  DROPPED: "已弃用",
  FAILED: "初筛失败/需人工",
};

/** 灵感「价值判断」，与状态由同一个 LLM value 推导，两者不能各判各的。 */
export const VALUE_JUDGMENT = { 高: "值得深挖", 中: "存档备用", 低: "建议弃用" };
export const STATUS_BY_VALUE = {
  高: INBOX_STATUS.TO_CLUSTER,
  中: INBOX_STATUS.ARCHIVED,
  低: INBOX_STATUS.DROPPED,
};

export const TOPIC_STATUS = {
  TODO: "待写",
  WRITING: "撰写中",
  DRAFTED: "已成稿",
  PUBLISHED: "已发布",
  PARKED: "搁置",
};

export const DRAFT_STATUS = { TODO: "待修改", PUBLISHED: "已发布" };

export const PLATFORMS = new Set(["公众号", "X", "小红书", "视频号", "YouTube"]);
export const PRIORITIES = new Set(["高", "中", "低"]);

export const VERIFICATION = { NA: "不适用", PENDING: "待核验", VERIFIED: "已核验" };
