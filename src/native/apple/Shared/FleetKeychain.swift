import Foundation
import Security
import CryptoKit

enum FleetKeychain {
    static var service: String { (Bundle.main.bundleIdentifier ?? "app.workfleet.preview") + ".native.v1" }
    private static func query(_ id: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: id, kSecUseDataProtectionKeychain as String: true]
    }
    static func read(_ id: String) throws -> Data? {
        var request = query(id); request[kSecReturnData as String] = true; request[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?; let status = SecItemCopyMatching(request as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        try FleetProtocol.require(status == errSecSuccess && result is Data, "vault-unavailable", "Couldn't read the Apple Keychain. Unlock the device and try again."); return result as? Data
    }
    static func save(_ id: String, _ bytes: Data) throws {
        let request = query(id); let changed = SecItemUpdate(request as CFDictionary, [kSecValueData as String: bytes] as CFDictionary)
        if changed == errSecItemNotFound {
            var create = request; create[kSecValueData as String] = bytes; create[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            try FleetProtocol.require(SecItemAdd(create as CFDictionary, nil) == errSecSuccess, "vault-unavailable", "Couldn't save to the Apple Keychain.")
        } else { try FleetProtocol.require(changed == errSecSuccess, "vault-unavailable", "Couldn't update the Apple Keychain.") }
    }
    static func remove(_ id: String) throws {
        let status = SecItemDelete(query(id) as CFDictionary); try FleetProtocol.require(status == errSecSuccess || status == errSecItemNotFound, "vault-unavailable", "Couldn't remove the sign-in from the Apple Keychain.")
    }
    static func storageKey(existing: Bool) throws -> SymmetricKey {
        if let saved = try read("storage-key") { try FleetProtocol.require(saved.count == 32, "vault-unavailable", "The local encryption key isn't valid."); return SymmetricKey(data: saved) }
        try FleetProtocol.require(!existing, "vault-unavailable", "The local key is no longer valid. Keep the original data and restore from a portable backup.")
        let key = SymmetricKey(size: .bits256); let bytes = key.withUnsafeBytes { Data($0) }; try save("storage-key", bytes); return key
    }
}
