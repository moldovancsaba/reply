import SwiftUI
import WebKit

@MainActor
final class ReplyWorkspaceStore: NSObject, ObservableObject, WKNavigationDelegate {
    let webView: WKWebView

    override init() {
        Self.clearTransientCaches()
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let view = WKWebView(frame: .zero, configuration: config)
        view.allowsBackForwardNavigationGestures = true
        view.setValue(false, forKey: "drawsBackground")
        view.navigationDelegate = nil
        self.webView = view
        super.init()
        view.navigationDelegate = self
    }

    private static func clearTransientCaches() {
        let cacheTypes: Set<String> = [
            WKWebsiteDataTypeDiskCache,
            WKWebsiteDataTypeMemoryCache,
            WKWebsiteDataTypeFetchCache,
            WKWebsiteDataTypeOfflineWebApplicationCache,
            WKWebsiteDataTypeServiceWorkerRegistrations,
        ]
        WKWebsiteDataStore.default().removeData(ofTypes: cacheTypes, modifiedSince: .distantPast) {}
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(250))
            injectNativeShellMarker(into: webView)
            openFirstConversationIfNeeded(in: webView)
        }
    }

    private func injectNativeShellMarker(into webView: WKWebView) {
        let script = """
        document.body.classList.add('native-shell');
        true;
        """
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    private func openFirstConversationIfNeeded(in webView: WKWebView) {
        let script = """
        (() => {
          const handles = Array.from(document.querySelectorAll('.sidebar-item[data-handle]'))
            .map((node) => String(node.getAttribute('data-handle') || '').trim())
            .filter(Boolean);
          const currentHandle = String(window.currentHandle || '').trim();
          const inDashboard = document.body.classList.contains('mode-dashboard');
          if ((!currentHandle || inDashboard) && handles.length > 0 && typeof window.selectContact === 'function') {
            window.selectContact(handles[0]);
            return { repaired: true, handle: handles[0], inDashboard };
          }
          return { repaired: false, handle: currentHandle, inDashboard, count: handles.length };
        })();
        """
        webView.evaluateJavaScript(script, completionHandler: nil)
    }
}

struct ReplyWebView: NSViewRepresentable {
    let webView: WKWebView
    let url: URL?

    func makeNSView(context: Context) -> WKWebView {
        webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        guard let url else { return }
        let targetURL = cacheBustedURL(from: url)
        if webView.url == nil {
            webView.load(reloadRequest(for: targetURL))
            return
        }
        if normalizedURLString(webView.url) != normalizedURLString(targetURL) {
            webView.load(reloadRequest(for: targetURL))
        }
    }

    private func reloadRequest(for url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 15
        return request
    }

    private func cacheBustedURL(from url: URL) -> URL {
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url
        }
        var items = components.queryItems ?? []
        if !items.contains(where: { $0.name == "reply_native_shell" }) {
            items.append(URLQueryItem(name: "reply_native_shell", value: "1"))
        }
        components.queryItems = items
        return components.url ?? url
    }

    private func normalizedURLString(_ url: URL?) -> String {
        guard let url, let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return ""
        }
        return components.string ?? url.absoluteString
    }
}
