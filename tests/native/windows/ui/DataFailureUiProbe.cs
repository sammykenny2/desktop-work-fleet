using Microsoft.Data.Sqlite;
using System.IO;
using System.Text.Json;
using WorkFleet.Windows;
using WorkFleet.Windows.Core;

/// <summary>
/// SPEC-006 DO in the real window: a database that is not SQLite stops the start, before any main window exists, with the
/// explanation window, whose set-aside lets the next open start empty; a workspace record DPAPI cannot decrypt, as after a Windows account change,
/// opens the page's explanation, which shows the folder and sets the data aside through the host.
/// </summary>
internal static class DataFailureUiProbe
{
  private static void Require(bool value, string message) { if (!value) throw new Exception(message); }
  private static async Task<bool> Check(FleetWindow window, string script) => await window.WebView.CoreWebView2.ExecuteScriptAsync(script) == "true";
  private static string[] SetAside(string directory) => Directory.EnumerateDirectories(directory, DataFailure.SetAsidePrefix + "*").ToArray();

  public static async Task Run(string directory)
  {
    var start = Path.Combine(directory, "start"); Program.English(start);
    // As Program.Main does before any window: the explanation speaks the stored display language.
    HostText.Apply(HostPreferences.Read(start).Language);
    File.WriteAllText(Path.Combine(start, "fleet.sqlite3"), "these bytes are not a SQLite database");
    string? cause = null, asked = null;
    var reopened = WorkFleet.Windows.Program.OpenWindow(start, () => Program.Open(start), found =>
    {
      cause = found;
      var explanation = new DataFailureWindow(start, found, text => { asked = text; return true; });
      explanation.Show(); var done = explanation.SetAside() && explanation.SetAsideDone; explanation.Close(); return done;
    });
    Require(cause == DataFailure.Damaged, $"A database that is not SQLite reported {cause ?? "no failure"}.");
    Require(asked == HostText.Get("dataFailure.confirm") && reopened is not null, "The start-up explanation did not set the data aside after asking.");
    // A main window built over damaged data would stay registered with WPF and keep the app from ever shutting down.
    Require(System.Windows.Application.Current.Windows.OfType<FleetWindow>().SequenceEqual([reopened!]), "A failed main window stayed registered.");
    Require(SetAside(start) is [var folder] && File.Exists(Path.Combine(folder, "fleet.sqlite3")), "The damaged database is not in one set-aside folder.");
    await Program.Wait(reopened!, "document.querySelector('#status')?.textContent === 'Local data opened'", "empty data opens after the start-up set-aside");
    await Program.Close(reopened!);
    Console.WriteLine("PASS a damaged database explains itself at start and opens empty once set aside");

    var page = Path.Combine(directory, "page");
    var first = Program.Open(page);
    await Program.Wait(first, "document.querySelector('#status')?.textContent === 'Local data opened'", "first open writes the workspace record");
    await Program.Close(first);
    using (var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Path.Combine(page, "fleet.sqlite3"), Pooling = false }.ToString()))
    {
      connection.Open(); using var command = connection.CreateCommand();
      command.CommandText = "UPDATE records SET data = randomblob(64) WHERE kind = 'workspace';";
      Require(command.ExecuteNonQuery() == 1, "There was no workspace record to damage.");
    }
    var second = Program.Open(page);
    await Program.Wait(second, "document.querySelector('#data-failure-dialog').open", "the page explains notes it cannot decrypt");
    Require(await Check(second, $"document.querySelector('.data-failure-path').textContent === {JsonSerializer.Serialize(page)}"
      + " && document.querySelector('#data-failure-body').textContent.includes(\"can't be decrypted\")"), "The explanation lacks the folder or the cause.");
    // Esc or a browser close request does not leave the page without its notes and without the explanation.
    await second.WebView.CoreWebView2.ExecuteScriptAsync("document.querySelector('#data-failure-dialog').close()");
    await Program.Wait(second, "document.querySelector('#data-failure-dialog').open", "the explanation shows again after a close");
    const string last = "[...document.querySelectorAll('#data-failure-actions button')].at(-1).click()";
    await second.WebView.CoreWebView2.ExecuteScriptAsync(last);
    await Program.Wait(second, "document.querySelector('#data-failure-body h3') !== null", "the set-aside confirmation");
    Require(SetAside(page).Length == 0, "The data moved before the confirmation.");
    await second.WebView.CoreWebView2.ExecuteScriptAsync(last);
    await Program.Wait(second, "document.querySelector('#status')?.textContent === 'Local data opened'", "the host reopens the page on empty data");
    Require(SetAside(page) is [var moved] && File.Exists(Path.Combine(moved, "fleet.sqlite3")), "The undecryptable database is not in one set-aside folder.");
    await Program.Close(second);
    Console.WriteLine("PASS notes the page cannot decrypt show their folder and open empty once set aside");
  }
}
