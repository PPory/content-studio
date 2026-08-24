import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

const hasProxy = ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]
  .some((key) => String(process.env[key] || "").trim());

if (hasProxy) setGlobalDispatcher(new EnvHttpProxyAgent());
