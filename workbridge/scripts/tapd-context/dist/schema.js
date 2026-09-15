export const ENTITY_TYPES = ["Story", "Task", "Bug"];
export const TEAM_PROFILES = ["frontend", "backend", "qa", "product", "lead"];
export const EFFORT_WRITEBACK_MODES = ["confirm", "auto", "never"];
export const STATUS_TRANSITION_MODES = ["never", "confirm"];
export const UPDATE_SCOPES = ["self", "explicit-team"];
export const TEAM_WRITE_ACTIONS = [
    "create-requirement",
    "update-requirement",
    "create-task",
    "update-self-task",
    "update-explicit-team-task",
    "write-effort",
    "create-tcase",
    "create-comment",
    "write-timesheet",
    "transition-status",
];
export class CliError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = "CliError";
        this.code = code;
        this.details = details;
    }
}
export function asString(value) {
    if (value === null || value === undefined) {
        return "";
    }
    return String(value).trim();
}
export function normalizeEntityType(value) {
    const raw = asString(value).toLowerCase();
    if (raw === "story" || raw === "stories") {
        return "Story";
    }
    if (raw === "task" || raw === "tasks") {
        return "Task";
    }
    if (raw === "bug" || raw === "bugs") {
        return "Bug";
    }
    throw new CliError("MISSING_WORK_ITEM_TYPE", "工作项类型必须是 Story、Task 或 Bug。");
}
export function normalizeWorkItem(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new CliError("INVALID_INPUT_JSON", "TAPD Context JSON 必须是对象。");
    }
    const input = value;
    const id = asString(input.id);
    if (!id) {
        throw new CliError("MISSING_WORK_ITEM_ID", "TAPD Context 缺少工作项 id。");
    }
    const item = {
        source: asString(input.source) || "tapd",
        entity_type: normalizeEntityType(input.entity_type),
        id,
    };
    const optionalKeys = [
        "short_id",
        "title",
        "url",
        "external_url",
        "user_nick",
        "workspace_id",
    ];
    for (const key of optionalKeys) {
        const normalized = asString(input[key]);
        if (normalized) {
            item[key] = normalized;
        }
    }
    return item;
}
export function defaultProjectConfig(baseBranch, workspaceId, userNick, profile) {
    return {
        version: 1,
        base_branch: baseBranch,
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
        ...(userNick ? { user_nick: userNick } : {}),
        ...(profile ? { profile } : {}),
        branch: {
            type_map: {
                Story: "feat",
                Task: "task",
                Bug: "fix",
            },
            name_template: "{type}/tapd-{entity}-{id}-{slug}",
            date_format: "YYMMDD",
            slug_language: "en",
        },
    };
}
function optionalEnum(value, allowed, field) {
    const normalized = asString(value);
    if (!normalized) {
        return undefined;
    }
    if (!allowed.includes(normalized)) {
        throw new CliError("INVALID_CONFIG_FILE", `${field} 的值无效：${normalized}`);
    }
    return normalized;
}
function optionalNumber(value, field, minimum, exclusive = false) {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new CliError("INVALID_CONFIG_FILE", `${field} 必须是数字。`);
    }
    if (exclusive ? value <= minimum : value < minimum) {
        const qualifier = exclusive ? "大于" : "不小于";
        throw new CliError("INVALID_CONFIG_FILE", `${field} 必须${qualifier} ${minimum}。`);
    }
    return value;
}
function normalizeEffort(value) {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
        throw new CliError("INVALID_CONFIG_FILE", "effort 必须是对象。");
    }
    const raw = value;
    const effort = {};
    const capacity = optionalNumber(raw.capacity_per_week_hours, "effort.capacity_per_week_hours", 0, true);
    const wip = optionalNumber(raw.wip_limit, "effort.wip_limit", 1);
    const ai = optionalNumber(raw.ai_coding_factor, "effort.ai_coding_factor", 0, true);
    const integration = optionalNumber(raw.integration_factor, "effort.integration_factor", 0, true);
    const planning = optionalNumber(raw.planning_factor, "effort.planning_factor", 0, true);
    const buffer = optionalNumber(raw.buffer_percent, "effort.buffer_percent", 0);
    if (capacity !== undefined)
        effort.capacity_per_week_hours = capacity;
    if (wip !== undefined) {
        if (!Number.isInteger(wip)) {
            throw new CliError("INVALID_CONFIG_FILE", "effort.wip_limit 必须是整数。");
        }
        effort.wip_limit = wip;
    }
    if (ai !== undefined)
        effort.ai_coding_factor = ai;
    if (integration !== undefined)
        effort.integration_factor = integration;
    if (planning !== undefined)
        effort.planning_factor = planning;
    if (buffer !== undefined)
        effort.buffer_percent = buffer;
    if (raw.auto_writeback !== undefined) {
        if (typeof raw.auto_writeback !== "boolean") {
            throw new CliError("INVALID_CONFIG_FILE", "effort.auto_writeback 必须是布尔值。");
        }
        effort.auto_writeback = raw.auto_writeback;
    }
    return effort;
}
function normalizeWorkflow(value) {
    if (value === null || value === undefined) {
        return undefined;
    }
    if (typeof value !== "object" || Array.isArray(value)) {
        throw new CliError("INVALID_CONFIG_FILE", "workflow 必须是对象。");
    }
    const raw = value;
    const effortWriteback = optionalEnum(raw.effort_writeback, EFFORT_WRITEBACK_MODES, "workflow.effort_writeback");
    return effortWriteback ? { effort_writeback: effortWriteback } : {};
}
function objectValue(value, field) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new CliError("INVALID_TEAM_POLICY", `${field} 必须是对象。`);
    }
    return value;
}
function rejectUnknownKeys(value, allowed, field) {
    const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
    if (unknown.length > 0) {
        throw new CliError("INVALID_TEAM_POLICY", `${field} 包含未知字段：${unknown.join(", ")}。`);
    }
}
function requiredEnum(value, allowed, field) {
    const normalized = asString(value);
    if (!normalized || !allowed.includes(normalized)) {
        throw new CliError("INVALID_TEAM_POLICY", `${field} 必须是以下值之一：${allowed.join(", ")}。`);
    }
    return normalized;
}
export function validateTeamPolicy(value) {
    const root = objectValue(value, "team policy");
    rejectUnknownKeys(root, [
        "version",
        "workspace_id",
        "base_branch",
        "defaults",
        "task",
        "permissions",
        "effort",
    ], "team policy");
    if (root.version !== 1) {
        throw new CliError("INVALID_TEAM_POLICY", "team policy 缺少 version=1。");
    }
    for (const field of ["workspace_id", "base_branch"]) {
        if (root[field] !== undefined &&
            (typeof root[field] !== "string" || !root[field].trim())) {
            throw new CliError("INVALID_TEAM_POLICY", `${field} 必须是非空字符串。`);
        }
    }
    const defaults = objectValue(root.defaults, "defaults");
    rejectUnknownKeys(defaults, ["profile", "effort_writeback", "status_transition"], "defaults");
    requiredEnum(defaults.profile, TEAM_PROFILES, "defaults.profile");
    requiredEnum(defaults.effort_writeback, EFFORT_WRITEBACK_MODES, "defaults.effort_writeback");
    requiredEnum(defaults.status_transition, STATUS_TRANSITION_MODES, "defaults.status_transition");
    const task = objectValue(root.task, "task");
    rejectUnknownKeys(task, ["prefix_by_profile", "update_scope_by_profile"], "task");
    const prefixes = objectValue(task.prefix_by_profile, "task.prefix_by_profile");
    rejectUnknownKeys(prefixes, TEAM_PROFILES, "task.prefix_by_profile");
    for (const [profile, prefix] of Object.entries(prefixes)) {
        if (typeof prefix !== "string" || !prefix.trim()) {
            throw new CliError("INVALID_TEAM_POLICY", `task.prefix_by_profile.${profile} 必须是非空字符串。`);
        }
    }
    const scopes = objectValue(task.update_scope_by_profile, "task.update_scope_by_profile");
    rejectUnknownKeys(scopes, TEAM_PROFILES, "task.update_scope_by_profile");
    for (const [profile, scope] of Object.entries(scopes)) {
        requiredEnum(scope, UPDATE_SCOPES, `task.update_scope_by_profile.${profile}`);
    }
    const permissions = objectValue(root.permissions, "permissions");
    rejectUnknownKeys(permissions, ["write_actions_by_profile"], "permissions");
    const writeActions = objectValue(permissions.write_actions_by_profile, "permissions.write_actions_by_profile");
    rejectUnknownKeys(writeActions, TEAM_PROFILES, "permissions.write_actions_by_profile");
    for (const [profile, actions] of Object.entries(writeActions)) {
        if (!Array.isArray(actions) || new Set(actions).size !== actions.length) {
            throw new CliError("INVALID_TEAM_POLICY", `permissions.write_actions_by_profile.${profile} 必须是无重复数组。`);
        }
        for (const action of actions) {
            requiredEnum(action, TEAM_WRITE_ACTIONS, `permissions.write_actions_by_profile.${profile}`);
        }
    }
    if (root.effort !== undefined) {
        const effort = objectValue(root.effort, "effort");
        rejectUnknownKeys(effort, [
            "capacity_per_week_hours",
            "wip_limit",
            "ai_coding_factor",
            "integration_factor",
            "planning_factor",
            "buffer_percent",
        ], "effort");
        try {
            normalizeEffort(effort);
        }
        catch (error) {
            if (error instanceof CliError) {
                throw new CliError("INVALID_TEAM_POLICY", error.message);
            }
            throw error;
        }
    }
}
export function validateProjectConfig(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new CliError("INVALID_CONFIG_FILE", "TAPD 项目配置必须是 JSON 对象。");
    }
    const config = value;
    const baseBranch = asString(config.base_branch) || asString(config.git?.base_branch);
    const workspaceId = asString(config.workspace_id) || asString(config.tapd?.workspace_id);
    const userNick = asString(config.user_nick) || asString(config.user?.display_name);
    if (config.version !== 1 || !baseBranch) {
        throw new CliError("INVALID_CONFIG_FILE", "TAPD 项目配置缺少 version 或 base_branch。");
    }
    const profile = optionalEnum(config.profile, TEAM_PROFILES, "profile");
    const defaults = defaultProjectConfig(baseBranch, workspaceId, userNick, profile);
    const typeMap = config.branch?.type_map;
    if (typeMap) {
        for (const entityType of ENTITY_TYPES) {
            const mapped = asString(typeMap[entityType]);
            if (mapped) {
                defaults.branch.type_map[entityType] = mapped;
            }
        }
    }
    defaults.branch.name_template =
        asString(config.branch?.name_template) || defaults.branch.name_template;
    const effort = normalizeEffort(config.effort);
    const workflow = normalizeWorkflow(config.workflow);
    if (effort) {
        defaults.effort = effort;
    }
    if (workflow) {
        defaults.workflow = workflow;
    }
    return defaults;
}
export function emptyContextStore() {
    return {
        version: 1,
        branches: {},
    };
}
export function validateContextStore(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new CliError("INVALID_CONTEXT_FILE", ".tapd/context.json 必须是 JSON 对象。");
    }
    const store = value;
    if (store.version !== 1 ||
        !store.branches ||
        typeof store.branches !== "object" ||
        Array.isArray(store.branches)) {
        throw new CliError("INVALID_CONTEXT_FILE", ".tapd/context.json 缺少 version 或 branches 映射。");
    }
    for (const [branchName, rawContext] of Object.entries(store.branches)) {
        if (!rawContext || typeof rawContext !== "object" || Array.isArray(rawContext)) {
            throw new CliError("INVALID_CONTEXT_FILE", `.tapd/context.json 中的分支 ${branchName} 不是有效对象。`);
        }
        const context = rawContext;
        const validBinding = context.binding?.method === "start" || context.binding?.method === "bind";
        const validStatus = context.status?.local_phase === "initialized" &&
            (context.status.last_synced_at === null ||
                typeof context.status.last_synced_at === "string");
        const validGit = Boolean(asString(context.git?.base_branch)) &&
            Boolean(asString(context.git?.source_branch)) &&
            Boolean(asString(context.git?.created_from_commit));
        const validWorkItem = context.work_item &&
            typeof context.work_item === "object" &&
            Boolean(asString(context.work_item.id));
        try {
            if (validWorkItem) {
                normalizeEntityType(context.work_item?.entity_type);
            }
        }
        catch {
            throw new CliError("INVALID_CONTEXT_FILE", `.tapd/context.json 中分支 ${branchName} 的工作项类型无效。`);
        }
        if (asString(context.branch) !== branchName ||
            !asString(context.created_at) ||
            !asString(context.updated_at) ||
            !validBinding ||
            !validStatus ||
            !validGit ||
            !validWorkItem ||
            !context.assignee ||
            typeof context.assignee !== "object") {
            throw new CliError("INVALID_CONTEXT_FILE", `.tapd/context.json 中分支 ${branchName} 的结构不完整。`);
        }
    }
    return store;
}
