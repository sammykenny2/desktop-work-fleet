import Foundation

/// A reusable account-owned transport. Each task keeps its own bounded response and cancellation state.
final class BoundedHTTPSession: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var clients: [Int: BoundedHTTP] = [:]
    private var closed = false
    private var session: URLSession!
    override init() {
        super.init()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 30; configuration.timeoutIntervalForResource = 110
        configuration.httpCookieStorage = nil; configuration.urlCache = nil; configuration.urlCredentialStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }
    func start(_ request: URLRequest, client: BoundedHTTP) {
        lock.lock()
        guard !closed else { lock.unlock(); client.complete(CancellationError()); return }
        let task = session.dataTask(with: request); clients[task.taskIdentifier] = client
        lock.unlock()
        client.attach(task); task.resume()
    }
    func close() {
        lock.lock(); let retire = !closed; closed = true; lock.unlock()
        if retire { session.invalidateAndCancel() }
    }
    private func client(_ task: URLSessionTask, remove: Bool = false) -> BoundedHTTP? {
        lock.lock(); defer { lock.unlock() }
        return remove ? clients.removeValue(forKey: task.taskIdentifier) : clients[task.taskIdentifier]
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        completionHandler(client(dataTask)?.receive(response) == true ? .allow : .cancel)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        if client(dataTask)?.receive(data) != true { dataTask.cancel() }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didFinishCollecting metrics: URLSessionTaskMetrics) {
        client(task)?.collect(metrics)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        client(task, remove: true)?.complete(error)
    }
}

final class BoundedHTTP: @unchecked Sendable {
    struct Metrics: Sendable {
        let duration: Double
        let transactions: Int
        let reusedConnections: Int
    }
    private let maximum: Int
    private let pool: BoundedHTTPSession
    private let ownsPool: Bool
    private let lock = NSLock()
    private var bytes = Data()
    private var response: HTTPURLResponse?
    private var continuation: CheckedContinuation<(Data, HTTPURLResponse), Error>?
    private var task: URLSessionDataTask?
    private var failure: Error?
    private var cancelled = false
    private var started = false
    private var measured: Metrics?
    var metrics: Metrics? { lock.lock(); defer { lock.unlock() }; return measured }
    init(maximum: Int, session: BoundedHTTPSession? = nil) {
        self.maximum = maximum; pool = session ?? BoundedHTTPSession(); ownsPool = session == nil
    }
    deinit { if ownsPool { pool.close() } }
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        defer { if ownsPool { pool.close() } }
        return try await withTaskCancellationHandler(operation: {
            try await withCheckedThrowingContinuation { continuation in
                lock.lock()
                guard !started else {
                    lock.unlock(); continuation.resume(throwing: PinItAnywhereFailure("invalid-request", "The HTTP task has already started.")); return
                }
                started = true
                guard !cancelled else { lock.unlock(); continuation.resume(throwing: CancellationError()); return }
                self.continuation = continuation; lock.unlock()
                pool.start(request, client: self)
            }
        }, onCancel: { self.cancel() })
    }
    func cancel() {
        lock.lock(); cancelled = true; let active = task; lock.unlock(); active?.cancel()
    }
    fileprivate func attach(_ task: URLSessionDataTask) {
        lock.lock(); let cancel = cancelled || continuation == nil
        if !cancel { self.task = task }; lock.unlock()
        if cancel { task.cancel() }
    }
    fileprivate func receive(_ response: URLResponse) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard !cancelled, continuation != nil else { return false }
        guard let http = response as? HTTPURLResponse, response.expectedContentLength < 0 || response.expectedContentLength <= maximum else {
            failure = PinItAnywhereFailure("response-size", "Google's response is over the size limit."); return false
        }
        self.response = http; return true
    }
    fileprivate func receive(_ data: Data) -> Bool {
        lock.lock(); defer { lock.unlock() }
        guard !cancelled, continuation != nil else { return false }
        guard data.count <= maximum - bytes.count else {
            failure = PinItAnywhereFailure("response-size", "Google's response is over the size limit."); return false
        }
        bytes.append(data); return true
    }
    fileprivate func collect(_ value: URLSessionTaskMetrics) {
        lock.lock(); defer { lock.unlock() }
        measured = Metrics(duration: value.taskInterval.duration, transactions: value.transactionMetrics.count,
                           reusedConnections: value.transactionMetrics.filter { $0.isReusedConnection }.count)
    }
    fileprivate func complete(_ error: Error?) {
        lock.lock()
        let waiting = continuation; continuation = nil; task = nil
        let result: Result<(Data, HTTPURLResponse), Error>
        if let failure = failure ?? (cancelled ? CancellationError() : error) { result = .failure(failure) }
        else if let response { result = .success((bytes, response)) }
        else { result = .failure(PinItAnywhereFailure("network", "Google didn't return a complete response.")) }
        bytes = Data(); lock.unlock()
        waiting?.resume(with: result)
    }
}
