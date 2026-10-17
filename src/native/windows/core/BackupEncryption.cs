using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;

namespace WorkFleet.Windows.Core;

/// <summary>SPEC-002 portable envelope. Passwords never return through the renderer bridge.</summary>
public static class BackupEncryption
{
  private static readonly UTF8Encoding Utf8 = new(false, true);
  public static byte[] Password(string password)
  {
    HostError.Require(password.Length <= 1024, "backup-password", "Backup passwords can be at most 1,024 characters.");
    byte[] bytes;
    try { bytes = Utf8.GetBytes(password); }
    catch (EncoderFallbackException) { throw new HostError("backup-password", "The backup password contains invalid characters."); }
    if (password.EnumerateRunes().Count() >= 12) return bytes;
    CryptographicOperations.ZeroMemory(bytes); throw new HostError("backup-password", "Backup passwords need at least 12 characters.");
  }
  public static byte[] Encrypt(byte[] plaintext, byte[] password)
  {
    HostError.Require(plaintext.Length is > 0 and <= 136 * 1024 * 1024, "backup-limit", "The backup to encrypt has an invalid size.");
    var salt = RandomNumberGenerator.GetBytes(16); var nonce = RandomNumberGenerator.GetBytes(12);
    // All fields are fixed ASCII or lowercase hex. This order is the canonical JSON AAD used by the portable reader.
    var aad = Utf8.GetBytes("{\"cipher\":\"AES-256-GCM\",\"format\":\"work-fleet-encrypted-backup\",\"iterations\":600000,\"kdf\":\"PBKDF2-HMAC-SHA256\",\"nonce\":\""
      + Convert.ToHexString(nonce).ToLowerInvariant() + "\",\"salt\":\"" + Convert.ToHexString(salt).ToLowerInvariant() + "\",\"schemaVersion\":1,\"tagBits\":128}");
    var key = Rfc2898DeriveBytes.Pbkdf2(password, salt, 600000, HashAlgorithmName.SHA256, 32);
    var ciphertext = new byte[plaintext.Length + 16];
    try
    {
      using var cipher = new AesGcm(key, 16);
      cipher.Encrypt(nonce, plaintext, ciphertext.AsSpan(0, plaintext.Length), ciphertext.AsSpan(plaintext.Length), aad);
      using var output = new MemoryStream();
      using (var zip = new ZipArchive(output, ZipArchiveMode.Create, leaveOpen: true))
      {
        Add(zip, "encryption.json", aad); Add(zip, "payload.bin", ciphertext);
      }
      HostError.Require(output.Length <= WindowsBackupDirectory.MaxBackupBytes, "backup-limit", "The encrypted backup is too large.");
      return output.ToArray();
    }
    finally { CryptographicOperations.ZeroMemory(key); CryptographicOperations.ZeroMemory(ciphertext); }
  }
  private static void Add(ZipArchive archive, string name, byte[] bytes)
  {
    var entry = archive.CreateEntry(name, CompressionLevel.NoCompression);
    entry.LastWriteTime = new DateTimeOffset(1980, 1, 1, 0, 0, 0, TimeSpan.Zero);
    using var stream = entry.Open(); stream.Write(bytes);
  }
}
