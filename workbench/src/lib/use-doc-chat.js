import { useCallback, useRef, useState } from "react";
import { agentStream } from "./api.js";
import { DEFAULT_CHAT_MODE, normalizeChatMode } from "./chat-agent.js";

export function useDocChat({ docTitle = "", docPath = "" } = {}) {
  const [chatMode, setChatMode] = useState(DEFAULT_CHAT_MODE);
  const [chat, setChat] = useState({ messages: [], running: false, error: null });
  const chatAbortRef = useRef(null);
  const sessionRef = useRef("");
  const messagesRef = useRef([]);
  const replayNextRef = useRef(false);

  const sendChat = useCallback((text) => {
    chatAbortRef.current?.abort();
    const ac = new AbortController();
    chatAbortRef.current = ac;
    const previousMessages = messagesRef.current;
    const pendingMessages = [
      ...previousMessages,
      { role: "user", text },
      { role: "agent", text: "", agent: "pi-agent-sdk" },
    ];
    messagesRef.current = pendingMessages;
    setChat((current) => ({ ...current, messages: pendingMessages, running: true, error: null }));

    const patchLast = (fn) => setChat((current) => {
      const messages = current.messages.slice();
      const index = messages.length - 1;
      if (index >= 0 && messages[index].role === "agent") messages[index] = { ...messages[index], ...fn(messages[index]) };
      messagesRef.current = messages;
      return { ...current, messages };
    });

    let requestMessage = text;
    if (replayNextRef.current) {
      const history = previousMessages
        .filter((item) => (item.role === "user" || item.role === "agent") && String(item.text || "").trim())
        .map((item) => (item.role === "user" ? "用户：" : "AI：") + String(item.text).trim())
        .join("\n\n");
      if (history) requestMessage = "【切换权限模式后恢复的前文】\n" + history + "\n\n【继续提问】\n" + text;
      replayNextRef.current = false;
    }

    agentStream({
      signal: ac.signal,
      message: requestMessage,
      permissionMode: chatMode,
      sessionId: sessionRef.current || undefined,
      docTitle,
      docPath,
      onSession: (id) => { if (id) sessionRef.current = id; },
      onChunk: (full) => patchLast(() => ({ text: full })),
    }).then((full) => {
      patchLast(() => ({ text: full }));
      setChat((current) => ({ ...current, running: false }));
    }).catch((error) => {
      if (error.name === "AbortError") return setChat((current) => ({ ...current, running: false }));
      setChat((current) => ({ ...current, running: false, error }));
    });
  }, [docTitle, docPath, chatMode]);

  const switchMode = useCallback((value) => {
    const next = normalizeChatMode(value);
    setChatMode((currentMode) => {
      if (currentMode === next) return currentMode;
      replayNextRef.current = true;
      const systemMessage = { role: "sys", text: "已切到" + (next === "daily" ? "日常" : next === "creative" ? "创作" : "开发") + "模式；后续能力由服务端按新模式执行。" };
      messagesRef.current = messagesRef.current.length ? [...messagesRef.current, systemMessage] : messagesRef.current;
      setChat((current) => ({ ...current, messages: current.messages.length ? [...current.messages, systemMessage] : current.messages }));
      return next;
    });
  }, []);

  const newChat = useCallback(() => {
    chatAbortRef.current?.abort();
    sessionRef.current = "";
    replayNextRef.current = false;
    messagesRef.current = [];
    setChatMode(DEFAULT_CHAT_MODE);
    setChat({ messages: [], running: false, error: null });
  }, []);

  const stopChat = useCallback(() => chatAbortRef.current?.abort(), []);

  return { chat, chatMode, sendChat, switchMode, newChat, stopChat };
}
