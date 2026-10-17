import Foundation

@main struct ReleaseFeedProbe {
  static func main() throws {
    let fixtureURL = URL(fileURLWithPath: CommandLine.arguments[1])
    let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: fixtureURL)) as! [String: Any]
    let repository = fixture["repository"] as! String
    let data = try Data(contentsOf: fixtureURL.deletingLastPathComponent().appendingPathComponent(fixture["feed"] as! String))
    var checks = 0
    func require(_ value: Bool) { precondition(value); checks += 1 }
    let chosen = try FleetReleaseFeed.latest(data, repository: repository, channel: "preview", current: [0, 1, 0])
    require(chosen?.tag == "macos-v0.5.0")
    require(chosen?.appcast == "https://github.com/o/r/releases/download/macos-v0.5.0/appcast.xml")
    for current in [[0, 5, 0], [0, 6, 0]] {
      let result = try FleetReleaseFeed.latest(data, repository: repository, channel: "preview", current: current)
      require(result == nil)
    }
    let empty = Data("<feed xmlns=\"http://www.w3.org/2005/Atom\" />".utf8)
    let emptyResult = try FleetReleaseFeed.latest(empty, repository: repository, channel: "preview", current: [0, 1, 0])
    require(emptyResult == nil)
    for damaged in fixture["invalidFeeds"] as! [String] {
      do {
        _ = try FleetReleaseFeed.latest(Data(damaged.utf8), repository: repository, channel: "preview", current: [0, 1, 0])
        preconditionFailure("damaged feed accepted")
      } catch let failure as FleetFailure { require(failure.code == "metadata_invalid" && failure.message == FleetText.text("update.invalidFeed")) }
    }
    for (repo, channel) in [(repository, "stable"), ("another/repo", "preview")] {
      do {
        _ = try FleetReleaseFeed.latest(data, repository: repo, channel: channel, current: [0, 1, 0])
        preconditionFailure("unsupported feed accepted")
      } catch let failure as FleetFailure { require(failure.code == "metadata_invalid") }
    }
    for text in ["01.2.3", "1.2", "1.2.3.4", "1.2.3-beta", "1.2.3\n"] { require(FleetReleaseFeed.version(text) == nil) }
    print("PASS release-feed \(checks) checks")
  }
}
