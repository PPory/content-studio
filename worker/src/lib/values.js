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

/**
 * 创作流程状态独立于旧发布状态。发布必须同时写入两者；其余阶段只改这一列。
 *
 * ⚠️ **只有三档：写作中 → 待发布 → 已发布**（另有 已弃用）。
 *
 * ⚠️ **`DIAGNOSIS`（待诊断）是历史值，代码不再写入。** 常量留着是因为
 * `schema.sql` 的 CHECK 里还有它，而且库里可能还有旧行——**读到要认得，写绝不能写**。
 * 撤掉的理由：它在这个 Worker 里**没有任何实现**（没有功能、没有提示词、没有端点），
 * 全部含义就是"发出去之前你自己再读一遍"，而界面上同时有三处指着它、
 * 其中一处指向一个不存在的动作。**没有工具的闸门只是一个多出来的状态。**
 */
export const DRAFT_WORKFLOW = {
  WRITING: "写作中",
  /** @deprecated 历史值：只读兼容，不再写入。见上面那段注释 */
  DIAGNOSIS: "待诊断",
  READY: "待发布",
  PUBLISHED: "已发布",
  ABANDONED: "已弃用",
};

/**
 * 种子的反应清单。**这是这条链的起点**：看到一个东西，选一条、补上后半句，
 * 一篇短文的骨架当场就有了（「我不同意，因为___」本身就是全部结构）。
 *
 * ⚠️ **它是文案，不是状态**——所以 `seeds.reaction` 没有 CHECK 约束，白名单只有这一份。
 * 改措辞、加减条数都只动这儿，不用迁移。
 *
 * ⚠️ **分组不是装饰，是这份清单能用的前提。** 第一版七条**全都假设触发物是「一个观点」**，
 * 于是「DeepSeek 发布了 V4-Flash，我想写」一条都选不上——**你没法「同意」或「不同意」一件事实**。
 * 而热点里大量是发布和事件。补上事件那一组之后清单有十条，平铺的话每次都得从头扫到尾；
 * 分了组，你看到一条新闻只会看中间那三条。**所以加组和加条是同一件事，别只加条。**
 *
 * ⚠️ **顺序有意义**：每组里最常用也最好下笔的排最前。界面上按这个顺序画，
 * 别按字母或长度重排。
 */
export const SEED_REACTION_GROUPS = Object.freeze([
  Object.freeze({
    label: "对着一个观点",
    items: Object.freeze([
      "同意，而且我有个例子",
      "不同意，因为…",
      "这个说法有个前提没说出来",
      "说得对，但只在某种情况下成立",
      "我以前也这么以为，后来发现…",
    ]),
  }),
  Object.freeze({
    label: "对着一件事 / 一个发布",
    items: Object.freeze([
      // 「我试了」排第一是有理由的：**体感是只有你有的东西**，
      // 而一条发布的解读满互联网都是。
      "我试了，说说体感",
      "这件事真正的影响是…",
      "和之前 / 别家比，变的是…",
    ]),
  }),
  Object.freeze({
    label: "都能用",
    items: Object.freeze([
      "这让我想起另一件事",
      "这解释了我一直没想明白的",
    ]),
  }),
]);

/**
 * 扁平清单**从分组算出来，不手写第二份**。
 * 校验（`normalizeSeedInput`）和旧客户端都还在用它，而两份手写的清单迟早对不上——
 * 那时的症状是「界面上能选的某一条，存进去被清空了」，两边都不报错。
 */
export const SEED_REACTIONS = Object.freeze(SEED_REACTION_GROUPS.flatMap((g) => g.items));

/** 种子的状态。**这个是真状态**（影响流转），schema 里有 CHECK 兜着。 */
export const SEED_STATUS = Object.freeze({ KEEPING: "攒着", WRITTEN: "写了", DROPPED: "不写了" });

/** 触发物的种类。`none` = 干活时想到的，没有触发物——**那往往是你最有话说的**。 */
export const SEED_SOURCE_KINDS = Object.freeze(["none", "hot", "inbox", "material"]);

export const PLATFORMS = new Set(["公众号", "X", "小红书", "视频号", "YouTube"]);
export const PRIORITIES = new Set(["高", "中", "低"]);

export const VERIFICATION = { NA: "不适用", PENDING: "待核验", VERIFIED: "已核验" };
