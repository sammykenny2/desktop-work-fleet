import Foundation

final class BoundedHTTP: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    private let maximum: Int
    private var bytes = Data()
    private var response: HTTPURLResponse?
    private var continuation: CheckedContinuation<(Data, HTTPURLResponse), Error>?
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var failure: Error?
    init(maximum: Int) { self.maximum = maximum }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                self.continuation = continuation
                let configuration = URLSessionConfiguration.ephemeral; configuration.timeoutIntervalForRequest = 30; configuration.timeoutIntervalForResource = 110
                configuration.httpCookieStorage = nil; configuration.urlCache = nil
                let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil); self.session = session
                let task = session.dataTask(with: request); self.task = task; task.resume()
            }
        }, onCancel: { self.task?.cancel() })
    }
    func cancel() { task?.cancel() }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let http = response as? HTTPURLResponse, response.expectedContentLength < 0 || response.expectedContentLength <= maximum else {
            failure = FleetFailure("response-size", "Google's response is over the size limit."); completionHandler(.cancel); return
        }
        self.response = http; completionHandler(.allow)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        if bytes.count + data.count > maximum { failure = FleetFailure("response-size", "Google's response is over the size limit."); dataTask.cancel() }
        else { bytes.append(data) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        defer { session.finishTasksAndInvalidate(); self.session = nil; self.task = nil; continuation = nil }
        if let failure = failure ?? error { continuation?.resume(throwing: failure) }
        else if let response { continuation?.resume(returning: (bytes, response)) }
        else { continuation?.resume(throwing: FleetFailure("network", "Google didn't return a complete response.")) }
    }
}
