// 「对话」用哪个本机 agent。两个都跑在 vault 里、都只读。
//
// 为什么给选择而不是钦定一个：这两家的模型不一样，同一个问题给出的角度经常不同；
// 而且哪个登录着、哪个还有额度是随时在变的——被钉死在一个上面，另一个不可用时
// 整条对话通道就废了。
//
// **差别只有一条要写在界面上：Codex 不吐增量。** claude 是一个字一个字流回来的，
// codex 只在整条消息完成时给一次，所以它是「转半天，然后整段落地」。不说清楚的话
// 用户会以为卡死了。
//
// 存 localStorage：这是「这台机器上这个人的偏好」，和阅读设置同一类，不是知识。

const KEY = "workbench:chat-agent:v1";

export const CHAT_AGENTS = [
  {
    id: "claude",
    name: "Claude Code",
    note: "逐字流式返回",
    waiting: "对话走的是本机的 Claude Code（它能读你整个 vault），不是 API——第一次要先把它拉起来",
    slowAt: 12,
  },
  {
    id: "codex",
    name: "Codex",
    note: "答完一次性返回",
    waiting: "Codex 不吐增量：它会先想完、再把整段一次性给出来，所以这里会空着转一会儿",
    // 屏幕从头到尾都是空的，这句解释必须早点出来
    slowAt: 4,
  },
];

export const agentName = (id) => (CHAT_AGENTS.find((a) => a.id === id) || CHAT_AGENTS[0]).name;

export function loadChatAgent() {
  try {
    const id = localStorage.getItem(KEY);
    return CHAT_AGENTS.some((a) => a.id === id) ? id : CHAT_AGENTS[0].id;
  } catch {
    return CHAT_AGENTS[0].id;
  }
}

export function saveChatAgent(id) {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* 隐私模式下写不了，不该因此不能对话 */
  }
}
