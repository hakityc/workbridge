#!/usr/bin/env node
import { parseArgs } from "node:util";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { BridgeError, identifier, requireValue, safeUrl, } from "./contracts.js";
import { atomicPrivate, ensurePrivate, home, locked, readPrivate, safePath, } from "./storage.js";
import { connector, connectors, localLaunch } from "./connectors.js";
import { verify } from "./probe.js";
import { applyHost, fingerprint, inspect, matchesRegistration, registration, reload, removeHost, } from "./hosts.js";
import { authorize, interact } from "./interactions.js";
import { bind, current, loadRun, migrate, saveRun, start } from "./state.js";
const cli = fileURLToPath(import.meta.url);
const opts = {
    host: { type: "string" },
    connection: { type: "string" },
    site: { type: "string" },
    profile: { type: "string" },
    transport: { type: "string" },
    url: { type: "string" },
    auth: { type: "string" },
    "bearer-env": { type: "string" },
    "allow-writes": { type: "boolean" },
    yes: { type: "boolean" },
    input: { type: "string" },
    replace: { type: "boolean" },
    help: { type: "boolean" },
    "no-persist": { type: "boolean" },
    base: { type: "string" },
    branch: { type: "string" },
};
function connectionPath(name) {
    return join(home(), "connections", identifier(name) + ".json");
}
function load(name) {
    const p = readPrivate(connectionPath(name));
    requireValue(p.version === 1 &&
        p.name === name &&
        ["codex", "claude", "cursor"].includes(p.host) &&
        ["stdio", "streamable-http"].includes(p.transport), "INVALID_CONNECTION", "连接配置无效。");
    identifier(p.server);
    connector(p.connector);
    requireValue(typeof p.allowWrites === "boolean", "INVALID_CONNECTION", "缺少连接读写模式。");
    if (p.transport === "streamable-http") {
        requireValue(typeof p.url === "string" && ["none", "oauth", "bearer-env"].includes(p.auth || ""), "INVALID_CONNECTION", "远程连接配置无效。");
        safeUrl(p.url, true);
        if (p.auth === "bearer-env")
            requireValue(p.host === "codex" && typeof p.bearerEnv === "string" && /^[A-Z][A-Z0-9_]*$/.test(p.bearerEnv), "UNSUPPORTED_AUTH", "远程凭据引用无效。");
    }
    return p;
}
function output(value) {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
    const status = value;
    if (status?.ok === false || status?.probe?.ok === false)
        process.exitCode = 1;
}
function available(command, args = ["--version"]) {
    const r = spawnSync(command, args, { stdio: "ignore", timeout: 10000 });
    requireValue(!r.error && r.status === 0, "DEPENDENCY_MISSING", `需要可运行的 ${command}；安装后重新执行原连接命令。`);
}
async function about(site) {
    try {
        const response = await fetch(site + "/about.json", {
            signal: AbortSignal.timeout(15000),
            redirect: "error",
        });
        requireValue(response.ok, "SITE_UNAVAILABLE", "站点不可达或拒绝访问。");
        const data = (await response.json());
        requireValue(data.about, "NOT_DISCOURSE", "站点没有返回 Discourse about 信息。");
    }
    catch (e) {
        if (e instanceof BridgeError)
            throw e;
        throw new BridgeError("SITE_UNAVAILABLE", "无法验证站点；请核对地址与网络。");
    }
}
async function generateProfile(site, path) {
    requireValue(process.stdin.isTTY && process.stdout.isTTY, "INTERACTIVE_REQUIRED", "请在自己的交互终端完成浏览器授权。");
    const c = connector("discourse");
    const oldMask = process.umask(0o077);
    try {
        await new Promise((resolvePromise, reject) => {
            // The official generator owns the browser/device exchange. Output stays in the user's terminal.
            const child = spawn(c.command, [...c.args, "generate-user-api-key", "--site", site, "--save-to", path], { stdio: "inherit" });
            const timer = setTimeout(() => {
                child.kill("SIGTERM");
                reject(new BridgeError("AUTH_TIMEOUT", "授权超时，未继续配置。"));
            }, 5 * 60 * 1000);
            child.on("error", () => {
                clearTimeout(timer);
                reject(new BridgeError("AUTH_FAILED", "授权进程无法启动。"));
            });
            child.on("exit", (code) => {
                clearTimeout(timer);
                code === 0
                    ? resolvePromise()
                    : reject(new BridgeError("AUTH_CANCELLED", "授权已取消或失败。"));
            });
        });
    }
    finally {
        process.umask(oldMask);
    }
    requireValue(existsSync(path), "AUTH_FAILED", "授权未生成 profile。");
    safePath(path, true);
    chmodSync(path, 0o600);
}
function validateDiscourseProfile(path, site) {
    const value = readPrivate(path);
    requireValue(value.auth_pairs?.some((p) => p.site?.replace(/\/$/, "") === site && (p.user_api_key || p.api_key)), "AUTH_REQUIRED", "profile 没有该站点的凭据。");
}
function restoreSwitch(old, next) {
    const actual = inspect(old.host, old.server);
    if (actual !== undefined && fingerprint(actual) === old.hostFingerprint) {
        atomicPrivate(connectionPath(old.name), old);
        return;
    }
    if (actual !== undefined) {
        requireValue(matchesRegistration(actual, next, cli), "HOST_CONFLICT", "宿主配置已被其他操作修改，不能自动恢复。");
        removeHost({ ...next, hostFingerprint: fingerprint(actual) });
    }
    // The local profile must point to the original launch configuration before a host starts it.
    atomicPrivate(connectionPath(old.name), old);
    old.hostFingerprint = applyHost(old, cli, undefined);
    atomicPrivate(connectionPath(old.name), old);
}
async function main() {
    const { values: v, positionals: a } = parseArgs({
        options: opts,
        allowPositionals: true,
        strict: true,
    });
    requireValue(Number(process.versions.node.split(".")[0]) >= 22, "NODE_VERSION", "WorkBridge 需要 Node.js 22 或更新版本。");
    const [cmd, sub, name] = a;
    if (v.help || !cmd) {
        process.stdout.write(`WorkBridge 0.1.0-rc.1 — skill + secure configuration CLI\n\nworkbridge doctor --host <codex|claude|cursor> --connection <name>\nworkbridge connect <tapd|discourse> --host <host> --connection <name> [--site <url>] [--profile <absolute-path>] [--allow-writes] [--yes]\nworkbridge connection verify <name>\nworkbridge connection configure <name> --transport streamable-http --url <url> [--auth oauth|none|bearer-env] [--bearer-env <ENV_NAME>] [--yes]\nworkbridge connection configure <name> --transport stdio [--yes]\nworkbridge connection recover <name> [--yes]\nworkbridge disconnect <name> [--yes]\nworkbridge context bind --input <resource.json> [--replace]\nworkbridge context current\nworkbridge context start --input <resource.json> --base <base> --branch <branch>\nworkbridge context migrate --connection <name>\nworkbridge run save --input <run.json> [--no-persist]\nworkbridge run show <id>\nworkbridge catalog\n\nToken must be entered in your own terminal, never as an argument.\n`);
        return;
    }
    if (cmd === "catalog") {
        output(connectors());
        return;
    }
    if (cmd === "context") {
        if (sub === "current")
            output(current());
        else if (sub === "migrate") {
            requireValue(v.connection, "INVALID_ARGUMENT", "需要 --connection。");
            if (existsSync(connectionPath(v.connection)))
                requireValue(load(v.connection).connector === "tapd", "INVALID_CONNECTION", "旧绑定只能迁移到 TAPD 连接。");
            output(migrate(v.connection));
        }
        else if (sub === "bind" || sub === "start") {
            requireValue(v.input, "INVALID_ARGUMENT", "需要 --input。");
            const r = JSON.parse(readFileSync(v.input, "utf8"));
            if (existsSync(connectionPath(r.connection)))
                requireValue(load(r.connection).connector === r.provider, "INVALID_RESOURCE", "资源与连接器不匹配。");
            else
                connector(r.provider);
            if (sub === "start") {
                requireValue(v.base && v.branch, "INVALID_ARGUMENT", "需要已确认的 --base 与 --branch。");
                output(await start(r, v.base, v.branch));
            }
            else
                output(bind(r, v.replace));
        }
        else
            throw new BridgeError("INVALID_ARGUMENT", "未知 context 命令。");
        return;
    }
    if (cmd === "run") {
        if (sub === "show")
            output(loadRun(name));
        else if (sub === "save") {
            requireValue(v.input, "INVALID_ARGUMENT", "需要 --input。");
            if (v["no-persist"])
                output({ ok: true, persisted: false });
            else
                output(saveRun(JSON.parse(readFileSync(v.input, "utf8"))));
        }
        else
            throw new BridgeError("INVALID_ARGUMENT", "未知 run 命令。");
        return;
    }
    if (cmd === "mcp-launch") {
        const p = load(sub);
        requireValue(p.transport === "stdio", "INVALID_TRANSPORT", "远程连接应由宿主直接调用。");
        const spec = localLaunch(p);
        const child = spawn(spec.command, spec.args, {
            env: spec.env,
            stdio: ["inherit", "inherit", "pipe"],
        });
        child.stderr.on("data", () => { });
        for (const signal of ["SIGTERM", "SIGINT"])
            process.on(signal, () => child.kill(signal));
        await new Promise((done, reject) => {
            child.on("error", () => reject(new BridgeError("SERVER_START_FAILED", "MCP 无法启动。")));
            child.on("exit", (code) => {
                process.exitCode = code || 0;
                done();
            });
        });
        return;
    }
    if (cmd === "doctor") {
        requireValue(v.host && ["codex", "claude", "cursor"].includes(v.host) && v.connection, "INVALID_ARGUMENT", "需要 --host 和 --connection。");
        if (!existsSync(connectionPath(v.connection))) {
            const existing = inspect(v.host, v.connection);
            output({
                ok: false,
                code: existing ? "EXISTING_UNMANAGED_CONNECTION" : "CONNECTION_MISSING",
                next: existing
                    ? "请由 Agent 使用现有宿主工具只读验证；不要覆盖该服务。"
                    : "保留业务草案，运行 connect 完成首次连接。",
                hostVerified: false,
            });
            return;
        }
        const p = load(v.connection);
        requireValue(p.host === v.host, "HOST_MISMATCH", "连接属于另一个宿主。");
        const actual = inspect(p.host, p.server);
        output({
            connection: p.name,
            hostConfigured: actual !== undefined,
            hostUnchanged: fingerprint(actual) === p.hostFingerprint,
            probe: await verify(p),
            next: reload[p.host],
        });
        return;
    }
    if (cmd === "connection" && sub === "verify") {
        output(await verify(load(name)));
        return;
    }
    await locked(async () => {
        if (cmd === "disconnect") {
            const p = load(sub);
            await authorize(`从 ${p.host} 移除 WorkBridge 服务 ${p.server}？不会撤销远端 key。`, p.name, !!v.yes);
            removeHost(p);
            rmSync(connectionPath(p.name));
            // External profiles are owned by the user; only delete generated credentials.
            if (p.credentialRef?.startsWith(join(home(), "credentials") + "/")) {
                safePath(p.credentialRef, true);
                rmSync(p.credentialRef, { force: true });
            }
            output({ ok: true, remoteRevoked: false });
            return;
        }
        if (cmd === "connection" && sub === "configure") {
            const old = load(name);
            requireValue(v.transport === "stdio" || (v.transport === "streamable-http" && v.url), "INVALID_ARGUMENT", "需要 --transport stdio，或 --transport streamable-http --url。");
            const auth = v.auth || "oauth";
            requireValue(["oauth", "none", "bearer-env"].includes(auth), "UNSUPPORTED_AUTH", "不支持的认证方式。");
            if (auth === "bearer-env")
                requireValue(v["bearer-env"] && /^[A-Z][A-Z0-9_]*$/.test(v["bearer-env"]), "INVALID_ARGUMENT", "需要环境变量名称，不能提供 token 值。");
            const p = v.transport === "stdio"
                ? {
                    ...old,
                    transport: "stdio",
                    url: undefined,
                    auth: undefined,
                    bearerEnv: undefined,
                    state: "pending-host-reload",
                }
                : {
                    ...old,
                    transport: "streamable-http",
                    url: safeUrl(v.url, true),
                    auth: auth,
                    bearerEnv: auth === "bearer-env" ? v["bearer-env"] : undefined,
                    state: "pending-host-reload",
                };
            if (p.transport === "stdio") {
                const c = connector(p.connector);
                requireValue(Number(process.versions.node.split(".")[0]) >= c.node, "NODE_VERSION", `本地连接需要 Node ${c.node}+。`);
                available(c.command);
            }
            registration(p, cli);
            await authorize(`将 ${name} 切换为 ${p.url || "本地 stdio"}，保留原资源关联？`, name, !!v.yes);
            const check = await verify(p);
            requireValue(check.ok || check.code === "HOST_AUTH_REQUIRED", check.code || "PROBE_FAILED", "远程探测失败，原连接未修改。");
            const journal = join(home(), "transactions", identifier(name) + ".json");
            requireValue(!existsSync(journal), "RECOVERY_REQUIRED", "有未完成的切换，请先运行 connection recover。");
            atomicPrivate(journal, { version: 1, old, next: p });
            try {
                removeHost(old);
                p.hostFingerprint = applyHost(p, cli, undefined);
                atomicPrivate(connectionPath(name), p);
                rmSync(journal);
            }
            catch (e) {
                try {
                    restoreSwitch(old, p);
                    rmSync(journal);
                }
                catch {
                    throw new BridgeError("RECOVERY_REQUIRED", "切换未完成；已保留恢复记录。请运行 connection recover <name>，不重复连接或写业务数据。");
                }
                throw e;
            }
            output({
                ok: true,
                state: p.state,
                hostVerified: false,
                authentication: p.auth,
                next: reload[p.host] +
                    (p.auth === "oauth" ? " 完成宿主 OAuth 登录后再验证。" : ""),
            });
            return;
        }
        if (cmd === "connection" && sub === "recover") {
            const journal = join(home(), "transactions", identifier(name) + ".json");
            const tx = readPrivate(journal);
            await authorize("恢复切换前的宿主连接？保留业务资源和原凭据。", name, !!v.yes);
            restoreSwitch(tx.old, tx.next);
            rmSync(journal);
            output({ ok: true, restored: true, next: reload[tx.old.host] });
            return;
        }
        requireValue(cmd === "connect" && ["tapd", "discourse"].includes(sub), "INVALID_ARGUMENT", "未知命令或连接器。");
        requireValue(v.host && ["codex", "claude", "cursor"].includes(v.host) && v.connection, "INVALID_ARGUMENT", "需要 --host 和 --connection。");
        const connection = identifier(v.connection), c = connector(sub), host = v.host;
        requireValue(Number(process.versions.node.split(".")[0]) >= c.node, "NODE_VERSION", `${sub} 本地 MCP 需要 Node.js ${c.node}+；请升级后重试，尚未请求凭据。`);
        available(c.command, sub === "tapd" ? ["--version"] : ["--version"]);
        if (sub === "tapd")
            available("uv", [
                "python",
                "find",
                ">=3.13",
                "--no-project",
                "--no-python-downloads",
            ]);
        if (host !== "cursor")
            available(host);
        const path = connectionPath(connection);
        let prior;
        if (existsSync(path)) {
            const old = load(connection);
            requireValue(old.host === host && old.connector === sub, "CONNECTION_CONFLICT", "连接名称已用于不同平台或宿主。");
            requireValue(!existsSync(join(home(), "transactions", connection + ".json")), "RECOVERY_REQUIRED", "请先运行 connection recover，恢复中断的切换。");
            const actual = inspect(host, old.server);
            if (actual === undefined || !old.hostFingerprint) {
                await authorize(`恢复未完成的 ${old.server} 宿主注册？`, connection, !!v.yes);
                if (actual === undefined) {
                    const check = await verify(old);
                    requireValue(check.ok || check.code === "HOST_AUTH_REQUIRED", check.code || "PROBE_FAILED", "原连接验证失败；未恢复宿主注册。");
                    old.hostFingerprint = applyHost(old, cli, undefined);
                }
                else {
                    requireValue(matchesRegistration(actual, old, cli), "HOST_CONFLICT", "配置不是计划中的 WorkBridge 注册，未接管。");
                    old.hostFingerprint = fingerprint(actual);
                }
                atomicPrivate(path, old);
            }
            else
                requireValue(fingerprint(actual) === old.hostFingerprint, "HOST_CONFLICT", "宿主配置已被外部修改；未覆盖。");
            prior = old;
            if (v["allow-writes"] && !old.allowWrites && !v.replace) {
                requireValue(old.connector === "discourse" && old.transport === "stdio", "UNSUPPORTED_OPERATION", "写入模式由远程服务管理。");
                await authorize("启用该 Discourse 连接的写工具？业务发帖仍需明确授权。", connection, !!v.yes);
                const next = {
                    ...old,
                    allowWrites: true,
                    state: "pending-host-reload",
                };
                const check = await verify(next);
                requireValue(check.ok, check.code || "PROBE_FAILED", "验证失败，保留原连接。");
                atomicPrivate(path, next);
            }
            if (!v.replace) {
                output({
                    connection,
                    probe: await verify(load(connection)),
                    next: reload[host] +
                        " 认证失败时运行同一 connect 命令并添加 --replace，重新隐藏输入。",
                    reused: true,
                });
                return;
            }
            requireValue(old.transport === "stdio", "INVALID_TRANSPORT", "重新授权本地凭据只适用于 stdio 连接。");
        }
        const server = `workbridge-${connection}`;
        const existing = inspect(host, server);
        requireValue(prior
            ? prior.hostFingerprint &&
                fingerprint(existing) === prior.hostFingerprint
            : existing === undefined, "HOST_CONFLICT", "同名宿主服务已存在或已变化；不覆盖原服务。");
        let site;
        if (sub === "discourse") {
            site = safeUrl(v.site ||
                prior?.site ||
                String(await interact({
                    version: 1,
                    type: "input",
                    prompt: "Discourse 站点 HTTPS URL",
                    connection,
                })));
            await about(site);
        }
        await authorize(`将为 ${host} 新增 ${server}，凭据保存在仓库外的受限文件。继续？`, connection, !!v.yes);
        let credentialRef;
        let generated = false;
        let committed = false;
        try {
            ensurePrivate(join(home(), "credentials"));
            if (sub === "tapd") {
                process.stdout.write("请从 https://www.tapd.cn/personal_settings/index?tab=personal_token 获取 token。不要粘贴到聊天。\n");
                const token = String(await interact({
                    version: 1,
                    type: "secret",
                    prompt: "TAPD token（隐藏输入）",
                    connection,
                })).trim();
                credentialRef = join(home(), "credentials", connection + "-" + randomUUID() + ".json");
                const p = {
                    version: 1,
                    name: connection,
                    connector: sub,
                    host,
                    server,
                    transport: "stdio",
                    allowWrites: true,
                    state: "pending-host-reload",
                };
                const check = await verify(p, { token });
                requireValue(check.ok, check.code || "AUTH_FAILED", "TAPD 只读认证验证未通过；未保存凭据或修改宿主。");
                atomicPrivate(credentialRef, { token });
                generated = true;
            }
            else {
                credentialRef = v.profile
                    ? resolve(v.profile)
                    : join(home(), "credentials", connection + "-" + randomUUID() + ".json");
                if (!v.profile) {
                    generated = true;
                    await generateProfile(site, credentialRef);
                }
                validateDiscourseProfile(credentialRef, site);
            }
            const p = {
                version: 1,
                name: connection,
                connector: sub,
                host,
                server,
                transport: "stdio",
                site,
                credentialRef,
                allowWrites: sub === "tapd" || !!v["allow-writes"] || !!prior?.allowWrites,
                state: "pending-host-reload",
            };
            if (sub === "discourse") {
                const check = await verify(p);
                requireValue(check.ok, check.code || "PROBE_FAILED", "Discourse 验证失败，未修改宿主。");
            }
            // Persist a recoverable pending record before the host may start mcp-launch.
            if (prior)
                p.hostFingerprint = prior.hostFingerprint;
            atomicPrivate(path, p);
            committed = true;
            if (!prior) {
                p.hostFingerprint = applyHost(p, cli, undefined);
                atomicPrivate(path, p);
            }
            if (prior?.credentialRef &&
                prior.credentialRef !== credentialRef &&
                prior.credentialRef.startsWith(join(home(), "credentials") + "/")) {
                safePath(prior.credentialRef, true);
                rmSync(prior.credentialRef, { force: true });
            }
            output({
                ok: true,
                connection,
                state: p.state,
                hostVerified: false,
                next: reload[host],
            });
        }
        catch (e) {
            if (committed && inspect(host, server) === undefined) {
                rmSync(path, { force: true });
                committed = false;
            }
            if (generated && !committed && credentialRef)
                rmSync(credentialRef, { force: true });
            throw e;
        }
    });
}
main().catch((e) => {
    // Do not print arbitrary dependency messages: they can contain credentials.
    const safe = e instanceof BridgeError
        ? { code: e.code, message: e.message }
        : {
            code: "OPERATION_FAILED",
            message: "操作失败，未输出原始错误。请运行 doctor 检查连接状态。",
        };
    const stream = process.argv[2] === "mcp-launch" ? process.stderr : process.stdout;
    stream.write(JSON.stringify({ ok: false, ...safe }) + "\n");
    process.exitCode = 1;
});
