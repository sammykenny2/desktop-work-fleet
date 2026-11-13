import Foundation

@main struct ReleaseFeedProbe {
  static func main() throws {
    let fixtureURL = URL(fileURLWithPath: CommandLine.arguments[1])
    let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: fixtureURL)) as! [String: Any]
    let repository = fixture["repository"] as! String
    let data = try Data(contentsOf: fixtureURL.deletingLastPathComponent().appendingPathComponent(fixture["feed"] as! String))
    var checks = 0
    func require(_ value: Bool) { precondition(value); checks += 1 }
    let chosen = try PinItAnywhereReleaseFeed.latest(data, repository: repository, channel: "preview", current: [0, 1, 2])
    require(chosen?.tag == (fixture["manifestRelease"] as? String))
    require(chosen?.appcast == "https://github.com/o/r/releases/download/v0.1.10/appcast.xml")
    // Older per-platform tags such as macos-v0.5.0 are ignored even though their version is higher.
    for current in [[0, 1, 10], [0, 2, 1]] {
      let result = try PinItAnywhereReleaseFeed.latest(data, repository: repository, channel: "preview", current: current)
      require(result == nil)
    }
    do {
      _ = try PinItAnywhereReleaseFeed.latest(Data((fixture["withoutRelease"] as! String).utf8), repository: repository, channel: "preview", current: [0, 1, 0])
      preconditionFailure("a feed without a vX.Y.Z release read as up to date")
    } catch let failure as PinItAnywhereFailure { require(failure.code == "metadata_invalid" && failure.message == PinItAnywhereText.text("update.noRelease")) }
    let empty = Data("<feed xmlns=\"http://www.w3.org/2005/Atom\" />".utf8)
    let emptyResult = try PinItAnywhereReleaseFeed.latest(empty, repository: repository, channel: "preview", current: [0, 1, 0])
    require(emptyResult == nil)
    for damaged in fixture["invalidFeeds"] as! [String] {
      do {
        _ = try PinItAnywhereReleaseFeed.latest(Data(damaged.utf8), repository: repository, channel: "preview", current: [0, 1, 0])
        preconditionFailure("damaged feed accepted")
      } catch let failure as PinItAnywhereFailure { require(failure.code == "metadata_invalid" && failure.message == PinItAnywhereText.text("update.invalidFeed")) }
    }
    // The feed lists another/repo's v99.0.0, which counts for that repository; a repository it does not list is refused.
    for (repo, channel) in [(repository, "stable"), ("another/repository", "preview")] {
      do {
        _ = try PinItAnywhereReleaseFeed.latest(data, repository: repo, channel: channel, current: [0, 1, 0])
        preconditionFailure("unsupported feed accepted")
      } catch let failure as PinItAnywhereFailure { require(failure.code == "metadata_invalid") }
    }
    for text in ["01.2.3", "1.2", "1.2.3.4", "1.2.3-beta", "1.2.3\n"] { require(PinItAnywhereReleaseFeed.version(text) == nil) }
    print("PASS release-feed \(checks) checks")
  }
}
