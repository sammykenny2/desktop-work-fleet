using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Windows.Interop;

namespace WorkFleet.Windows;

public sealed record ShortcutBinding(string Key, string Target);
public sealed record ShortcutRegistration(string Key, string Target, string Status);

/// <summary>Owns registrations, never keyboard hooks. Suspend while an app editor or IME owns input.</summary>
public sealed class NativeShortcuts : IDisposable
{
  private readonly HwndSource receiver;
  private readonly Action<string> invoke;
  private readonly Dictionary<int, (ShortcutBinding Binding, uint Modifiers, uint Key)> active = [];
  private ShortcutBinding[] bindings = [];
  private ShortcutRegistration[] registrations = [];
  private bool suspended;
  private bool disposed;
  public IReadOnlyList<ShortcutRegistration> Registrations => Array.AsReadOnly(registrations);
  public event Action? Changed;

  public NativeShortcuts(Action<string> invoke)
  {
    this.invoke = invoke;
    receiver = new HwndSource(new HwndSourceParameters("Work Fleet shortcuts") { ParentWindow = new IntPtr(-3), Width = 0, Height = 0 });
    receiver.AddHook(Receive);
  }

  public void Configure(IEnumerable<ShortcutBinding> settings)
  {
    receiver.Dispatcher.VerifyAccess(); ObjectDisposedException.ThrowIf(disposed, this);
    var next = settings.Take(33).ToArray();
    if (next.Length > 32 || next.Any(b => b is null || string.IsNullOrEmpty(b.Key) || b.Key.Length > 80
      || b.Target is null || !Regex.IsMatch(b.Target, @"\A(?:@(?:all|capture|toggle)|[A-Za-z0-9][A-Za-z0-9._:-]{0,127})\z", RegexOptions.CultureInvariant)
      || b.Target is "__proto__" or "prototype" or "constructor")
      || next.Select(b => b.Key).Distinct(StringComparer.Ordinal).Count() != next.Length)
      throw new ArgumentException("Invalid shortcut settings.");
    bindings = next; Refresh();
  }

  public void Suspend(bool value)
  {
    receiver.Dispatcher.VerifyAccess(); ObjectDisposedException.ThrowIf(disposed, this);
    if (suspended == value) return; suspended = value; Refresh();
  }

  private void Refresh()
  {
    Clear(); var result = new List<ShortcutRegistration>(); var id = 1;
    foreach (var binding in bindings)
    {
      var status = Parse(binding.Key, out var modifiers, out var key);
      if (status == "available")
      {
        if (suspended) status = "suspended";
        else if (RegisterHotKey(receiver.Handle, id, modifiers | 0x4000, key)) active.Add(id, (binding, modifiers, key));
        else status = Marshal.GetLastWin32Error() == 1409 ? "conflict" : "unavailable";
      }
      result.Add(new(binding.Key, binding.Target, status)); id++;
    }
    registrations = result.ToArray(); Changed?.Invoke();
  }

  public static string Parse(string text, out uint modifiers, out uint key)
  {
    modifiers = 0; key = 0;
    if (text is null || text.Length > 80) return "invalid";
    var parts = text.Split('+');
    if (parts.Length is < 2 or > 5 || parts.Distinct(StringComparer.Ordinal).Count() != parts.Length) return "invalid";
    var order = new[] { "Ctrl", "Alt", "Shift", "Meta" }; var previous = -1;
    foreach (var part in parts[..^1])
    {
      var index = Array.IndexOf(order, part); if (index <= previous) return "invalid"; previous = index;
      modifiers |= part switch { "Ctrl" => 2u, "Alt" => 1u, "Shift" => 4u, "Meta" => 8u, _ => 0u };
    }
    var name = parts[^1];
    if (Regex.IsMatch(name, @"\A[A-Z0-9]\z", RegexOptions.CultureInvariant)) key = name[0];
    else if (Regex.IsMatch(name, @"\AF(?:[1-9]|1[0-9]|2[0-4])\z", RegexOptions.CultureInvariant)) key = (uint)(111 + int.Parse(name[1..], System.Globalization.CultureInfo.InvariantCulture));
    else return "invalid";
    if ((modifiers & (1 | 2 | 8)) == 0) return "invalid";
    // Ctrl+Alt character chords also match AltGr text input on international layouts, including Shift+AltGr.
    if ((modifiers & 3) == 3 && key is >= 0x30 and <= 0x5a) return "typing";
    // Windows reserves Win combinations and F12. Never steal ubiquitous text-editing commands or close-window.
    if ((modifiers & 8) != 0 || name == "F12" || (name == "F4" && (modifiers & 1) != 0)) return "reserved";
    if ((modifiers & 2) != 0 && (modifiers & 1) == 0 && new[] { "A", "C", "X", "V", "Z", "Y" }.Contains(name)) return "editing";
    return "available";
  }

  private IntPtr Receive(IntPtr window, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
  {
    if (message != 0x0312) return IntPtr.Zero; handled = true;
    var packed = (ulong)lParam.ToInt64();
    var id = wParam.ToInt64();
    if (!disposed && !suspended && id is >= 1 and <= 32 && active.TryGetValue((int)id, out var entry)
      && (packed & 0xffff) == entry.Modifiers && ((packed >> 16) & 0xffff) == entry.Key)
      invoke(entry.Binding.Target);
    return IntPtr.Zero;
  }

  private void Clear()
  {
    foreach (var id in active.Keys)
      if (!UnregisterHotKey(receiver.Handle, id)) throw new InvalidOperationException("Unable to release an owned shortcut.");
    active.Clear();
    // Reusing IDs cannot reinterpret an already queued old binding as a new action.
    while (PeekMessageW(out _, receiver.Handle, 0x0312, 0x0312, 1)) { }
  }

  public void Dispose()
  {
    if (disposed) return; receiver.Dispatcher.VerifyAccess(); disposed = true;
    try { Clear(); } finally { receiver.RemoveHook(Receive); receiver.Dispose(); }
  }
  [StructLayout(LayoutKind.Sequential)] private struct NativeMessage
  { public IntPtr Window; public uint Message; public UIntPtr WParam; public IntPtr LParam; public uint Time; public int X, Y; public uint Private; }
  [DllImport("user32.dll", SetLastError = true)] private static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint key);
  [DllImport("user32.dll")] private static extern bool UnregisterHotKey(IntPtr window, int id);
  [DllImport("user32.dll")] private static extern bool PeekMessageW(out NativeMessage message, IntPtr window, uint first, uint last, uint flags);
}
