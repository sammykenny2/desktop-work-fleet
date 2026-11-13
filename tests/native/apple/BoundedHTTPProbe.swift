import Foundation

@main struct BoundedHTTPProbe {
    static func check(_ value: Bool, _ message: String) throws {
        if !value { throw PinItAnywhereFailure("probe-failed", message) }
    }
    static func main() async throws {
        let base = CommandLine.arguments[1], pool = BoundedHTTPSession()
        defer { pool.close() }
        func request(_ path: String, _ authorization: String? = nil) -> URLRequest {
            var value = URLRequest(url: URL(string: base + path)!)
            if let authorization { value.setValue(authorization, forHTTPHeaderField: "Authorization") }
            return value
        }
        for value in ["fixture-a", "fixture-b", ""] {
            let client = BoundedHTTP(maximum: 128, session: pool)
            let result = try await client.send(request("/echo", value.isEmpty ? nil : value))
            try check(String(data: result.0, encoding: .utf8) == value, "Authorization leaked between requests")
            if value != "fixture-a" { try check((client.metrics?.reusedConnections ?? 0) > 0, "A warm connection was not reused") }
        }
        let redirected = try await BoundedHTTP(maximum: 32, session: pool).send(request("/redirect"))
        try check(redirected.1.statusCode == 302, "A redirect was followed")
        for path in ["/large", "/chunked"] {
            do {
                _ = try await BoundedHTTP(maximum: 32, session: pool).send(request(path))
                throw PinItAnywhereFailure("probe-failed", "Oversized response was accepted")
            } catch let failure as PinItAnywhereFailure { try check(failure.code == "response-size", "Wrong size error") }
        }
        let cancelled = BoundedHTTP(maximum: 32, session: pool); cancelled.cancel()
        do { _ = try await cancelled.send(request("/echo")); throw PinItAnywhereFailure("probe-failed", "Early cancellation was lost") }
        catch is CancellationError { }
        let slow = BoundedHTTP(maximum: 32, session: pool)
        let waiting = Task { try await slow.send(request("/slow")) }
        try await Task.sleep(nanoseconds: 20_000_000); waiting.cancel()
        do { _ = try await waiting.value; throw PinItAnywhereFailure("probe-failed", "In-flight cancellation was lost") }
        catch is CancellationError { }
        _ = try await BoundedHTTP(maximum: 32, session: pool).send(request("/echo"))
        try await withThrowingTaskGroup(of: Void.self) { group in
            for _ in 0..<12 { group.addTask { _ = try await BoundedHTTP(maximum: 32, session: pool).send(request("/echo")) } }
            try await group.waitForAll()
        }
        let retired = BoundedHTTPSession()
        let running = Task { try await BoundedHTTP(maximum: 32, session: retired).send(request("/slow")) }
        try await Task.sleep(nanoseconds: 20_000_000); retired.close()
        do { _ = try await running.value; throw PinItAnywhereFailure("probe-failed", "Retirement left a request running") }
        catch { try check(!(error is PinItAnywhereFailure), "Retirement unexpectedly succeeded") }
        do { _ = try await BoundedHTTP(maximum: 32, session: retired).send(request("/echo")); throw PinItAnywhereFailure("probe-failed", "Retired account admitted work") }
        catch is CancellationError { }
        for _ in 0..<50 {
            let client = BoundedHTTP(maximum: 32, session: pool)
            let task = Task { try await client.send(request("/echo")) }; task.cancel()
            do { _ = try await task.value } catch { }
        }
        print("PASS bounded HTTP reuse, limits, redirects, authorization, concurrency and cancellation")
    }
}
