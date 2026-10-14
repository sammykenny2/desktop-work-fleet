using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using WorkFleet.Windows.Core;

/// <summary>
/// The Google sign-in callback listener over real loopback sockets. The first check is the 0.2.1 failure: Chrome's spare
/// connection was accepted before the one with the redirect, stayed idle, and its read timeout ended the whole sign-in.
/// </summary>
internal static class LoopbackCallbackProbe
{
  private const string State = "probe-state_0123456789";

  public static int Run()
  {
    var count = 0;
    void Require(bool value, string message) { if (!value) throw new Exception(message); count++; }

    using (var callback = new LoopbackCallback(State))
    {
      Require(callback.RedirectUri == $"http://127.0.0.1:{callback.Port}/oauth2/callback", "redirect URI");
      var clock = Stopwatch.StartNew(); var waiting = callback.WaitAsync(Deadline());
      using var spare = Connect(callback.Port); Wait(() => callback.Accepted == 1, "the spare connection is accepted first");
      using var redirect = Connect(callback.Port);
      Send(redirect, $"GET /oauth2/callback?state={State}&code=4%2F0Aabc+def&scope=openid HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
      var query = waiting.GetAwaiter().GetResult();
      Require(clock.Elapsed < LoopbackCallback.ConnectionTimeout, $"an idle connection delayed the callback by {clock.Elapsed}");
      Require(query["code"].Single() == "4/0Aabc def" && query["scope"].Single() == "openid", "decoded callback query");
      Require(Answer(redirect).StartsWith("HTTP/1.1 200 OK", StringComparison.Ordinal), "the redirect is answered");
      Require(Closed(spare), "the spare connection ends with the listener");
      Require(Refused(callback.Port), "the port closes after the callback");
      Require(callback.Accepted == 2 && callback.Rejected == 0 && callback.Dropped == 0, "a spare closed at the end is not counted as dropped");
    }

    using (var callback = new LoopbackCallback(State))
    {
      var waiting = callback.WaitAsync(Deadline());
      using (var early = Connect(callback.Port)) { }
      foreach (var request in new[] {
        "GET /oauth2/callback?state=other&code=x HTTP/1.1\r\n\r\n",
        $"GET /oauth2/elsewhere?state={State}&code=x HTTP/1.1\r\n\r\n",
        $"POST /oauth2/callback?state={State}&code=x HTTP/1.1\r\n\r\n",
        $"GET /oauth2/callback?state={State}&state={State}&code=x HTTP/1.1\r\n\r\n" })
      {
        using var client = Connect(callback.Port); Send(client, request);
        Require(Answer(client).StartsWith("HTTP/1.1 400 Bad Request", StringComparison.Ordinal), "rejects " + request.Split(' ')[1]);
        Require(!waiting.IsCompleted, "a rejected request leaves the wait open");
      }
      // The blank line that ends the header arrives split across two reads.
      using var split = Connect(callback.Port);
      Send(split, "GET /oauth2/callback?sta"); Thread.Sleep(200); Send(split, $"te={State}&error=access_denied HTTP/1.1\r\n\r"); Thread.Sleep(200); Send(split, "\n");
      var query = waiting.GetAwaiter().GetResult();
      Require(query["error"].Single() == "access_denied" && !query.ContainsKey("code"), "a refusal with this state reaches the caller");
      Require(callback.Rejected == 4 && callback.Dropped == 1, $"counts rejected={callback.Rejected} dropped={callback.Dropped}");
    }

    using (var callback = new LoopbackCallback(State))
    {
      var waiting = callback.WaitAsync(Deadline());
      var idle = Enumerable.Range(0, LoopbackCallback.MaxOpen).Select(_ => Connect(callback.Port)).ToList();
      Wait(() => callback.Accepted == LoopbackCallback.MaxOpen, "every idle connection is accepted");
      var clock = Stopwatch.StartNew();
      using (var extra = Connect(callback.Port)) Require(Closed(extra) && clock.Elapsed < TimeSpan.FromSeconds(2), "a connection over the limit is closed at once");
      foreach (var client in idle) client.Dispose();
      Wait(() => callback.Dropped == LoopbackCallback.MaxOpen + 1, "closed connections free their places");
      using var redirect = Connect(callback.Port); Send(redirect, $"GET /oauth2/callback?state={State}&code=x HTTP/1.1\r\n\r\n");
      Require(waiting.GetAwaiter().GetResult()["code"].Single() == "x", "the callback still arrives after the limit was reached");
    }

    using (var callback = new LoopbackCallback(State))
    {
      using var cancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(300));
      using var idle = Connect(callback.Port);
      try { callback.WaitAsync(cancel.Token).GetAwaiter().GetResult(); throw new Exception("cancelled wait returned"); }
      catch (OperationCanceledException) { count++; }
      Require(Refused(callback.Port) && Closed(idle), "cancellation closes the port and open connections");
    }
    return count;
  }

  private static CancellationToken Deadline() => new CancellationTokenSource(TimeSpan.FromSeconds(30)).Token;
  private static TcpClient Connect(int port) { var client = new TcpClient(); client.Connect(IPAddress.Loopback, port); client.ReceiveTimeout = 10000; return client; }
  private static void Send(TcpClient client, string text) { client.GetStream().Write(Encoding.ASCII.GetBytes(text)); client.GetStream().Flush(); }
  private static string Answer(TcpClient client)
  {
    using var reader = new StreamReader(client.GetStream(), Encoding.UTF8, leaveOpen: true); return reader.ReadToEnd();
  }
  private static bool Closed(TcpClient client)
  {
    try { return client.GetStream().Read(new byte[1]) == 0; }
    catch (IOException error) when (error.InnerException is SocketException { SocketErrorCode: not SocketError.TimedOut }) { return true; }
    catch (IOException) { return false; }
  }
  private static bool Refused(int port)
  {
    try { using var client = new TcpClient(); client.Connect(IPAddress.Loopback, port); return false; }
    catch (SocketException error) { return error.SocketErrorCode == SocketError.ConnectionRefused; }
  }
  private static void Wait(Func<bool> condition, string what)
  {
    for (var clock = Stopwatch.StartNew(); !condition(); Thread.Sleep(10))
      if (clock.Elapsed > TimeSpan.FromSeconds(5)) throw new Exception("timed out waiting: " + what);
  }
}
