import Foundation
import GoogleSignIn
#if os(macOS)
import AppKit
#else
import UIKit
#endif

@MainActor final class FleetGoogle {
    static let scope = "https://www.googleapis.com/auth/drive.appdata"
    let clientID: String
    let profile: String
    private var account: [String: Any]?
    private var prepared: String?
    private var closed = false
    #if os(macOS)
    var presenting: (() -> NSWindow?)?
    #else
    var presenting: (() -> UIViewController?)?
    #endif
    init(profile: String, config: [String: Any]) throws {
        self.profile = profile
        #if os(macOS)
        let platform = "macos"
        #else
        let platform = "ios"
        #endif
        let clients = (config["google"] as? [String: Any])?["clients"] as? [String: Any] ?? [:]
        clientID = clients[platform] as? String ?? ""
        if !clientID.isEmpty { GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID) }
        if profile.hasPrefix("google:"), let bytes = try FleetKeychain.read("google-account:" + String(profile.dropFirst(7))) {
            let saved = try FleetProtocol.json(bytes); if saved["clientID"] as? String == clientID && saved["accountId"] as? String == String(profile.dropFirst(7)) { account = saved }
        }
    }
    var available: Bool { !clientID.isEmpty }
    func status() -> [String: Any] { ["configured": available, "connected": account != nil, "accountId": account?["accountId"] ?? NSNull(), "email": account?["email"] ?? NSNull(), "profileId": profile] }
    func signIn() async throws -> [String: Any] {
        try FleetProtocol.require(!closed && available, "google-config", "Set the Apple Google client ID and rebuild the app.")
        guard let presenter = presenting?() else { throw FleetFailure("google-unavailable", "The sign-in screen isn't available right now.") }
        // Interactive sign-in already opens the account chooser. Keep the existing SDK session if the user cancels.
        prepared = nil
        let result: GIDSignInResult = try await withCheckedThrowingContinuation { continuation in
            GIDSignIn.sharedInstance.signIn(withPresenting: presenter, hint: nil, additionalScopes: [Self.scope]) { result, error in
                if let error { continuation.resume(throwing: Self.failure(error)) }
                else if let result { continuation.resume(returning: result) }
                else { continuation.resume(throwing: FleetFailure("google-cancelled", "Google sign-in didn't finish.")) }
            }
        }
        try FleetProtocol.require(!closed && result.user.grantedScopes?.contains(Self.scope) == true, "source-permission", "Access to Google app data wasn't granted.")
        let identity = try await identify(result.user.accessToken.tokenString)
        let id = try FleetProtocol.text(identity, "sub", 255); try FleetProtocol.require(FleetProtocol.isAccount(id), "google-account", "The Google account ID isn't valid.")
        let saved: [String: Any] = ["accountId": id, "email": identity["email"] as? String ?? "", "clientID": clientID]
        try FleetKeychain.save("google-account:" + id, FleetProtocol.encode(saved)); prepared = id
        return ["accountId": id, "email": saved["email"]!, "profileId": "google:" + id]
    }
    private func identify(_ token: String) async throws -> [String: Any] {
        var request = URLRequest(url: URL(string: "https://openidconnect.googleapis.com/v1/userinfo")!); request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        let bytes: Data, response: HTTPURLResponse
        do { (bytes, response) = try await BoundedHTTP(maximum: 65536).send(request) }
        catch { throw Self.failure(error) }
        try FleetProtocol.require(response.statusCode == 200 && !closed, "unauthorized", "Couldn't confirm the Google account."); return try FleetProtocol.json(bytes)
    }
    func open(_ id: String) throws -> String {
        try FleetProtocol.require(!closed && id == prepared && FleetKeychain.read("google-account:" + id) != nil, "google-account", "Finish signing in to this account first."); prepared = nil; return "google:" + id
    }
    func token(_ expected: String) async throws -> String {
        try FleetProtocol.require(!closed && available && profile == "google:" + expected && account?["accountId"] as? String == expected, "stale-session", "The Google account doesn't match the workspace.")
        let restored: GIDGoogleUser
        if let current = GIDSignIn.sharedInstance.currentUser { restored = current }
        else {
            restored = try await withCheckedThrowingContinuation { continuation in GIDSignIn.sharedInstance.restorePreviousSignIn { user, error in
                if let error { continuation.resume(throwing: Self.failure(error)) }
                else if let user { continuation.resume(returning: user) }
                else { continuation.resume(throwing: FleetFailure("unauthorized", "Sign in to Google again.")) }
            } }
        }
        let user: GIDGoogleUser = try await withCheckedThrowingContinuation { continuation in restored.refreshTokensIfNeeded { user, error in
            if let error { continuation.resume(throwing: Self.failure(error)) }
            else if let user { continuation.resume(returning: user) }
            else { continuation.resume(throwing: FleetFailure("unauthorized", "Google access needs to be renewed.")) }
        } }
        try FleetProtocol.require(!closed && user.grantedScopes?.contains(Self.scope) == true, "unauthorized", "Access to Google app data needs to be confirmed again.")
        let identity = try await identify(user.accessToken.tokenString)
        try FleetProtocol.require(FleetProtocol.text(identity, "sub", 255) == expected, "stale-session", "The Google SDK returned another account. No notes were sent."); return user.accessToken.tokenString
    }
    // Only this device signs out: the SDK's disconnect revokes the project's grant for every client, so every other device
    // signed in to this account would lose sync within the hour (ADR-021, amended 2026-10-15).
    func signOut() async throws {
        if let id = account?["accountId"] as? String { try FleetKeychain.remove("google-account:" + id) }; account = nil
        prepared = nil
        GIDSignIn.sharedInstance.signOut()
    }
    nonisolated private static func failure(_ error: Error) -> FleetFailure {
        if let failure = error as? FleetFailure { return failure }
        let value = error as NSError
        if value.domain == NSURLErrorDomain { return FleetFailure("network", "Couldn't connect to Google. Check your network and try again.") }
        if value.domain == kGIDSignInErrorDomain {
            switch value.code {
            case GIDSignInError.Code.canceled.rawValue: return FleetFailure("google-cancelled", "Google sign-in was cancelled.")
            case GIDSignInError.Code.keychain.rawValue: return FleetFailure("vault-unavailable", "Couldn't save the Google sign-in. Unlock the device and try again.")
            case GIDSignInError.Code.hasNoAuthInKeychain.rawValue, GIDSignInError.Code.refreshTokenExpired.rawValue: return FleetFailure("unauthorized", "Google access has expired. Sign in again.")
            default: break
            }
        }
        return FleetFailure("google-unavailable", "Google sign-in didn't finish. Try again later.")
    }
    func close() { closed = true; prepared = nil }
    static func handle(_ url: URL) -> Bool { GIDSignIn.sharedInstance.handle(url) }
}
