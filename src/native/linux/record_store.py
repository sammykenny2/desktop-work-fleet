"""Bounded account-scoped record transactions; no conversion of old workspace blobs."""
import json
import re

import protocol as p

FORMAT = "work-fleet-local-records"
TRANSACTION = "work-fleet-record-transaction"
COLLECTIONS = frozenset(("meta", "current", "history", "draft", "outbox", "control", "job"))
MAX_ROWS = 512
MAX_BYTES = 8 * 1024 * 1024


def key(value):
    return isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}", value) is not None and value not in ("__proto__", "prototype", "constructor")


def require(condition):
    p.require(condition, "invalid-record-transaction", "The local record transaction is invalid. Saved data is unchanged.")


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True, allow_nan=False).encode("utf-8")


def validate(data, profile):
    require(len(data) <= MAX_BYTES)
    value = p.decode(data)
    require(set(value) == {"format", "schemaVersion", "profileId", "revision", "commitId", "puts", "deletes"} | ({"attachmentDeletes"} if "attachmentDeletes" in value else set())
            and value["format"] == TRANSACTION and type(value["schemaVersion"]) is int and value["schemaVersion"] == 1
            and value["profileId"] == profile and p.is_uuid(value["commitId"]) and value["commitId"] == value["commitId"].lower())
    revision = p.number(value, "revision")
    attachment_deletes = value.get("attachmentDeletes", [])
    require(isinstance(attachment_deletes, list) and all(p.is_digest(item) and len(item) == 64 for item in attachment_deletes)
            and len(set(attachment_deletes)) == len(attachment_deletes))
    require(isinstance(value["puts"], list) and isinstance(value["deletes"], list)
            and len(value["puts"]) + len(value["deletes"]) + len(attachment_deletes) <= MAX_ROWS)
    seen = set()
    for row in value["puts"] + value["deletes"]:
        require(isinstance(row, dict) and row.get("collection") in COLLECTIONS and key(row.get("key")))
        identity = row["collection"], row["key"]
        require(identity not in seen)
        seen.add(identity)
    for row in value["puts"]:
        require(set(row) == {"collection", "key", "entity", "ordinal", "value"}
                and (row["entity"] == "" or key(row["entity"])) and p.number(row, "ordinal") <= revision)
        require(len(encode(row)) <= MAX_BYTES - 1024)
    for row in value["deletes"]:
        require(set(row) == {"collection", "key"})
    return value


class RecordStore:
    """Uses the owning Database's lock, connection and authenticated encryption."""

    def initialize_records(self):
        self.connection.executescript("""
            CREATE TABLE IF NOT EXISTS record_heads(profile TEXT PRIMARY KEY,revision INTEGER NOT NULL,commit_id TEXT NOT NULL,digest TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS record_entries(profile TEXT NOT NULL,collection TEXT NOT NULL,id TEXT NOT NULL,entity TEXT NOT NULL,ordinal INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(profile,collection,id));
            CREATE INDEX IF NOT EXISTS record_order ON record_entries(profile,collection,ordinal DESC,id DESC);
            CREATE INDEX IF NOT EXISTS record_entity ON record_entries(profile,collection,entity,ordinal DESC,id DESC);
        """)

    def record_status(self):
        with self.lock:
            row = self.connection.execute("SELECT revision,commit_id,digest FROM record_heads WHERE profile=?", (self.profile,)).fetchone()
            if row is not None:
                return {"format": FORMAT, "schemaVersion": 1, "profileId": self.profile,
                        "revision": row[0], "commitId": row[1], "digest": row[2]}
            # Only an indexed presence check: do not decrypt or parse legacy history to identify it.
            if self.connection.execute("SELECT 1 FROM records WHERE profile=? AND kind='workspace'", (self.profile,)).fetchone():
                return {"format": "legacy-workspace", "profileId": self.profile}
            return None

    def record_entry(self, collection, identity):
        require(collection in COLLECTIONS and key(identity))
        with self.lock:
            row = self.connection.execute("SELECT data FROM record_entries WHERE profile=? AND collection=? AND id=?",
                                          (self.profile, collection, identity)).fetchone()
            if row is None:
                return None
            data = self.open("entry:" + collection, identity, row[0])
            value = p.decode(data)
            require(value.get("collection") == collection and value.get("key") == identity)
            return data

    def record_page(self, query):
        require(isinstance(query, dict) and "expectedRevision" in query
                and set(query) <= {"collection", "entity", "after", "limit", "expectedRevision", "order", "keysOnly"})
        keys_only = query.get("keysOnly", False)
        require(type(keys_only) is bool)
        order = query.get("order", "desc")
        require(order in ("asc", "desc"))
        collection, entity, after = query.get("collection"), query.get("entity"), query.get("after")
        require(collection in COLLECTIONS and (entity is None or entity == "" or key(entity)))
        limit = p.number({"limit": query.get("limit", 100)}, "limit", 100)
        require(limit > 0)
        expected = query.get("expectedRevision")
        if expected is not None:
            p.number(query, "expectedRevision")
        parameters = [self.profile, collection]
        where = "profile=? AND collection=?"
        if entity is not None:
            where += " AND entity=?"
            parameters.append(entity)
        if after is not None:
            require(isinstance(after, dict) and set(after) == {"ordinal", "key"} and key(after["key"]))
            ordinal = p.number(after, "ordinal")
            where += " AND (ordinal,id)" + (">" if order == "asc" else "<") + "(?,?)"
            parameters.extend((ordinal, after["key"]))
        parameters.append(limit + 1)
        with self.lock:
            status = self.record_status()
            p.require(not status or status["format"] == FORMAT, "incompatible-local-data", "This profile uses an older format. Keep it or explicitly reset it before continuing.")
            p.require((status or {}).get("revision") == expected, "stale-writer", "Local data changed while reading its records. Reload before continuing.")
            rows, size, more = [], 512, False
            sorting = "ASC" if order == "asc" else "DESC"
            cursor = self.connection.execute("SELECT id,entity,ordinal," + ("NULL" if keys_only else "data") + " FROM record_entries WHERE " + where + " ORDER BY ordinal " + sorting + ",id " + sorting + " LIMIT ?", parameters)
            for identity, stored_entity, ordinal, ciphertext in cursor:
                data = encode(dict(collection=collection, key=identity, ordinal=ordinal)) if keys_only else self.open("entry:" + collection, identity, ciphertext)
                row = p.decode(data)
                require(row["collection"] == collection and row["key"] == identity and (keys_only or row["entity"] == stored_entity) and row["ordinal"] == ordinal)
                if len(rows) >= limit or (rows and size + len(data) > MAX_BYTES):
                    more = True
                    break
                require(size + len(data) <= MAX_BYTES)
                rows.append(row)
                size += len(data) + 1
            last = rows[-1] if rows else None
            return encode({"revision": expected, "rows": rows, "next": {"ordinal": last["ordinal"], "key": last["key"]} if more and last else None})

    def commit_records(self, token, expected, attachments):
        require(expected is None or type(expected) is int and 0 <= expected <= p.SAFE_INTEGER)
        require(isinstance(attachments, list) and len(attachments) <= MAX_ROWS and len(set(attachments)) == len(attachments))
        with self.lock:
            digest, data = self.staged(token, "workspace")
            require(p.digest(data) == digest)
            value = validate(data, self.profile)
            self.connection.execute("BEGIN IMMEDIATE")
            try:
                attachment_bytes = 0
                for staged in attachments:
                    row = self.connection.execute("SELECT size FROM staging WHERE profile=? AND token=? AND kind='attachment'", (self.profile, staged)).fetchone()
                    p.require(row is not None, "transfer-missing", "The native attachment transfer has expired.")
                    require(0 <= row[0] <= p.ATTACHMENT)
                    attachment_bytes += row[0]
                    require(attachment_bytes <= 128 * 1024 * 1024)
                status = self.record_status()
                if status and all(status.get(field) == value[field] for field in ("profileId", "revision", "commitId")) and status.get("digest") == digest:
                    for staged in [token] + attachments:
                        self.discard(staged)
                    self.connection.execute("COMMIT")
                    return status
                p.require(not status or status["format"] == FORMAT, "incompatible-local-data", "This profile uses an older format. Keep it or explicitly reset it before continuing.")
                p.require((status or {}).get("revision") == expected, "stale-writer", "Another writer changed the local records. Keep your changes and reload.")
                require(value["revision"] == (0 if expected is None else expected + 1))
                for row in value["puts"]:
                    if row["collection"] == "history":
                        old = self.record_entry("history", row["key"])
                        if old is not None:
                            previous = p.decode(old)
                            p.require(previous["entity"] == row["entity"] and encode(previous["value"]) == encode(row["value"]),
                                      "revision-collision", "A revision ID has different content. Saved data is unchanged.")
                            continue
                    encrypted = self.seal("entry:" + row["collection"], row["key"], encode(row))
                    self.connection.execute("INSERT INTO record_entries VALUES(?,?,?,?,?,?) ON CONFLICT(profile,collection,id) DO UPDATE SET entity=excluded.entity,ordinal=excluded.ordinal,data=excluded.data",
                                            (self.profile, row["collection"], row["key"], row["entity"], row["ordinal"], encrypted))
                for row in value["deletes"]:
                    self.connection.execute("DELETE FROM record_entries WHERE profile=? AND collection=? AND id=?", (self.profile, row["collection"], row["key"]))
                for identity in value.get("attachmentDeletes", []):
                    self.connection.execute("DELETE FROM attachments WHERE profile=? AND id=?", (self.profile, identity))
                for attachment in attachments:
                    self.put_attachment(attachment)
                self.connection.execute("INSERT INTO record_heads VALUES(?,?,?,?) ON CONFLICT(profile) DO UPDATE SET revision=excluded.revision,commit_id=excluded.commit_id,digest=excluded.digest",
                                        (self.profile, value["revision"], value["commitId"], digest))
                self.discard(token)
                result = self.record_status()
                self.connection.execute("COMMIT")
                return result
            except Exception:
                self.connection.execute("ROLLBACK")
                raise
