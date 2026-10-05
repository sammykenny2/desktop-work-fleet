using Microsoft.Win32.SafeHandles;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace WorkFleet.Windows.Core;

public sealed record FileIdentity(ulong Volume, string Id, long Created);
public sealed record BackupDirectoryReference(string NativePath, FileIdentity Identity);
public sealed record BackupFileIdentity(string Name, FileIdentity Identity, string Sha256, int Size);

/// <summary>
/// Native directory capability. All child opens are relative to its held handle;
/// retention hashes and deletes the same exclusively write/delete-locked file handle.
/// </summary>
public sealed class WindowsBackupDirectory : IDisposable
{
  public const int MaxBackupBytes = 136 * 1024 * 1024 + 4096;
  private const uint Synchronize = 0x00100000, ReadAttributes = 0x80, Delete = 0x10000;
  private const uint GenericRead = 0x80000000, GenericWrite = 0x40000000;
  private readonly SafeFileHandle directory;
  private readonly object gate = new();
  public BackupDirectoryReference Reference { get; }
  private bool disposed;

  private WindowsBackupDirectory(SafeFileHandle directory)
  {
    this.directory = directory;
    try
    {
      var info = Information(directory);
      HostError.Require((info.Attributes & 0x10) != 0 && (info.Attributes & 0x400) == 0,
        "backup-directory", "備份位置必須是實際資料夾，不能是連結。");
      var fileSystem = new StringBuilder(64);
      if (!GetVolumeInformationByHandleW(directory, null, 0, out _, out _, out _, fileSystem, (uint)fileSystem.Capacity)) ThrowLast();
      // This implementation is qualified for local NTFS. Other backends must prove the same semantics separately.
      HostError.Require(fileSystem.ToString() == "NTFS", "backup-filesystem", "此原生備份方式目前需要本機 NTFS 資料夾。");
      Reference = new BackupDirectoryReference(FinalPath(directory), Identity(directory, info));
    }
    catch { directory.Dispose(); throw; }
  }
  public static WindowsBackupDirectory Choose(string absolutePath)
  {
    var path = Path.GetFullPath(absolutePath);
    HostError.Require(path.Length >= 3 && char.IsAsciiLetter(path[0]) && path[1] == ':' && path[2] == '\\',
      "backup-directory", "請選擇本機磁碟上的備份資料夾。");
    var drive = GetDriveTypeW(path[..3]);
    HostError.Require(drive is 2 or 3, "backup-filesystem", "此原生備份方式目前不支援網路磁碟。");
    return new WindowsBackupDirectory(Open("\\??\\" + path.TrimEnd('\\') + (path.Length == 3 ? "\\" : ""), null,
      ReadAttributes | Synchronize, 1, 1 | 0x20));
  }
  public static WindowsBackupDirectory Reopen(BackupDirectoryReference reference)
  {
    var path = reference.NativePath;
    HostError.Require(path.Length >= 49 && path.StartsWith(@"\\?\Volume{", StringComparison.Ordinal)
      && Guid.TryParseExact(path.Substring(11, 36), "D", out _) && path[47..49] == @"}\", "backup-directory", "備份位置參照無效。");
    // Windows' volume GUID namespace itself uses a system reparse mapping. Resolve only that root
    // through Win32, then refuse filesystem reparses while opening the saved directory below it.
    var root = CreateFileW(path[..49], ReadAttributes | Synchronize, 1, IntPtr.Zero, 3, 0x02000000 | 0x00200000, IntPtr.Zero);
    if (root.IsInvalid) { var error = Marshal.GetLastWin32Error(); root.Dispose(); throw new Win32Exception(error); }
    WindowsBackupDirectory result;
    if (path.Length == 49) result = new WindowsBackupDirectory(root);
    else using (root) result = new WindowsBackupDirectory(Open(path[49..], root, ReadAttributes | Synchronize, 1, 1 | 0x20));
    if (result.Reference.Identity == reference.Identity) return result;
    result.Dispose(); throw new HostError("backup-directory-changed", "備份資料夾已被替換；請重新選擇位置。");
  }
  public BackupFileIdentity Create(string name, byte[] bytes, Action<BackupFileIdentity> reserve, CancellationToken cancellation = default)
  {
    Name(name);
    HostError.Require(bytes.Length > 0 && bytes.Length <= MaxBackupBytes, "backup-limit", "備份檔案容量無效。");
    // Callers own the buffer for this synchronous operation. Native host stages own immutable bytes.
    var digest = LocalDatabase.Digest(bytes);
    lock (gate)
    {
      ObjectDisposedException.ThrowIf(disposed, this); cancellation.ThrowIfCancellationRequested();
      using var handle = Open(name, directory, GenericRead | GenericWrite | Synchronize, 2, 0x40 | 0x20 | 0x2);
      var identity = new BackupFileIdentity(name, Identity(handle, Information(handle)), digest, bytes.Length);
      // Persist native file identity while this new file is locked, before bytes are written.
      // Any failure leaves the newly created file; it never replaces an older file or guesses a rollback.
      reserve(identity);
      using var stream = new FileStream(handle, FileAccess.ReadWrite, 1024 * 1024);
      for (var offset = 0; offset < bytes.Length; offset += 1024 * 1024)
      {
        cancellation.ThrowIfCancellationRequested(); stream.Write(bytes, offset, Math.Min(1024 * 1024, bytes.Length - offset));
      }
      cancellation.ThrowIfCancellationRequested();
      // Finalize and read back even if cancellation arrives after this irreversible boundary.
      stream.Flush(flushToDisk: true); stream.Position = 0;
      HostError.Require(stream.Length == bytes.Length && Digest(stream) == digest, "backup-save-integrity", "備份已寫入，但讀回校驗失敗。");
      return identity;
    }
  }
  public byte[]? Read(BackupFileIdentity expected)
  {
    Validate(expected);
    lock (gate)
    {
      ObjectDisposedException.ThrowIf(disposed, this);
      using var handle = OpenExisting(expected.Name, delete: false); if (handle is null) return null;
      MatchIdentity(handle, expected); using var stream = new FileStream(handle, FileAccess.Read);
      HostError.Require(stream.Length <= MaxBackupBytes, "backup-limit", "備份檔案超過容量上限。");
      var bytes = new byte[checked((int)stream.Length)]; stream.ReadExactly(bytes); return bytes;
    }
  }
  public bool Contains(string name)
  {
    Name(name);
    lock (gate)
    {
      ObjectDisposedException.ThrowIf(disposed, this); using var handle = OpenExisting(name, delete: false); return handle is not null;
    }
  }
  public void WhileVerified(BackupFileIdentity expected, Action operation)
  {
    Validate(expected);
    lock (gate)
    {
      ObjectDisposedException.ThrowIf(disposed, this);
      using var handle = OpenExisting(expected.Name, delete: false);
      HostError.Require(handle is not null, "backup-latest-missing", "最新備份不存在，先保留舊檔。");
      try { MatchIdentity(handle!, expected); }
      catch (HostError) { throw new HostError("backup-latest-missing", "最新備份已被替換，先保留舊檔。"); }
      using var stream = new FileStream(handle!, FileAccess.Read);
      HostError.Require(stream.Length == expected.Size && Digest(stream) == expected.Sha256,
        "backup-latest-missing", "最新備份已被修改，先保留舊檔。");
      // Hold the latest valid file against writes/replacement throughout old-file deletion.
      operation();
    }
  }
  public void Remove(BackupFileIdentity expected, Action? beforeDisposition = null)
  {
    Validate(expected);
    lock (gate)
    {
      ObjectDisposedException.ThrowIf(disposed, this);
      using var handle = OpenExisting(expected.Name, delete: true); if (handle is null) return;
      MatchIdentity(handle, expected); using var stream = new FileStream(handle, FileAccess.Read);
      HostError.Require(stream.Length == expected.Size && Digest(stream) == expected.Sha256,
        "backup-file-changed", "舊備份已被修改，保留該檔案供檢查。");
      beforeDisposition?.Invoke();
      // The callback is for native fault probes only. No renderer-supplied callbacks or paths.
      // Delete through the same handle. No File.Delete(path) check-then-delete sequence.
      var disposition = new Disposition { DeleteFile = true };
      if (!SetFileInformationByHandle(handle, 4, ref disposition, (uint)Marshal.SizeOf<Disposition>())) ThrowLast();
    }
  }
  private SafeFileHandle? OpenExisting(string name, bool delete)
  {
    try { return Open(name, directory, GenericRead | Synchronize | (delete ? Delete : 0), 1, 0x40 | 0x20); }
    catch (Win32Exception error) when (error.NativeErrorCode is 2 or 3) { return null; }
  }
  private static void Validate(BackupFileIdentity value)
  {
    Name(value.Name); LocalDatabase.CheckDigest(value.Sha256);
    HostError.Require(value.Size > 0 && value.Size <= MaxBackupBytes, "backup-limit", "備份身分容量無效。");
  }
  private static void Name(string name) => HostError.Require(Regex.IsMatch(name, @"\Awork-fleet-(auto|backup)-[a-zA-Z0-9-]+\.zip\z", RegexOptions.CultureInvariant)
    && name.Length <= 180, "backup-name", "備份檔名無效。");
  private static string Digest(Stream stream) => Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
  private static void MatchIdentity(SafeFileHandle handle, BackupFileIdentity expected)
  {
    var info = Information(handle);
    HostError.Require((info.Attributes & (0x400 | 0x10)) == 0 && Identity(handle, info) == expected.Identity,
      "backup-file-changed", "原備份已被替換，未修改現在的檔案。");
  }
  private static FileInfo Information(SafeFileHandle handle)
  {
    if (!GetFileInformationByHandle(handle, out var information)) ThrowLast(); return information;
  }
  private static FileIdentity Identity(SafeFileHandle handle, FileInfo information)
  {
    if (!GetFileInformationByHandleEx(handle, 18, out FileIdInfo id, (uint)Marshal.SizeOf<FileIdInfo>())) ThrowLast();
    return new FileIdentity(id.VolumeSerialNumber, Convert.ToHexString(id.FileId), ((long)information.Created.High << 32) | information.Created.Low);
  }
  private static string FinalPath(SafeFileHandle handle)
  {
    var path = new StringBuilder(32768);
    var size = GetFinalPathNameByHandleW(handle, path, (uint)path.Capacity, 1); // VOLUME_NAME_GUID
    if (size == 0) ThrowLast();
    HostError.Require(size < path.Capacity, "backup-directory", "備份路徑過長。"); return path.ToString();
  }
  private static SafeFileHandle Open(string name, SafeFileHandle? root, uint access, uint disposition, uint options)
  {
    // NtCreateFile is the documented Windows SDK user-mode API that provides RootDirectory.
    // OBJ_DONT_REPARSE rejects reparse points; a single relative child component never re-resolves ancestors.
    var text = Marshal.StringToHGlobalUni(name); var descriptor = IntPtr.Zero; var rootReference = false;
    try
    {
      root?.DangerousAddRef(ref rootReference);
      var unicode = new UnicodeString { Length = checked((ushort)(name.Length * 2)), MaximumLength = checked((ushort)(name.Length * 2)), Buffer = text };
      descriptor = Marshal.AllocHGlobal(Marshal.SizeOf<UnicodeString>()); Marshal.StructureToPtr(unicode, descriptor, false);
      var attributes = new ObjectAttributes { Length = Marshal.SizeOf<ObjectAttributes>(), RootDirectory = root?.DangerousGetHandle() ?? IntPtr.Zero,
        ObjectName = descriptor, Attributes = 0x40 | 0x1000 }; // case insensitive, no reparse
      var status = NtCreateFile(out var handle, access, ref attributes, out _, IntPtr.Zero, 0x80,
        1, disposition, options, IntPtr.Zero, 0); // FILE_SHARE_READ only; excludes write and delete
      if (status < 0) { handle?.Dispose(); throw new Win32Exception(checked((int)RtlNtStatusToDosError(status))); }
      return handle;
    }
    finally
    {
      if (rootReference) root!.DangerousRelease();
      if (descriptor != IntPtr.Zero) Marshal.FreeHGlobal(descriptor); Marshal.FreeHGlobal(text);
    }
  }
  private static void ThrowLast() => throw new Win32Exception(Marshal.GetLastWin32Error());
  public void Dispose() { lock (gate) { if (disposed) return; disposed = true; directory.Dispose(); } }

  [StructLayout(LayoutKind.Sequential)] private struct UnicodeString { public ushort Length, MaximumLength; public IntPtr Buffer; }
  [StructLayout(LayoutKind.Sequential)] private struct ObjectAttributes
  { public int Length; public IntPtr RootDirectory, ObjectName; public uint Attributes; public IntPtr SecurityDescriptor, SecurityQualityOfService; }
  [StructLayout(LayoutKind.Sequential)] private struct IoStatusBlock { public IntPtr Status, Information; }
  [StructLayout(LayoutKind.Sequential)] private struct FileTime { public uint Low, High; }
  [StructLayout(LayoutKind.Sequential)] private struct FileInfo
  {
    public uint Attributes; public FileTime Created, Accessed, Written;
    public uint VolumeSerialNumber, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
  }
  [StructLayout(LayoutKind.Sequential)] private struct FileIdInfo
  { public ulong VolumeSerialNumber; [MarshalAs(UnmanagedType.ByValArray, SizeConst = 16)] public byte[] FileId; }
  [StructLayout(LayoutKind.Sequential)] private struct Disposition { [MarshalAs(UnmanagedType.U1)] public bool DeleteFile; }
  [DllImport("ntdll.dll")] private static extern int NtCreateFile(out SafeFileHandle file, uint access, ref ObjectAttributes attributes,
    out IoStatusBlock status, IntPtr allocationSize, uint fileAttributes, uint share, uint disposition, uint options, IntPtr ea, uint eaLength);
  [DllImport("ntdll.dll")] private static extern uint RtlNtStatusToDosError(int status);
  [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInfo info);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint disposition, uint options, IntPtr template);
  [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int kind, out FileIdInfo info, uint size);
  [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool SetFileInformationByHandle(SafeFileHandle file, int kind, ref Disposition info, uint size);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern uint GetFinalPathNameByHandleW(SafeFileHandle file, StringBuilder path, uint size, uint flags);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern uint GetDriveTypeW(string root);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetVolumeInformationByHandleW(SafeFileHandle file, StringBuilder? name, uint nameSize, out uint serial, out uint componentSize,
    out uint flags, StringBuilder fileSystem, uint fileSystemSize);
}
