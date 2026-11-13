import Foundation

/** Typed dataset operations keep query strings, URLs and credentials inside the native service. */
enum PinItAnywhereDataset {
    static let fields = "id,name,mimeType,parents,spaces,trashed,size,createdTime,appProperties,sha256Checksum"
    static let format = "pin-it-anywhere-dataset"
    static let shards = Array("0123456789abcdef").map(String.init) + ["groups"]
    static let kinds = ["dataset-root", "folder", "dataset", "ready", "revision", "attachment", "change", "checkpoint", "purge"]
    static func check(_ condition: Bool) throws { try PinItAnywhereProtocol.require(condition, "invalid-source-file", "The dataset descriptor or query isn't valid.") }
    static func matches(_ value: Any?, _ pattern: String) -> Bool {
        guard let text = value as? String, !["__proto__", "prototype", "constructor"].contains(text) else { return false }
        return text.range(of: pattern, options: .regularExpression) == text.startIndex..<text.endIndex
    }
    static func fileID(_ value: Any?) -> Bool { matches(value, "^[A-Za-z0-9_-]{1,256}$") }
    static func entityID(_ value: Any?) -> Bool { matches(value, "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$") }
    static func datasetID(_ value: Any?) -> Bool { matches(value, "^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$") }
    static func properties(_ file: [String: Any]) throws -> [String: String] {
        var result = ["piaFormat": format, "piaSchema": "1", "piaDataset": try PinItAnywhereProtocol.text(file, "datasetId"), "piaKind": try PinItAnywhereProtocol.text(file, "kind")]
        for (key, property) in [("sha256", "piaSha256"), ("role", "piaRole"), ("entityId", "piaEntity"), ("revisionId", "piaRevision"), ("shard", "piaShard")] {
            if file[key] != nil { result[property] = try PinItAnywhereProtocol.text(file, key) }
        }
        try check(result.allSatisfy { ($0.key + $0.value).utf8.count <= 124 }); return result
    }
    static func file(_ value: [String: Any]) throws -> [String: Any] {
        let kind = try PinItAnywhereProtocol.text(value, "kind")
        try check(fileID(value["id"]) && fileID(value["parentId"]) && datasetID(value["datasetId"]) && kinds.contains(kind))
        var keys: Set<String> = ["id", "parentId", "datasetId", "kind"]
        if ["folder", "dataset-root"].contains(kind) {
            keys.insert("role"); try check(matches(value["role"], "^[a-z][a-z0-9-]{0,31}$"))
            if value["entityId"] != nil { keys.insert("entityId"); try check(entityID(value["entityId"])) }
            try check(kind != "dataset-root" || value["parentId"] as? String == "appDataFolder" && value["role"] as? String == "root")
        } else {
            keys.formUnion(["sha256", "size"])
            try check(PinItAnywhereProtocol.isDigest(PinItAnywhereProtocol.text(value, "sha256")))
            let maximum = kind == "attachment" ? PinItAnywhereProtocol.attachment : ["change", "purge", "dataset", "ready"].contains(kind) ? 65536 : 8 * 1024 * 1024
            _ = try PinItAnywhereProtocol.number(value, "size", Int64(maximum))
            if ["revision", "attachment", "change", "purge"].contains(kind) { keys.insert("entityId"); try check(entityID(value["entityId"])) }
            if ["revision", "change"].contains(kind) { keys.insert("revisionId"); try check(entityID(value["revisionId"])) }
            if ["revision", "change", "checkpoint", "purge"].contains(kind) { keys.insert("shard"); try check(shards.contains(PinItAnywhereProtocol.text(value, "shard"))) }
        }
        try check(Set(value.keys) == keys); _ = try properties(value); return value
    }
    static func mediaType(_ kind: String, _ value: Any?) -> Bool {
        guard let mime = value as? String, mime.utf8.count <= 256 else { return false }
        if ["folder", "dataset-root"].contains(kind) { return mime == "application/vnd.google-apps.folder" }
        return matches(mime, "^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$")
            && !mime.lowercased().hasPrefix("application/vnd.google-apps.")
    }
    static func metadata(_ input: [String: Any]) throws -> [String: Any] {
        let value = try file(input), kind = try PinItAnywhereProtocol.text(value, "kind"), id = try PinItAnywhereProtocol.text(value, "id")
        let folder = ["folder", "dataset-root"].contains(kind)
        let suffix = folder ? "" : kind == "attachment" ? ".bin" : ".json"
        return ["id": id, "name": kind + "-" + (value["revisionId"] as? String ?? value["entityId"] as? String ?? id) + suffix,
                "mimeType": folder ? "application/vnd.google-apps.folder" : kind == "attachment" ? "application/octet-stream" : "application/json",
                "parents": [try PinItAnywhereProtocol.text(value, "parentId")], "appProperties": try properties(value)]
    }
    static func verify(_ value: [String: Any], _ expected: [String: Any]) throws {
        let desired = try metadata(expected), parents = value["parents"] as? [String] ?? []
        let rootAlias = expected["kind"] as? String == "dataset-root" && parents.count == 1 && fileID(parents.first)
        func verifyField(_ condition: Bool, _ field: String) throws {
            try PinItAnywhereProtocol.require(condition, "dataset-response-" + field, "Google Drive returned mismatched dataset metadata (" + field + ").")
        }
        try verifyField(value["id"] as? String == expected["id"] as? String, "id")
        try verifyField(mediaType(try PinItAnywhereProtocol.text(expected, "kind"), value["mimeType"]), "type")
        try verifyField(parents == desired["parents"] as? [String] || rootAlias, "parent")
        try verifyField(value["appProperties"] as? [String: String] == desired["appProperties"] as? [String: String], "properties")
        try verifyField((value["spaces"] as? [String] ?? []).contains("appDataFolder"), "space")
        try verifyField(value["trashed"] == nil || ((try? PinItAnywhereProtocol.bool(value, "trashed")) == false), "state")
        if expected["sha256"] != nil {
            try verifyField(value["size"] as? String == String(PinItAnywhereProtocol.number(expected, "size")), "size")
            try verifyField(value["sha256Checksum"] == nil || value["sha256Checksum"] as? String == expected["sha256"] as? String, "checksum")
        }
    }

    static func deleteBatch(_ value: Any?) throws -> Data {
        guard let ids = value as? [String] else { throw PinItAnywhereFailure("invalid-source-file", "The deletion IDs are invalid.") }
        try check((1...100).contains(ids.count) && Set(ids).count == ids.count
            && ids.allSatisfy { fileID($0) && !["root", "appDataFolder"].contains($0) })
        let body = ids.enumerated().map { index, id in
            "--pin_it_anywhere_delete\r\nContent-Type: application/http\r\nContent-ID: wf-\(index)\r\n\r\nDELETE /drive/v3/files/\(id) HTTP/1.1\r\n\r\n"
        }.joined() + "--pin_it_anywhere_delete--\r\n"
        return Data(body.utf8)
    }
    static func query(_ value: [String: Any]) throws -> String {
        let scope = try PinItAnywhereProtocol.text(value, "scope"); var keys: Set<String> = ["scope"], clauses = ["trashed = false"]
        func prop(_ key: String, _ item: String) -> String { "appProperties has { key='" + key + "' and value='" + item + "' }" }
        if scope == "fences" { clauses.append(prop("piaKind", "reset")) }
        else if scope != "legacy" {
            clauses.append(prop("piaFormat", format))
            if !["datasets", "reset-datasets"].contains(scope) {
                keys.insert("datasetId"); try check(datasetID(value["datasetId"])); clauses.append(prop("piaDataset", try PinItAnywhereProtocol.text(value, "datasetId")))
            }
            if ["datasets", "reset-datasets", "ready", "roots"].contains(scope) {
                clauses.append(prop("piaKind", ["datasets", "reset-datasets"].contains(scope) ? "dataset" : scope == "roots" ? "dataset-root" : "ready"))
                if scope == "roots" { clauses.append("'appDataFolder' in parents") }
            } else if ["current", "current-all"].contains(scope) {
                if scope == "current" { keys.insert("shard"); let shard = try PinItAnywhereProtocol.text(value, "shard"); try check(shards.contains(shard)); clauses.append(prop("piaShard", shard)) }
                clauses.append("(" + prop("piaKind", "checkpoint") + " or " + prop("piaKind", "change") + ")")
            } else if ["history", "children"].contains(scope) {
                keys.insert("parentId"); try check(fileID(value["parentId"])); clauses.append("'" + (try PinItAnywhereProtocol.text(value, "parentId")) + "' in parents")
                if scope == "history" { clauses.append(prop("piaKind", "revision")) }
            } else if ["purges", "entity-folders", "entity-data"].contains(scope) {
                keys.insert("entities"); let ids = value["entities"] as? [String] ?? []
                try check((1...20).contains(ids.count) && ids.allSatisfy { entityID($0) } && Set(ids).count == ids.count)
                clauses += [scope == "entity-data" ? "(" + ["revision", "attachment", "folder"].map { prop("piaKind", $0) }.joined(separator: " or ") + ")"
                    : prop("piaKind", scope == "purges" ? "purge" : "folder"), "(" + ids.map { prop("piaEntity", $0) }.joined(separator: " or ") + ")"]
            } else { try check(false) }
        }
        try check(Set(value.keys) == keys); return clauses.joined(separator: " and ")
    }
}
