// 一次性数据迁移。**这里的每一段都是历史事实，不是配置。**
//
// 背景：2026-08-13 把 vault 里工作台那几个目录整体搬进了 `99 - 个人工作台/`。
// vault 里的文件跟着目录一起走了，Obsidian 那边也没事——但浏览器本地存的三样东西
// 里存着**完整 vault 路径**，它们不会自己跟着动：
//
//   workbench:reading:v1    键是书目录，值里的 docPath 是章节路径
//   workbench:bookmarks:v1  键里带文档路径
//   workbench:recent:v2     go.open / go.state 里带路径
//
// 不迁移的表现不是报错，是**安静地全部失效**：总览那格「接着读」会空掉（`recentReadings`
// 按 `book.dir` 取，取不到就当没读过），书签一个都不剩，「最近打开」的行点了跳不到那一条。
// 加起来像是「工作台把我读到哪忘了」，而没有任何地方会说出原因。
//
// ⚠️ **这里的新旧路径都写死字面量，故意不引 vault-dirs 那份常量。** 迁移描述的是
// 「从 A 变成了 B」这一次历史事件；引常量的话，以后布局再动一次，这段代码会跟着变成
// 「从 A 变成 C」，而那时候用户的数据早就已经是 B 了——它会把对的数据改坏。
// 以后再搬家就在下面**再加一条**，不要改已有的那条。
const MIGRATIONS = [
  {
    id: "vault-dirs-2026-08-13",
    // 路径在 JSON 里都是完整的值或值的前缀，替换整串是安全的；书名里不可能有 `/`。
    from: ["书架/", "洞察/", "归档/", "网页批注/", "热点/"],
    to: [
      "99 - 个人工作台/01 - 书架/",
      "99 - 个人工作台/02 - 洞察/",
      "99 - 个人工作台/03 - 归档/",
      "99 - 个人工作台/04 - 网页批注/",
      "99 - 个人工作台/09 - 热点/",
    ],
    keys: ["workbench:reading:v1", "workbench:bookmarks:v1", "workbench:recent:v2"],
    guard: "99 - 个人工作台/", // 串里已经有它 = 这份数据已经是新的，别再套一层
  },
];

const DONE_KEY = "workbench:migrated:v1";

function doneSet() {
  try {
    const raw = JSON.parse(localStorage.getItem(DONE_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

/**
 * 跑一遍还没跑过的迁移。**在渲染之前调用**——组件挂载后再改 localStorage 的话，
 * 第一帧读到的是旧数据，屏幕上会先闪一次「没有阅读记录」。
 *
 * 三层保险，因为改错了本地数据是没法回滚的：
 *   1. 跑过的记在 `DONE_KEY` 里，不重复跑
 *   2. 即便重复跑，`guard` 也保证不会二次替换
 *   3. 整段包在 try 里——隐私模式下 localStorage 会抛，而认不出上次读到哪
 *      绝不该让工作台打不开
 */
export function runMigrations() {
  let done;
  try {
    done = doneSet();
  } catch {
    return;
  }
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    for (const key of m.keys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw || raw.includes(m.guard)) continue;
        let next = raw;
        m.from.forEach((from, i) => {
          next = next.split(from).join(m.to[i]);
        });
        if (next !== raw) localStorage.setItem(key, next);
      } catch {
        /* 单个键坏掉不该挡住别的键 */
      }
    }
    done.add(m.id);
  }
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
  } catch {
    /* 记不住就下次再跑一遍，guard 挡着不会跑坏 */
  }
}
