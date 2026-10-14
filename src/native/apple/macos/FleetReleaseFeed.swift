import Foundation

/// ADR-044 public release discovery. Atom carries published previews; asset URLs stay in the configured repository/tag.
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
      throw FleetFailure("metadata_invalid", "更新資訊格式不符，未下載任何檔案。")
    }
    let delegate = ReleaseParser(repository: repository, current: current)
    let parser = XMLParser(data: data)
    parser.shouldProcessNamespaces = true
    parser.shouldResolveExternalEntities = false
    parser.delegate = delegate
    guard parser.parse(), delegate.validRoot else {
      throw FleetFailure("metadata_invalid", "更新資訊格式不符，未下載任何檔案。")
    }
    if delegate.entries > 0 && !delegate.foundPlatform {
      throw FleetFailure("metadata_invalid", "來源未列出這個平台的版本，請至 Releases 頁面確認。")
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
  var foundPlatform = false
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
    guard tag.hasPrefix("macos-v"), let version = FleetReleaseFeed.version(String(tag.dropFirst(7))) else { return }
    foundPlatform = true
    guard current.lexicographicallyPrecedes(version) else { return }
    if let best, !best.version.lexicographicallyPrecedes(version) { return }
    best = .init(tag: tag, version: version, appcast: "https://github.com/\(repository)/releases/download/\(tag)/appcast.xml")
  }

  func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
    if !stack.isEmpty { stack.removeLast() }
  }
}
