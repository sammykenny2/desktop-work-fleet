using System.IO;
using WorkFleet.Windows;

internal static class AttachmentFilesProbe
{
  public static void Run()
  {
    var png = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGNQiQ8AIgYIBQAWcgNNdvla9QAAAABJRU5ErkJggg==");
    using var files = new AttachmentFiles();
    var result = System.Text.Json.JsonSerializer.SerializeToElement(files.Invoke(png, "proof.png", false));
    if (!result.GetProperty("available").GetBoolean() || result.GetProperty("png").ValueKind != System.Text.Json.JsonValueKind.String)
      throw new Exception("Windows Shell returned no thumbnail or file icon.");
    var bytes = Convert.FromBase64String(result.GetProperty("png").GetString()!);
    if (!bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) || bytes.Length > 256 * 1024)
      throw new Exception("Unexpected thumbnail representation.");
    if (AttachmentFiles.Filename("../../proof.png").Contains('/') || AttachmentFiles.CanOpen("RUN.EXE") || !AttachmentFiles.CanOpen("proof.pdf"))
      throw new Exception("Attachment filename or document policy failed.");
    foreach (var name in new[] { "RUN.CMD .", "RUN.CMD. . ", "loader.cpl", "script.pif", "run.py", "link.webloc" })
      if (AttachmentFiles.CanOpen(name)) throw new Exception("Executable filename was accepted: " + name);
    Console.WriteLine("PASS Windows Shell attachment thumbnail, bounded PNG and filename policy (no external app launched)");
  }
}
