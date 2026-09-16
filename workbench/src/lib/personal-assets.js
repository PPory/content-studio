export const ASSET_KINDS = { identity: "身份背景", current: "当前状况", experience: "经历故事", voice: "观点与表达" };
export const ASSET_USAGE = { private: "仅自己保存", reference: "可以引用", ask: "每次询问" };
export const assetDate = value => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "";
