#!/usr/bin/env python3
import re


OWNER_SEPARATOR = re.compile(r"[;；,，\s]+")


def owner_tokens(owner: object) -> list[str]:
    if owner is None:
        return []
    return [token.strip() for token in OWNER_SEPARATOR.split(str(owner)) if token.strip()]


def owner_matches(owner: object, nick: object) -> bool:
    normalized_nick = "" if nick is None else str(nick).strip()
    return bool(normalized_nick) and normalized_nick in owner_tokens(owner)
