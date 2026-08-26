# content-studio — Claude Code

共享仓库规则：

@AGENTS.md

## Claude Code 规则

`AGENTS.md` 是仓库级共享规则的真源。

不要在本文件重复 `AGENTS.md` 中已经存在的：

* 项目架构
* 跨包边界
* 验证命令
* UI 设计规则
* Emil UI / coss / ReUI 使用规则

进入子目录工作时继续遵守对应的局部规则：

* `worker/CLAUDE.md`
* `workbench/CLAUDE.md`

局部规则只影响对应子树；不要因为一个包的约束而修改另一个包的架构或实现。

遇到规则冲突时，优先遵守作用域更具体的子目录规则，同时不得违反仓库级安全、真实性和跨包边界约束。
