import Foundation

@main struct DatasetProbe {
    static func main() throws {
        let fixture = try PinItAnywhereProtocol.json(Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
        for item in fixture["queries"] as! [[String: Any]] {
            try PinItAnywhereDataset.check(PinItAnywhereDataset.query(item["input"] as! [String: Any]) == item["expected"] as! String)
        }
        for item in fixture["files"] as! [[String: Any]] { try PinItAnywhereDataset.verify(item["metadata"] as! [String: Any], PinItAnywhereDataset.file(item["input"] as! [String: Any])) }
        let media = fixture["mediaTypes"] as! [String: [String]]
        for mime in media["accepted"]! {
            try PinItAnywhereDataset.check(PinItAnywhereDataset.mediaType("revision", mime))
            try PinItAnywhereDataset.check(!PinItAnywhereDataset.mediaType("folder", mime))
        }
        for mime in media["rejected"]! { try PinItAnywhereDataset.check(!PinItAnywhereDataset.mediaType("revision", mime)) }
        let sample = (fixture["files"] as! [[String: Any]]).first { ($0["input"] as? [String: Any])?["kind"] as? String == "revision" }!
        let expected = sample["input"] as! [String: Any], valid = sample["metadata"] as! [String: Any]
        for (field, key, bad) in [("id", "id", "other" as Any), ("type", "mimeType", "application/vnd.google-apps.document"),
            ("parent", "parents", ["other"]), ("properties", "appProperties", [String: String]()),
            ("space", "spaces", ["drive"]), ("state", "trashed", true), ("size", "size", "99999"),
            ("checksum", "sha256Checksum", "bad")] {
            var value = valid; value[key] = bad
            do { try PinItAnywhereDataset.verify(value, expected); throw PinItAnywhereFailure("test-failed", "Mismatched metadata accepted.") }
            catch let failure as PinItAnywhereFailure { try PinItAnywhereDataset.check(failure.code == "dataset-response-" + field) }
        }
        for key in ["badQueries", "badFiles"] {
            for item in fixture[key] as! [[String: Any]] {
                var rejected = false
                do { if key == "badQueries" { _ = try PinItAnywhereDataset.query(item) } else { _ = try PinItAnywhereDataset.file(item) } }
                catch { rejected = true }
                try PinItAnywhereDataset.check(rejected)
            }
        }
        let deletion = fixture["deletion"] as! [String: Any]
        try PinItAnywhereDataset.check(PinItAnywhereDataset.deleteBatch(deletion["ids"]) == Data((deletion["body"] as! String).utf8))
        for ids in fixture["badDeletionIds"] as! [Any] {
            var rejected = false
            do { _ = try PinItAnywhereDataset.deleteBatch(ids) } catch { rejected = true }
            try PinItAnywhereDataset.check(rejected)
        }
        print("PASS dataset wire")
    }
}
