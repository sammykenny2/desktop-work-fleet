using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace WorkFleet.Windows.Core;

/// <summary>Current Windows user DPAPI; no plaintext fallback or renderer-visible key.</summary>
public static class UserProtection
{
  [StructLayout(LayoutKind.Sequential)]
  private struct DataBlob { public int Size; public IntPtr Data; }
  [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool CryptProtectData(ref DataBlob data, string? description, ref DataBlob entropy,
    IntPtr reserved, IntPtr prompt, uint flags, out DataBlob output);
  [DllImport("crypt32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool CryptUnprotectData(ref DataBlob data, IntPtr description, ref DataBlob entropy,
    IntPtr reserved, IntPtr prompt, uint flags, out DataBlob output);
  [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);

  public static byte[] Protect(byte[] bytes, string scope) => Transform(bytes, scope, true);
  public static byte[] Unprotect(byte[] bytes, string scope) => Transform(bytes, scope, false);
  private static byte[] Transform(byte[] bytes, string scope, bool encrypt)
  {
    var entropyBytes = SHA256.HashData(Encoding.UTF8.GetBytes("work-fleet/windows/v1\0" + scope));
    var input = new DataBlob { Size = bytes.Length, Data = Marshal.AllocHGlobal(Math.Max(1, bytes.Length)) };
    var entropy = new DataBlob { Size = entropyBytes.Length, Data = Marshal.AllocHGlobal(entropyBytes.Length) };
    var output = new DataBlob();
    try
    {
      Marshal.Copy(bytes, 0, input.Data, bytes.Length); Marshal.Copy(entropyBytes, 0, entropy.Data, entropyBytes.Length);
      // CRYPTPROTECT_UI_FORBIDDEN, with CurrentUser (no LOCAL_MACHINE flag).
      var succeeded = encrypt ? CryptProtectData(ref input, null, ref entropy, IntPtr.Zero, IntPtr.Zero, 1, out output)
        : CryptUnprotectData(ref input, IntPtr.Zero, ref entropy, IntPtr.Zero, IntPtr.Zero, 1, out output);
      if (!succeeded) throw new CryptographicException("Windows 安全儲存無法使用；請使用原 Windows 帳號重試。",
        new Win32Exception(Marshal.GetLastWin32Error()));
      var result = new byte[output.Size]; Marshal.Copy(output.Data, result, 0, output.Size); return result;
    }
    finally
    {
      Clear(input.Data, input.Size); Marshal.FreeHGlobal(input.Data);
      Clear(entropy.Data, entropy.Size); Marshal.FreeHGlobal(entropy.Data);
      if (output.Data != IntPtr.Zero) { Clear(output.Data, output.Size); LocalFree(output.Data); }
      CryptographicOperations.ZeroMemory(entropyBytes);
    }
  }
  private static void Clear(IntPtr pointer, int size)
  {
    var zeros = new byte[Math.Min(size, 65536)];
    for (var offset = 0; offset < size; offset += zeros.Length)
      Marshal.Copy(zeros, 0, IntPtr.Add(pointer, offset), Math.Min(zeros.Length, size - offset));
  }
}
