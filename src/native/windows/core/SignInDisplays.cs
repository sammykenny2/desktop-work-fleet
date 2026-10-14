namespace WorkFleet.Windows.Core;

/// <summary>
/// ADR-046: a sign-in launch keeps its desktop scenes out of Explorer while the displays are still settling. Twice,
/// Windows kept driving a closed laptop's built-in panel as the primary display for about 75 seconds after sign-in,
/// then turned it off, and the renderer failed right after. Scenes wait while that panel is on with the lid closed next
/// to another display, and until the display inventory has stayed the same for <see cref="Quiet"/>; never past
/// <see cref="Limit"/> after the coordinator started.
/// </summary>
public static class SignInDisplays
{
  public static readonly TimeSpan Quiet = TimeSpan.FromSeconds(5);
  public static readonly TimeSpan Limit = TimeSpan.FromMinutes(3);
  public const string LidClosedReason = "built-in display on with the lid closed";
  public const string ChangedReason = "displays changed";

  /// <param name="lidClosed">Null where Windows reports no lid state, as on a desktop PC; treated as open.</param>
  /// <param name="sinceChange">Time since the display inventory last changed; null when it has not changed since start.</param>
  public static SceneHold Check(bool? lidClosed, bool builtInOn, bool otherOn, TimeSpan? sinceChange, TimeSpan sinceStart)
  {
    // A closed laptop with no other display keeps its panel; Windows only turns it off when something else shows the desktop.
    var reason = lidClosed == true && builtInOn && otherOn ? LidClosedReason
      : sinceChange is { } quiet && quiet < Quiet ? ChangedReason : null;
    return new(reason, reason is not null && sinceStart >= Limit);
  }
}

/// <param name="Reason">Why the scenes would still wait, or null when the displays look settled.</param>
/// <param name="Expired">The wait reached <see cref="SignInDisplays.Limit"/>; the scenes attach although Reason holds.</param>
public sealed record SceneHold(string? Reason, bool Expired)
{
  public bool Waiting => Reason is not null && !Expired;
}
