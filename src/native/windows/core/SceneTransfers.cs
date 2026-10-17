using System.Security.Cryptography;

namespace WorkFleet.Windows.Core;

/// <summary>Ephemeral, principal-bound scene bytes. No filesystem, vault or storage methods exist here.</summary>
public sealed class SceneTransfers : IDisposable
{
  public const int MaxFrame = 128 * 1024 * 1024;
  public const int MaxCommand = 16 * 1024 * 1024;
  private const long Budget = 384L * 1024 * 1024;
  private sealed class Entry(string owner, byte[] bytes, string digest, bool frame, int written = 0, bool sealedValue = false)
  {
    public string Owner = owner, Digest = digest;
    public byte[] Bytes = bytes;
    public int Written = written;
    public bool Sealed = sealedValue;
    public bool Retained;
    public bool Frame = frame;
    public DateTime Used = DateTime.UtcNow;
  }
  private readonly Dictionary<string, Entry> entries = new(StringComparer.Ordinal);
  private bool disposed;

  public string Begin(string owner, int size, string digest, int maximum)
  {
    ObjectDisposedException.ThrowIf(disposed, this); Sweep(); LocalDatabase.CheckDigest(digest);
    HostError.Require(size > 0 && size <= maximum && maximum <= MaxFrame, "scene-size", "The desktop transfer size is invalid.");
    HostError.Require(entries.Count < 192 && entries.Values.Select(e => e.Bytes).Distinct().Sum(b => (long)b.Length) + size <= Budget,
      "scene-busy", "A desktop frame is still transferring. Try again shortly.");
    var frame = maximum == MaxFrame;
    // A full-size frame must leave admission room for final editor writes needed by a flush barrier.
    HostError.Require(entries.Values.Where(e => e.Frame == frame).Select(e => e.Bytes).Distinct().Sum(b => (long)b.Length) + size
      <= (frame ? 320L : 64L) * 1024 * 1024, "scene-busy", "Desktop transfers are still in progress. Try again shortly.");
    var token = Guid.NewGuid().ToString(); entries.Add(token, new Entry(owner, new byte[size], digest, frame)); return token;
  }
  public int Append(string owner, string token, int offset, string base64)
  {
    var entry = Get(owner, token);
    HostError.Require(!entry.Sealed && offset == entry.Written, "scene-offset", "The desktop transfer arrived out of order.");
    HostError.Require(base64.Length <= BridgeSession.ChunkSize * 4 / 3 + 4, "scene-size", "A desktop transfer chunk is too large.");
    var bytes = Convert.FromBase64String(base64);
    try
    {
      HostError.Require(bytes.Length is > 0 and <= BridgeSession.ChunkSize && entry.Written + bytes.Length <= entry.Bytes.Length,
        "scene-size", "The desktop transfer is larger than declared.");
      bytes.CopyTo(entry.Bytes, entry.Written); entry.Written += bytes.Length; return entry.Written;
    }
    finally { CryptographicOperations.ZeroMemory(bytes); }
  }
  public ReadOnlyMemory<byte> Seal(string owner, string token)
  {
    var entry = Get(owner, token);
    HostError.Require(entry.Written == entry.Bytes.Length, "scene-incomplete", "The desktop transfer is incomplete.");
    if (!entry.Sealed)
    {
      HostError.Require(LocalDatabase.Digest(entry.Bytes) == entry.Digest, "scene-integrity", "The desktop transfer failed its integrity check.");
      entry.Sealed = true;
    }
    return entry.Bytes;
  }
  public object Lease(string owner, string token, string reader)
  {
    var entry = Get(owner, token);
    HostError.Require(entry.Sealed && entries.Count < 192, "scene-busy", "The desktop frame isn't readable yet.");
    var lease = Guid.NewGuid().ToString();
    entries.Add(lease, new Entry(reader, entry.Bytes, entry.Digest, entry.Frame, entry.Written, true));
    return new { token = lease, size = entry.Bytes.Length, sha256 = entry.Digest };
  }
  public object Read(string owner, string token, int offset)
  {
    var entry = Get(owner, token);
    HostError.Require(entry.Sealed && offset >= 0 && offset <= entry.Bytes.Length, "scene-offset", "The desktop download position is invalid.");
    var length = Math.Min(BridgeSession.ChunkSize, entry.Bytes.Length - offset);
    return new { offset, base64 = Convert.ToBase64String(entry.Bytes, offset, length), done = offset + length == entry.Bytes.Length };
  }
  public void Drop(string owner, string token)
  {
    if (!entries.TryGetValue(token, out var entry) || entry.Owner != owner) return;
    entries.Remove(token);
    if (!entries.Values.Any(e => ReferenceEquals(e.Bytes, entry.Bytes))) CryptographicOperations.ZeroMemory(entry.Bytes);
  }
  public void DropOwner(string owner)
  {
    foreach (var token in entries.Where(e => e.Value.Owner == owner).Select(e => e.Key).ToArray()) Drop(owner, token);
  }
  // A retained published frame is renewed by the coordinator; incomplete/abandoned transfers expire.
  public void Touch(string owner, string token) { _ = Get(owner, token); }
  public void Retain(string owner, string token) { var entry = Get(owner, token); HostError.Require(entry.Sealed, "scene-incomplete", "The frame is incomplete."); entry.Retained = true; }
  private Entry Get(string owner, string token)
  {
    ObjectDisposedException.ThrowIf(disposed, this);
    HostError.Require(entries.TryGetValue(token, out var entry) && entry.Owner == owner, "scene-missing", "The desktop transfer doesn't belong to this window or has expired.");
    entry!.Used = DateTime.UtcNow; return entry;
  }
  private void Sweep()
  {
    foreach (var pair in entries.Where(e => !e.Value.Retained && DateTime.UtcNow - e.Value.Used > TimeSpan.FromMinutes(5)).ToArray()) Drop(pair.Value.Owner, pair.Key);
  }
  public void Dispose()
  {
    if (disposed) return; disposed = true;
    foreach (var bytes in entries.Values.Select(e => e.Bytes).Distinct()) CryptographicOperations.ZeroMemory(bytes);
    entries.Clear();
  }
}
