namespace WorkFleet.Windows.Core;

public sealed class HostError(string code, string message) : Exception(message)
{
  public string Code { get; } = code;
  public static void Require(bool condition, string code, string message)
  {
    if (!condition) throw new HostError(code, message);
  }
}
