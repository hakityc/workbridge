import contextlib
import importlib.util
import io
import json
import os
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "workbridge" / "scripts" / "get_current_user.py"
SPEC = importlib.util.spec_from_file_location("get_current_user", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class FakeResponse:
    def __init__(self, body: str):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.body.encode()


class GetCurrentUserTest(unittest.TestCase):
    def run_main(self, body: str):
        stdout = io.StringIO()
        stderr = io.StringIO()
        env = {
            "TAPD_ACCESS_TOKEN": "test-placeholder-token",
            "TAPD_API_BASE_URL": "https://api.tapd.cn",
        }
        with (
            mock.patch.dict(os.environ, env, clear=True),
            mock.patch.object(
                MODULE.urllib.request,
                "urlopen",
                return_value=FakeResponse(body),
            ),
            contextlib.redirect_stdout(stdout),
            contextlib.redirect_stderr(stderr),
        ):
            code = MODULE.main()
        self.assertNotIn(env["TAPD_ACCESS_TOKEN"], stdout.getvalue())
        self.assertNotIn(env["TAPD_ACCESS_TOKEN"], stderr.getvalue())
        return code, stdout.getvalue(), stderr.getvalue()

    def test_numeric_id_preserves_success_contract(self):
        code, stdout, stderr = self.run_main(
            json.dumps(
                {
                    "status": 1,
                    "data": {"id": 12345, "nick": "开发者A", "name": None},
                }
            )
        )
        self.assertEqual(code, 0)
        self.assertEqual(stderr, "")
        self.assertEqual(
            json.loads(stdout),
            {"id": "12345", "nick": "开发者A", "name": ""},
        )

    def test_none_nick_returns_existing_exit_code(self):
        code, _, stderr = self.run_main(
            json.dumps({"status": 1, "data": {"id": "1", "nick": None}})
        )
        self.assertEqual(code, 7)
        self.assertIn("Missing user nick", stderr)

    def test_non_success_status_returns_existing_exit_code(self):
        code, _, stderr = self.run_main(
            json.dumps({"status": 0, "info": "test-placeholder-token"})
        )
        self.assertEqual(code, 6)
        self.assertNotIn("test-placeholder-token", stderr)

    def test_missing_data_returns_existing_exit_code(self):
        code, _, _ = self.run_main(json.dumps({"status": 1}))
        self.assertEqual(code, 7)

    def test_non_json_returns_existing_exit_code(self):
        code, _, stderr = self.run_main("test-placeholder-token not-json")
        self.assertEqual(code, 5)
        self.assertEqual(stderr.strip(), "Invalid JSON response")


if __name__ == "__main__":
    unittest.main()
