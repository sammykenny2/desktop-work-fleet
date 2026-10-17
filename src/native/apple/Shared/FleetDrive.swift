import Foundation

actor FleetDrive {
    private static let fields = "id,size,spaces,trashed,appProperties,sha256Checksum"
    private let google: FleetGoogle
    private let account: String
    private var closed = false
    private var uploads: [String: (path: String, digest: String, size: Int)] = [:]
    private var clients: [UUID: BoundedHTTP] = [:]
    init(google: FleetGoogle, profile: String) { self.google = google; account = profile.hasPrefix("google:") ? String(profile.dropFirst(7)) : "" }
    func close() { closed = true; for client in clients.values { client.cancel() }; clients.removeAll(); uploads.removeAll() }
    private func path(_ base: String, _ fields: [(String, String)]) -> String {
        var query = URLComponents(); query.queryItems = fields.map { URLQueryItem(name: $0.0, value: $0.1) }; return base + (query.percentEncodedQuery.map { "?" + $0 } ?? "")
    }
    private func request(_ path: String, method: String = "GET", body: Data? = nil, headers: [String: String] = [:], maximum: Int = 2 * 1024 * 1024, allow308: Bool = false, context: String = "") async throws -> (Data, HTTPURLResponse) {
        try FleetProtocol.require(!closed && !account.isEmpty, "stale-session", "The Google session has ended.")
        guard let url = URL(string: "https://www.googleapis.com" + path), url.scheme == "https", url.host == "www.googleapis.com", url.user == nil, url.password == nil, url.fragment == nil, url.port == nil || url.port == 443 else { throw FleetFailure("invalid-source", "The Google transfer address isn't valid.") }
        var request = URLRequest(url: url); request.httpMethod = method; request.httpBody = body
        request.setValue("Bearer " + (try await google.token(account)), forHTTPHeaderField: "Authorization")
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        let id = UUID(), client = BoundedHTTP(maximum: maximum); clients[id] = client; defer { clients.removeValue(forKey: id) }
        let bytes: Data, response: HTTPURLResponse
        do { (bytes, response) = try await client.send(request) }
        catch let failure as FleetFailure { throw failure }
        catch { throw FleetFailure("network", "Couldn't connect to Google Drive. Pending changes are kept.") }
        try FleetProtocol.require(!closed, "stale-session", "The Google session has ended.")
        let status = response.statusCode
        if (200..<300).contains(status) || allow308 && status == 308 { return (bytes, response) }
        let error = try? FleetProtocol.json(bytes); let reasons = (error?["error"] as? [String: Any])?["errors"] as? [[String: Any]]; let reason = reasons?.first?["reason"] as? String ?? ""
        let code = status == 401 ? "unauthorized" : status == 409 ? "file-exists" : status == 429 || ["rateLimitExceeded", "userRateLimitExceeded"].contains(reason) ? "rate-limit"
            : status >= 500 ? "service-unavailable" : status == 410 && context == "changes" ? "cursor-expired" : [400, 410].contains(status) && context == "listing" ? "page-expired"
            : status == 404 && context == "upload" ? "upload-session-expired" : status == 404 && context == "delete" ? "file-missing"
            : reason == "storageQuotaExceeded" ? "storage-quota" : status == 403 ? "source-permission" : "source-error"
        throw FleetFailure(code, "Google Drive didn't finish syncing (\(code)). Local data and pending changes are kept.")
    }
    private func json(_ path: String, context: String = "") async throws -> [String: Any] { try FleetProtocol.json((try await request(path, context: context)).0) }
    private func file(_ args: [String: Any]) throws -> [String: Any] {
        guard let value = args["file"] as? [String: Any] else { throw FleetFailure("invalid-source-file", "The sync file isn't valid.") }
        let id = try FleetProtocol.text(value, "id"), kind = try FleetProtocol.text(value, "kind"), digest = try FleetProtocol.text(value, "sha256")
        try FleetProtocol.require(id.range(of: "^[A-Za-z0-9_-]{1,256}$", options: .regularExpression) != nil && ["revision", "attachment", "reset", "workspace"].contains(kind) && FleetProtocol.isDigest(digest), "invalid-source-file", "The sync file ID isn't valid.")
        let size = try FleetProtocol.number(value, "size", Int64(["revision", "workspace"].contains(kind) ? 8 * 1024 * 1024 : kind == "reset" ? 4096 : FleetProtocol.attachment)); return ["id": id, "kind": kind, "sha256": digest, "size": size]
    }
    private func metadata(_ value: [String: Any], _ file: [String: Any]) throws {
        guard let properties = value["appProperties"] as? [String: Any], let spaces = value["spaces"] as? [String] else { throw FleetFailure("upload-mismatch", "The Google file's metadata is incomplete.") }
        try FleetProtocol.require(FleetProtocol.text(value, "id") == FleetProtocol.text(file, "id") && FleetProtocol.text(value, "size") == String(FleetProtocol.number(file, "size"))
            && spaces.contains("appDataFolder") && (value["trashed"] == nil || FleetProtocol.bool(value, "trashed") == false)
            && FleetProtocol.text(properties, "wfFormat") == "work-fleet-file" && FleetProtocol.text(properties, "wfSchema") == "1" && FleetProtocol.text(properties, "wfKind") == FleetProtocol.text(file, "kind") && FleetProtocol.text(properties, "wfSha256") == FleetProtocol.text(file, "sha256")
            && (value["sha256Checksum"] == nil || FleetProtocol.text(value, "sha256Checksum") == FleetProtocol.text(file, "sha256")), "upload-mismatch", "The Google file's metadata doesn't match its contents.")
    }
    func invoke(_ method: String, _ args: [String: Any], bytes: Data? = nil) async throws -> Any {
        try FleetProtocol.require(FleetProtocol.text(args, "accountId") == account && !closed, "stale-session", "The Google account has changed.")
        switch method {
        case "google.cursor": return try await json(path("/drive/v3/changes/startPageToken", [("fields", "startPageToken")]))
        case "google.list":
            var fields = [("spaces", "appDataFolder"), ("q", "trashed = false"), ("pageSize", "100"), ("fields", "nextPageToken,incompleteSearch,files(\(Self.fields))")]
            if args["pageToken"] != nil && !(args["pageToken"] is NSNull) { fields.append(("pageToken", try FleetProtocol.text(args, "pageToken", 8192))) }
            return try await json(path("/drive/v3/files", fields), context: "listing")
        case "google.changes": return try await json(path("/drive/v3/changes", [("pageToken", FleetProtocol.text(args, "cursor", 8192)), ("spaces", "appDataFolder"), ("pageSize", "100"), ("includeRemoved", "true"), ("fields", "nextPageToken,newStartPageToken,changes(fileId,removed,file(\(Self.fields),mimeType))")]), context: "changes")
        case "google.allocate": return try await json(path("/drive/v3/files/generateIds", [("count", "1"), ("space", "appDataFolder"), ("type", "files"), ("fields", "ids")]))
        case "google.read":
            let file = try self.file(args), id = try FleetProtocol.text(file, "id"), size = Int(try FleetProtocol.number(file, "size"))
            try metadata(await json(path("/drive/v3/files/" + id, [("fields", Self.fields)])), file)
            let data = try await request(path("/drive/v3/files/" + id, [("alt", "media")]), maximum: max(size, 65536)).0
            try FleetProtocol.require(data.count == size && FleetProtocol.digest(data) == FleetProtocol.text(file, "sha256"), "file-integrity", "The Google file failed its checksum."); return data
        case "google.delete":
            // Reset only: files in the app data folder are removed one by one; one that is already gone counts as deleted.
            let id = try FleetProtocol.text(args, "fileId")
            try FleetProtocol.require(id.range(of: "^[A-Za-z0-9_-]{1,256}$", options: .regularExpression) != nil, "invalid-source-file", "The sync file ID isn't valid.")
            do { _ = try await request("/drive/v3/files/" + id, method: "DELETE", context: "delete") }
            catch let failure as FleetFailure where failure.code == "file-missing" { }
            return NSNull()
        case "google.create":
            let file = try self.file(args); guard let bytes else { throw FleetFailure("transfer-missing", "The file contents to upload are missing.") }
            try FleetProtocol.require(bytes.count == FleetProtocol.number(file, "size") && FleetProtocol.digest(bytes) == FleetProtocol.text(file, "sha256"), "file-integrity", "The file to upload failed its checksum.")
            return try await create(file, bytes)
        default: throw FleetFailure("unsupported-method", "The Google host does not support this operation.")
        }
    }
    private func completed(_ bytes: Data, _ file: [String: Any]) async throws -> [String: Any] {
        let value = try FleetProtocol.json(bytes); try metadata(value, file)
        if value["sha256Checksum"] == nil {
            let data = try await request(path("/drive/v3/files/" + FleetProtocol.text(file, "id"), [("alt", "media")]), maximum: max(65536, Int(FleetProtocol.number(file, "size")))).0
            try FleetProtocol.require(data.count == FleetProtocol.number(file, "size") && FleetProtocol.digest(data) == FleetProtocol.text(file, "sha256"), "upload-mismatch", "The Google upload failed its checksum.")
        }
        uploads.removeValue(forKey: try FleetProtocol.text(file, "id")); return value
    }
    private func offset(_ response: HTTPURLResponse, maximum: Int, previous: Int) throws -> Int {
        var offset = 0
        if let range = response.value(forHTTPHeaderField: "Range") {
            try FleetProtocol.require(range.range(of: "^bytes=0-[0-9]+$", options: .regularExpression) != nil, "invalid-upload-range", "Google's resumable upload progress isn't valid.")
            guard let end = Int(range.dropFirst(8)), end < Int.max else { throw FleetFailure("invalid-upload-range", "Google's resumable upload progress is out of range.") }; offset = end + 1
        }
        try FleetProtocol.require(offset <= maximum && offset > previous, "service-unavailable", "Google hasn't confirmed new upload progress."); return offset
    }
    private func create(_ file: [String: Any], _ bytes: Data) async throws -> [String: Any] {
        let id = try FleetProtocol.text(file, "id"), digest = try FleetProtocol.text(file, "sha256"), kind = try FleetProtocol.text(file, "kind"), size = Int(try FleetProtocol.number(file, "size"))
        let metadata: [String: Any] = ["id": id, "name": "work-fleet-v1-\(kind)-\(digest).bin", "mimeType": "application/octet-stream", "parents": ["appDataFolder"], "appProperties": ["wfFormat": "work-fleet-file", "wfSchema": "1", "wfKind": kind, "wfSha256": digest]]
        let json = try FleetProtocol.encode(metadata)
        do {
            if size == 0 {
                let boundary = "wf_" + FleetProtocol.uuid(); let body = Data("--\(boundary)\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n\(String(data: json, encoding: .utf8)!)\r\n--\(boundary)\r\nContent-Type: application/octet-stream\r\n\r\n\r\n--\(boundary)--\r\n".utf8)
                return try await completed(request(path("/upload/drive/v3/files", [("uploadType", "multipart"), ("fields", Self.fields)]), method: "POST", body: body, headers: ["Content-Type": "multipart/related; boundary=" + boundary]).0, file)
            }
            var position = 0, session = uploads[id]
            if let saved = session {
                try FleetProtocol.require(saved.digest == digest && saved.size == size, "upload-mismatch", "The resumed upload differs from the original upload.")
                let (data, response) = try await request(saved.path, method: "PUT", body: Data(), headers: ["Content-Range": "bytes */\(size)"], allow308: true, context: "upload")
                if response.statusCode != 308 { return try await completed(data, file) }; position = try offset(response, maximum: size, previous: -1)
            } else {
                let (_, response) = try await request(path("/upload/drive/v3/files", [("uploadType", "resumable"), ("fields", Self.fields)]), method: "POST", body: json, headers: ["Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "application/octet-stream", "X-Upload-Content-Length": String(size)])
                guard let location = response.value(forHTTPHeaderField: "Location"), location.utf8.count <= 8192, let uri = URLComponents(string: location), uri.scheme == "https", uri.host == "www.googleapis.com", uri.port == nil || uri.port == 443,
                    uri.path == "/upload/drive/v3/files", uri.user == nil, uri.password == nil, uri.fragment == nil, let query = uri.percentEncodedQuery else { throw FleetFailure("invalid-upload-session", "Google's resumable upload address isn't valid.") }
                // Google echoes the request's own parameters (fields) and adds its own (session_crd) beside upload_id, so any
                // distinct plain parameters are accepted; where the contents and the token go is what stays fixed.
                // URLComponents leaves commas in fields unescaped, and Google's Location can echo those literal commas.
                let pairs = query.split(separator: "&", omittingEmptySubsequences: false).map(String.init)
                try FleetProtocol.require(pairs.allSatisfy { $0.range(of: "^[A-Za-z_]+=[A-Za-z0-9_%.,-]*$", options: .regularExpression) != nil }
                    && Set(pairs.map { pair in pair.prefix { $0 != "=" } }).count == pairs.count
                    && pairs.contains("uploadType=resumable") && pairs.contains { $0.hasPrefix("upload_id=") && $0.count > 10 }, "invalid-upload-session", "Google's resumable upload address isn't valid.")
                session = (uri.percentEncodedPath + "?" + query, digest, size); uploads[id] = session
            }
            while position < size {
                let end = min(position + 1024 * 1024, size)
                let (data, response) = try await request(session!.path, method: "PUT", body: bytes.subdata(in: position..<end), headers: ["Content-Type": "application/octet-stream", "Content-Range": "bytes \(position)-\(end - 1)/\(size)"], allow308: true, context: "upload")
                if response.statusCode != 308 { return try await completed(data, file) }; position = try offset(response, maximum: end, previous: position)
            }
            throw FleetFailure("service-unavailable", "Google hasn't confirmed the upload. Pending changes are kept.")
        } catch let error as FleetFailure {
            if ["file-exists", "unauthorized", "source-permission", "source-error", "upload-session-expired", "storage-quota"].contains(error.code) { uploads.removeValue(forKey: id) }; throw error
        }
    }
}
