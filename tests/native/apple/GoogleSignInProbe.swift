import Foundation
import AppKit
import GoogleSignIn

@MainActor enum PinItAnywhereKeychain {
    static var values: [String: Data] = [:]
    static func read(_ id: String) throws -> Data? { values[id] }
    static func save(_ id: String, _ data: Data) throws { values[id] = data }
    static func remove(_ id: String) throws { values.removeValue(forKey: id) }
}
@MainActor final class BoundedHTTP {
    static var failure: Error?
    static var sub = "account"
    static var calls = 0
    static var expectedToken = "synthetic-token"
    init(maximum: Int) {}
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        Self.calls += 1
        if let failure = Self.failure { throw failure }
        precondition(request.url?.absoluteString == "https://openidconnect.googleapis.com/v1/userinfo")
        precondition(request.value(forHTTPHeaderField: "Authorization") == "Bearer " + Self.expectedToken)
        return (try PinItAnywhereProtocol.encode(["sub": Self.sub, "email": "synthetic@example.test"]), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}
@main @MainActor enum GoogleSignInProbe {
    static let client = "123-fixture.apps.googleusercontent.com"
    static func google(_ profile: String = "local") throws -> PinItAnywhereGoogle {
        let result = try PinItAnywhereGoogle(profile: profile, config: ["google": ["clients": ["macos": client]]])
        result.presenting = { NSWindow() }; return result
    }
    static func reject(_ expected: String, _ operation: () async throws -> Void) async throws {
        do { try await operation(); preconditionFailure("Expected rejection") }
        catch let failure as PinItAnywhereFailure {
            precondition(failure.code == expected, "Unexpected code: " + failure.code)
            precondition(!failure.message.contains("private-provider-detail") && !failure.message.contains("synthetic-token"))
        }
    }
    static func run(_ name: String) async throws {
        let sdk = GIDSignIn.sharedInstance
        let previous = GIDGoogleUser(token: "synthetic-token", scopes: [PinItAnywhereGoogle.scope])
        sdk.currentUser = previous
        switch name {
        case "cold-concurrent":
            try PinItAnywhereKeychain.save("google-account:account", PinItAnywhereProtocol.encode(["clientID": client, "accountId": "account"]))
            sdk.currentUser = nil; sdk.nextUser = previous; sdk.deferRestore = true
            let host = try google("google:account")
            let first = Task { try await host.token("account") }, second = Task { try await host.token("account") }
            for _ in 0..<20 { await Task.yield() }
            precondition(sdk.restoreCalls == 1, "Concurrent cold requests started overlapping SDK restores")
            sdk.completeRestore()
            let values = try await [first.value, second.value]
            precondition(values == ["synthetic-token", "synthetic-token"])
            precondition(previous.refreshCalls == 1 && BoundedHTTP.calls == 1, "Concurrent requests duplicated token verification")
            _ = try await host.token("account")
            precondition(BoundedHTTP.calls == 1, "An unchanged verified token repeated the identity request")
            sdk.currentUser = GIDGoogleUser(token: "synthetic-next-token", scopes: [PinItAnywhereGoogle.scope])
            BoundedHTTP.expectedToken = "synthetic-next-token"; BoundedHTTP.sub = "other-account"
            try await reject("stale-session") { _ = try await host.token("account") }
            precondition(BoundedHTTP.calls == 2, "A changed token skipped identity verification")
        case "cold-retry":
            try PinItAnywhereKeychain.save("google-account:account", PinItAnywhereProtocol.encode(["clientID": client, "accountId": "account"]))
            sdk.currentUser = nil; sdk.nextUser = previous; sdk.deferRestore = true
            sdk.nextError = URLError(.notConnectedToInternet)
            let host = try google("google:account")
            let first = Task { try await host.token("account") }, second = Task { try await host.token("account") }
            for _ in 0..<20 { await Task.yield() }
            precondition(sdk.restoreCalls == 1)
            sdk.completeRestore()
            try await reject("network") { _ = try await first.value }
            try await reject("network") { _ = try await second.value }
            sdk.nextError = nil
            let retry = Task { try await host.token("account") }
            for _ in 0..<20 { await Task.yield() }
            precondition(sdk.restoreCalls == 2)
            sdk.completeRestore()
            let token = try await retry.value; precondition(token == "synthetic-token")
        case "cold-host-replacement":
            try PinItAnywhereKeychain.save("google-account:account", PinItAnywhereProtocol.encode(["clientID": client, "accountId": "account"]))
            sdk.currentUser = nil; sdk.nextUser = previous; sdk.deferRestore = true
            let old = try google("google:account"), next = try google("google:account")
            let first = Task { try await old.token("account") }
            for _ in 0..<20 { await Task.yield() }
            old.close()
            let second = Task { try await next.token("account") }
            for _ in 0..<20 { await Task.yield() }
            precondition(sdk.restoreCalls == 1, "Replacing the host overlapped SDK restoration")
            sdk.completeRestore()
            try await reject("stale-session") { _ = try await first.value }
            let token = try await second.value; precondition(token == "synthetic-token")
            precondition(BoundedHTTP.calls == 1, "A closed host continued with network authorization")
        case "cancel":
            try PinItAnywhereKeychain.save("google-account:account", PinItAnywhereProtocol.encode(["clientID": client, "accountId": "account", "email": "synthetic@example.test"]))
            let host = try google("google:account")
            sdk.nextError = NSError(domain: kGIDSignInErrorDomain, code: GIDSignInError.Code.canceled.rawValue)
            try await reject("google-cancelled") { _ = try await host.signIn() }
            precondition(sdk.signOuts == 0 && sdk.currentUser === previous)
            precondition(host.status()["connected"] as? Bool == true)
            let token = try await host.token("account"); precondition(token == "synthetic-token")
        case "success":
            let host = try google(); sdk.nextUser = previous
            let account = try await host.signIn()
            precondition(account["profileId"] as? String == "google:account")
            precondition(sdk.requestedScopes == [PinItAnywhereGoogle.scope])
            let profile = try host.open("account"); precondition(profile == "google:account")
            try await reject("google-account") { _ = try host.open("account") }
            let metadata = try PinItAnywhereProtocol.json(PinItAnywhereKeychain.values["google-account:account"]!)
            precondition(metadata["accountId"] as? String == "account" && metadata["accessToken"] == nil)
        case "scope-denied":
            let host = try google(); sdk.nextUser = GIDGoogleUser(token: "synthetic-token", scopes: [])
            try await reject("source-permission") { _ = try await host.signIn() }
            precondition(PinItAnywhereKeychain.values.isEmpty)
        case "closed":
            let host = try google(); sdk.nextUser = previous; sdk.beforeResult = { host.close() }
            try await reject("source-permission") { _ = try await host.signIn() }
            precondition(PinItAnywhereKeychain.values.isEmpty)
        case "wrong-account":
            try PinItAnywhereKeychain.save("google-account:account", PinItAnywhereProtocol.encode(["clientID": client, "accountId": "account"]))
            let host = try google("google:account"); BoundedHTTP.sub = "other-account"
            try await reject("stale-session") { _ = try await host.token("account") }
        case "errors":
            let host = try google()
            for (error, code) in [(NSError(domain: kGIDSignInErrorDomain, code: GIDSignInError.Code.keychain.rawValue), "vault-unavailable"),
                (NSError(domain: kGIDSignInErrorDomain, code: GIDSignInError.Code.refreshTokenExpired.rawValue), "unauthorized"),
                (NSError(domain: "provider", code: 1, userInfo: [NSLocalizedDescriptionKey: "private-provider-detail"]), "google-unavailable")] {
                sdk.nextError = error; try await reject(code) { _ = try await host.signIn() }
            }
            sdk.nextError = nil; sdk.nextUser = previous; BoundedHTTP.failure = URLError(.notConnectedToInternet)
            try await reject("network") { _ = try await host.signIn() }
        default: preconditionFailure("Unknown probe")
        }
    }
    static func main() async {
        do { let name = CommandLine.arguments[1]; try await run(name); print("PASS " + name) }
        catch { fputs("FAIL \(error)\n", stderr); exit(1) }
    }
}
