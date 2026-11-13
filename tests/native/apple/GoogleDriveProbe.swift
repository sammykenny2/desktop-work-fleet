import Foundation

// Only authorization and HTTP are replaced; PinItAnywhereDrive and PinItAnywhereProtocol are the production sources.
actor PinItAnywhereGoogle {
    func token(_ expected: String) throws -> String {
        try GoogleDriveProbe.check(expected == "fixture-account", "Unexpected account")
        return "fixture-token"
    }
}

final class BoundedHTTPSession { func close() {} }
final class BoundedHTTP {
    struct Metrics { let duration = 0.01; let transactions = 1; let reusedConnections = 1 }
    var metrics: Metrics? { Metrics() }
    init(maximum: Int, session: BoundedHTTPSession? = nil) { }
    func cancel() { }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        try await ScriptedHTTP.shared.send(request)
    }
}

actor ScriptedHTTP {
    struct Step {
        let method: String
        let url: String
        var status = 200
        var headers: [String: String] = [:]
        var response = Data()
        var body: Data?
        var range: String?
        var fail = false
        var expectedFileId = "fixture-file"
        var expectedParents = ["appDataFolder"]
        var expectedMime: String?
    }
    static let shared = ScriptedHTTP()
    private var steps: [Step] = []
    func prepare(_ steps: [Step]) throws {
        try finished()
        self.steps = steps
    }
    func finished() throws { try GoogleDriveProbe.check(steps.isEmpty, "Expected HTTP request was not made") }
    func send(_ request: URLRequest) throws -> (Data, HTTPURLResponse) {
        try GoogleDriveProbe.check(!steps.isEmpty, "Unexpected HTTP request")
        let step = steps.removeFirst()
        try GoogleDriveProbe.check(request.httpMethod == step.method, "Unexpected HTTP method")
        try GoogleDriveProbe.check(request.url?.absoluteString == step.url, "Upload URL was changed")
        try GoogleDriveProbe.check(request.value(forHTTPHeaderField: "Authorization") == "Bearer fixture-token", "Missing fixture token")
        if let body = step.body { try GoogleDriveProbe.check(request.httpBody == body, "Upload bytes changed") }
        if let range = step.range { try GoogleDriveProbe.check(request.value(forHTTPHeaderField: "Content-Range") == range, "Unexpected upload range") }
        if step.method == "POST" && request.url?.path != "/batch/drive/v3" {
            let metadata = try PinItAnywhereProtocol.json(request.httpBody ?? Data())
            try GoogleDriveProbe.check(metadata["id"] as? String == step.expectedFileId, "Reserved file ID changed")
            try GoogleDriveProbe.check(metadata["parents"] as? [String] == step.expectedParents, "Wrong Drive parent")
        }
        if let mime = step.expectedMime {
            let header = step.method == "POST" ? "X-Upload-Content-Type" : "Content-Type"
            try GoogleDriveProbe.check(request.value(forHTTPHeaderField: header) == mime, "Unexpected media Content-Type")
            if step.method == "POST" {
                try GoogleDriveProbe.check(PinItAnywhereProtocol.json(request.httpBody ?? Data())["mimeType"] as? String == mime, "Unexpected metadata MIME type")
            }
        }
        if step.fail { throw URLError(.networkConnectionLost) }
        return (step.response, HTTPURLResponse(url: request.url!, statusCode: step.status, httpVersion: "HTTP/1.1", headerFields: step.headers)!)
    }
}

@main enum GoogleDriveProbe {
    static let base = "https://www.googleapis.com/upload/drive/v3/files"
    static let start = base + "?uploadType=resumable&fields=" + PinItAnywhereDataset.fields
    static let location = start + "&upload_id=fixture-session&session_crd=fixture-crd"
    static let bytes = Data([0, 255, 1, 3])
    static var file: [String: Any] { ["id": "fixture-file", "kind": "attachment", "sha256": PinItAnywhereProtocol.digest(bytes), "size": bytes.count] }
    static var arguments: [String: Any] { ["accountId": "fixture-account", "file": file] }
    static func adapter() -> PinItAnywhereDrive { PinItAnywhereDrive(google: PinItAnywhereGoogle(), profile: "google:fixture-account") }
    static func check(_ condition: Bool, _ message: String) throws {
        if !condition { throw PinItAnywhereFailure("drive-probe", message) }
    }
    static func begin(_ location: String?) -> ScriptedHTTP.Step {
        ScriptedHTTP.Step(method: "POST", url: start, headers: location.map { ["Location": $0] } ?? [:])
    }
    static func upload(_ location: String, fail: Bool = false) throws -> ScriptedHTTP.Step {
        let metadata: [String: Any] = ["id": "fixture-file", "size": "4", "spaces": ["appDataFolder"],
            "sha256Checksum": PinItAnywhereProtocol.digest(bytes), "appProperties": ["piaFormat": "pin-it-anywhere-file", "piaSchema": "1",
            "piaKind": "attachment", "piaSha256": PinItAnywhereProtocol.digest(bytes)]]
        return ScriptedHTTP.Step(method: "PUT", url: location, status: 201, response: try PinItAnywhereProtocol.encode(metadata),
            body: bytes, range: "bytes 0-3/4", fail: fail)
    }
    static func create(_ drive: PinItAnywhereDrive) async throws {
        let value = try await drive.invoke("google.create", arguments, bytes: bytes) as? [String: Any]
        try check(value?["id"] as? String == "fixture-file", "Upload did not complete")
    }
    static func reject(_ drive: PinItAnywhereDrive, code: String) async throws {
        do {
            try await create(drive)
            throw PinItAnywhereFailure("drive-probe", "Expected upload failure")
        } catch let error as PinItAnywhereFailure {
            try check(error.code == code, "Unexpected error code: " + error.code)
            try check(!error.message.contains("fixture-") && !error.message.contains("https://"), "Error leaked a credential or upload URL")
        }
    }
    static func fixture(_ name: String) async throws {
        switch name {
        case "read-probe", "read-probe-invalid", "read-probe-network":
            var components = URLComponents(string: "https://www.googleapis.com/drive/v3/changes")!
            components.queryItems = [URLQueryItem(name: "pageToken", value: "fixture-private-cursor"), URLQueryItem(name: "spaces", value: "appDataFolder"),
                URLQueryItem(name: "pageSize", value: "100"), URLQueryItem(name: "includeRemoved", value: "true"),
                URLQueryItem(name: "fields", value: "nextPageToken,newStartPageToken,changes(fileId,removed,file(\(PinItAnywhereDataset.fields),mimeType))")]
            let start = ScriptedHTTP.Step(method: "GET", url: "https://www.googleapis.com/drive/v3/changes/startPageToken?fields=startPageToken",
                                          response: Data("{\"startPageToken\":\"fixture-private-cursor\"}".utf8))
            let feed = ScriptedHTTP.Step(method: "GET", url: components.url!.absoluteString,
                response: Data((name == "read-probe" ? "{\"newStartPageToken\":\"fixture-private-cursor\"}" : "{\"changes\":null,\"newStartPageToken\":\"fixture-private-cursor\"}").utf8), fail: name == "read-probe-network")
            try await ScriptedHTTP.shared.prepare(name == "read-probe" ? Array(repeating: [start] + Array(repeating: feed, count: 31), count: 2).flatMap { $0 } : [start, feed])
            let drive = adapter(), report = await drive.readOnlyProbe(intervalNanoseconds: 0)
            let modes = report["modes"] as! [[String: Any]]
            try check(modes.count == (name == "read-probe" ? 2 : 1), "Unexpected probe modes")
            if name == "read-probe" {
                for mode in modes {
                    try check(mode["requests"] as? Int == 32, "Probe read budget changed")
                    let groups = mode["groups"] as! [String: [String: Any]]
                    try check(groups["empty"]?["samples"] as? Int == 30, "Warm samples were not separated")
                }
            } else if name == "read-probe-network" {
                try check(modes[0]["errorCode"] as? String == "network", "Network failure was hidden")
                try check(modes[0]["requests"] as? Int == 2 && modes[0]["completedResponses"] as? Int == 1, "Failed request disappeared from the probe count")
            } else { try check(modes[0]["errorCode"] as? String == "invalid-source-page", "Invalid page was accepted as empty") }
            let encoded = String(data: try PinItAnywhereProtocol.encode(report), encoding: .utf8)!
            try check(!encoded.contains("fixture-") && !encoded.contains("Bearer") && !encoded.contains("googleapis.com"), "Probe leaked private identifiers")
            await drive.close()
        case "delete-batch":
            let ids = ["old-one", "old-two"], body = try PinItAnywhereDataset.deleteBatch(ids)
            let reply = Data("--reply\r\nContent-Type: application/http\r\nContent-ID: response-wf-0\r\n\r\nHTTP/1.1 204 No Content\r\n\r\n--reply--\r\n".utf8)
            try await ScriptedHTTP.shared.prepare([ScriptedHTTP.Step(method: "POST", url: "https://www.googleapis.com/batch/drive/v3", response: reply, body: body)])
            let result = try await adapter().invoke("google.deleteBatch", ["accountId": "fixture-account", "fileIds": ids]) as! Data
            try check(result == reply, "Batch response changed")
            var rejected = false
            do { _ = try await adapter().invoke("google.deleteBatch", ["accountId": "fixture-account", "fileIds": ["root"]]) }
            catch let error as PinItAnywhereFailure { rejected = error.code == "invalid-source-file" }
            try check(rejected, "Root deletion must fail before HTTP")
        case "dataset":
            let content = Data([0, 255, 1, 3])
            let file: [String: Any] = ["id": "fixture-file", "kind": "revision", "datasetId": "11111111-2222-3333-4444-555555555555",
                "parentId": "note-folder", "entityId": "one", "revisionId": "r1", "shard": "a", "sha256": PinItAnywhereProtocol.digest(content), "size": 4]
            var metadata = try PinItAnywhereDataset.metadata(file)
            metadata["mimeType"] = "text/plain"
            metadata["spaces"] = ["appDataFolder"]; metadata["size"] = "4"; metadata["sha256Checksum"] = PinItAnywhereProtocol.digest(content)
            var startStep = begin(location); startStep.expectedParents = ["note-folder"]; startStep.expectedMime = "application/json"
            let uploaded = ScriptedHTTP.Step(method: "PUT", url: location, status: 201, response: try PinItAnywhereProtocol.encode(metadata), body: content, range: "bytes 0-3/4", expectedMime: "application/json")
            let media = "https://www.googleapis.com/drive/v3/files/fixture-file"
            try await ScriptedHTTP.shared.prepare([startStep, uploaded,
                ScriptedHTTP.Step(method: "GET", url: media + "?fields=" + PinItAnywhereDataset.fields, response: try PinItAnywhereProtocol.encode(metadata)),
                ScriptedHTTP.Step(method: "GET", url: media + "?alt=media", response: content)])
            let drive = adapter(), args: [String: Any] = ["accountId": "fixture-account", "file": file]
            _ = try await drive.invoke("google.dataset.create", args, bytes: content)
            let received = try await drive.invoke("google.dataset.read", args) as! Data
            try check(received == content, "Dataset bytes changed")
            metadata["parents"] = ["another-note"]
            try await ScriptedHTTP.shared.prepare([ScriptedHTTP.Step(method: "GET", url: media + "?fields=" + PinItAnywhereDataset.fields, response: try PinItAnywhereProtocol.encode(metadata))])
            var rejected = false
            do { _ = try await drive.invoke("google.dataset.read", args) }
            catch let error as PinItAnywhereFailure { rejected = error.code == "dataset-response-parent" }
            try check(rejected, "Cross-note dataset file was accepted")
        case "literal-fields", "encoded-fields":
            let target = name == "literal-fields" ? location : location.replacingOccurrences(of: ",", with: "%2C")
            try await ScriptedHTTP.shared.prepare([begin(target), upload(target)])
            try await create(adapter())
        case "invalid-locations":
            let invalid: [String?] = [nil, "", "/upload/drive/v3/files?uploadType=resumable&upload_id=fixture-session",
                location.replacingOccurrences(of: "https:", with: "http:"),
                location.replacingOccurrences(of: "www.googleapis.com", with: "attacker.invalid"),
                location.replacingOccurrences(of: "www.googleapis.com", with: "www.googleapis.com.attacker.invalid"),
                location.replacingOccurrences(of: "www.googleapis.com", with: "www.googleapis.com:444"),
                location.replacingOccurrences(of: "www.googleapis.com", with: "user:password@www.googleapis.com"),
                location.replacingOccurrences(of: "/upload/drive/v3/files", with: "/drive/v3/files"),
                location + "#fragment", location + "&uploadType=resumable", location + "&upload_id=other",
                location + "&fields=id", location.replacingOccurrences(of: "uploadType=resumable", with: "uploadType=multipart"),
                location.replacingOccurrences(of: "&upload_id=fixture-session", with: ""),
                location.replacingOccurrences(of: "upload_id=fixture-session", with: "upload_id="),
                location + "&", location + "&fields2=id", location + "&extra=" + String(repeating: "x", count: 8192)]
            for target in invalid {
                try await ScriptedHTTP.shared.prepare([begin(target)])
                try await reject(adapter(), code: "invalid-upload-session")
            }
        case "retry", "restart":
            let drive = adapter()
            try await ScriptedHTTP.shared.prepare([begin(location), upload(location, fail: true)])
            try await reject(drive, code: "network")
            if name == "restart" {
                await drive.close()
                let next = location.replacingOccurrences(of: "fixture-session", with: "fixture-new-session")
                try await ScriptedHTTP.shared.prepare([begin(next), upload(next)])
                try await create(adapter())
            } else {
                let status = ScriptedHTTP.Step(method: "PUT", url: location, status: 308, body: Data(), range: "bytes */4")
                try await ScriptedHTTP.shared.prepare([status, upload(location)])
                try await create(drive)
            }
        default: throw PinItAnywhereFailure("drive-probe", "Unknown case")
        }
        try await ScriptedHTTP.shared.finished()
    }
    static func main() async {
        do {
            let name = CommandLine.arguments[1]
            try await fixture(name)
            print("PASS " + name)
        } catch {
            fputs("FAIL \((error as? PinItAnywhereFailure)?.message ?? String(describing: error))\n", stderr)
            exit(1)
        }
    }
}
