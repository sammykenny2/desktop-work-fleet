using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;

namespace WorkFleet.Windows;

/// <summary>
/// One Work Fleet per user and data directory. A second launch asks the running one to show its main window and exits,
/// instead of failing on the data owner lock. The MSIX and the ZIP use different data directories and do not collide.
/// </summary>
public sealed class SingleInstance : IDisposable
{
  private readonly string name;
  private readonly CancellationTokenSource stop = new();
  private readonly object gate = new();
  private Action? show;
  private bool pending;

  private SingleInstance(string name) { this.name = name; _ = Task.Run(Serve); }

  /// <summary>Null when a running instance accepted the request to show itself.</summary>
  public static SingleInstance? Claim(string directory)
  {
    var name = PipeName(directory);
    return Forward(name) ? null : new SingleInstance(name);
  }
  /// <summary>Requests that arrived before the main window was ready are replayed once it is.</summary>
  public void Listen(Action handler)
  {
    bool replay;
    lock (gate) { show = handler; replay = pending; pending = false; }
    if (replay) handler();
  }
  private static string PipeName(string directory)
  {
    var owner = WindowsIdentity.GetCurrent().User?.Value ?? "";
    var digest = SHA256.HashData(Encoding.UTF8.GetBytes(owner + "\n" + Path.GetFullPath(directory).ToUpperInvariant()));
    return "WorkFleet-" + Convert.ToHexString(digest)[..32];
  }
  private static bool Forward(string name)
  {
    try
    {
      using var client = new NamedPipeClientStream(".", name, PipeDirection.InOut, PipeOptions.None);
      client.Connect(500);
      // This process was started by the user, so it may hand the foreground to the running instance.
      if (GetNamedPipeServerProcessId(client.SafePipeHandle.DangerousGetHandle(), out var process)) _ = AllowSetForegroundWindow(process);
      client.Write("show\n"u8); client.Flush();
      var reply = new byte[3]; var read = 0;
      var deadline = DateTime.UtcNow.AddSeconds(5);
      while (read < reply.Length && DateTime.UtcNow < deadline)
      {
        var task = client.ReadAsync(reply, read, reply.Length - read);
        if (!task.Wait(TimeSpan.FromSeconds(5)) || task.Result == 0) break;
        read += task.Result;
      }
      return read == 3 && reply.AsSpan().SequenceEqual("ok\n"u8);
    }
    catch (Exception error) when (error is TimeoutException or IOException or UnauthorizedAccessException or AggregateException) { return false; }
  }
  private async Task Serve()
  {
    var security = new PipeSecurity();
    var owner = WindowsIdentity.GetCurrent().User;
    if (owner is not null) security.AddAccessRule(new PipeAccessRule(owner, PipeAccessRights.ReadWrite | PipeAccessRights.CreateNewInstance, AccessControlType.Allow));
    while (!stop.IsCancellationRequested)
    {
      try
      {
        using var server = NamedPipeServerStreamAcl.Create(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 64, 64, security);
        await server.WaitForConnectionAsync(stop.Token);
        var buffer = new byte[16]; var read = 0;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop.Token); timeout.CancelAfter(TimeSpan.FromSeconds(2));
        while (read < 5)
        {
          var count = await server.ReadAsync(buffer.AsMemory(read, buffer.Length - read), timeout.Token);
          if (count == 0) break; read += count;
        }
        if (read != 5 || !buffer.AsSpan(0, 5).SequenceEqual("show\n"u8)) continue;
        Action? handler;
        lock (gate) { handler = show; if (handler is null) pending = true; }
        handler?.Invoke();
        await server.WriteAsync("ok\n"u8.ToArray(), timeout.Token); await server.FlushAsync(timeout.Token);
      }
      catch (OperationCanceledException) when (stop.IsCancellationRequested) { return; }
      catch (Exception error) when (error is IOException or OperationCanceledException or UnauthorizedAccessException) { await Task.Delay(200); }
    }
  }
  public void Dispose() { stop.Cancel(); }
  [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetNamedPipeServerProcessId(IntPtr pipe, out uint process);
  [DllImport("user32.dll")] private static extern bool AllowSetForegroundWindow(uint process);
}
