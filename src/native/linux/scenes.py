"""Principal-bound presentation bytes and validated owner projections."""
import base64
import math
import re
import time

import protocol as p

COMMAND = 16 * 1024 * 1024


def rect(value):
    p.require(isinstance(value, dict) and all(type(value.get(key)) in (int, float) and math.isfinite(value[key]) for key in ("x", "y", "width", "height")) and value["width"] > 0 and value["height"] > 0, "scene-frame", "A desktop position or size isn't valid.")
    return {key: value[key] for key in ("x", "y", "width", "height")}


def intersection(a, b):
    x, y = max(a["x"], b["x"]), max(a["y"], b["y"])
    width = min(a["x"] + a["width"], b["x"] + b["width"]) - x
    height = min(a["y"] + a["height"], b["y"] + b["height"]) - y
    return None if width <= 0 or height <= 0 else {"x": x, "y": y, "width": width, "height": height}


def frame(data, session, previous):
    value = p.decode(data)
    p.require(set(value) <= set("protocol sessionId sequence topology locale workspaceRevision layoutRevision groups operationScope activeGroupId cards editor dropTarget fallbacks notice quickMove".split()), "scene-frame", "The desktop frame contains data that isn't for display.")
    # The key that starts a quick move in the scene; the host only relays it.
    p.require(value.get("quickMove") in (None, "meta", "ctrl"), "scene-frame", "The desktop quick move key isn't valid.")
    p.require(p.number(value, "protocol", 1) == 1 and p.text(value, "sessionId") == session and p.number(value, "sequence") > previous, "scene-session", "The desktop frame's session or sequence has expired.")
    p.number(value, "topology")
    # The owner's UI locale, which the scene applies before drawing its own text (docs/i18n.md).
    if "locale" in value:
        p.text(value, "locale", 16)
    p.number(value, "workspaceRevision")
    p.number(value, "layoutRevision")
    groups, cards = value.get("groups"), value.get("cards")
    p.require(isinstance(groups, list) and len(groups) <= 20000 and isinstance(cards, list) and len(cards) <= 20000, "scene-frame", "The desktop frame is too large.")
    for group in groups:
        p.require(isinstance(group, dict) and set(group) <= {"id", "name", "color", "region"}, "scene-frame", "A desktop group's format isn't valid.")
        p.text(group, "id", 128)
        p.text(group, "name", p.RECORD)
        p.require(re.fullmatch(r"#[0-9A-Fa-f]{6}", p.text(group, "color")) is not None, "scene-frame", "A desktop color isn't valid.")
        if group.get("region") is not None:
            rect(group["region"])
    ids = set()
    for card in cards:
        p.require(isinstance(card, dict) and set(card) <= set("id groupId revision summary text format attachmentCount attachments rect layer interactive draggable editing selected completed mine color opacity".split()), "scene-frame", "A desktop card's format isn't valid.")
        files = card.get("attachments", [])
        p.require(isinstance(files, list) and len(files) <= 20000, "scene-frame", "An attachment list's format isn't valid.")
        for file in files:
            p.require(isinstance(file, dict) and set(file) == {"id", "name"}, "scene-frame", "An attachment list's format isn't valid.")
            p.text(file, "id", 128)
            p.text(file, "name", p.RECORD)
        key = p.text(card, "id", 128)
        p.require(key not in ids and card.get("layer") in ("desktop", "floating", "wallpaper"), "scene-frame", "A desktop card's ID or layer isn't valid.")
        ids.add(key)
        p.text(card, "groupId", 128)
        p.require(isinstance(card.get("text"), str) and len(card["text"].encode("utf-16-le", "surrogatepass")) <= 16 * 1024 * 1024 and re.fullmatch(r"#[0-9A-Fa-f]{6}", p.text(card, "color")) is not None, "scene-frame", "A desktop card's text or color isn't valid.")
        rect(card.get("rect"))
        # A paper resting on the Top layer may be see-through from 30%; every other paper is opaque.
        opacity = card.get("opacity", 1)
        p.require(type(opacity) in (int, float) and 0.3 <= opacity <= 1 and (card["layer"] == "floating" or opacity == 1), "scene-frame", "A desktop card's opacity isn't valid.")
        for flag in ("interactive", "draggable", "editing", "selected", "completed", "mine"):
            p.boolean(card, flag)
        p.require(card["layer"] != "wallpaper" or not any(card[flag] for flag in ("interactive", "draggable", "editing")), "scene-frame", "The wallpaper layer must let the pointer pass through.")
    # A stage notice only keeps the topmost scene on screen; it never becomes an input region.
    notice = value.get("notice")
    if notice is not None:
        p.require(isinstance(notice, dict) and set(notice) <= {"id", "rect", "title", "text", "step", "steps"}, "scene-frame", "A desktop notice's format isn't valid.")
        for key in ("id", "step", "steps"):
            p.number(notice, key)
        p.text(notice, "title", 200)
        p.text(notice, "text", 200)
        rect(notice.get("rect"))
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
        p.require(size > 0 and p.is_digest(digest), "scene-size", "The desktop transfer's size or checksum isn't valid.")
        unique = {value["allocation"]: value for value in self.entries.values()}.values()
        lane = maximum == p.RECORD
        p.require(len(self.entries) < 192 and sum(value["size"] for value in unique) + size <= 384 * 1024 * 1024 and sum(value["size"] for value in unique if value["frame"] == lane) + size <= (320 if lane else 64) * 1024 * 1024, "scene-busy", "A desktop frame is still transferring. Try again in a moment.")
        token = p.identifier()
        self.entries[token] = {"owner": owner, "allocation": token, "size": size, "sha256": digest, "frame": lane, "bytes": bytearray(), "sealed": False, "retained": False, "used": now}
        return {"token": token}

    def get(self, owner, token):
        value = self.entries.get(token)
        p.require(value is not None and value["owner"] == owner, "scene-missing", "The desktop transfer doesn't belong to this window or has expired.")
        value["used"] = time.monotonic()
        return value

    def append(self, owner, args):
        value = self.get(owner, p.text(args, "token"))
        data = base64.b64decode(p.text(args, "base64", p.CHUNK * 4 // 3 + 4), validate=True)
        p.require(not value["sealed"] and p.number(args, "offset", value["size"]) == len(value["bytes"]) and 0 < len(data) <= p.CHUNK and len(value["bytes"]) + len(data) <= value["size"], "scene-offset", "The desktop transfer's order or size doesn't match.")
        value["bytes"].extend(data)
        return {"offset": len(value["bytes"])}

    def seal(self, owner, token):
        value = self.get(owner, token)
        p.require(len(value["bytes"]) == value["size"] and (value["sealed"] or p.digest(value["bytes"]) == value["sha256"]), "scene-integrity", "The desktop transfer is incomplete or failed its checksum.")
        if not value["sealed"]:
            value["bytes"] = bytes(value["bytes"])
            value["sealed"] = True
        return value["bytes"]

    def lease(self, owner, token, reader):
        value = self.get(owner, token)
        p.require(value["sealed"] and len(self.entries) < 192, "scene-busy", "The desktop frame can't be read yet.")
        key = p.identifier()
        self.entries[key] = {**value, "owner": reader, "retained": False}
        return {"token": key, "size": value["size"], "sha256": value["sha256"]}

    def read(self, owner, token, args):
        value = self.get(owner, token)
        offset = p.number(args, "offset", value["size"])
        p.require(value["sealed"], "scene-incomplete", "The desktop transfer isn't complete yet.")
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
