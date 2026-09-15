#!/usr/bin/env python3
import json
import os
import sys
import urllib.error
import urllib.request


def normalize_value(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def main() -> int:
    token = os.environ.get("TAPD_ACCESS_TOKEN", "").strip()
    if not token:
        print("Missing env: TAPD_ACCESS_TOKEN", file=sys.stderr)
        return 2

    api_base = os.environ.get("TAPD_API_BASE_URL", "https://api.tapd.cn").rstrip("/")
    url = f"{api_base}/users/info"

    req = urllib.request.Request(url, method="GET")
    req.add_header("Authorization", f"Bearer {token}")

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        print(f"HTTPError {e.code}", file=sys.stderr)
        return 3
    except Exception as e:
        print(f"Request failed: {type(e).__name__}", file=sys.stderr)
        return 4

    try:
        obj = json.loads(raw)
    except Exception:
        print("Invalid JSON response", file=sys.stderr)
        return 5

    if not isinstance(obj, dict) or obj.get("status") != 1:
        status = obj.get("status") if isinstance(obj, dict) else None
        print(f"API status not successful: {normalize_value(status)}", file=sys.stderr)
        return 6

    data = obj.get("data") or {}
    if not isinstance(data, dict):
        data = {}
    nick = normalize_value(data.get("nick"))
    name = normalize_value(data.get("name"))
    user_id = normalize_value(data.get("id"))
    if not nick:
        print("Missing user nick in API response", file=sys.stderr)
        return 7

    print(
        json.dumps(
            {"id": user_id, "nick": nick, "name": name},
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
