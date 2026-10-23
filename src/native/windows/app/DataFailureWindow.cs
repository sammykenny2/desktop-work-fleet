using System.Diagnostics;
using System.Windows;
using System.Windows.Controls;
using WorkFleet.Windows.Core;

namespace WorkFleet.Windows;

/// <summary>
/// SPEC-006 DO: at start, says why the local data could not be opened, shows its folder and, where starting again can
/// help, offers to set the data aside after a confirmation. SetAsideDone is true once the data was moved aside.
/// </summary>
public sealed class DataFailureWindow : Window
{
  private readonly string directory;
  private readonly Func<string, bool> confirm;
  public bool SetAsideDone { get; private set; }

  /// <param name="confirm">Asks the confirmation text; probes answer it themselves.</param>
  public DataFailureWindow(string directory, string cause, Func<string, bool>? confirm = null)
  {
    this.directory = directory;
    this.confirm = confirm ?? (text => MessageBox.Show(this, text, "Work Fleet", MessageBoxButton.OKCancel, MessageBoxImage.Warning, MessageBoxResult.Cancel) == MessageBoxResult.OK);
    Title = "Work Fleet"; Width = 560; SizeToContent = SizeToContent.Height; ResizeMode = ResizeMode.NoResize;
    WindowStartupLocation = WindowStartupLocation.CenterScreen;
#pragma warning disable WPF0001 // Fluent ThemeMode is experimental; only this window opts in, never the transparent scene windows.
    // The Windows 11 look: Fluent controls and backdrop in the Windows app light or dark mode, following a change while open.
    ThemeMode = ThemeMode.System;
#pragma warning restore WPF0001
    var panel = new StackPanel { Margin = new Thickness(24) };
    panel.Children.Add(new TextBlock { Text = HostText.Get("dataFailure.title"), FontSize = 20, FontWeight = FontWeights.SemiBold, TextWrapping = TextWrapping.Wrap });
    panel.Children.Add(new TextBlock { Text = HostText.Get("dataFailure." + cause), TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 12, 0, 0) });
    panel.Children.Add(new TextBlock { Text = HostText.Get("dataFailure.folder"), Margin = new Thickness(0, 16, 0, 4) });
    // Read-only but selectable, so the path can be copied into a support message.
    panel.Children.Add(new TextBox { Text = directory, IsReadOnly = true, TextWrapping = TextWrapping.Wrap });
    var buttons = new StackPanel { Orientation = Orientation.Horizontal, HorizontalAlignment = HorizontalAlignment.Right, Margin = new Thickness(0, 20, 0, 0) };
    Button Add(string key, Action action)
    {
      var button = new Button { Content = HostText.Get(key), MinWidth = 96, Margin = new Thickness(8, 0, 0, 0) };
      button.Click += (_, _) => action(); buttons.Children.Add(button); return button;
    }
    // Opening the folder changes nothing, so it is the accent action; setting aside asks first.
    Add("dataFailure.openFolder", OpenFolder).SetResourceReference(StyleProperty, "AccentButtonStyle");
    if (DataFailure.CanSetAside(cause)) Add("dataFailure.setAside", () => { if (SetAside()) Close(); });
    Add("dataFailure.close", Close).IsCancel = true;
    panel.Children.Add(buttons); Content = panel;
  }

  public void OpenFolder()
  {
    try { Process.Start(new ProcessStartInfo("explorer.exe", $"\"{directory}\"") { UseShellExecute = true }); } catch { }
  }

  /// <summary>Asks first; returns true once the database files are in their dated set-aside folder.</summary>
  public bool SetAside()
  {
    if (!confirm(HostText.Get("dataFailure.confirm"))) return false;
    try { DataFailure.SetAside(directory, DateTimeOffset.Now); SetAsideDone = true; return true; }
    catch (HostError error)
    {
      var key = error.Code == "data-set-aside-incomplete" ? "dataFailure.setAsideIncomplete" : "dataFailure.setAsideFailed";
      MessageBox.Show(this, HostText.Get(key), "Work Fleet", MessageBoxButton.OK, MessageBoxImage.Error);
      return false;
    }
  }
}
