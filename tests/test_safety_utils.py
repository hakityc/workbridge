import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "workbridge" / "scripts" / "safety_utils.py"
SPEC = importlib.util.spec_from_file_location("safety_utils", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class OwnerMatchingTest(unittest.TestCase):
    def test_supported_separators(self):
        for owner in ["开发者A;", "张三;开发者A;", "张三；开发者A", "张三,开发者A", "张三，开发者A", "张三 开发者A"]:
            with self.subTest(owner=owner):
                self.assertTrue(MODULE.owner_matches(owner, "开发者A"))

    def test_similar_nicks_do_not_match(self):
        for owner in ["开发者A同学;", "小开发者A;", "开发者A-前端;", "张三;"]:
            with self.subTest(owner=owner):
                self.assertFalse(MODULE.owner_matches(owner, "开发者A"))

    def test_empty_values_do_not_match(self):
        self.assertFalse(MODULE.owner_matches(None, "开发者A"))
        self.assertFalse(MODULE.owner_matches("开发者A;", None))
        self.assertFalse(MODULE.owner_matches("开发者A;", ""))


if __name__ == "__main__":
    unittest.main()
