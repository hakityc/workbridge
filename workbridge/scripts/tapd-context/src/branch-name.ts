import { EntityType, ProjectConfig, WorkItemInput } from "./schema.js";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDate(date: Date): string {
  return `${String(date.getFullYear()).slice(-2)}${pad(date.getMonth() + 1)}${pad(
    date.getDate(),
  )}`;
}

export function slugifyTitle(title: string): string {
  const withoutPrefixes = title.replace(/^(?:\s*【[^】]*】\s*)+/, "");
  return withoutPrefixes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

export function fallbackSlug(item: WorkItemInput): string {
  const identity = item.short_id || item.id.slice(-9);
  return `${item.entity_type.toLowerCase()}-${identity}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .slice(0, 40);
}

export function buildBranchName(
  config: ProjectConfig,
  item: WorkItemInput,
  slugOverride: string | undefined,
  date: Date,
): string {
  const normalizedOverride = slugOverride ? slugifyTitle(slugOverride) : "";
  const slug = normalizedOverride || slugifyTitle(item.title || "") || fallbackSlug(item);
  const type = config.branch.type_map[item.entity_type];
  const identity = item.id;
  return config.branch.name_template
    .replaceAll("{type}", type)
    .replaceAll("{date}", formatDate(date))
    .replaceAll("{entity}", item.entity_type.toLowerCase())
    .replaceAll("{id}", identity)
    .replaceAll("{slug}", slug);
}

export interface ParsedBranchIdentity {
  entity_type?: EntityType;
  id: string;
  shorthand: boolean;
}

const TYPED_TAPD_BRANCH =
  /(?:^|\/)tapd-(story|task|bug)-([0-9A-Za-z_]+)(?=$|[-/])/i;
const SHORT_TAPD_BRANCH = /(?:^|\/)tapd-([0-9A-Za-z_]+)(?=$|[-/])/i;

function entityFromBranchToken(value: string): EntityType {
  const normalized = value.toLowerCase();
  if (normalized === "story") {
    return "Story";
  }
  if (normalized === "task") {
    return "Task";
  }
  return "Bug";
}

export function parseTapdBranchName(branch: string): ParsedBranchIdentity | null {
  const typed = branch.match(TYPED_TAPD_BRANCH);
  if (typed) {
    return {
      entity_type: entityFromBranchToken(typed[1]),
      id: typed[2],
      shorthand: false,
    };
  }

  const shorthand = branch.match(SHORT_TAPD_BRANCH);
  if (shorthand) {
    return {
      id: shorthand[1],
      shorthand: true,
    };
  }

  return null;
}
