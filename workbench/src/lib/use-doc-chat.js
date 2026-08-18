/**
 * 和本机 agent 聊这一篇文档。**书架和内容工作台共用这一个 hook。**
 *
 * 合并之前两边各有一份 66 行的实现，逐行比对只有**两行**真的不同（文档标题和路径
 * 从哪儿取）。那种「同一件事写在两个地方」正是这个项目历史上几乎所有事故的形状：
 * `askPlatformsOn` 漏进解构、`go.open` 两个生产者加一个漏一个、`fixEmphasis` 两处、
 * 状态字符串两处——没有一条是因为文件太长。
 *
 * 而且合并之前**书架那一份从来没被测过**（完整一轮只在内容工作台跑），
 * 也就是说它坏了没人会知道。所以先补了三条断言立基线（书架能发一轮、换引擎清会话、
 * 关掉阅读区中止请求），再动的这里。
 *
 * ## 这里面每一句都是有代价换来的
 *
 * - **`chatAbortRef` 不是可有可无的**。发新的一条、换引擎、重开一轮、换文档、
 *   组件卸载——五个地方都要先掐掉在跑的那条。不掐的话它在后台接着烧 token，
 *   而回来的字已经没有地方可去了。
 * - **`sessionRef` 在换引擎和重开时必须清空**。那是上一家自己的 session 文件，
 *   拿去 resume 另一家只会失败。上下文因此断掉，所以要在对话里留一条 `sys` 痕迹，
 *   否则用户只会觉得「它怎么突然失忆了」。
 * - **每条回复记下 `agent`**：换过引擎之后，回头能看出上下两段不是同一个模型答的。
 * - **`AbortError` 不算失败**：那是用户自己按的停，报一个红框等于骂他一句。
 */

import { useCallback, useRef, useState } from "react";
import { agentStream } from "./api.js";
import { agentName, loadChatAgent, saveChatAgent } from "./chat-agent.js";

/**
 * @param {{docTitle?: string, docPath?: string}} doc 当前打开的这一篇的身份。
 *   **收值不收取值函数**：调用方十有八九会写一个内联箭头，那样每次渲染都是新身份，
 *   `sendChat` 跟着每次都变——比合并之前（依赖 `reading` / `active`）还糟。
 *   收值的话依赖关系和原来逐字对应：那一篇变了才重建。
 */
export function useDocChat({ docTitle = "", docPath = "" } = {}) {
  const [chatAgent, setChatAgent] = useState(loadChatAgent);
  const [chat, setChat] = useState({ messages: [], running: false, error: null });
  const chatAbortRef = useRef(null);
  const sessionRef = useRef("");
  const messagesRef = useRef([]);

  const sendChat = useCallback(
    (text) => {
      chatAbortRef.current?.abort();
      const ac = new AbortController();
      chatAbortRef.current = ac;
      const previousMessages = messagesRef.current;
      const pendingMessages = [
        ...previousMessages,
        { role: "user", text },
        { role: "agent", text: "", agent: chatAgent },
      ];
      messagesRef.current = pendingMessages;
      setChat((c) => ({
        ...c,
        // 每条回复记下是谁答的：换过引擎之后，回头能看出上下两段不是同一个模型
        messages: pendingMessages,
        running: true,
        error: null,
      }));
      const patchLast = (fn) =>
        setChat((c) => {
          const msgs = c.messages.slice();
          const i = msgs.length - 1;
          if (i >= 0 && msgs[i].role === "agent") msgs[i] = { ...msgs[i], ...fn(msgs[i]) };
          messagesRef.current = msgs;
          return { ...c, messages: msgs };
        });
      const currentSession = sessionRef.current;
      const run = (message, sessionId) =>
        agentStream({
          signal: ac.signal,
          message,
          agent: chatAgent,
          sessionId: sessionId || undefined,
          docTitle,
          docPath,
          onSession: (id) => id && (sessionRef.current = id),
          onChunk: (full) => patchLast(() => ({ text: full })),
        });

      run(text, currentSession)
        .catch((e) => {
          // Claude/Codex CLI 偶尔会返回一个随后无法 resume 的会话号。
          // 只对这个明确错误重建一次，并把屏幕上已完成的对话带回；
          // 网络、鉴权和其他失败仍原样报错，避免双倍调用。
          if (!currentSession || !/No conversation found with session ID/i.test(e.message || "")) throw e;
          sessionRef.current = "";
          const history = previousMessages
            .filter((m) => (m.role === "user" || m.role === "agent") && String(m.text || "").trim())
            .map((m) => `${m.role === "user" ? "用户" : "AI"}：${String(m.text).trim()}`)
            .join("\n\n");
          const recoveredMessage = history
            ? `【之前的对话】\n${history}\n\n【继续提问】\n${text}`
            : text;
          return run(recoveredMessage, "");
        })
        .then((full) => {
          patchLast(() => ({ text: full }));
          setChat((c) => ({ ...c, running: false }));
        })
        .catch((e) => {
          if (e.name === "AbortError") return setChat((c) => ({ ...c, running: false }));
          setChat((c) => ({ ...c, running: false, error: e }));
        });
    },
    [docTitle, docPath, chatAgent]
  );

  /**
   * 换引擎。**会话号必须清掉**——那是上一家自己的 session 文件，拿去 resume 另一家
   * 只会失败。上下文带不过去，所以在对话里留一条痕迹，别让人以为它突然失忆了。
   */
  const switchAgent = useCallback((id) => {
    chatAbortRef.current?.abort();
    sessionRef.current = "";
    saveChatAgent(id);
    setChatAgent(id);
    setChat((c) => ({
      ...c,
      running: false,
      messages: c.messages.length
        ? [...c.messages, { role: "sys", text: `已切到 ${agentName(id)}，之前的上下文不带过去` }]
        : c.messages,
    }));
    messagesRef.current = messagesRef.current.length
      ? [...messagesRef.current, { role: "sys", text: `已切到 ${agentName(id)}，之前的上下文不带过去` }]
      : messagesRef.current;
  }, []);

  /**
   * 重开一轮。一直聊下去上下文越滚越长也越跑越偏，换个话题就该另起一轮；
   * 只靠刷新页面的话，整个阅读区会跟着关掉。
   *
   * **换一篇文档时调的也是这一个**，不另起一个 `resetChat`——两者要做的事一模一样
   * （掐掉在跑的、清会话号、清消息），各写一份就是刚合掉的那种重复又长回来。
   * 不清的后果是「上一篇的对话挂在这一篇上」：屏幕上看不出那几条说的是另一篇文档，
   * 而 agent 那边的 session 还接着上一轮。
   */
  const newChat = useCallback(() => {
    chatAbortRef.current?.abort();
    sessionRef.current = "";
    messagesRef.current = [];
    setChat({ messages: [], running: false, error: null });
  }, []);

  // 只中止，不清空：用户按的是「停」，已经吐出来的字要留在屏幕上
  const stopChat = useCallback(() => chatAbortRef.current?.abort(), []);

  return { chat, chatAgent, sendChat, switchAgent, newChat, stopChat };
}
