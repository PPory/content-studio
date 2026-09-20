Content Studio 情报采集 V3 执行包

建议用法：将本文件夹提供给本地 Codex，让它读取 CODEX_START.txt，然后按 IMPLEMENTATION_PLAN.md 执行。

IMPLEMENTATION_PLAN.md：完整实施规格、阶段任务、数据与可靠性设计、测试用例和一手参考资料。
source-manifest.json：拟实施的机器可读来源清单。它尚未部署，也不代表任何接口已通过健康检查。Codex 需要实现导入或映射逻辑。
source-inventory.original.json：从用户两个 Excel 附件完整提取的原始行及文件哈希，用于防止来源遗漏。
CODEX_START.txt：可直接粘贴给 Codex 的启动指令。
PACKAGE_VALIDATION.json：执行包结构检查结果，以及本轮未执行的验证范围。

本包没有修改 Content Studio 仓库，没有访问用户生产数据库，也没有创建定时任务。当前工作台只读接口返回 SNAPSHOT_EXPIRED，无法提供可用的 capturedAt；因此 P0 本地审计是必要步骤。