import Foundation

/// ADR-044 public release discovery. Atom carries published previews, one `vX.Y.Z` release for every platform; asset URLs
/// stay in the configured repository/tag.
/// Refusals reach the update section as they are, so their text comes from the host table.
enum FleetReleaseFeed {
  struct Release {
    let tag: String
    let version: [Int]
    let appcast: String
  }

  static func version(_ text: String) -> [Int]? {
    guard text.range(of: "^(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})\\z", options: .regularExpression) != nil else { return nil }
    return text.split(separator: ".").compactMap { Int($0) }
  }

  static func latest(_ data: Data, repository: String, channel: String, current: [Int]) throws -> Release? {
    guard channel == "preview", data.count <= 2 * 1024 * 1024,
       let text = String(data: data, encoding: .utf8), !text.contains("<!DOCTYPE"), !text.contains("<!ENTITY") else {
      throw FleetFailure("metadata_invalid", FleetText.text("update.invalidFeed"))
    }
    let delegate = ReleaseParser(repository: repository, current: current)
    let parser = XMLParser(data: data)
    parser.shouldProcessNamespaces = true
    parser.shouldResolveExternalEntities = false
    parser.delegate = delegate
    guard parser.parse(), delegate.validRoot else {
      throw FleetFailure("metadata_invalid", FleetText.text("update.invalidFeed"))
    }
    // A feed that lists releases but none of this form must not be read as "up to date".
    if delegate.entries > 0 && !delegate.found {
      throw FleetFailure("metadata_invalid", FleetText.text("update.noRelease"))
    }
    return delegate.best
  }
}

private final class ReleaseParser: NSObject, XMLParserDelegate {
  private let repository: String, current: [Int]
  private let atom = "http://www.w3.org/2005/Atom"
  private var stack: [String] = []
  var validRoot = false
  var entries = 0
  var found = false
  var best: FleetReleaseFeed.Release?

  init(repository: String, current: [Int]) { self.repository = repository; self.current = current }

  func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?,
        qualifiedName qName: String?, attributes: [String: String]) {
    let element = "{\(namespaceURI ?? "")}\(elementName)"
    if stack.isEmpty {
      validRoot = namespaceURI == atom && elementName == "feed"
      if !validRoot { parser.abortParsing(); return }
    }
    stack.append(element)
    if stack == ["{\(atom)}feed", "{\(atom)}entry"] { entries += 1 }
    guard stack == ["{\(atom)}feed", "{\(atom)}entry", "{\(atom)}link"],
       attributes["rel", default: "alternate"] == "alternate", let page = attributes["href"] else { return }
    let prefix = "https://github.com/\(repository)/releases/tag/"
    guard page.hasPrefix(prefix) else { return }
    let tag = String(page.dropFirst(prefix.count))
    // Releases before 0.3.7 had one tag per platform, such as macos-v0.3.6; they never match this prefix.
    guard tag.hasPrefix("v"), let version = FleetReleaseFeed.version(String(tag.dropFirst(1))) else { return }
    found = true
    guard current.lexicographicallyPrecedes(version) else { return }
    if let best, !best.version.lexicographicallyPrecedes(version) { return }
    best = .init(tag: tag, version: version, appcast: "https://github.com/\(repository)/releases/download/\(tag)/appcast.xml")
  }

  func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
    if !stack.isEmpty { stack.removeLast() }
  }
}
