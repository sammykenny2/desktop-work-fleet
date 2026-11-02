import Foundation

@main struct DatasetProbe {
    static func main() throws {
        let fixture = try FleetProtocol.json(Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
        for item in fixture["queries"] as! [[String: Any]] {
            try FleetDataset.check(FleetDataset.query(item["input"] as! [String: Any]) == item["expected"] as! String)
        }
        for item in fixture["files"] as! [[String: Any]] { try FleetDataset.verify(item["metadata"] as! [String: Any], FleetDataset.file(item["input"] as! [String: Any])) }
        let sample = (fixture["files"] as! [[String: Any]]).first { ($0["input"] as? [String: Any])?["kind"] as? String == "revision" }!
        let expected = sample["input"] as! [String: Any], valid = sample["metadata"] as! [String: Any]
        for (field, key, bad) in [("id", "id", "other" as Any), ("type", "mimeType", "text/plain"),
            ("parent", "parents", ["other"]), ("properties", "appProperties", [String: String]()),
            ("space", "spaces", ["drive"]), ("state", "trashed", true), ("size", "size", "99999"),
            ("checksum", "sha256Checksum", "bad")] {
            var value = valid; value[key] = bad
            do { try FleetDataset.verify(value, expected); throw FleetFailure("test-failed", "Mismatched metadata accepted.") }
            catch let failure as FleetFailure { try FleetDataset.check(failure.code == "dataset-response-" + field) }
        }
        for key in ["badQueries", "badFiles"] {
            for item in fixture[key] as! [[String: Any]] {
                var rejected = false
                do { if key == "badQueries" { _ = try FleetDataset.query(item) } else { _ = try FleetDataset.file(item) } }
                catch { rejected = true }
                try FleetDataset.check(rejected)
            }
        }
        let deletion = fixture["deletion"] as! [String: Any]
        try FleetDataset.check(FleetDataset.deleteBatch(deletion["ids"]) == Data((deletion["body"] as! String).utf8))
        for ids in fixture["badDeletionIds"] as! [Any] {
            var rejected = false
            do { _ = try FleetDataset.deleteBatch(ids) } catch { rejected = true }
            try FleetDataset.check(rejected)
        }
        print("PASS dataset wire")
    }
}
