import { useEffect, useRef } from "react";

const targets = new Map();

export function registerAssistantSummonTarget(kind, handler) {
  if (!kind || typeof handler !== "function") return () => {};
  targets.set(kind, handler);
  return () => {
    if (targets.get(kind) === handler) targets.delete(kind);
  };
}

export function useAssistantSummonTarget(kind, handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => registerAssistantSummonTarget(kind, (...args) => handlerRef.current?.(...args)), [kind]);
}

export function assistantSummonDestination({ routeView, readingAvailable = targets.has("reading") }) {
  if (readingAvailable) return "reading";
  if (routeView === "project") return "project";
  if (routeView === "assistant") return "global-page";
  return "quick";
}

export function summonAssistant({ routeView, onQuick }) {
  const destination = assistantSummonDestination({ routeView });
  if (destination === "quick") onQuick?.();
  else targets.get(destination)?.();
  return destination;
}

export function assistantReferenceDocument(context, attached = true) {
  if (!attached || !context?.object) return {};
  const { id, type, title } = context.object;
  return {
    ...(id ? { objectId: id } : {}),
    ...(type ? { objectType: type } : {}),
    ...(title ? { title } : {}),
  };
}
