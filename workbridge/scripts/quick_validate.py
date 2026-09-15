#!/usr/bin/env python3
"""Self-contained validation for the TAPD skill."""

from __future__ import annotations

import json
import py_compile
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ALLOWED_FRONTMATTER = {
    "name",
    "description",
    "license",
    "allowed-tools",
    "metadata",
    "compatibility",
}
REQUIRED_SCHEMAS = {
    "input.schema.json",
    "config.schema.json",
    "project.schema.json",
    "context.schema.json",
    "team.schema.json",
    "spec-manifest.schema.json",
}
REQUIRED_EXAMPLES = {
    "tapd-context.input.json",
    "config.example.json",
    "project.example.json",
    "context.example.json",
    "team.example.json",
    "spec-manifest.example.json",
}
REQUIRED_REFERENCES = {
    "just-in-time-onboarding.md",
    "mcp-bootstrap.md",
    "team-policy.md",
    "work-item-orchestrator.md",
}


class ValidationError(RuntimeError):
    pass


def run(command: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        command,
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    if result.returncode != 0:
        raise ValidationError(
            f"Command failed ({' '.join(command)}):\n{result.stdout.strip()}"
        )
    return result


def load_json(path: Path) -> object:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise ValidationError(f"Invalid JSON: {path}: {exc}") from exc


def validate_frontmatter(skill_root: Path) -> None:
    path = skill_root / "SKILL.md"
    content = path.read_text(encoding="utf-8")
    match = re.match(r"^---\n(.*?)\n---\n", content, re.DOTALL)
    if not match:
        raise ValidationError("SKILL.md has invalid YAML frontmatter delimiters")

    values: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if not line.strip() or line.startswith((" ", "\t")):
            continue
        key, separator, value = line.partition(":")
        if not separator:
            raise ValidationError(f"Invalid frontmatter line: {line}")
        values[key.strip()] = value.strip()

    unexpected = set(values) - ALLOWED_FRONTMATTER
    if unexpected:
        raise ValidationError(f"Unexpected frontmatter keys: {sorted(unexpected)}")
    if values.get("name") != "workbridge":
        raise ValidationError("Frontmatter name must be workbridge")
    description = values.get("description", "")
    if not description or len(description) > 1024:
        raise ValidationError("Frontmatter description is missing or longer than 1024 chars")
    if "<" in description or ">" in description:
        raise ValidationError("Frontmatter description cannot contain angle brackets")


def validate_reference_links(skill_root: Path) -> None:
    references_root = skill_root / "references" / "tapd"
    missing_required = REQUIRED_REFERENCES - {path.name for path in references_root.glob("*.md")}
    if missing_required:
        raise ValidationError(f"Required references are missing: {sorted(missing_required)}")
    markdown_files = [skill_root / "SKILL.md", *(skill_root / "references").rglob("*.md")]
    missing: set[str] = set()
    for path in markdown_files:
        content = path.read_text(encoding="utf-8")
        references = set(re.findall(r"references/([a-z0-9][a-z0-9/-]*\.md)", content))
        for name in references:
            target = skill_root / "references" / name
            if not target.exists():
                missing.add(str(target.relative_to(skill_root)))
        local_names = set(re.findall(r"`([a-z0-9][a-z0-9-]*\.md)`", content))
        for name in local_names:
            target = path.parent / name
            if not target.exists():
                missing.add(str(target.relative_to(skill_root)))
    if missing:
        raise ValidationError(f"Missing local reference links: {sorted(missing)}")


def validate_json_assets(skill_root: Path) -> None:
    examples = skill_root / "examples"
    if not REQUIRED_EXAMPLES.issubset(path.name for path in examples.glob("*.json")):
        raise ValidationError("examples JSON set is incomplete")
    for path in examples.glob("*.json"):
        load_json(path)

    schemas = skill_root / "scripts" / "tapd-context" / "schemas"
    if not REQUIRED_SCHEMAS.issubset(path.name for path in schemas.glob("*.json")):
        raise ValidationError("tapd-context schemas are incomplete")
    for path in schemas.glob("*.json"):
        value = load_json(path)
        if not isinstance(value, dict) or "$schema" not in value or "type" not in value:
            raise ValidationError(f"Schema lacks $schema/type: {path}")

    team_schema = load_json(schemas / "team.schema.json")
    assert isinstance(team_schema, dict)
    schema_actions = set(team_schema["$defs"]["writeActions"]["items"]["enum"])
    schema_source = (skill_root / "scripts" / "tapd-context" / "src" / "schema.ts").read_text(
        encoding="utf-8"
    )
    actions_match = re.search(
        r"export const TEAM_WRITE_ACTIONS = \[(.*?)\] as const;",
        schema_source,
        re.DOTALL,
    )
    if not actions_match:
        raise ValidationError("TEAM_WRITE_ACTIONS declaration is missing")
    source_actions = set(re.findall(r'"([a-z-]+)"', actions_match.group(1)))
    if source_actions != schema_actions:
        raise ValidationError(
            "TEAM_WRITE_ACTIONS differs between src/schema.ts and team.schema.json"
        )

    team_example = load_json(examples / "team.example.json")
    assert isinstance(team_example, dict)
    example_actions = {
        action
        for actions in team_example["permissions"]["write_actions_by_profile"].values()
        for action in actions
    }
    if not example_actions.issubset(schema_actions):
        raise ValidationError("team.example.json contains unknown write actions")

    evals = load_json(skill_root / "evals" / "evals.json")
    if not isinstance(evals, dict) or not isinstance(evals.get("cases"), list):
        raise ValidationError("evals/evals.json must retain the cases array")
    case_ids = [case.get("id") for case in evals["cases"] if isinstance(case, dict)]
    original = {
        "intake-must-read-story-description-and-proto",
        "task-update-guard-only-my-owner",
        "tcase-fallback-openapi-when-mcp-missing",
    }
    if not original.issubset(case_ids):
        raise ValidationError("One or more original eval cases were removed")


def validate_python(skill_root: Path) -> None:
    python_files = [
        skill_root / "scripts" / "get_current_user.py",
        skill_root / "scripts" / "safety_utils.py",
        skill_root / "scripts" / "quick_validate.py",
    ]
    with tempfile.TemporaryDirectory(prefix="tapd-pycompile-") as temp_dir:
        for index, path in enumerate(python_files):
            try:
                py_compile.compile(
                    str(path),
                    cfile=str(Path(temp_dir) / f"{index}.pyc"),
                    doraise=True,
                )
            except py_compile.PyCompileError as exc:
                raise ValidationError(f"py_compile failed for {path}: {exc}") from exc


def compare_dist(package_root: Path) -> None:
    tsc = package_root / "node_modules" / ".bin" / "tsc"
    if not tsc.exists():
        raise ValidationError(
            "Development validation requires npm install in scripts/tapd-context"
        )

    with tempfile.TemporaryDirectory(prefix="tapd-context-build-") as temp_dir:
        fresh_dist = Path(temp_dir) / "dist"
        run(
            [
                str(tsc),
                "-p",
                str(package_root / "tsconfig.json"),
                "--outDir",
                str(fresh_dist),
            ],
            cwd=package_root,
        )
        committed_dist = package_root / "dist"
        fresh_files = {
            path.relative_to(fresh_dist)
            for path in fresh_dist.rglob("*")
            if path.is_file()
        }
        committed_files = {
            path.relative_to(committed_dist)
            for path in committed_dist.rglob("*")
            if path.is_file()
        }
        if fresh_files != committed_files:
            raise ValidationError(
                f"src/dist file sets differ: fresh={sorted(map(str, fresh_files))}, "
                f"committed={sorted(map(str, committed_files))}"
            )
        for relative in sorted(fresh_files):
            if (fresh_dist / relative).read_bytes() != (committed_dist / relative).read_bytes():
                raise ValidationError(f"Committed dist is stale: {relative}")


def validate_cli(skill_root: Path) -> None:
    package_root = skill_root / "scripts" / "tapd-context"
    if not (package_root / "package-lock.json").exists():
        raise ValidationError("tapd-context package-lock.json is required")
    package = load_json(package_root / "package.json")
    if not isinstance(package, dict) or package.get("engines", {}).get("node") != ">=18":
        raise ValidationError("tapd-context must declare Node.js >=18 runtime")

    node = shutil.which("node")
    if not node:
        raise ValidationError("node is required for development validation")
    compare_dist(package_root)
    help_result = run([node, str(package_root / "dist" / "cli.js"), "--help"])
    if "tapd-context start" not in help_result.stdout:
        raise ValidationError("bundled dist CLI help is incomplete")
    if "tapd-context spec init" not in help_result.stdout:
        raise ValidationError("bundled dist CLI is missing Flow spec commands")
    run([node, "--check", str(skill_root / "scripts" / "mcp_probe.mjs")])


def run_tests(skill_root: Path) -> None:
    repository_tests = skill_root.parent / "tests"
    tests_root = repository_tests if repository_tests.is_dir() else skill_root / "tests"
    python_result = run(
        [
            sys.executable,
            "-m",
            "unittest",
            "discover",
            "-s",
            str(tests_root),
            "-p",
            "test_*.py",
        ],
        cwd=skill_root,
    )
    print("Python:", " ".join(line for line in python_result.stdout.splitlines() if line.startswith(("Ran ", "OK"))))
    node = shutil.which("node")
    assert node
    test_files = sorted(
        str(path)
        for path in (skill_root / "scripts" / "tapd-context" / "test").glob("*.test.mjs")
    )
    legacy_result = run([node, "--test", *test_files], cwd=skill_root)
    print("Legacy Node:", " ".join(line for line in legacy_result.stdout.splitlines() if line.startswith(("# tests", "# pass", "# fail", "# skipped"))))


def validate(skill_root: Path) -> None:
    validate_frontmatter(skill_root)
    validate_reference_links(skill_root)
    validate_json_assets(skill_root)
    validate_python(skill_root)
    validate_cli(skill_root)
    run_tests(skill_root)
    result = run(["npm", "test"], cwd=skill_root / "scripts")
    print("WorkBridge Node:", " ".join(line for line in result.stdout.splitlines() if line.startswith(("# tests", "# pass", "# fail", "# skipped"))))
    compare_dist(skill_root / "scripts")


def main() -> int:
    skill_root = (
        Path(sys.argv[1]).resolve()
        if len(sys.argv) > 1
        else Path(__file__).resolve().parents[1]
    )
    try:
        validate(skill_root)
    except ValidationError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    print("OK: WorkBridge validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
