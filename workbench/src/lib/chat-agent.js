export const DEFAULT_CHAT_MODE = "daily";

export const CHAT_PERMISSION_MODES = [
  { id: "daily", name: "日常", note: "只读、检索、联网和候选动作" },
  { id: "creative", name: "创作", note: "增加个人工作台内的受控写入候选" },
  { id: "developer", name: "开发", note: "增加项目写入和 PowerShell 候选", warning: "开发模式可触及项目代码和命令。只有明确的开发任务才应使用此模式。" },
];

export function normalizeChatMode(value) {
  return CHAT_PERMISSION_MODES.some((item) => item.id === value) ? value : DEFAULT_CHAT_MODE;
}

export function chatModeInfo(value) {
  return CHAT_PERMISSION_MODES.find((item) => item.id === normalizeChatMode(value)) || CHAT_PERMISSION_MODES[0];
}

export const piAgentName = () => "Pi Agent SDK";
