import Foundation

/// A `URLProtocol` that serves canned responses from an in-memory map instead of hitting the
/// network. Tests register `URL -> Data` pairs; a registered URL returns HTTP 200 with that data,
/// anything else returns HTTP 404. `stub(status:…)` registers a non-200 answer, and
/// `requests(to:)` returns what was sent (method, headers, body) for assertions.
///
/// Swift Testing runs tests concurrently by default, so the maps are guarded by an `NSLock`.
/// Seed each stubbed `URLSession` with its own distinct URLs so tests don't collide.
public final class StubURLProtocol: URLProtocol, @unchecked Sendable {
    public struct Response: Sendable {
        public var status: Int
        public var body: Data
        /// When set, the request fails with this transport error (offline) instead of answering.
        public var error: URLError?
        /// Seconds to hold the answer back, for tests that need a request to be in flight.
        public var delay: TimeInterval = 0
        public init(status: Int = 200, body: Data, delay: TimeInterval = 0) {
            self.status = status
            self.body = body
            self.delay = delay
        }

        /// A connection failure, as if the network were down.
        public static func offline(_ code: URLError.Code = .notConnectedToInternet) -> Response {
            var r = Response(body: Data())
            r.error = URLError(code)
            return r
        }
    }

    public struct Recorded: Sendable {
        public let method: String
        public let headers: [String: String]
        public let body: Data?
    }

    /// Everything the stub remembers, behind one lock so the statics are concurrency-safe.
    private struct State {
        var responses: [String: [Response]] = [:]
        var recorded: [String: [Recorded]] = [:]
        var order: [String] = []
    }

    private static let state = Locked(State())

    /// Registers absolute-URL-string -> 200 body, merging into existing entries.
    public static func stub(_ map: [String: Data]) {
        state.withLock { s in
            for (key, value) in map { s.responses[key] = [Response(body: value)] }
        }
    }

    /// Registers a sequence of answers for one URL, served in order (the last one repeats).
    public static func stub(_ url: String, _ sequence: [Response]) {
        state.withLock { $0.responses[url] = sequence }
    }

    public static func requests(to url: String) -> [Recorded] {
        state.withLock { $0.recorded[url] ?? [] }
    }

    /// Every URL requested so far, in order. Filter by host: the log is shared across tests.
    public static func requestedURLs() -> [String] {
        state.withLock { $0.order }
    }

    private static func take(for request: URLRequest) -> Response? {
        guard let url = request.url?.absoluteString else { return nil }
        let body =
            request.httpBody
            ?? request.httpBodyStream.map { stream in
                stream.open()
                defer { stream.close() }
                var data = Data()
                var buffer = [UInt8](repeating: 0, count: 4096)
                while stream.hasBytesAvailable {
                    let n = stream.read(&buffer, maxLength: buffer.count)
                    if n <= 0 { break }
                    data.append(buffer, count: n)
                }
                return data
            }
        return state.withLock { s in
            s.order.append(url)
            s.recorded[url, default: []].append(
                Recorded(method: request.httpMethod ?? "GET", headers: request.allHTTPHeaderFields ?? [:], body: body))
            guard var queue = s.responses[url], let first = queue.first else { return nil }
            if queue.count > 1 { queue.removeFirst(); s.responses[url] = queue }
            return first
        }
    }

    public override class func canInit(with request: URLRequest) -> Bool { true }

    public override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    public override func startLoading() {
        guard let url = request.url else { return }
        let answer = Self.take(for: request) ?? Response(status: 404, body: Data("not found".utf8))
        // Delayed answers are delivered from another queue: sleeping here would hold up every other request,
        // since URLSession drives all its protocols from one thread.
        if answer.delay > 0 {
            DispatchQueue.global().asyncAfter(deadline: .now() + answer.delay) { self.deliver(answer, for: url) }
        } else {
            deliver(answer, for: url)
        }
    }

    private func deliver(_ answer: Response, for url: URL) {
        if let error = answer.error {
            client?.urlProtocol(self, didFailWithError: error)
            return
        }
        let response = HTTPURLResponse(
            url: url, statusCode: answer.status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: answer.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    public override func stopLoading() {}
}

/// A value behind an `NSLock`: the stub's shared maps, counters captured by test closures.
public final class Locked<Value>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value

    public init(_ value: Value) { self.value = value }

    public func withLock<T>(_ body: (inout Value) throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body(&value)
    }
}

/// A `URLSession` whose every request is answered by `StubURLProtocol`.
public func stubbedSession(_ map: [String: Data] = [:]) -> URLSession {
    StubURLProtocol.stub(map)
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [StubURLProtocol.self]
    return URLSession(configuration: config)
}
