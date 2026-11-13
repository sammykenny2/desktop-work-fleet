import Foundation

actor PinItAnywhereDrive {
    private static let fields = PinItAnywhereDataset.fields
    private let google: PinItAnywhereGoogle
    private let account: String
    private var closed = false
    private var uploads: [String: (path: String, digest: String, size: Int)] = [:]
    private var clients: [UUID: BoundedHTTP] = [:]
    private let transport = BoundedHTTPSession()
    private var probeRequests: [[String: Any]]?
    private var probeAttempts = 0
    private var isolatedProbe = false
    init(google: PinItAnywhereGoogle, profile: String) { self.google = google; account = profile.hasPrefix("google:") ? String(profile.dropFirst(7)) : "" }
    deinit { transport.close() }
    func close() { closed = true; transport.close(); for client in clients.values { client.cancel() }; clients.removeAll(); uploads.removeAll() }
    private func path(_ base: String, _ fields: [(String, String)]) -> String {
        var query = URLComponents(); query.queryItems = fields.map { URLQueryItem(name: $0.0, value: $0.1) }; return base + (query.percentEncodedQuery.map { "?" + $0 } ?? "")
    }
    private func request(_ path: String, method: String = "GET", body: Data? = nil, headers: [String: String] = [:], maximum: Int = 2 * 1024 * 1024, allow308: Bool = false, context: String = "") async throws -> (Data, HTTPURLResponse) {
        try PinItAnywhereProtocol.require(!closed && !account.isEmpty, "stale-session", "The Google session has ended.")
        guard let url = URL(string: "https://www.googleapis.com" + path), url.scheme == "https", url.host == "www.googleapis.com", url.user == nil, url.password == nil, url.fragment == nil, url.port == nil || url.port == 443 else { throw PinItAnywhereFailure("invalid-source", "The Google transfer address isn't valid.") }
        var request = URLRequest(url: url); request.httpMethod = method; request.httpBody = body
        let started = ProcessInfo.processInfo.systemUptime
        request.setValue("Bearer " + (try await google.token(account)), forHTTPHeaderField: "Authorization")
        let authenticated = ProcessInfo.processInfo.systemUptime
        try PinItAnywhereProtocol.require(!closed, "stale-session", "The Google session has ended.")
        for (key, value) in headers { request.setValue(value, forHTTPHeaderField: key) }
        let id = UUID(), client = BoundedHTTP(maximum: maximum, session: isolatedProbe ? nil : transport); clients[id] = client; defer { clients.removeValue(forKey: id) }
        let bytes: Data, response: HTTPURLResponse
        if probeRequests != nil { probeAttempts += 1 }
        do { (bytes, response) = try await client.send(request) }
        catch let failure as PinItAnywhereFailure { throw failure }
        catch { throw PinItAnywhereFailure("network", "Couldn't connect to Google Drive. Pending changes are kept.") }
        try PinItAnywhereProtocol.require(!closed, "stale-session", "The Google session has ended.")
        let status = response.statusCode
        if probeRequests != nil {
            let metrics = client.metrics
            probeRequests?.append(["kind": context == "changes" ? "changes" : "start-token", "status": status,
                                   "responseBytes": bytes.count, "authMs": (authenticated - started) * 1000,
                                   "wallMs": (ProcessInfo.processInfo.systemUptime - started) * 1000,
                                   "httpMs": (metrics?.duration ?? 0) * 1000,
                                   "transactions": metrics?.transactions ?? 0, "reusedConnections": metrics?.reusedConnections ?? 0])
        }
        if (200..<300).contains(status) || allow308 && status == 308 { return (bytes, response) }
        let error = try? PinItAnywhereProtocol.json(bytes); let reasons = (error?["error"] as? [String: Any])?["errors"] as? [[String: Any]]; let reason = reasons?.first?["reason"] as? String ?? ""
        let code = status == 401 ? "unauthorized" : status == 409 ? "file-exists" : status == 429 || ["rateLimitExceeded", "userRateLimitExceeded"].contains(reason) ? "rate-limit"
            : status >= 500 ? "service-unavailable" : status == 410 && context == "changes" ? "cursor-expired" : [400, 410].contains(status) && context == "listing" ? "page-expired"
            : status == 404 && context == "upload" ? "upload-session-expired" : status == 404 ? "file-missing"
            : reason == "storageQuotaExceeded" ? "storage-quota"
            : ["activeItemCreationLimitExceeded", "numChildrenInNonRootLimitExceeded"].contains(reason) ? "source-item-limit"
            : status == 403 ? "source-permission" : "source-error"
        throw PinItAnywhereFailure(code, "Google Drive didn't finish syncing (\(code)). Local data and pending changes are kept.")
    }
    private func json(_ path: String, context: String = "") async throws -> [String: Any] { try PinItAnywhereProtocol.json((try await request(path, context: context)).0) }
    /// Debug launch only: fixed read operations in this app's OAuth context, with no renderer or cloud writes.
    func readOnlyProbe(rounds: Int = 30, intervalNanoseconds: UInt64 = 1_000_000_000) async -> [String: Any] {
        guard (1...60).contains(rounds), intervalNanoseconds <= 20_000_000_000, probeRequests == nil else { return ["errorCode": "invalid-request"] }
        var modes: [[String: Any]] = []
        probeRequests = []; defer { probeRequests = nil; isolatedProbe = false }
        for isolated in [true, false] {
            isolatedProbe = isolated; probeRequests = []; probeAttempts = 0
            var categories: [String] = [], errorCode: String?
            do {
                let start = try await json(path("/drive/v3/changes/startPageToken", [("fields", "startPageToken")]))
                var cursor = try PinItAnywhereProtocol.text(start, "startPageToken", 8192)
                for index in 0...rounds {
                    let value = try await json(path("/drive/v3/changes", [("pageToken", cursor), ("spaces", "appDataFolder"),
                        ("pageSize", "100"), ("includeRemoved", "true"), ("fields", "nextPageToken,newStartPageToken,changes(fileId,removed,file(\(Self.fields),mimeType))")]), context: "changes")
                    let changes = value["changes"] ?? []
                    guard let changes = changes as? [Any], changes.count <= 100,
                          (value["nextPageToken"] != nil) != (value["newStartPageToken"] != nil) else {
                        throw PinItAnywhereFailure("invalid-source-page", "Google returned an invalid change page.")
                    }
                    cursor = try PinItAnywhereProtocol.text(value, value["nextPageToken"] != nil ? "nextPageToken" : "newStartPageToken", 8192)
                    categories.append(index == 0 ? "cold" : changes.isEmpty && value["nextPageToken"] == nil ? "empty" : "changed")
                    if index < rounds { try await Task.sleep(nanoseconds: intervalNanoseconds) }
                }
            } catch { errorCode = (error as? PinItAnywhereFailure)?.code ?? (closed ? "stale-session" : "network") }
            let samples = probeRequests ?? [], feeds = samples.filter { $0["kind"] as? String == "changes" }
            var groups: [String: Any] = [:]
            for category in ["start", "cold", "empty", "changed"] {
                let selected = category == "start" ? samples.filter { $0["kind"] as? String == "start-token" }
                    : zip(categories, feeds).filter { $0.0 == category }.map { $0.1 }
                var summary: [String: Any] = ["samples": selected.count]
                for key in ["authMs", "httpMs", "wallMs"] {
                    let sorted = selected.compactMap { $0[key] as? Double }.sorted()
                    if !sorted.isEmpty { summary[key] = ["median": sorted[(sorted.count - 1) / 2], "p95": sorted[Int(ceil(Double(sorted.count) * 0.95)) - 1]] }
                }
                for key in ["responseBytes", "transactions", "reusedConnections"] { summary[key] = selected.compactMap { $0[key] as? Int }.reduce(0, +) }
                groups[category] = summary
            }
            modes.append(["transport": isolated ? "per-request-session" : "account-session", "requests": probeAttempts, "completedResponses": samples.count,
                          "startTokenRequests": samples.filter { $0["kind"] as? String == "start-token" }.count,
                          "groups": groups, "errorCode": errorCode as Any? ?? NSNull()])
            if errorCode != nil { break }
        }
        return ["format": "pin-it-anywhere-drive-read-probe", "schemaVersion": 1, "readOnly": true,
                "intervalMs": intervalNanoseconds / 1_000_000, "modes": modes]
    }
    // The account chip's name and photo: Drive's about.user needs no scope beyond app data. The photo is a public
    // googleusercontent address, fetched without the access token; an unusable photo leaves only the name.
    private func profile() async throws -> [String: Any] {
        let user = try await json(path("/drive/v3/about", [("fields", "user(displayName,photoLink)")]))["user"] as? [String: Any] ?? [:]
        let name = (user["displayName"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        var photo: Any = NSNull()
        if let link = user["photoLink"] as? String, let value = await self.photo(link.trimmingCharacters(in: .whitespacesAndNewlines)) { photo = value }
        return ["name": (1...256).contains(name.count) ? name as Any : NSNull(), "photo": photo]
    }
    private func photo(_ link: String) async -> [String: Any]? {
        guard !closed, link.count <= 2048, let url = URL(string: link), url.scheme == "https", let host = url.host, host.range(of: "^lh[3-6]\\.googleusercontent\\.com$", options: .regularExpression) != nil,
              url.user == nil, url.password == nil, url.fragment == nil, url.port == nil || url.port == 443 else { return nil }
        let id = UUID(), client = BoundedHTTP(maximum: 128 * 1024); clients[id] = client; defer { clients.removeValue(forKey: id) }
        guard let result = try? await client.send(URLRequest(url: url)), result.1.statusCode == 200, !closed, let type = Self.imageType(result.0) else { return nil }
        return ["type": type, "data": result.0.base64EncodedString()]
    }
    private static func imageType(_ bytes: Data) -> String? {
        let b = [UInt8](bytes.prefix(12))
        if b.starts(with: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) { return "image/png" }
        if b.starts(with: [0xFF, 0xD8, 0xFF]) { return "image/jpeg" }
        if b.starts(with: Array("GIF87a".utf8)) || b.starts(with: Array("GIF89a".utf8)) { return "image/gif" }
        if b.count == 12 && b.starts(with: Array("RIFF".utf8)) && Array(b[8..<12]) == Array("WEBP".utf8) { return "image/webp" }
        return nil
    }
    private func file(_ args: [String: Any]) throws -> [String: Any] {
        guard let value = args["file"] as? [String: Any] else { throw PinItAnywhereFailure("invalid-source-file", "The sync file isn't valid.") }
        if value["datasetId"] != nil { return try PinItAnywhereDataset.file(value) }
        let id = try PinItAnywhereProtocol.text(value, "id"), kind = try PinItAnywhereProtocol.text(value, "kind"), digest = try PinItAnywhereProtocol.text(value, "sha256")
        try PinItAnywhereProtocol.require(id.range(of: "^[A-Za-z0-9_-]{1,256}$", options: .regularExpression) != nil && ["revision", "attachment", "reset", "workspace"].contains(kind) && PinItAnywhereProtocol.isDigest(digest), "invalid-source-file", "The sync file ID isn't valid.")
        let size = try PinItAnywhereProtocol.number(value, "size", Int64(["revision", "workspace"].contains(kind) ? 8 * 1024 * 1024 : kind == "reset" ? 4096 : PinItAnywhereProtocol.attachment)); return ["id": id, "kind": kind, "sha256": digest, "size": size]
    }
    private func metadata(_ value: [String: Any], _ file: [String: Any]) throws {
        if file["datasetId"] != nil { return try PinItAnywhereDataset.verify(value, file) }
        guard let properties = value["appProperties"] as? [String: Any], let spaces = value["spaces"] as? [String] else { throw PinItAnywhereFailure("upload-mismatch", "The Google file's metadata is incomplete.") }
        try PinItAnywhereProtocol.require(PinItAnywhereProtocol.text(value, "id") == PinItAnywhereProtocol.text(file, "id") && PinItAnywhereProtocol.text(value, "size") == String(PinItAnywhereProtocol.number(file, "size"))
            && spaces.contains("appDataFolder") && (value["trashed"] == nil || PinItAnywhereProtocol.bool(value, "trashed") == false)
            && PinItAnywhereProtocol.text(properties, "piaFormat") == "pin-it-anywhere-file" && PinItAnywhereProtocol.text(properties, "piaSchema") == "1" && PinItAnywhereProtocol.text(properties, "piaKind") == PinItAnywhereProtocol.text(file, "kind") && PinItAnywhereProtocol.text(properties, "piaSha256") == PinItAnywhereProtocol.text(file, "sha256")
            && (value["sha256Checksum"] == nil || PinItAnywhereProtocol.text(value, "sha256Checksum") == PinItAnywhereProtocol.text(file, "sha256")), "upload-mismatch", "The Google file's metadata doesn't match its contents.")
    }
    func invoke(_ method: String, _ args: [String: Any], bytes: Data? = nil) async throws -> Any {
        try PinItAnywhereProtocol.require(PinItAnywhereProtocol.text(args, "accountId") == account && !closed, "stale-session", "The Google account has changed.")
        var method = method
        if method == "google.dataset.list" {
            guard let selector = args["query"] as? [String: Any] else { throw PinItAnywhereFailure("invalid-source-file", "The dataset query isn't valid.") }
            var fields = [("spaces", "appDataFolder"), ("q", try PinItAnywhereDataset.query(selector)), ("pageSize", "100"), ("fields", "nextPageToken,incompleteSearch,files(\(Self.fields))")]
            if selector["scope"] as? String == "history" { fields.append(("orderBy", "createdTime desc")) }
            if args["pageToken"] != nil && !(args["pageToken"] is NSNull) { fields.append(("pageToken", try PinItAnywhereProtocol.text(args, "pageToken", 8192))) }
            return try await json(path("/drive/v3/files", fields), context: "listing")
        }
        if method == "google.dataset.get" {
            let id = try PinItAnywhereProtocol.text(args, "fileId"); try PinItAnywhereDataset.check(PinItAnywhereDataset.fileID(id))
            return try await json(path("/drive/v3/files/" + id, [("fields", Self.fields)]))
        }
        if method == "google.dataset.folder" {
            let file = try self.file(args); try PinItAnywhereDataset.check(["folder", "dataset-root"].contains(PinItAnywhereProtocol.text(file, "kind")))
            let metadata = try PinItAnywhereDataset.metadata(file); let value: [String: Any]
            do { value = try PinItAnywhereProtocol.json((await request(path("/drive/v3/files", [("fields", Self.fields)]), method: "POST", body: PinItAnywhereProtocol.encode(metadata), headers: ["Content-Type": "application/json; charset=UTF-8"])).0) }
            catch let error as PinItAnywhereFailure where error.code == "file-exists" { value = try await json(path("/drive/v3/files/" + PinItAnywhereProtocol.text(file, "id"), [("fields", Self.fields)])) }
            try PinItAnywhereDataset.verify(value, file); return value
        }
        if ["google.dataset.read", "google.dataset.create"].contains(method) {
            let file = try self.file(args); try PinItAnywhereDataset.check(file["datasetId"] != nil && !["folder", "dataset-root"].contains(PinItAnywhereProtocol.text(file, "kind")))
            method = method == "google.dataset.read" ? "google.read" : "google.create"
        } else if method == "google.dataset.changes" { method = "google.changes" }
        switch method {
        case "google.cursor": return try await json(path("/drive/v3/changes/startPageToken", [("fields", "startPageToken")]))
        case "google.list":
            var fields = [("spaces", "appDataFolder"), ("q", "trashed = false"), ("pageSize", "100"), ("fields", "nextPageToken,incompleteSearch,files(\(Self.fields))")]
            if args["pageToken"] != nil && !(args["pageToken"] is NSNull) { fields.append(("pageToken", try PinItAnywhereProtocol.text(args, "pageToken", 8192))) }
            return try await json(path("/drive/v3/files", fields), context: "listing")
        case "google.changes": return try await json(path("/drive/v3/changes", [("pageToken", PinItAnywhereProtocol.text(args, "cursor", 8192)), ("spaces", "appDataFolder"), ("pageSize", "100"), ("includeRemoved", "true"), ("fields", "nextPageToken,newStartPageToken,changes(fileId,removed,file(\(Self.fields),mimeType))")]), context: "changes")
        case "google.allocate":
            let count = try PinItAnywhereProtocol.number(["count": args["count"] ?? 1], "count", 100)
            try PinItAnywhereDataset.check(count > 0)
            return try await json(path("/drive/v3/files/generateIds", [("count", String(count)), ("space", "appDataFolder"), ("type", "files"), ("fields", "ids")]))
        case "google.profile": return try await profile()
        case "google.read":
            let file = try self.file(args), id = try PinItAnywhereProtocol.text(file, "id"), size = Int(try PinItAnywhereProtocol.number(file, "size"))
            try metadata(await json(path("/drive/v3/files/" + id, [("fields", Self.fields)])), file)
            let data = try await request(path("/drive/v3/files/" + id, [("alt", "media")]), maximum: max(size, 65536)).0
            try PinItAnywhereProtocol.require(data.count == size && PinItAnywhereProtocol.digest(data) == PinItAnywhereProtocol.text(file, "sha256"), "file-integrity", "The Google file failed its checksum."); return data
        case "google.deleteBatch":
            let body = try PinItAnywhereDataset.deleteBatch(args["fileIds"])
            return try await request("/batch/drive/v3", method: "POST", body: body,
                headers: ["Content-Type": "multipart/mixed; boundary=pin_it_anywhere_delete"]).0
        case "google.delete":
            // Reset only: files in the app data folder are removed one by one; one that is already gone counts as deleted.
            let id = try PinItAnywhereProtocol.text(args, "fileId")
            try PinItAnywhereProtocol.require(id.range(of: "^[A-Za-z0-9_-]{1,256}$", options: .regularExpression) != nil, "invalid-source-file", "The sync file ID isn't valid.")
            do { _ = try await request("/drive/v3/files/" + id, method: "DELETE", context: "delete") }
            catch let failure as PinItAnywhereFailure where failure.code == "file-missing" { }
            return NSNull()
        case "google.create":
            let file = try self.file(args); guard let bytes else { throw PinItAnywhereFailure("transfer-missing", "The file contents to upload are missing.") }
            try PinItAnywhereProtocol.require(bytes.count == PinItAnywhereProtocol.number(file, "size") && PinItAnywhereProtocol.digest(bytes) == PinItAnywhereProtocol.text(file, "sha256"), "file-integrity", "The file to upload failed its checksum.")
            return try await create(file, bytes)
        default: throw PinItAnywhereFailure("unsupported-method", "The Google host does not support this operation.")
        }
    }
    private func completed(_ bytes: Data, _ file: [String: Any]) async throws -> [String: Any] {
        let value = try PinItAnywhereProtocol.json(bytes); try metadata(value, file)
        if value["sha256Checksum"] == nil {
            let data = try await request(path("/drive/v3/files/" + PinItAnywhereProtocol.text(file, "id"), [("alt", "media")]), maximum: max(65536, Int(PinItAnywhereProtocol.number(file, "size")))).0
            try PinItAnywhereProtocol.require(data.count == PinItAnywhereProtocol.number(file, "size") && PinItAnywhereProtocol.digest(data) == PinItAnywhereProtocol.text(file, "sha256"), "upload-mismatch", "The Google upload failed its checksum.")
        }
        uploads.removeValue(forKey: try PinItAnywhereProtocol.text(file, "id")); return value
    }
    private func offset(_ response: HTTPURLResponse, maximum: Int, previous: Int) throws -> Int {
        var offset = 0
        if let range = response.value(forHTTPHeaderField: "Range") {
            try PinItAnywhereProtocol.require(range.range(of: "^bytes=0-[0-9]+$", options: .regularExpression) != nil, "invalid-upload-range", "Google's resumable upload progress isn't valid.")
            guard let end = Int(range.dropFirst(8)), end < Int.max else { throw PinItAnywhereFailure("invalid-upload-range", "Google's resumable upload progress is out of range.") }; offset = end + 1
        }
        try PinItAnywhereProtocol.require(offset <= maximum && offset > previous, "service-unavailable", "Google hasn't confirmed new upload progress."); return offset
    }
    private func create(_ file: [String: Any], _ bytes: Data) async throws -> [String: Any] {
        let id = try PinItAnywhereProtocol.text(file, "id"), digest = try PinItAnywhereProtocol.text(file, "sha256"), kind = try PinItAnywhereProtocol.text(file, "kind"), size = Int(try PinItAnywhereProtocol.number(file, "size"))
        let metadata: [String: Any] = file["datasetId"] != nil ? try PinItAnywhereDataset.metadata(file) : ["id": id, "name": "pin-it-anywhere-v1-\(kind)-\(digest).bin", "mimeType": "application/octet-stream", "parents": ["appDataFolder"], "appProperties": ["piaFormat": "pin-it-anywhere-file", "piaSchema": "1", "piaKind": kind, "piaSha256": digest]]
        let json = try PinItAnywhereProtocol.encode(metadata), mime = try PinItAnywhereProtocol.text(metadata, "mimeType")
        do {
            if size == 0 {
                let boundary = "wf_" + PinItAnywhereProtocol.uuid(); let body = Data("--\(boundary)\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n\(String(data: json, encoding: .utf8)!)\r\n--\(boundary)\r\nContent-Type: \(mime)\r\n\r\n\r\n--\(boundary)--\r\n".utf8)
                return try await completed(request(path("/upload/drive/v3/files", [("uploadType", "multipart"), ("fields", Self.fields)]), method: "POST", body: body, headers: ["Content-Type": "multipart/related; boundary=" + boundary]).0, file)
            }
            var position = 0, session = uploads[id]
            if let saved = session {
                try PinItAnywhereProtocol.require(saved.digest == digest && saved.size == size, "upload-mismatch", "The resumed upload differs from the original upload.")
                let (data, response) = try await request(saved.path, method: "PUT", body: Data(), headers: ["Content-Range": "bytes */\(size)"], allow308: true, context: "upload")
                if response.statusCode != 308 { return try await completed(data, file) }; position = try offset(response, maximum: size, previous: -1)
            } else {
                let (_, response) = try await request(path("/upload/drive/v3/files", [("uploadType", "resumable"), ("fields", Self.fields)]), method: "POST", body: json, headers: ["Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mime, "X-Upload-Content-Length": String(size)])
                guard let location = response.value(forHTTPHeaderField: "Location"), location.utf8.count <= 8192, let uri = URLComponents(string: location), uri.scheme == "https", uri.host == "www.googleapis.com", uri.port == nil || uri.port == 443,
                    uri.path == "/upload/drive/v3/files", uri.user == nil, uri.password == nil, uri.fragment == nil, let query = uri.percentEncodedQuery else { throw PinItAnywhereFailure("invalid-upload-session", "Google's resumable upload address isn't valid.") }
                // Google echoes the request's own parameters (fields) and adds its own (session_crd) beside upload_id, so any
                // distinct plain parameters are accepted; where the contents and the token go is what stays fixed.
                // URLComponents leaves commas in fields unescaped, and Google's Location can echo those literal commas.
                let pairs = query.split(separator: "&", omittingEmptySubsequences: false).map(String.init)
                try PinItAnywhereProtocol.require(pairs.allSatisfy { $0.range(of: "^[A-Za-z_]+=[A-Za-z0-9_%.,-]*$", options: .regularExpression) != nil }
                    && Set(pairs.map { pair in pair.prefix { $0 != "=" } }).count == pairs.count
                    && pairs.contains("uploadType=resumable") && pairs.contains { $0.hasPrefix("upload_id=") && $0.count > 10 }, "invalid-upload-session", "Google's resumable upload address isn't valid.")
                session = (uri.percentEncodedPath + "?" + query, digest, size); uploads[id] = session
            }
            while position < size {
                let end = min(position + 1024 * 1024, size)
                let (data, response) = try await request(session!.path, method: "PUT", body: bytes.subdata(in: position..<end), headers: ["Content-Type": mime, "Content-Range": "bytes \(position)-\(end - 1)/\(size)"], allow308: true, context: "upload")
                if response.statusCode != 308 { return try await completed(data, file) }; position = try offset(response, maximum: end, previous: position)
            }
            throw PinItAnywhereFailure("service-unavailable", "Google hasn't confirmed the upload. Pending changes are kept.")
        } catch let error as PinItAnywhereFailure {
            if ["file-exists", "unauthorized", "source-permission", "source-error", "upload-session-expired", "storage-quota", "source-item-limit"].contains(error.code) { uploads.removeValue(forKey: id) }; throw error
        }
    }
}
