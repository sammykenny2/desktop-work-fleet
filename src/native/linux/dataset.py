"""Closed dataset descriptors and typed Google queries; no renderer-supplied HTTP or query text."""
import re

import protocol as p

FORMAT = "pin-it-anywhere-dataset"
FIELDS = "id,name,mimeType,parents,spaces,trashed,size,createdTime,appProperties,sha256Checksum"
SHARDS = tuple("0123456789abcdef") + ("groups",)
KINDS = ("dataset-root", "folder", "dataset", "ready", "revision", "attachment", "change", "checkpoint", "purge")
FORBIDDEN = ("__proto__", "prototype", "constructor")


def check(condition):
    p.require(condition, "invalid-source-file", "The dataset descriptor or query isn't valid.")


def matches(value, pattern):
    return isinstance(value, str) and value not in FORBIDDEN and re.fullmatch(pattern, value) is not None


def file_id(value):
    return matches(value, r"[A-Za-z0-9_-]{1,256}")


def entity_id(value):
    return matches(value, r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")


def dataset_id(value):
    return matches(value, r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}")


def properties(file):
    result = {"piaFormat": FORMAT, "piaSchema": "1", "piaDataset": file["datasetId"], "piaKind": file["kind"]}
    for key, prop in (("sha256", "piaSha256"), ("role", "piaRole"), ("entityId", "piaEntity"), ("revisionId", "piaRevision"), ("shard", "piaShard")):
        if key in file:
            result[prop] = file[key]
    check(all(len((key + value).encode("utf-8")) <= 124 for key, value in result.items()))
    return result


def file(value):
    check(isinstance(value, dict) and file_id(value.get("id")) and file_id(value.get("parentId")) and dataset_id(value.get("datasetId")) and value.get("kind") in KINDS)
    keys = {"id", "parentId", "datasetId", "kind"}
    kind = value["kind"]
    if kind in ("folder", "dataset-root"):
        keys.add("role")
        check(matches(value.get("role"), r"[a-z][a-z0-9-]{0,31}"))
        if "entityId" in value:
            keys.add("entityId")
            check(entity_id(value["entityId"]))
        check(kind != "dataset-root" or value["parentId"] == "appDataFolder" and value["role"] == "root")
    else:
        keys.update(("sha256", "size"))
        limit = p.ATTACHMENT if kind == "attachment" else 65536 if kind in ("change", "purge", "dataset", "ready") else 8 * 1024 * 1024
        check(p.is_digest(value.get("sha256")))
        p.number(value, "size", limit)
        if kind in ("revision", "attachment", "change", "purge"):
            keys.add("entityId")
            check(entity_id(value.get("entityId")))
        if kind in ("revision", "change"):
            keys.add("revisionId")
            check(entity_id(value.get("revisionId")))
        if kind in ("revision", "change", "checkpoint", "purge"):
            keys.add("shard")
            check(value.get("shard") in SHARDS)
    check(set(value) == keys)
    properties(value)
    return dict(value)


def media_type(kind, value):
    if not isinstance(value, str) or len(value) > 256:
        return False
    if kind in ("folder", "dataset-root"):
        return value == "application/vnd.google-apps.folder"
    return re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*", value) is not None and not value.lower().startswith("application/vnd.google-apps.")


def metadata(value):
    value = file(value)
    folder = value["kind"] in ("folder", "dataset-root")
    suffix = "" if folder else ".bin" if value["kind"] == "attachment" else ".json"
    return {"id": value["id"], "name": value["kind"] + "-" + value.get("revisionId", value.get("entityId", value["id"])) + suffix,
            "mimeType": "application/vnd.google-apps.folder" if folder else "application/octet-stream" if value["kind"] == "attachment" else "application/json",
            "parents": [value["parentId"]], "appProperties": properties(value)}


def verify(value, expected):
    desired = metadata(expected)
    parents = value.get("parents")
    # Root creation sends the documented alias; the renderer also proves direct membership with a scoped parent query.
    parent_ok = parents == desired["parents"] or expected["kind"] == "dataset-root" and isinstance(parents, list) and len(parents) == 1 and file_id(parents[0])
    check(value.get("id") == expected["id"] and media_type(expected["kind"], value.get("mimeType")) and parent_ok
          and value.get("appProperties") == desired["appProperties"] and isinstance(value.get("spaces"), list)
          and "appDataFolder" in value["spaces"] and value.get("trashed", False) is False)
    if "sha256" in expected:
        check(value.get("size") == str(expected["size"]) and value.get("sha256Checksum", expected["sha256"]) == expected["sha256"])


def query(value):
    check(isinstance(value, dict))
    scope = value.get("scope")
    keys, clauses = {"scope"}, ["trashed = false"]

    def prop(key, item):
        return "appProperties has { key='" + key + "' and value='" + item + "' }"

    if scope == "fences":
        clauses.append(prop("piaKind", "reset"))
    elif scope != "legacy":
        clauses.append(prop("piaFormat", FORMAT))
        if scope not in ("datasets", "reset-datasets"):
            keys.add("datasetId")
            check(dataset_id(value.get("datasetId")))
            clauses.append(prop("piaDataset", value["datasetId"]))
        if scope in ("datasets", "reset-datasets", "ready", "roots"):
            clauses.append(prop("piaKind", {"datasets": "dataset", "reset-datasets": "dataset", "ready": "ready", "roots": "dataset-root"}[scope]))
            if scope == "roots":
                clauses.append("'appDataFolder' in parents")
        elif scope in ("current", "current-all"):
            if scope == "current":
                keys.add("shard")
                check(value.get("shard") in SHARDS)
                clauses.append(prop("piaShard", value["shard"]))
            clauses.append("(" + prop("piaKind", "checkpoint") + " or " + prop("piaKind", "change") + ")")
        elif scope in ("history", "children"):
            keys.add("parentId")
            check(file_id(value.get("parentId")))
            clauses.append("'" + value["parentId"] + "' in parents")
            if scope == "history":
                clauses.append(prop("piaKind", "revision"))
        elif scope in ("purges", "entity-folders", "entity-data"):
            keys.add("entities")
            entities = value.get("entities")
            check(isinstance(entities, list) and 0 < len(entities) <= 20 and all(entity_id(item) for item in entities) and len(set(entities)) == len(entities))
            kinds = "(" + " or ".join(prop("piaKind", kind) for kind in ("revision", "attachment", "folder")) + ")" if scope == "entity-data" else prop("piaKind", "purge" if scope == "purges" else "folder")
            clauses.extend((kinds, "(" + " or ".join(prop("piaEntity", item) for item in entities) + ")"))
        else:
            check(False)
    check(set(value) == keys)
    return " and ".join(clauses)


def delete_batch(ids):
    check(isinstance(ids, list) and 1 <= len(ids) <= 100
          and all(file_id(key) and key not in ("root", "appDataFolder") for key in ids) and len(set(ids)) == len(ids))
    return ("".join(f"--pin_it_anywhere_delete\r\nContent-Type: application/http\r\nContent-ID: wf-{index}\r\n\r\nDELETE /drive/v3/files/{key} HTTP/1.1\r\n\r\n"
                    for index, key in enumerate(ids)) + "--pin_it_anywhere_delete--\r\n").encode("ascii")
