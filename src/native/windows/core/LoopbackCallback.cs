using System.Net;
using System.Net.Sockets;
using System.Text;

namespace WorkFleet.Windows.Core;

/// <summary>
/// The one-time Google sign-in redirect listener on 127.0.0.1 (ADR-021). A browser may open a spare connection beside the one
/// that carries the redirect and only use it after the page loads (Chrome asks it for the favicon), and the spare can be
/// accepted first. So each connection is served on its own: one that stays idle, closes early or fails ends only itself, and
/// the sign-in waits for the request with its state.
/// </summary>
public sealed class LoopbackCallback : IDisposable
{
  public const string CallbackPath = "/oauth2/callback";
  public const int MaxHeader = 8192, MaxOpen = 16;
  public static readonly TimeSpan ConnectionTimeout = TimeSpan.FromSeconds(5);
  private static ReadOnlySpan<byte> HeaderEnd => "\r\n\r\n"u8;
  private readonly TcpListener listener = new(IPAddress.Loopback, 0);
  private readonly string state;
  private int accepted, dropped, rejected;
  public int Port { get; }
  public string RedirectUri => $"http://127.0.0.1:{Port}{CallbackPath}";
  /// <summary>For host.log: connections accepted, ended on their own without an answer (idle, closed, reset, over MaxOpen), and answered 400.</summary>
  public int Accepted => Volatile.Read(ref accepted);
  public int Dropped => Volatile.Read(ref dropped);
  public int Rejected => Volatile.Read(ref rejected);

  public LoopbackCallback(string state)
  {
    this.state = state; listener.Start(MaxOpen);
    Port = ((IPEndPoint)listener.LocalEndpoint).Port;
  }

  /// <summary>The query of the first request to the callback path with this state. Any other request gets 400 and the wait goes on.</summary>
  public async Task<IReadOnlyDictionary<string, string[]>> WaitAsync(CancellationToken cancellation)
  {
    using var stop = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
    var found = new TaskCompletionSource<IReadOnlyDictionary<string, string[]>>(TaskCreationOptions.RunContinuationsAsynchronously);
    var serving = new List<Task>(); Task<TcpClient>? accept = null;
    try
    {
      while (true)
      {
        accept = listener.AcceptTcpClientAsync(stop.Token).AsTask();
        if (await Task.WhenAny(accept, found.Task) == found.Task) return await found.Task;
        TcpClient client;
        // A browser may reset its spare connection before Windows hands it over; that ends only that connection.
        try { client = await accept; }
        catch (SocketException error) when (error.SocketErrorCode == SocketError.ConnectionReset) { accept = null; Interlocked.Increment(ref dropped); continue; }
        accept = null; Interlocked.Increment(ref accepted);
        serving.RemoveAll(task => task.IsCompleted);
        if (serving.Count >= MaxOpen) { Interlocked.Increment(ref dropped); client.Dispose(); continue; }
        serving.Add(Serve(client, found, stop.Token));
      }
    }
    finally
    {
      stop.Cancel(); listener.Stop();
      if (accept is not null) try { (await accept).Dispose(); } catch (Exception error) when (error is OperationCanceledException or SocketException or ObjectDisposedException) { }
      await Task.WhenAll(serving);
    }
  }

  /// <summary>
  /// Answers one connection. It never throws: a failure here belongs to this connection, not to the sign-in. Dropped counts
  /// only connections that ended on their own, not the ones still open when the wait ends.
  /// </summary>
  private async Task Serve(TcpClient client, TaskCompletionSource<IReadOnlyDictionary<string, string[]>> found, CancellationToken stop)
  {
    using (client)
    {
      var counted = false;
      try
      {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop); timeout.CancelAfter(ConnectionTimeout);
        var stream = client.GetStream();
        var query = Parse(await ReadHeader(stream, timeout.Token));
        var valid = query is not null && query.TryGetValue("state", out var states) && states.Length == 1 && states[0] == state;
        var body = Encoding.UTF8.GetBytes(valid ? "Work Fleet: You may close this browser tab." : "Invalid callback.");
        var response = Encoding.ASCII.GetBytes($"HTTP/1.1 {(valid ? "200 OK" : "400 Bad Request")}\r\nContent-Type: text/plain; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {body.Length}\r\n\r\n");
        if (!valid) { Interlocked.Increment(ref rejected); counted = true; }
        try { await stream.WriteAsync(response.Concat(body).ToArray(), timeout.Token); }
        // The code is already here; a browser that left before the page arrived does not undo the sign-in.
        catch (Exception error) when (valid && Ended(error)) { }
        if (valid) found.TrySetResult(query!);
      }
      catch (Exception error) when (Ended(error)) { if (!counted && !stop.IsCancellationRequested) Interlocked.Increment(ref dropped); }
    }
  }

  private static bool Ended(Exception error) =>
    error is IOException or SocketException or OperationCanceledException or ObjectDisposedException or InvalidOperationException;

  /// <summary>The request header up to its blank line, or MaxHeader bytes of a longer one. A connection closed before the end has no request.</summary>
  private static async Task<byte[]> ReadHeader(NetworkStream stream, CancellationToken cancellation)
  {
    var header = new byte[MaxHeader]; var length = 0;
    while (length < MaxHeader)
    {
      var read = await stream.ReadAsync(header.AsMemory(length), cancellation);
      if (read == 0) throw new IOException("The browser closed the connection before its request.");
      var from = Math.Max(0, length - HeaderEnd.Length + 1); length += read;
      if (header.AsSpan(from, length - from).IndexOf(HeaderEnd) >= 0) break;
    }
    return header[..length];
  }

  /// <summary>The query of a GET to the callback path, or null for any other request.</summary>
  private IReadOnlyDictionary<string, string[]>? Parse(byte[] header)
  {
    var line = Encoding.ASCII.GetString(header).Split("\r\n")[0].Split(' ');
    if (line.Length != 3 || line[0] != "GET" || !line[1].StartsWith(CallbackPath + "?", StringComparison.Ordinal)
      || !Uri.TryCreate("http://127.0.0.1:" + Port + line[1], UriKind.Absolute, out var callback) || callback.AbsolutePath != CallbackPath) return null;
    return callback.Query.TrimStart('?').Split('&').Select(part => part.Split('=', 2))
      .GroupBy(part => Uri.UnescapeDataString(part[0])).ToDictionary(group => group.Key, group => group.Select(part => part.Length == 2 ? Uri.UnescapeDataString(part[1].Replace('+', ' ')) : "").ToArray());
  }

  public void Dispose() => listener.Stop();
}
