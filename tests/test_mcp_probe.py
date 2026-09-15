import json
import os
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / "workbridge" / "scripts" / "mcp_probe.mjs"
FAKE_SERVER = ROOT / "tests" / "fixtures" / "fake_mcp_server.mjs"


def run_probe(arguments: list[str], env: dict[str, str] | None = None):
    return subprocess.run(
        ["node", str(PROBE), *arguments],
        cwd=ROOT,
        env={**os.environ, **(env or {})},
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
        timeout=5,
    )


class McpProbeTests(unittest.TestCase):
    def test_read_only_probe_checks_capability_and_calls_fake_server(self):
        result = run_probe(
            [
                "--require",
                "get_user_participant_projects,create_story_or_task",
                "--probe",
                "get_user_participant_projects",
                "--",
                "node",
                str(FAKE_SERVER),
            ]
        )
        self.assertEqual(result.returncode, 0, result.stdout)
        output = json.loads(result.stdout)
        self.assertTrue(output["ok"])
        self.assertEqual(output["stage"], "read-only-probe")

    def test_write_probe_and_missing_probe_value_are_rejected_before_spawn(self):
        write_result = run_probe(
            ["--probe", "create_story_or_task", "--", "node", str(FAKE_SERVER)]
        )
        self.assertNotEqual(write_result.returncode, 0)
        self.assertIn("only accepts read-only tools", write_result.stdout)

        missing_result = run_probe(["--probe", "--", "node", str(FAKE_SERVER)])
        self.assertNotEqual(missing_result.returncode, 0)
        self.assertIn("needs one read-only tool name", missing_result.stdout)

    def test_probe_redacts_credentials_and_times_out_cleanly(self):
        secret = "tapd-super-secret-fixture"
        failed = run_probe(
            [
                "--probe",
                "get_user_participant_projects",
                "--",
                "node",
                str(FAKE_SERVER),
            ],
            {"TAPD_ACCESS_TOKEN": secret, "FAKE_MCP_FAIL": "1"},
        )
        self.assertNotEqual(failed.returncode, 0)
        self.assertNotIn(secret, failed.stdout)
        self.assertIn("PROBE_FAILED", failed.stdout)

        timed_out = run_probe(
            ["--", "node", str(FAKE_SERVER)],
            {"FAKE_MCP_HANG": "1", "FLOW_MCP_PROBE_TIMEOUT_MS": "50"},
        )
        self.assertNotEqual(timed_out.returncode, 0)
        self.assertEqual(json.loads(timed_out.stdout)["stage"], "timeout")


if __name__ == "__main__":
    unittest.main()
