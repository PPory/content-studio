# 交接：AI 产物的三态链（卡片 → 分栏 → 整页）

> 这份文档是给**下一个会话**的。上一轮做完了浮标（`AssistantOrb`）和上下文 chip，
> 也就是 Notion 参考图 37–42 那一段；这一轮做剩下的 43–45。
>
> 先读 [`ai-experience-redesign.md`](ai-experience-redesign.md)，尤其是「九之五 ～ 九之十」
> 那几节——那里记着这条链前半段踩过的每一个坑，很多会在这一轮再咬一次。

---

## 零、动手之前必须先确认的两件事

### 0.1 仓库现在有并发改动

写这份文档时（2026-08-29），工作区里有**另一个会话正在改的东西**：

- `workbench/server/lib/settings-schema.mjs` 有 +23 行未提交改动（新增「云端存储」设置项）
- `workbench/server/routes/feishu.mjs` 几分钟前刚被改过
- HEAD 上还有今天新落的两个提交：`01b50f7` 飞书文档同步、`c8e962c` Lark CLI

**后果**：`npm test`（smoke）里那条 `左栏十一项` 现在报「多了 云端存储」。
那是**别人在做的功能**，不是这一轮的责任——不要顺手把它改绿，等那个功能落定由它自己补。
开工前先 `git status` 看一眼工作区，别把别人没写完的东西当成 bug 去修。

### 0.2 参考图要重新贴

图 43–45 的**准确描述**在下面第一节，是照着原图逐帧写的，可以直接照做。
但如果要抠视觉细节（间距、字重、按钮位置），**让用户重新贴一次原图**——
文字描述不能代替看图，这条在这个项目里已经栽过一次（第一轮「并没有很好 1:1 复刻」）。

---

## 一、参考图：Notion 是怎么做的

用户给的原始说明（原话）：

> 纯 AI 对话页面 [图41]，发送指令 [图42]，点击卡片打开 [图43]，点击整页打开 [图44][图45]

### 图 42 — 产物卡长在回复里

在**独立 AI 对话页**里发一句会产出东西的指令（「帮我新建文档，写一篇 200 字的 Notion AI 功能简介」），
助手的这一条回复由四部分组成，从上到下：

1. 一行链接式的结果声明：`已创建页面 📄 Notion AI 功能简介（200字）`（带下划线，可点）
2. 正常的散文回答（「已为你在工作区新建文档并写入约 200 字…」，中间又嵌了一次那个文档链接）
3. **产物卡**：一张带边框、圆角的卡片
   - 左半：一行英文小标题 `Created Notion AI简介文档`，下面一颗**实心浅灰按钮「打开页面」**，
     右边跟着一个 `↩`（撤销）图标按钮
   - 右半：一块**缩略预览**——白底小卡，顶上一个文档图标，下面是文档标题，
     再下面是三四条灰色占位横线（模拟正文），右边被卡片边缘裁掉一截，
     读起来像「一页纸露出了一角」
4. 卡片下面才是这条消息的动作行：`复制 / + / 👍 / 👎 / ↩撤消`

**注意顺序**：产物卡在消息动作行**上面**，是这条回复的一部分，不是浮在旁边的东西。

### 图 43 — 点「打开页面」→ 分栏

整个内容区从「一栏对话」变成**左右两栏**：

- **左栏（约 40%）**：原来的对话，原样保留（用户气泡、回答、产物卡、动作行都还在），
  只是变窄、换行更多。顶上仍是那条面包屑 `Notion AI / Notion AI 功能简介`。
- **右栏（约 60%）**：产物**本体**，是一份**真正可编辑的文档**——大标题 + 正文，
  正文行首悬停有 `+` 和拖拽手柄，和普通页面一模一样。
- **右栏自己有一条顶栏**（在整个窗口的最上沿，和左栏的面包屑同高）：
  `»`（收起右栏）、`⤢`（整页打开）、`▣`、右端是 `🔒共享 / ★ / …`
- ⚠️ **左栏输入框上方多出一颗上下文 chip**：`📄 Notion AI 功能简介（200字）`。
  也就是说——**打开产物的同时，它成了这段对话的上下文**。
  （我们这一侧已经有这个机制了，见第三节。）

### 图 44 — `⤢` 的提示

鼠标停在右栏顶栏的 `⤢` 上，弹出 tooltip：**「以整页形式打开」+ `Ctrl+↵`**。

### 图 45 — 整页

左栏对话**整个消失**，产物占满内容区：

- 顶栏换成这份产物自己的页面级 chrome：左边是标题 `Notion AI 功能简介（200字）` + `🔒私人 ⌄`，
  右边是 `上次编辑1分钟前 / 🔒共享 / ★ / …`
- 正文居中、限宽（和 Notion 普通页面一致）
- ⚠️ **右下角那颗 AI 浮标回来了**——也就是图 80 里那颗。
  对话没有被销毁，它退回成「随时能叫回来的那颗球」。

### 这条链在讲什么

**同一个产物，三种「我现在有多想看它」**：

| 态 | 回答的问题 | 对话在哪 |
| --- | --- | --- |
| 卡片 | 它产出了什么？（一眼确认） | 就是对话本身 |
| 分栏 | 它写得对不对？（边看边接着聊） | 左栏，变窄但完整 |
| 整页 | 我要动手改它了 | 收成右下角一颗浮标 |

**升级是单向递进的**（卡片 → 分栏 → 整页），**降级随时**（`»` 回分栏、浮标回对话）。
每一步只做一件事：**给产物更多空间，给对话更少空间**。

---

## 二、到我们这边，产物是什么

⚠️ **这是这一轮最重要的一条判断，先想清楚再写代码。**

Notion 的产物是「一个 Notion 页面」——一个有 URL 的一等对象。我们没有这种东西，
而且**不许为了这个功能新建一种业务对象**（`AGENTS.md`：不新增共享业务包、
不新建第二套存储、同一条业务规则只实现一次）。

好消息是：**产物在我们这儿已经存在了，它就是 Action 已经产出的东西。**

`server/agent-runtime/assistant-runner.mjs` 里现成的 action 类型：

- `create_content` → 在 Worker/D1 里新建一篇稿件（`applyAssistantAction` 里调 `callWorker(env, "create", …)`）
- `workspace_write` / `workspace_edit` / `document_create` / `document_update` → 写 vault 文件
- 还有 `annotation_append`、`reference_insert`、`project_write` 等

也就是说，**产物有且只有两种落点**：

1. **D1 稿件**（`create_content`）→ 打开它 = 打开项目工作区那个 `MarkdownEditor`
2. **vault 文件**（`workspace_write` 一族）→ 打开它 = 打开阅读区那个 `MarkdownEditor`

**这一轮不产生第三种东西，只做「怎么看它」。** 具体地说：

- `ActionCard`（`src/components/assistant/ActionCard.jsx`）现在只有「确认写入 / 拒绝」，
  执行完变成「已执行」就没下文了——**产物卡要做的是给它加上「打开」和一块缩略预览**。
- `AI_RESULT_KINDS`（`src/lib/ai/result-model.js`）是 `answer / candidate / report / action`。
  **不要加第五种 `artifact`**：产物不是一种新的结果，它是 `action` **执行之后**的产物。
  真要建模，加在 action 的 `result` 上（`applyAssistantAction` 已经返回 `result`）。

---

## 三、现有代码里能直接用的东西

**先读这几个，多半不用从零写。**

### 3.1 已经有一个「整页接管」的先例

`src/components/ProjectReportReview.jsx` + `.project-report-review` 那套 CSS
（`src/components/project-assistant.css`，搜 `project-report-review`）：

- 它就是**分栏**：`.project-report-review__grid { grid-template-columns: minmax(0,1.3fr) minmax(360px,.7fr) }`
  左边是正文（`.project-report-document`）、右边是报告（`.project-report-findings`），
  两边各自 `overflow-y: auto`
- 它**接管整个工作区**的方式很值得抄：
  ```css
  .project-workspace__grid:has(> .project-report-review) > .project-draft { display: none; }
  ```
  也就是**不做全屏浮层**，而是在原来的 grid 里换一个孩子。这样返回时布局不会跳。
- 它由 `ProjectAssistantRail` 渲染（`reviewRun` 状态），并通过 `reviewingCandidate` /
  `data-reviewing` 把协作栏隐掉。**同一套开关这一轮可以复用。**
- 顶栏那颗「← 返回正文」也在里面，抄它的位置和文案风格。

### 3.2 已经有一个「浮层 → 整页」的升级

`AssistantPane` 的 `onContinue`（`surface === "overlay"` 时那颗 `⤢`）：
`App.jsx` 里 `onContinue={() => { setGlobalConversationId(railConversationId); setQuickAssistantOpen(false); go("assistant"); }}`。

**「带着同一段对话换个地方继续」这件事已经跑通了**——图 45 的整页态要保留对话，
用的是同一个思路（记住 conversationId，换 surface 重新挂）。

### 3.3 surface 是个受控枚举，要加得改一处

`src/lib/assistant-policy.js`：

```js
export const ASSISTANT_SURFACES = Object.freeze({
  page:    { history: "sidebar", dismiss: "route" },
  overlay: { history: "button",  dismiss: "escape" },
  rail:    { history: "button",  dismiss: "collapse" },
});
```

`AssistantPane` 开头会 `throw new TypeError` 拒绝未知 surface。分栏态如果需要新 surface
（比如 `split`），在这里加，并且**必须遵守那条注释写死的规矩**：

> Assistant 能做什么只由 scope + target 决定；**surface 不得增加或削弱能力**。

也就是说：分栏态不能因为「屏幕大了」就多给一个按钮，也不能因为「窄」就藏掉真实性回执。

### 3.4 上下文 chip 已经在输入框里了

图 43 那颗 `📄 <标题>` chip 我们已经有位置了：`AssistantComposer` 的 `context` 插槽
（`.assistant-composer__context`），由 `AssistantPane` 的 `composerContext` 传入。
**打开产物时把 chip 换成产物本身即可，不用新建 UI。**
⚠️ 面板要向上开，见九之九那条坑。

### 3.5 浮标已经做好了

`src/components/assistant/AssistantOrb.jsx`。图 45 整页态右下角那颗就是它。
**它现在的出现条件写死在 `ProjectAssistantRail` 里**（`collapsed && !reviewOpen`），
整页态要用的话，把条件抽出来，不要复制第二份组件。

⚠️ 它必须挂在 `<aside>` **外面**——那个 aside 收起时是 `display: none`。

### 3.6 编辑器可以直接复用

`MarkdownEditor` 已经是「所见即源码 + 实时预览 + 内联 AI」的完整体，
分栏和整页的右侧直接挂它就行。三个现有调用点在
`ProjectWorkspace.jsx` / `ReaderOverlay.jsx` / `SettingsPrompts.jsx`，抄任意一个的 props。

---

## 四、硬约束（违反会被打回）

来自 `AGENTS.md` 和这条链前半段的既有决定：

1. **Worker/D1 是业务真源。** 产物的状态、字段、关系都在 Worker；
   workbench 只消费 `/wb/*`，不复制业务规则，不推测数据库字段。
2. **AI 只提出候选。** 产物是 action 执行的结果，而 action 必须由用户确认过。
   **不要做「AI 自己开了个页面并直接开始改」**。
3. **真实性是代码硬闸。** `grounding.gate === "rejected"` 的内容不得有任何落地路径。
   产物卡上的「打开」如果通向一个可编辑的正文，就是一条**新的落地路径**——
   必须按 gate 判一次。（这条在 `AiAnswerCard` 上已经栽过一次，见九之四。）
4. **不新增第二个 AI 入口。** 浮标那条规矩：只在「本屏本来有一列 AI，而它现在收着」时出现。
5. **动效要有目的。** 分栏 ↔ 整页的过渡如果加动画，得能说出它解释了什么
   （比如「这一栏去哪了」）；说不出就不加。高频操作优先 immediacy。
6. **不要为了这个功能大改已有稳定实现。** Reuse → Adapt → Create。

---

## 五、已知会咬人的坑

这些都是这条链前半段**真的发生过**的，按 `ai-experience-redesign.md` 九之二 ～ 九之十：

- ⚠️ **CSS `>` 直接子选择器**：只要在 JSX 里给控件包一层容器，就回头搜一遍针对该父级的
  `>` 规则。这个项目已经因此静默失效过三次（`.md-editor__bar`、`.assistant-composer > footer > div > button`、
  `.assistant-command-menu > button`）。分栏必然要包新层，**必踩**。
- ⚠️ **CodeMirror 的 `EditorView.theme` 注入的选择器是两个类**（`.ͼx .cm-line`），
  权重比你在 `styles.css` 里写的单类高。要覆盖就写 `.cm-editor .cm-line.你的类`。
- ⚠️ **`display: none` 的父级里画的东西是看不见的**，而且不报错。
- ⚠️ **绝对定位的浮层要判断向上还是向下开**。触发器搬到屏幕底部之后 `top: 100%`
  会把面板整个开到视口外，现象是「点了没反应」。
- ⚠️ **原生选区高亮在失焦后消失**。分栏之后如果左栏输入框接管焦点、右栏正文里还有
  「它说的是这一段」的标记，必须自己画一层（`editor-held-selection.js` 就是干这个的）。
- ⚠️ **测试里不要 `waitForTimeout(固定毫秒)` 然后断言**。这个文件里已经因此有过随机红的断言，
  而**会随机变红的断言比没有更糟：它训练人忽略红色**。等条件，别等时间。
- ⚠️ **报告测试结果时单独把退出码写进日志再读**。`npm test | grep …` 的退出码是 grep 的，
  我在这个项目里因此误报过「全绿」。

---

## 六、验收

```powershell
cd workbench
npm run check
npm run test:unit
npm run test:writing
npm run test:pi
npm test
npm run build
git diff --check
```

视觉改动大时再跑一次 `npm run shots`（一轮约 40 分钟，会临时改测试数据，
**不能和 `npm test` 并行**，也不要截断）。用户的偏好是「只在专门调版面时跑」。

新增断言的要求（这个项目的惯例）：**写真的会红的断言**。
比如「整页态右下角有浮标」「分栏态左栏仍能发消息」「gate rejected 的产物打不开」，
而不是「某个 class 存在」。

---

## 七、明确不在这一轮范围内

- **发布时本地图片取不到**（正文里的 vault 相对路径在平台上解析不出来）。
  这是另一条待办，跨 Worker 契约，需要先和用户定路线。
- **光标粗细**。已明确否决：原生 caret 宽度没有 CSS 可设，唯一办法是装回
  `drawSelection()` 自绘，而那会把光标高度重新钉成整个行框（就是用户最早说的「光标很大」）。
  **宽度不值得用高度去换。**
- 设置左栏那条 `左栏十一项` 断言——见 0.1，那是别人在做的功能。

---

## 八、要问用户的（别自己拍）

1. **产物打开之后，改的是谁？** D1 稿件和 vault 文件的编辑器、保存路径、权限都不一样。
   是两种都支持，还是这一轮只做其中一种？
2. **分栏态的对话，和原来那段是同一段吗？** 图 43 看起来是同一段（对话内容原样保留）。
   我们这边右栏对话是绑 `scopeId` 的，打开一篇 D1 稿件之后 scope 变不变，会影响历史归属。
3. **整页态从哪儿退出去？** Notion 是靠面包屑/浏览器后退。我们没有产物的路由，
   要不要给它一条 hash 路由（`#/artifact/<id>`）——这决定了「刷新还在不在」。
