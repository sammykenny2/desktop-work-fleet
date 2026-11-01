import Foundation

@main struct DatasetProbe {
    static func main() throws {
        let fixture = try FleetProtocol.json(Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
        for item in fixture["queries"] as! [[String: Any]] {
            try FleetDataset.check(FleetDataset.query(item["input"] as! [String: Any]) == item["expected"] as! String)
        }
        for item in fixture["files"] as! [[String: Any]] { try FleetDataset.verify(item["metadata"] as! [String: Any], FleetDataset.file(item["input"] as! [String: Any])) }
        for key in ["badQueries", "badFiles"] {
            for item in fixture[key] as! [[String: Any]] {
                var rejected = false
                do { if key == "badQueries" { _ = try FleetDataset.query(item) } else { _ = try FleetDataset.file(item) } }
                catch { rejected = true }
                try FleetDataset.check(rejected)
            }
        }
        print("PASS dataset wire")
    }
}
