namespace WorkFleet.Windows.Core;

public static class NavigationPolicy
{
  public const string Host = "work-fleet.invalid";
  public const string Document = "https://work-fleet.invalid/app/index.html";
  public const string DesktopDocument = "https://work-fleet.invalid/desktop/index.html";
  public static bool IsDesktopDocument(string? value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
    && IsAsset(value) && uri.AbsolutePath == "/desktop/index.html" && uri.Query.Length == 0;
  public static bool IsDocument(string? value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
    && IsAsset(value) && uri.AbsolutePath == "/app/index.html" && uri.Query.Length == 0;
  public static bool IsAsset(string? value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
    && uri.Scheme == "https" && uri.Host == Host && uri.Port == 443 && uri.UserInfo.Length == 0;
  public static bool IsExternal(string? value) => Uri.TryCreate(value, UriKind.Absolute, out var uri)
    && (uri.Scheme is "https" or "http" or "mailto") && uri.UserInfo.Length == 0 && !IsAsset(value);
}
