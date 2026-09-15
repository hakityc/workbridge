import { closeSync, constants, existsSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, normalize } from "node:path";
import { getHeadCommit, runGit } from "./git.js";
import { CliError } from "./schema.js";
export const FLOW_SPEC_FILE = join(".flow", "spec.json");
function objectValue(value, path, issues) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        issues.push(`${path} 必须是对象。`);
        return {};
    }
    return value;
}
function rejectUnknownKeys(value, allowed, path, issues) {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) {
            issues.push(`${path}.${key} 是未知字段。`);
        }
    }
}
function stringValue(value, path, issues) {
    if (typeof value !== "string" || !value.trim()) {
        issues.push(`${path} 必须是非空字符串。`);
        return "";
    }
    const trimmed = value.trim();
    if (/【FLOW-SPEC-(?:BEGIN|END):/.test(trimmed)) {
        issues.push(`${path} 不能包含 FLOW-SPEC 保留标记。`);
    }
    return trimmed;
}
function repoUrlValue(value, path, issues) {
    const remote = stringValue(value, path, issues);
    if (!remote) {
        return remote;
    }
    if (remote.includes("?") || remote.includes("#")) {
        issues.push(`${path} 不能包含 query 或 fragment，以免提交凭据或临时签名。`);
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(remote)) {
        try {
            const parsed = new URL(remote);
            if (parsed.username || parsed.password) {
                issues.push(`${path} 不能包含用户名、token 或密码。`);
            }
        }
        catch {
            issues.push(`${path} 不是合法的仓库 URL。`);
        }
    }
    return remote;
}
function stringArray(value, path, issues, minItems = 0) {
    if (!Array.isArray(value)) {
        issues.push(`${path} 必须是字符串数组。`);
        return [];
    }
    const values = value.map((item, index) => stringValue(item, `${path}[${index}]`, issues));
    if (values.length < minItems) {
        issues.push(`${path} 至少需要 ${minItems} 项。`);
    }
    if (new Set(values).size !== values.length) {
        issues.push(`${path} 不能包含重复项。`);
    }
    return values;
}
function safeRepoPath(value, path, issues) {
    if (!value) {
        return value;
    }
    const normalized = normalize(value).replaceAll("\\", "/");
    if (isAbsolute(value) ||
        normalized === ".." ||
        normalized.startsWith("../") ||
        normalized.startsWith("/")) {
        issues.push(`${path} 必须是产品仓库内的相对路径。`);
    }
    return normalized;
}
function exactCommit(repoRoot, ref, path, issues) {
    if (!ref) {
        return "";
    }
    try {
        return runGit(["rev-parse", "--verify", `${ref}^{commit}`], repoRoot);
    }
    catch {
        issues.push(`${path} 无法解析为 Git commit：${ref}`);
        return "";
    }
}
function exactFullCommitValue(repoRoot, ref, path, issues) {
    const exactRef = exactCommit(repoRoot, ref, path, issues);
    if (ref && exactRef && ref !== exactRef) {
        issues.push(`${path} 必须是完整的 40 位 commit。`);
    }
    return exactRef;
}
function assertPathAtRef(repoRoot, ref, path, label, issues) {
    if (!ref || !path) {
        return;
    }
    try {
        runGit(["cat-file", "-e", `${ref}:${path}`], repoRoot);
    }
    catch {
        issues.push(`${label} 在规格 commit 中不存在：${path}`);
    }
}
function parseManifest(value, repoRoot) {
    const issues = [];
    const root = objectValue(value, "manifest", issues);
    rejectUnknownKeys(root, ["version", "spec_id", "title", "source", "scope", "acceptance", "publication", "review"], "manifest", issues);
    if (root.version !== 1) {
        issues.push("version 必须为 1。");
    }
    const specId = stringValue(root.spec_id, "spec_id", issues);
    if (specId && !/^[a-z0-9][a-z0-9._-]{2,63}$/.test(specId)) {
        issues.push("spec_id 只能使用 3-64 位小写字母、数字、点、下划线或连字符。");
    }
    root.spec_id = specId;
    root.title = stringValue(root.title, "title", issues);
    const source = objectValue(root.source, "source", issues);
    rejectUnknownKeys(source, ["repo_url", "ref", "document", "prototype_paths", "decisions"], "source", issues);
    const repoUrl = repoUrlValue(source.repo_url, "source.repo_url", issues);
    const sourceRef = stringValue(source.ref, "source.ref", issues);
    const document = safeRepoPath(stringValue(source.document, "source.document", issues), "source.document", issues);
    const prototypePaths = stringArray(source.prototype_paths, "source.prototype_paths", issues, 1).map((path, index) => safeRepoPath(path, `source.prototype_paths[${index}]`, issues));
    const decisions = source.decisions === undefined
        ? undefined
        : safeRepoPath(stringValue(source.decisions, "source.decisions", issues), "source.decisions", issues);
    source.repo_url = repoUrl;
    source.ref = sourceRef;
    source.document = document;
    source.prototype_paths = prototypePaths;
    if (decisions !== undefined) {
        source.decisions = decisions;
    }
    const exactRef = exactFullCommitValue(repoRoot, sourceRef, "source.ref", issues);
    assertPathAtRef(repoRoot, exactRef, document, "产品文档", issues);
    for (const path of prototypePaths) {
        assertPathAtRef(repoRoot, exactRef, path, "原型文件", issues);
    }
    if (decisions) {
        assertPathAtRef(repoRoot, exactRef, decisions, "评审决定文件", issues);
    }
    const scope = objectValue(root.scope, "scope", issues);
    rejectUnknownKeys(scope, ["in_scope", "out_of_scope"], "scope", issues);
    scope.in_scope = stringArray(scope.in_scope, "scope.in_scope", issues, 1);
    scope.out_of_scope = stringArray(scope.out_of_scope, "scope.out_of_scope", issues);
    if (!Array.isArray(root.acceptance) || root.acceptance.length === 0) {
        issues.push("acceptance 至少需要一个验收点。");
    }
    const acceptanceIds = [];
    const normalizedAcceptance = [];
    if (Array.isArray(root.acceptance)) {
        root.acceptance.forEach((item, index) => {
            const acceptance = objectValue(item, `acceptance[${index}]`, issues);
            rejectUnknownKeys(acceptance, ["id", "priority", "statement"], `acceptance[${index}]`, issues);
            const id = stringValue(acceptance.id, `acceptance[${index}].id`, issues);
            if (id && !/^AC-[0-9]{2,}$/.test(id)) {
                issues.push(`acceptance[${index}].id 必须使用 AC-01 格式。`);
            }
            acceptanceIds.push(id);
            const priority = acceptance.priority === "should" ? "should" : "must";
            if (!["must", "should"].includes(acceptance.priority)) {
                issues.push(`acceptance[${index}].priority 只能是 must 或 should。`);
            }
            const statement = stringValue(acceptance.statement, `acceptance[${index}].statement`, issues);
            normalizedAcceptance.push({ id, priority, statement });
        });
    }
    root.acceptance = normalizedAcceptance;
    if (new Set(acceptanceIds).size !== acceptanceIds.length) {
        issues.push("acceptance.id 不能重复。");
    }
    const publication = root.publication === undefined
        ? undefined
        : objectValue(root.publication, "publication", issues);
    if (publication) {
        rejectUnknownKeys(publication, ["provider", "space_id", "entity_type", "external_id", "url", "published_ref"], "publication", issues);
        publication.provider = stringValue(publication.provider, "publication.provider", issues);
        publication.space_id = stringValue(publication.space_id, "publication.space_id", issues);
        if (publication.entity_type !== "requirement") {
            issues.push("publication.entity_type 必须为 requirement。");
        }
        const mappingFields = ["external_id", "url", "published_ref"];
        const mappingCount = mappingFields.filter((field) => publication[field] !== undefined).length;
        if (mappingCount > 0 && mappingCount < mappingFields.length) {
            issues.push("publication 的 external_id、url、published_ref 必须同时存在或同时缺失。");
        }
        for (const field of mappingFields) {
            if (publication[field] !== undefined) {
                publication[field] = stringValue(publication[field], `publication.${field}`, issues);
            }
        }
        if (typeof publication.published_ref === "string" && publication.published_ref) {
            exactFullCommitValue(repoRoot, publication.published_ref, "publication.published_ref", issues);
        }
    }
    const review = root.review === undefined ? undefined : objectValue(root.review, "review", issues);
    if (review) {
        rejectUnknownKeys(review, ["status", "reviewed_ref", "decided_at"], "review", issues);
    }
    const reviewStatus = review?.status;
    let reviewedExactRef = "";
    if (review &&
        !["draft", "reviewing", "approved", "changes-required"].includes(reviewStatus)) {
        issues.push("review.status 无效。");
    }
    if (reviewStatus === "approved") {
        const reviewedRef = stringValue(review?.reviewed_ref, "review.reviewed_ref", issues);
        reviewedExactRef = exactFullCommitValue(repoRoot, reviewedRef, "review.reviewed_ref", issues);
        const decidedAt = stringValue(review?.decided_at, "review.decided_at", issues);
        if (decidedAt && Number.isNaN(Date.parse(decidedAt))) {
            issues.push("review.decided_at 必须是 ISO 日期时间。");
        }
        if (review) {
            review.reviewed_ref = reviewedRef;
            review.decided_at = decidedAt;
        }
    }
    if (issues.length > 0) {
        throw new CliError("INVALID_SPEC_MANIFEST", "Flow 规格清单未通过校验。", { issues });
    }
    const manifest = root;
    return {
        manifest,
        exactRef,
        providerSupported: manifest.publication?.provider === "tapd" && Boolean(manifest.publication.space_id),
        localReviewGateValid: manifest.review?.status === "approved" &&
            reviewedExactRef === exactRef &&
            Boolean(manifest.publication?.external_id && manifest.publication.url),
    };
}
export function readAndValidateFlowSpec(repoRoot) {
    const path = join(repoRoot, FLOW_SPEC_FILE);
    if (!existsSync(path)) {
        throw new CliError("SPEC_NOT_INITIALIZED", "产品仓库尚未创建 .flow/spec.json。");
    }
    let value;
    try {
        value = JSON.parse(readFileSync(path, "utf8"));
    }
    catch (error) {
        throw new CliError("INVALID_SPEC_MANIFEST", ".flow/spec.json 不是合法 JSON。", {
            cause: error instanceof Error ? error.message : String(error),
        });
    }
    return parseManifest(value, repoRoot);
}
export function renderFlowRequirement(result) {
    const { manifest, exactRef } = result;
    const provider = manifest.publication?.provider || "tapd";
    const spaceId = manifest.publication?.space_id || "";
    const reviewStatus = manifest.review?.status || "draft";
    const inScope = manifest.scope.in_scope.map((item) => `- ${item}`).join("\n");
    const outOfScope = manifest.scope.out_of_scope.length
        ? manifest.scope.out_of_scope.map((item) => `- ${item}`).join("\n")
        : "- 无";
    const acceptance = manifest.acceptance
        .map((item) => `- ${item.id} [${item.priority}] ${item.statement}`)
        .join("\n");
    const prototypes = manifest.source.prototype_paths.map((path) => `- ${path}`).join("\n");
    return {
        title: `【FLOW:${manifest.spec_id}】${manifest.title}`,
        idempotency_key: `${manifest.spec_id}:${provider}:${spaceId}`,
        managed_description: [
            `【FLOW-SPEC-BEGIN:${manifest.spec_id}】`,
            `规格来源：${manifest.source.repo_url}`,
            `规格版本：${exactRef}`,
            `产品文档：${manifest.source.document}`,
            "原型：",
            prototypes,
            "",
            "目标与范围：",
            inScope,
            "",
            "不在范围：",
            outOfScope,
            "",
            "验收标准：",
            acceptance,
            "",
            `评审状态：${reviewStatus}`,
            `【FLOW-SPEC-END:${manifest.spec_id}】`,
        ].join("\n"),
    };
}
function remoteUrl(repoRoot) {
    let value = "";
    try {
        value = runGit(["config", "--get", "remote.origin.url"], repoRoot);
    }
    catch {
        throw new CliError("GIT_REMOTE_NOT_FOUND", "产品仓库缺少 origin remote，无法生成可追溯的规格来源。");
    }
    const issues = [];
    const safeValue = repoUrlValue(value, "origin remote", issues);
    if (issues.length > 0) {
        throw new CliError("UNSAFE_GIT_REMOTE_URL", "origin remote 不能安全写入共享规格清单。", { issues });
    }
    return safeValue;
}
function flowOutputPath(repoRoot) {
    const directory = join(repoRoot, dirname(FLOW_SPEC_FILE));
    if (existsSync(directory)) {
        const status = lstatSync(directory);
        if (status.isSymbolicLink() || !status.isDirectory()) {
            throw new CliError("UNSAFE_SPEC_PATH", ".flow 必须是产品仓库内的真实目录，不能是文件或软链接。");
        }
    }
    else {
        mkdirSync(directory, { mode: 0o755 });
    }
    const path = join(repoRoot, FLOW_SPEC_FILE);
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) {
        throw new CliError("UNSAFE_SPEC_PATH", ".flow/spec.json 不能是软链接。");
    }
    return path;
}
function writeManifestAtomically(repoRoot, manifest) {
    const path = flowOutputPath(repoRoot);
    const temporary = join(dirname(path), `.spec.${process.pid}.${randomUUID()}.tmp`);
    let descriptor;
    try {
        descriptor = openSync(temporary, constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW, 0o600);
        writeFileSync(descriptor, `${JSON.stringify(manifest, null, 2)}\n`);
        closeSync(descriptor);
        descriptor = undefined;
        renameSync(temporary, path);
    }
    catch (error) {
        if (descriptor !== undefined) {
            closeSync(descriptor);
        }
        if (existsSync(temporary)) {
            unlinkSync(temporary);
        }
        throw error;
    }
}
function assertSourcePathsCommitted(repoRoot, paths) {
    const output = runGit(["status", "--porcelain=v1", "--", ...paths], repoRoot);
    if (output) {
        throw new CliError("SPEC_SOURCE_NOT_COMMITTED", "产品文档或原型存在未提交修改；请先提交，再重新生成规格清单。", { entries: output.split("\n").filter(Boolean) });
    }
}
export function initializeFlowSpec(repoRoot, input) {
    const path = join(repoRoot, FLOW_SPEC_FILE);
    if (existsSync(path) && !input.force) {
        throw new CliError("SPEC_ALREADY_INITIALIZED", ".flow/spec.json 已存在；确认覆盖时使用 --force。");
    }
    const ref = getHeadCommit(repoRoot);
    const manifest = {
        version: 1,
        spec_id: input.specId,
        title: input.title,
        source: {
            repo_url: remoteUrl(repoRoot),
            ref,
            document: input.document,
            prototype_paths: input.prototypePaths,
        },
        scope: {
            in_scope: input.inScope,
            out_of_scope: input.outOfScope,
        },
        acceptance: input.acceptance.map((statement, index) => ({
            id: `AC-${String(index + 1).padStart(2, "0")}`,
            priority: "must",
            statement,
        })),
        publication: {
            provider: "tapd",
            space_id: input.workspaceId,
            entity_type: "requirement",
        },
        review: {
            status: "draft",
        },
    };
    const result = parseManifest(manifest, repoRoot);
    assertSourcePathsCommitted(repoRoot, [
        result.manifest.source.document,
        ...result.manifest.source.prototype_paths,
    ]);
    writeManifestAtomically(repoRoot, manifest);
    return result;
}
