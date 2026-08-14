# 注册 Telegram bot 命令菜单（输入框旁 ☰ 菜单 + 输入 / 时的自动补全，点击即用）。
# Telegram 规定命令名必须是 ASCII（[a-z0-9_]），故菜单用英文命令名 + 中文描述；
# 中文命令（/整理 /状态 /成稿）仍可手打，二者都被 handleCommand 识别。
# 作用域限定机主 chat，其他人看不到菜单。
#
# 运行：python -X utf8 scripts/set-bot-commands.py
# 用 urllib（自动走 HTTPS_PROXY，中国大陆访问 Telegram 需代理）；token 从 ../.env 读取。

import json, os, urllib.request
from pathlib import Path

env = {}
for line in (Path(__file__).parent.parent / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k] = v

token = env.get("TELEGRAM_BOT_TOKEN")
owner = int(os.environ["OWNER_CHAT_ID"])
if not token:
    raise SystemExit("缺少 .env 里的 TELEGRAM_BOT_TOKEN")

payload = {
    "commands": [
        {"command": "quote", "description": "存金句"},
        {"command": "concept", "description": "存核心观点"},
        {"command": "case", "description": "存案例"},
        {"command": "data", "description": "存数据"},
        {"command": "framework", "description": "存框架"},
        {"command": "material", "description": "存素材（自动归类）"},
        {"command": "tweet", "description": "推 X链接/文章/想法 → 推文候选"},
        {"command": "synthesize", "description": "整理出选题"},
        {"command": "draft", "description": "成稿 关键词 平台"},
        {"command": "status", "description": "各库待处理数量"},
        {"command": "help", "description": "全部命令与示例"},
    ],
    "scope": {"type": "chat", "chat_id": owner},
}

req = urllib.request.Request(
    f"https://api.telegram.org/bot{token}/setMyCommands",
    data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
    headers={"content-type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req) as r:
    print("setMyCommands:", r.status, r.read().decode("utf-8"))
