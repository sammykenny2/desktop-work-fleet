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
        try FleetProtocol.require(!closed && available, "google-config", "請設定 Apple Google client ID 並重新建置。")
        guard let presenter = presenting?() else { throw FleetFailure("google-unavailable", "登入畫面目前不可用。") }
        GIDSignIn.sharedInstance.signOut()
        let result: GIDSignInResult = try await withCheckedThrowingContinuation { continuation in
            GIDSignIn.sharedInstance.signIn(withPresenting: presenter, hint: nil, additionalScopes: [Self.scope]) { result, error in
                if let error { continuation.resume(throwing: error) }
                else if let result { continuation.resume(returning: result) }
                else { continuation.resume(throwing: FleetFailure("google-cancelled", "Google 登入未完成。")) }
            }
        }
        try FleetProtocol.require(!closed && result.user.grantedScopes?.contains(Self.scope) == true, "source-permission", "Google App 資料授權未完成。")
        let identity = try await identify(result.user.accessToken.tokenString)
        let id = try FleetProtocol.text(identity, "sub", 255); try FleetProtocol.require(FleetProtocol.isAccount(id), "google-account", "Google 帳號身分無效。")
        let saved: [String: Any] = ["accountId": id, "email": identity["email"] as? String ?? "", "clientID": clientID]
        try FleetKeychain.save("google-account:" + id, FleetProtocol.encode(saved)); prepared = id
        return ["accountId": id, "email": saved["email"]!, "profileId": "google:" + id]
    }
    private func identify(_ token: String) async throws -> [String: Any] {
        var request = URLRequest(url: URL(string: "https://openidconnect.googleapis.com/v1/userinfo")!); request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        let (bytes, response) = try await BoundedHTTP(maximum: 65536).send(request)
        try FleetProtocol.require(response.statusCode == 200 && !closed, "unauthorized", "無法確認 Google 帳號。"); return try FleetProtocol.json(bytes)
    }
    func open(_ id: String) throws -> String {
        try FleetProtocol.require(!closed && id == prepared && FleetKeychain.read("google-account:" + id) != nil, "google-account", "請先完成此帳號登入。"); prepared = nil; return "google:" + id
    }
    func token(_ expected: String) async throws -> String {
        try FleetProtocol.require(!closed && available && profile == "google:" + expected && account?["accountId"] as? String == expected, "stale-session", "Google 帳號與工作空間不同。")
        let restored: GIDGoogleUser
        if let current = GIDSignIn.sharedInstance.currentUser { restored = current }
        else {
            restored = try await withCheckedThrowingContinuation { continuation in GIDSignIn.sharedInstance.restorePreviousSignIn { user, error in
                if let error { continuation.resume(throwing: error) }
                else if let user { continuation.resume(returning: user) }
                else { continuation.resume(throwing: FleetFailure("unauthorized", "請重新登入 Google。")) }
            } }
        }
        let user: GIDGoogleUser = try await withCheckedThrowingContinuation { continuation in restored.refreshTokensIfNeeded { user, error in
            if let error { continuation.resume(throwing: error) }
            else if let user { continuation.resume(returning: user) }
            else { continuation.resume(throwing: FleetFailure("unauthorized", "Google 授權需要更新。")) }
        } }
        try FleetProtocol.require(!closed && user.grantedScopes?.contains(Self.scope) == true, "unauthorized", "Google App 資料授權需要重新確認。")
        let identity = try await identify(user.accessToken.tokenString)
        try FleetProtocol.require(FleetProtocol.text(identity, "sub", 255) == expected, "stale-session", "Google SDK 回傳另一個帳號，未傳送便箋。"); return user.accessToken.tokenString
    }
    // Only this device signs out: the SDK's disconnect revokes the project's grant for every client, so every other device
    // signed in to this account would lose sync within the hour (ADR-021, amended 2026-10-15).
    func signOut() async throws {
        if let id = account?["accountId"] as? String { try FleetKeychain.remove("google-account:" + id) }; account = nil
        GIDSignIn.sharedInstance.signOut()
    }
    func close() { closed = true }
    static func handle(_ url: URL) -> Bool { GIDSignIn.sharedInstance.handle(url) }
}
