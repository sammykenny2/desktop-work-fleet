import Foundation
import AppKit

public let kGIDSignInErrorDomain = "com.google.GIDSignIn"
public enum GIDSignInError { public enum Code: Int { case keychain = -2, hasNoAuthInKeychain = -4, canceled = -5, refreshTokenExpired = -11 } }
public final class GIDConfiguration { public let clientID: String; public init(clientID: String) { self.clientID = clientID } }
public final class GIDToken { public let tokenString: String; public init(_ token: String) { tokenString = token } }
@MainActor public final class GIDGoogleUser {
    public var grantedScopes: [String]?
    public let accessToken: GIDToken
    public var refreshError: Error?
    public private(set) var refreshCalls = 0
    public init(token: String, scopes: [String]) { accessToken = GIDToken(token); grantedScopes = scopes }
    public func refreshTokensIfNeeded(completion: (GIDGoogleUser?, Error?) -> Void) { refreshCalls += 1; completion(refreshError == nil ? self : nil, refreshError) }
}
public final class GIDSignInResult { public let user: GIDGoogleUser; public init(_ user: GIDGoogleUser) { self.user = user } }
@MainActor public final class GIDSignIn {
    public static let sharedInstance = GIDSignIn()
    public var configuration: GIDConfiguration?
    public var currentUser: GIDGoogleUser?
    public var nextUser: GIDGoogleUser?
    public var nextError: Error?
    public var beforeResult: (() -> Void)?
    public private(set) var signOuts = 0
    public private(set) var requestedScopes: [String]?
    public var deferRestore = false
    public private(set) var restoreCalls = 0
    private var restoreCompletion: ((GIDGoogleUser?, Error?) -> Void)?
    public func signOut() { signOuts += 1; currentUser = nil }
    public func signIn(withPresenting: NSWindow, hint: String?, additionalScopes: [String]?, completion: (GIDSignInResult?, Error?) -> Void) {
        requestedScopes = additionalScopes; beforeResult?()
        if let error = nextError { completion(nil, error) }
        else if let user = nextUser { currentUser = user; completion(GIDSignInResult(user), nil) }
        else { completion(nil, nil) }
    }
    public func restorePreviousSignIn(completion: @escaping (GIDGoogleUser?, Error?) -> Void) {
        restoreCalls += 1
        // The SDK keeps one current-options completion for a cold restore. An overlapping restore replaces it.
        if deferRestore { restoreCompletion = completion; return }
        completion(currentUser, nextError)
    }
    public func completeRestore() {
        currentUser = nextError == nil ? nextUser : nil
        let completion = restoreCompletion; restoreCompletion = nil
        completion?(currentUser, nextError)
    }
    public func handle(_ url: URL) -> Bool { true }
}
