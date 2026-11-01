import Foundation

/** Typed dataset operations keep query strings, URLs and credentials inside the native service. */
enum FleetDataset {
    static let fields = "id,name,mimeType,parents,spaces,trashed,size,createdTime,appProperties,sha256Checksum"
    static let format = "work-fleet-dataset"
    static let shards = Array("0123456789abcdef").map(String.init) + ["groups"]
    static let kinds = ["dataset-root", "folder", "dataset", "ready", "revision", "attachment", "change", "checkpoint", "purge"]
    static func check(_ condition: Bool) throws { try FleetProtocol.require(condition, "invalid-source-file", "The dataset descriptor or query isn't valid.") }
    static func matches(_ value: Any?, _ pattern: String) -> Bool {
        guard let text = value as? String, !["__proto__", "prototype", "constructor"].contains(text) else { return false }
        return text.range(of: pattern, options: .regularExpression) == text.startIndex..<text.endIndex
    }
    static func fileID(_ value: Any?) -> Bool { matches(value, "^[A-Za-z0-9_-]{1,256}$") }
    static func entityID(_ value: Any?) -> Bool { matches(value, "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$") }
    static func datasetID(_ value: Any?) -> Bool { matches(value, "^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$") }
    static func properties(_ file: [String: Any]) throws -> [String: String] {
        var result = ["wfFormat": format, "wfSchema": "1", "wfDataset": try FleetProtocol.text(file, "datasetId"), "wfKind": try FleetProtocol.text(file, "kind")]
        for (key, property) in [("sha256", "wfSha256"), ("role", "wfRole"), ("entityId", "wfEntity"), ("revisionId", "wfRevision"), ("shard", "wfShard")] {
            if file[key] != nil { result[property] = try FleetProtocol.text(file, key) }
        }
        try check(result.allSatisfy { ($0.key + $0.value).utf8.count <= 124 }); return result
    }
    static func file(_ value: [String: Any]) throws -> [String: Any] {
        let kind = try FleetProtocol.text(value, "kind")
        try check(fileID(value["id"]) && fileID(value["parentId"]) && datasetID(value["datasetId"]) && kinds.contains(kind))
        var keys: Set<String> = ["id", "parentId", "datasetId", "kind"]
        if ["folder", "dataset-root"].contains(kind) {
            keys.insert("role"); try check(matches(value["role"], "^[a-z][a-z0-9-]{0,31}$"))
            if value["entityId"] != nil { keys.insert("entityId"); try check(entityID(value["entityId"])) }
            try check(kind != "dataset-root" || value["parentId"] as? String == "appDataFolder" && value["role"] as? String == "root")
        } else {
            keys.formUnion(["sha256", "size"])
            try check(FleetProtocol.isDigest(FleetProtocol.text(value, "sha256")))
            let maximum = kind == "attachment" ? FleetProtocol.attachment : ["change", "purge", "dataset", "ready"].contains(kind) ? 65536 : 8 * 1024 * 1024
            _ = try FleetProtocol.number(value, "size", Int64(maximum))
            if ["revision", "attachment", "change", "purge"].contains(kind) { keys.insert("entityId"); try check(entityID(value["entityId"])) }
            if ["revision", "change"].contains(kind) { keys.insert("revisionId"); try check(entityID(value["revisionId"])) }
            if ["revision", "change", "checkpoint", "purge"].contains(kind) { keys.insert("shard"); try check(shards.contains(FleetProtocol.text(value, "shard"))) }
        }
        try check(Set(value.keys) == keys); _ = try properties(value); return value
    }
    static func metadata(_ input: [String: Any]) throws -> [String: Any] {
        let value = try file(input), kind = try FleetProtocol.text(value, "kind"), id = try FleetProtocol.text(value, "id")
        let folder = ["folder", "dataset-root"].contains(kind)
        let suffix = folder ? "" : kind == "attachment" ? ".bin" : ".json"
        return ["id": id, "name": kind + "-" + (value["revisionId"] as? String ?? value["entityId"] as? String ?? id) + suffix,
                "mimeType": folder ? "application/vnd.google-apps.folder" : "application/octet-stream",
                "parents": [try FleetProtocol.text(value, "parentId")], "appProperties": try properties(value)]
    }
    static func verify(_ value: [String: Any], _ expected: [String: Any]) throws {
        let desired = try metadata(expected), parents = value["parents"] as? [String] ?? []
        let rootAlias = expected["kind"] as? String == "dataset-root" && parents.count == 1 && fileID(parents.first)
        try check(value["id"] as? String == expected["id"] as? String && value["mimeType"] as? String == desired["mimeType"] as? String
            && (parents == desired["parents"] as? [String] || rootAlias)
            && value["appProperties"] as? [String: String] == desired["appProperties"] as? [String: String]
            && (value["spaces"] as? [String] ?? []).contains("appDataFolder") && (value["trashed"] == nil || FleetProtocol.bool(value, "trashed") == false))
        if expected["sha256"] != nil {
            try check(FleetProtocol.text(value, "size") == String(FleetProtocol.number(expected, "size"))
                && (value["sha256Checksum"] == nil || FleetProtocol.text(value, "sha256Checksum") == FleetProtocol.text(expected, "sha256")))
        }
    }
    static func query(_ value: [String: Any]) throws -> String {
        let scope = try FleetProtocol.text(value, "scope"); var keys: Set<String> = ["scope"], clauses = ["trashed = false"]
        func prop(_ key: String, _ item: String) -> String { "appProperties has { key='" + key + "' and value='" + item + "' }" }
        if scope == "fences" { clauses.append(prop("wfKind", "reset")) }
        else if scope != "legacy" {
            clauses.append(prop("wfFormat", format))
            if scope != "datasets" {
                keys.insert("datasetId"); try check(datasetID(value["datasetId"])); clauses.append(prop("wfDataset", try FleetProtocol.text(value, "datasetId")))
            }
            if ["datasets", "ready", "roots"].contains(scope) {
                clauses.append(prop("wfKind", scope == "datasets" ? "dataset" : scope == "roots" ? "dataset-root" : "ready"))
                if scope == "roots" { clauses.append("'appDataFolder' in parents") }
            } else if ["current", "current-all"].contains(scope) {
                if scope == "current" { keys.insert("shard"); let shard = try FleetProtocol.text(value, "shard"); try check(shards.contains(shard)); clauses.append(prop("wfShard", shard)) }
                clauses.append("(" + prop("wfKind", "checkpoint") + " or " + prop("wfKind", "change") + ")")
            } else if ["history", "children"].contains(scope) {
                keys.insert("parentId"); try check(fileID(value["parentId"])); clauses.append("'" + (try FleetProtocol.text(value, "parentId")) + "' in parents")
                if scope == "history" { clauses.append(prop("wfKind", "revision")) }
            } else if ["purges", "entity-folders"].contains(scope) {
                keys.insert("entities"); let ids = value["entities"] as? [String] ?? []
                try check((1...20).contains(ids.count) && ids.allSatisfy { entityID($0) } && Set(ids).count == ids.count)
                clauses += [prop("wfKind", scope == "purges" ? "purge" : "folder"), "(" + ids.map { prop("wfEntity", $0) }.joined(separator: " or ") + ")"]
            } else { try check(false) }
        }
        try check(Set(value.keys) == keys); return clauses.joined(separator: " and ")
    }
}
