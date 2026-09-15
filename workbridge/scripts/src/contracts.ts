export class BridgeError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function requireValue(
  condition: unknown,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new BridgeError(code, message);
}
export type Host = "codex" | "claude" | "cursor";
export interface ResourceRef {
  provider: string;
  connection: string;
  space: string;
  kind: string;
  id: string;
  url?: string;
  version?: string;
}
export interface CapabilityBinding {
  version: 1;
  tools: string[];
  write: boolean;
  defaults?: Record<string, unknown>;
  readback?: string;
  fields?: Record<string, string>;
}
export interface Connector {
  version: 1;
  id: string;
  node: number;
  command: string;
  args: string[];
  probe: { tool: string; args: Record<string, unknown> };
  capabilities: Record<string, CapabilityBinding>;
}
export interface ConnectionProfile {
  version: 1;
  name: string;
  connector: string;
  host: Host;
  server: string;
  transport: "stdio" | "streamable-http";
  site?: string;
  url?: string;
  auth?: "none" | "oauth" | "bearer-env";
  bearerEnv?: string;
  credentialRef?: string;
  allowWrites: boolean;
  hostFingerprint?: string;
  state: "pending-host-reload" | "configured";
}
export interface InteractionRequest {
  version: 1;
  type: "input" | "confirmation" | "secret" | "browser";
  prompt: string;
  options?: string[];
  connection: string;
  resumeId?: string;
}
export interface ActionPlan {
  version: 1;
  id: string;
  steps: Array<{
    id: string;
    capability: string;
    target: ResourceRef;
    changes: Record<string, { value?: unknown; clear?: true }>;
    preconditions: string[];
    authorization: string;
  }>;
}
export interface ActionResult {
  step: string;
  status: "success" | "failed" | "unknown" | "skipped";
  resource?: ResourceRef;
  verified: boolean;
  evidence?: string;
}
export function identifier(value: string): string {
  requireValue(
    typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value),
    "INVALID_IDENTIFIER",
    "使用 1–64 位小写字母、数字、点、横线或下划线。",
  );
  return value;
}
export function resource(value: unknown): ResourceRef {
  requireValue(
    value && typeof value === "object",
    "INVALID_RESOURCE",
    "需要 ResourceRef。",
  );
  const r = value as ResourceRef;
  for (const key of ["provider", "connection", "space", "kind", "id"] as const)
    requireValue(
      typeof r[key] === "string" && r[key].trim(),
      "INVALID_RESOURCE",
      `缺少 ${key}。`,
    );
  for (const key of Object.keys(r))
    requireValue(
      [
        "provider",
        "connection",
        "space",
        "kind",
        "id",
        "url",
        "version",
      ].includes(key),
      "INVALID_RESOURCE",
      "资源包含未知字段。",
    );
  identifier(r.connection);
  identifier(r.provider);
  for (const key of ["url", "version"] as const) requireValue(r[key] === undefined || typeof r[key] === "string", "INVALID_RESOURCE", "可选资源字段必须是字符串。");
  return r;
}
export function safeUrl(value: string, allowLoopback = false): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BridgeError("INVALID_URL", "需要有效的 HTTPS URL。");
  }
  requireValue(
    !url.username && !url.password && !url.search && !url.hash,
    "INVALID_URL",
    "URL 不得包含凭据、查询参数或片段。",
  );
  requireValue(
    url.protocol === "https:" ||
      (allowLoopback &&
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)),
    "INVALID_URL",
    "仅允许 HTTPS；本机探测允许 loopback HTTP。",
  );
  return url.toString().replace(/\/$/, "");
}
