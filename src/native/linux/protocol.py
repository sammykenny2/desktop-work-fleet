"""Bounded native protocol; no renderer-supplied paths, SQL, HTTP or credentials."""
import hashlib
import json
import math
import re
import uuid

CHUNK = 256 * 1024
RECORD = 128 * 1024 * 1024
ATTACHMENT = 25 * 1024 * 1024
BACKUP = 136 * 1024 * 1024 + 4096
SAFE_INTEGER = 9007199254740991


class Failure(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def require(condition, code, message):
    if not condition:
        raise Failure(code, message)


def text(value, key, maximum=256):
    result = value.get(key)
    require(isinstance(result, str) and result and len(result.encode("utf-16-le", "surrogatepass")) // 2 <= maximum, "invalid-request", "文字欄位無效。")
    return result


def number(value, key, maximum=SAFE_INTEGER):
    result = value.get(key)
    require(type(result) in (int, float) and 0 <= result <= maximum and math.isfinite(result) and result == int(result), "invalid-request", "數字欄位超限。")
    return int(result)


def boolean(value, key):
    result = value.get(key)
    require(type(result) is bool, "invalid-request", "布林欄位無效。")
    return result


def identifier():
    return str(uuid.uuid4())


def is_uuid(value):
    try:
        return isinstance(value, str) and len(value) == 36 and str(uuid.UUID(value)) == value.lower()
    except ValueError:
        return False


def is_digest(value):
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def is_account(value):
    return isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,255}", value) is not None


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True, allow_nan=False).encode("utf-8")


def decode(data):
    def pairs(values):
        result = {}
        for key, value in values:
            require(key not in result, "invalid-json", "JSON 欄位重複。")
            result[key] = value
        return result

    def constant(_):
        raise Failure("invalid-json", "JSON 數值無效。")

    try:
        result = json.loads(data, object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, UnicodeError, RecursionError) as error:
        raise Failure("invalid-json", "JSON 格式無效。") from error
    require(isinstance(result, dict), "invalid-json", "JSON 需要單一物件。")
    return result
