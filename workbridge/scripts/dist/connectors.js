import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { BridgeError, identifier, requireValue, } from "./contracts.js";
import { readPrivate } from "./storage.js";
const directory = fileURLToPath(new URL("../../references/connectors/", import.meta.url));
export function connectors(root = directory) {
    return readdirSync(root)
        .filter((x) => x.endsWith(".json"))
        .map((x) => {
        const c = JSON.parse(readFileSync(join(root, x), "utf8"));
        requireValue(c.version === 1 && c.id && c.probe?.tool && c.capabilities, "INVALID_CONNECTOR", "连接器声明无效。");
        identifier(c.id);
        return c;
    });
}
export function connector(id) {
    const found = connectors().find((c) => c.id === id);
    if (!found)
        throw new BridgeError("UNSUPPORTED_CONNECTOR", "没有已实现的连接器。");
    return found;
}
export function selectConnection(capability, profiles, catalog, explicit, defaultName) {
    const target = explicit || defaultName;
    const candidates = profiles.filter((p) => (!target || p.name === target) &&
        catalog.some((c) => c.id === p.connector && c.capabilities[capability]));
    requireValue(candidates.length > 0, "CAPABILITY_UNAVAILABLE", "目标连接未提供该能力；不得自动切换平台。");
    requireValue(candidates.length === 1, "AMBIGUOUS_CONNECTION", "存在多个连接，请明确选择。");
    return candidates[0];
}
export function localLaunch(profile, c = connector(profile.connector), credential) {
    const env = {};
    for (const [k, v] of Object.entries(process.env))
        if (v !== undefined)
            env[k] = v;
    // Do not leak another connection's inherited TAPD credential into this server.
    for (const key of [
        "TAPD_ACCESS_TOKEN",
        "TAPD_API_USER",
        "TAPD_API_PASSWORD",
        "CURRENT_USER_NICK",
        "BOT_URL",
    ])
        delete env[key];
    const args = [...c.args];
    if (profile.connector === "tapd") {
        const value = credential ||
            (profile.credentialRef
                ? readPrivate(profile.credentialRef)
                : {});
        requireValue(typeof value.token === "string" && value.token.length > 0, "AUTH_REQUIRED", "需要重新连接 TAPD。");
        env.TAPD_ACCESS_TOKEN = value.token;
    }
    else if (profile.connector === "discourse") {
        requireValue(profile.site && profile.credentialRef, "AUTH_REQUIRED", "需要站点和 Discourse profile。");
        readPrivate(profile.credentialRef);
        args.push("--site", profile.site, "--profile", profile.credentialRef, "--tools_mode", "discourse_api_only", "--log_level", "silent");
        if (profile.allowWrites)
            args.push("--allow_writes");
    }
    return { command: c.command, args, env };
}
