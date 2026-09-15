import { CliError, normalizeWorkItem } from "./schema.js";
const STANDARD_DETAIL_PATH = /^\/tapd_fe\/([^/]+)\/(story|task|bug)\/detail\/([^/?#]+)\/?$/i;
const PRONG_VIEW_PATH = /^\/([^/]+)\/prong\/(stories|tasks)\/view\/([^/?#]+)\/?$/i;
const BUGTRACE_VIEW_PATH = /^\/([^/]+)\/bugtrace\/bugs\/view\/([^/?#]+)\/?$/i;
export function parseTapdUrl(rawUrl) {
    let url;
    try {
        url = new URL(rawUrl.trim());
    }
    catch {
        throw new CliError("UNSUPPORTED_TAPD_URL", "无法解析 TAPD URL。", { url: rawUrl });
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new CliError("UNSUPPORTED_TAPD_URL", "TAPD URL 必须使用 http 或 https。");
    }
    const match = url.pathname.match(STANDARD_DETAIL_PATH);
    const prongMatch = url.pathname.match(PRONG_VIEW_PATH);
    const bugtraceMatch = url.pathname.match(BUGTRACE_VIEW_PATH);
    const identity = match
        ? {
            workspaceId: match[1],
            entityType: match[2],
            id: match[3],
        }
        : prongMatch
            ? {
                workspaceId: prongMatch[1],
                entityType: prongMatch[2] === "stories" ? "story" : "task",
                id: prongMatch[3],
            }
            : bugtraceMatch
                ? {
                    workspaceId: bugtraceMatch[1],
                    entityType: "bug",
                    id: bugtraceMatch[2],
                }
                : undefined;
    if (!identity) {
        throw new CliError("UNSUPPORTED_TAPD_URL", "仅支持标准 detail、Story/Task prong view 和 Bug bugtrace view 链接。", { url: rawUrl });
    }
    return normalizeWorkItem({
        source: "tapd",
        workspace_id: identity.workspaceId,
        entity_type: identity.entityType,
        id: decodeURIComponent(identity.id),
        url: url.toString(),
    });
}
export function mergeUrlIdentity(input) {
    if (!input.url) {
        return input;
    }
    const parsed = parseTapdUrl(input.url);
    return {
        ...input,
        entity_type: parsed.entity_type,
        id: parsed.id,
        workspace_id: parsed.workspace_id,
        url: parsed.url,
    };
}
export function parseInput(rawInput) {
    const trimmed = rawInput.trim();
    if (!trimmed) {
        throw new CliError("INVALID_INPUT_JSON", "--input 不能为空。");
    }
    if (/^https?:\/\//i.test(trimmed)) {
        return parseTapdUrl(trimmed);
    }
    try {
        return mergeUrlIdentity(normalizeWorkItem(JSON.parse(trimmed)));
    }
    catch (error) {
        if (error instanceof CliError) {
            throw error;
        }
        throw new CliError("INVALID_INPUT_JSON", "--input 不是有效的 TAPD Context JSON。");
    }
}
