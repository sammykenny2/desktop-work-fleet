import Foundation
import AppKit
import GoogleSignIn

@MainActor enum FleetKeychain {
    static var values: [String: Data] = [:]
    static func read(_ id: String) throws -> Data? { values[id] }
    static func save(_ id: String, _ data: Data) throws { values[id] = data }
    static func remove(_ id: String) throws { values.removeValue(forKey: id) }
}
@MainActor final class BoundedHTTP {
    static var failure: Error?
    static var sub = "account"
    init(maximum: Int) {}
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        if let failure = Self.failure { throw failure }
        precondition(request.url?.absoluteString == "https://openidconnect.googleapis.com/v1/userinfo")
        precondition(request.value(forHTTPHeaderField: "Authorization") == "Bearer synthetic-token")
        return (try FleetProtocol.encode(["sub": Self.sub, "email": "synthetic@example.test"]), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
    }
}
@main @MainActor enum GoogleSignInProbe {
    static let client = "123-fixture.apps.googleusercontent.com"
    static func google(_ profile: String = "local") throws -> FleetGoogle {
        let result = try FleetGoogle(profile: profile, config: ["google": ["clients": ["macos": client]]])
        result.presenting = { NSWindow() }; return result
    }
    static func reject(_ expected: String, _ operation: () async throws -> Void) async throws {
        do { try await operation(); preconditionFailure("Expected rejection") }
        catch let failure as FleetFailure {
            precondition(failure.code == expected, "Unexpected code: " + failure.code)
            precondition(!failure.message.contains("private-provider-detail") && !failure.message.contains("synthetic-token"))
        }
    }
    static func run(_ name: String) async throws {
        let sdk = GIDSignIn.sharedInstance
        let previous = GIDGoogleUser(token: "synthetic-token", scopes: [FleetGoogle.scope])
        sdk.currentUser = previous
        switch name {
        case "cancel":
            try FleetKeychain.save("google-account:account", FleetProtocol.encode(["clientID": client, "accountId": "account", "email": "synthetic@example.test"]))
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
            precondition(sdk.requestedScopes == [FleetGoogle.scope])
            let profile = try host.open("account"); precondition(profile == "google:account")
            try await reject("google-account") { _ = try host.open("account") }
            let metadata = try FleetProtocol.json(FleetKeychain.values["google-account:account"]!)
            precondition(metadata["accountId"] as? String == "account" && metadata["accessToken"] == nil)
        case "scope-denied":
            let host = try google(); sdk.nextUser = GIDGoogleUser(token: "synthetic-token", scopes: [])
            try await reject("source-permission") { _ = try await host.signIn() }
            precondition(FleetKeychain.values.isEmpty)
        case "closed":
            let host = try google(); sdk.nextUser = previous; sdk.beforeResult = { host.close() }
            try await reject("source-permission") { _ = try await host.signIn() }
            precondition(FleetKeychain.values.isEmpty)
        case "wrong-account":
            try FleetKeychain.save("google-account:account", FleetProtocol.encode(["clientID": client, "accountId": "account"]))
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
