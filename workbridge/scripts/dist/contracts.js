export class BridgeError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
export function requireValue(condition, code, message) {
    if (!condition)
        throw new BridgeError(code, message);
}
export function identifier(value) {
    requireValue(typeof value === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value), "INVALID_IDENTIFIER", "使用 1–64 位小写字母、数字、点、横线或下划线。");
    return value;
}
export function resource(value) {
    requireValue(value && typeof value === "object", "INVALID_RESOURCE", "需要 ResourceRef。");
    const r = value;
    for (const key of ["provider", "connection", "space", "kind", "id"])
        requireValue(typeof r[key] === "string" && r[key].trim(), "INVALID_RESOURCE", `缺少 ${key}。`);
    for (const key of Object.keys(r))
        requireValue([
            "provider",
            "connection",
            "space",
            "kind",
            "id",
            "url",
            "version",
        ].includes(key), "INVALID_RESOURCE", "资源包含未知字段。");
    identifier(r.connection);
    identifier(r.provider);
    for (const key of ["url", "version"])
        requireValue(r[key] === undefined || typeof r[key] === "string", "INVALID_RESOURCE", "可选资源字段必须是字符串。");
    return r;
}
export function safeUrl(value, allowLoopback = false) {
    let url;
    try {
        url = new URL(value);
    }
    catch {
        throw new BridgeError("INVALID_URL", "需要有效的 HTTPS URL。");
    }
    requireValue(!url.username && !url.password && !url.search && !url.hash, "INVALID_URL", "URL 不得包含凭据、查询参数或片段。");
    requireValue(url.protocol === "https:" ||
        (allowLoopback &&
            url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)), "INVALID_URL", "仅允许 HTTPS；本机探测允许 loopback HTTP。");
    return url.toString().replace(/\/$/, "");
}
