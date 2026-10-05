"""Principal-bound presentation bytes and validated owner projections."""
import base64
import math
import re
import time

import protocol as p

COMMAND = 16 * 1024 * 1024


def rect(value):
    p.require(isinstance(value, dict) and all(type(value.get(key)) in (int, float) and math.isfinite(value[key]) for key in ("x", "y", "width", "height")) and value["width"] > 0 and value["height"] > 0, "scene-frame", "桌面位置或尺寸無效。")
    return {key: value[key] for key in ("x", "y", "width", "height")}


def intersection(a, b):
    x, y = max(a["x"], b["x"]), max(a["y"], b["y"])
    width = min(a["x"] + a["width"], b["x"] + b["width"]) - x
    height = min(a["y"] + a["height"], b["y"] + b["height"]) - y
    return None if width <= 0 or height <= 0 else {"x": x, "y": y, "width": width, "height": height}


def frame(data, session, previous):
    value = p.decode(data)
    p.require(set(value) <= set("protocol sessionId sequence topology workspaceRevision layoutRevision groups operationScope activeGroupId cards editor dropTarget fallbacks".split()), "scene-frame", "桌面畫面含非呈現資料。")
    p.require(p.number(value, "protocol", 1) == 1 and p.text(value, "sessionId") == session and p.number(value, "sequence") > previous, "scene-session", "桌面畫面工作階段或順序已失效。")
    p.number(value, "topology")
    p.number(value, "workspaceRevision")
    p.number(value, "layoutRevision")
    groups, cards = value.get("groups"), value.get("cards")
    p.require(isinstance(groups, list) and len(groups) <= 20000 and isinstance(cards, list) and len(cards) <= 20000, "scene-frame", "桌面容量無效。")
    for group in groups:
        p.require(isinstance(group, dict) and set(group) <= {"id", "name", "color", "region"}, "scene-frame", "桌面群組格式無效。")
        p.text(group, "id", 128)
        p.text(group, "name", p.RECORD)
        p.require(re.fullmatch(r"#[0-9A-Fa-f]{6}", p.text(group, "color")) is not None, "scene-frame", "桌面色彩無效。")
        if group.get("region") is not None:
            rect(group["region"])
    ids = set()
    for card in cards:
        p.require(isinstance(card, dict) and set(card) <= set("id groupId revision summary text format attachmentCount rect layer interactive draggable editing selected completed mine color".split()), "scene-frame", "桌面卡片格式無效。")
        key = p.text(card, "id", 128)
        p.require(key not in ids and card.get("layer") in ("desktop", "floating", "wallpaper"), "scene-frame", "桌面卡片身分或層級無效。")
        ids.add(key)
        p.text(card, "groupId", 128)
        p.require(isinstance(card.get("text"), str) and len(card["text"].encode("utf-16-le", "surrogatepass")) <= 16 * 1024 * 1024 and re.fullmatch(r"#[0-9A-Fa-f]{6}", p.text(card, "color")) is not None, "scene-frame", "桌面文字或色彩無效。")
        rect(card.get("rect"))
        for flag in ("interactive", "draggable", "editing", "selected", "completed", "mine"):
            p.boolean(card, flag)
        p.require(card["layer"] != "wallpaper" or not any(card[flag] for flag in ("interactive", "draggable", "editing")), "scene-frame", "桌布層必須保持滑鼠穿透。")
    return value


class Transfers:
    def __init__(self):
        self.entries = {}

    def begin(self, owner, args, maximum):
        now = time.monotonic()
        for key, value in list(self.entries.items()):
            if not value["retained"] and now - value["used"] > 300:
                self.entries.pop(key)
        size, digest = p.number(args, "size", maximum), p.text(args, "sha256")
        p.require(size > 0 and p.is_digest(digest), "scene-size", "桌面傳輸容量或校驗值無效。")
        unique = {value["allocation"]: value for value in self.entries.values()}.values()
        lane = maximum == p.RECORD
        p.require(len(self.entries) < 192 and sum(value["size"] for value in unique) + size <= 384 * 1024 * 1024 and sum(value["size"] for value in unique if value["frame"] == lane) + size <= (320 if lane else 64) * 1024 * 1024, "scene-busy", "桌面畫面仍在傳輸，請稍後重試。")
        token = p.identifier()
        self.entries[token] = {"owner": owner, "allocation": token, "size": size, "sha256": digest, "frame": lane, "bytes": bytearray(), "sealed": False, "retained": False, "used": now}
        return {"token": token}

    def get(self, owner, token):
        value = self.entries.get(token)
        p.require(value is not None and value["owner"] == owner, "scene-missing", "桌面傳輸不屬於此視窗或已失效。")
        value["used"] = time.monotonic()
        return value

    def append(self, owner, args):
        value = self.get(owner, p.text(args, "token"))
        data = base64.b64decode(p.text(args, "base64", p.CHUNK * 4 // 3 + 4), validate=True)
        p.require(not value["sealed"] and p.number(args, "offset", value["size"]) == len(value["bytes"]) and 0 < len(data) <= p.CHUNK and len(value["bytes"]) + len(data) <= value["size"], "scene-offset", "桌面傳輸順序或容量不符。")
        value["bytes"].extend(data)
        return {"offset": len(value["bytes"])}

    def seal(self, owner, token):
        value = self.get(owner, token)
        p.require(len(value["bytes"]) == value["size"] and (value["sealed"] or p.digest(value["bytes"]) == value["sha256"]), "scene-integrity", "桌面傳輸不完整或校驗失敗。")
        if not value["sealed"]:
            value["bytes"] = bytes(value["bytes"])
            value["sealed"] = True
        return value["bytes"]

    def lease(self, owner, token, reader):
        value = self.get(owner, token)
        p.require(value["sealed"] and len(self.entries) < 192, "scene-busy", "桌面畫面尚未可讀。")
        key = p.identifier()
        self.entries[key] = {**value, "owner": reader, "retained": False}
        return {"token": key, "size": value["size"], "sha256": value["sha256"]}

    def read(self, owner, token, args):
        value = self.get(owner, token)
        offset = p.number(args, "offset", value["size"])
        p.require(value["sealed"], "scene-incomplete", "桌面傳輸尚未完整。")
        end = min(value["size"], offset + p.CHUNK)
        return {"offset": offset, "base64": base64.b64encode(value["bytes"][offset:end]).decode("ascii"), "done": end == value["size"]}

    def retain(self, owner, token):
        self.get(owner, token)["retained"] = True

    def drop(self, owner, token):
        if self.entries.get(token, {}).get("owner") == owner:
            self.entries.pop(token)

    def drop_owner(self, owner):
        for token, value in list(self.entries.items()):
            if value["owner"] == owner:
                self.entries.pop(token)
