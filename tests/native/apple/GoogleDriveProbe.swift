import Foundation

// Only authorization and HTTP are replaced; FleetDrive and FleetProtocol are the production sources.
actor FleetGoogle {
    func token(_ expected: String) throws -> String {
        try GoogleDriveProbe.check(expected == "fixture-account", "Unexpected account")
        return "fixture-token"
    }
}

final class BoundedHTTP {
    init(maximum: Int) { }
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
        if step.method == "POST" {
            let metadata = try FleetProtocol.json(request.httpBody ?? Data())
            try GoogleDriveProbe.check(metadata["id"] as? String == "fixture-file", "Reserved file ID changed")
            try GoogleDriveProbe.check(metadata["parents"] as? [String] == ["appDataFolder"], "Wrong Drive space")
        }
        if step.fail { throw URLError(.networkConnectionLost) }
        return (step.response, HTTPURLResponse(url: request.url!, statusCode: step.status, httpVersion: "HTTP/1.1", headerFields: step.headers)!)
    }
}

@main enum GoogleDriveProbe {
    static let base = "https://www.googleapis.com/upload/drive/v3/files"
    static let start = base + "?uploadType=resumable&fields=id,size,spaces,trashed,appProperties,sha256Checksum"
    static let location = start + "&upload_id=fixture-session&session_crd=fixture-crd"
    static let bytes = Data([0, 255, 1, 3])
    static var file: [String: Any] { ["id": "fixture-file", "kind": "attachment", "sha256": FleetProtocol.digest(bytes), "size": bytes.count] }
    static var arguments: [String: Any] { ["accountId": "fixture-account", "file": file] }
    static func adapter() -> FleetDrive { FleetDrive(google: FleetGoogle(), profile: "google:fixture-account") }
    static func check(_ condition: Bool, _ message: String) throws {
        if !condition { throw FleetFailure("drive-probe", message) }
    }
    static func begin(_ location: String?) -> ScriptedHTTP.Step {
        ScriptedHTTP.Step(method: "POST", url: start, headers: location.map { ["Location": $0] } ?? [:])
    }
    static func upload(_ location: String, fail: Bool = false) throws -> ScriptedHTTP.Step {
        let metadata: [String: Any] = ["id": "fixture-file", "size": "4", "spaces": ["appDataFolder"],
            "sha256Checksum": FleetProtocol.digest(bytes), "appProperties": ["wfFormat": "work-fleet-file", "wfSchema": "1",
            "wfKind": "attachment", "wfSha256": FleetProtocol.digest(bytes)]]
        return ScriptedHTTP.Step(method: "PUT", url: location, status: 201, response: try FleetProtocol.encode(metadata),
            body: bytes, range: "bytes 0-3/4", fail: fail)
    }
    static func create(_ drive: FleetDrive) async throws {
        let value = try await drive.invoke("google.create", arguments, bytes: bytes) as? [String: Any]
        try check(value?["id"] as? String == "fixture-file", "Upload did not complete")
    }
    static func reject(_ drive: FleetDrive, code: String) async throws {
        do {
            try await create(drive)
            throw FleetFailure("drive-probe", "Expected upload failure")
        } catch let error as FleetFailure {
            try check(error.code == code, "Unexpected error code: " + error.code)
            try check(!error.message.contains("fixture-") && !error.message.contains("https://"), "Error leaked a credential or upload URL")
        }
    }
    static func fixture(_ name: String) async throws {
        switch name {
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
        default: throw FleetFailure("drive-probe", "Unknown case")
        }
        try await ScriptedHTTP.shared.finished()
    }
    static func main() async {
        do {
            let name = CommandLine.arguments[1]
            try await fixture(name)
            print("PASS " + name)
        } catch {
            fputs("FAIL \((error as? FleetFailure)?.message ?? String(describing: error))\n", stderr)
            exit(1)
        }
    }
}
