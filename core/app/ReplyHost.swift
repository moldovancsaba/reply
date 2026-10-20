import AppKit
import Contacts
import Foundation

// {reply}.app host. macOS attaches Full Disk Access to the program that launches the service, so the service is started
// from this signed, named bundle: System Settings then lists "{reply}" with its icon instead of a bare "node".
//   reply --service   run the Reply Core service as a child of this app (what the login agent starts)
//   reply --consent-send   ask macOS for Automation of Messages, Mail and System Events and for Accessibility, for {reply}
//   reply --consent   ask macOS for Contacts access on behalf of {reply} (the prompt only shows for an app that asks)
//   reply             (double-click) make sure the service is running and open the UI in Safari

struct Config: Decodable { let node: String; let entry: String; let cwd: String; let launcher: String }

guard let url = Bundle.main.url(forResource: "reply-core", withExtension: "json"),
      let data = try? Data(contentsOf: url),
      let cfg = try? JSONDecoder().decode(Config.self, from: data) else {
    FileHandle.standardError.write(Data("{reply}: missing Contents/Resources/reply-core.json (rebuild with core/app/build-app.sh)\n".utf8))
    exit(78)
}

func spawn(_ args: [String]) -> Process {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: cfg.node)
    p.arguments = args
    p.currentDirectoryURL = URL(fileURLWithPath: cfg.cwd)
    var env = ProcessInfo.processInfo.environment
    let nodeDir = (cfg.node as NSString).deletingLastPathComponent
    env["PATH"] = "\(nodeDir):/usr/bin:/bin:/usr/sbin:/sbin:" + (env["PATH"] ?? "")
    p.environment = env
    return p
}

if CommandLine.arguments.dropFirst().first == "--consent-send" {
    // Sending messages drives Messages, Mail and (for WhatsApp) System Events with AppleScript. macOS lists {reply} under
    // Privacy > Automation / Accessibility only after the app itself asks, so this mode asks, one target at a time.
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.activate(ignoringOtherApps: true)
    let targets = [("Messages", "com.apple.MobileSMS"), ("Mail", "com.apple.mail"), ("System Events (for WhatsApp)", "com.apple.systemevents")]
    DispatchQueue.global().async {
        var lines: [String] = []
        for (name, bundleId) in targets {
            if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) {
                let cfg = NSWorkspace.OpenConfiguration(); cfg.activates = false; cfg.hides = true
                let sem = DispatchSemaphore(value: 0)
                NSWorkspace.shared.openApplication(at: url, configuration: cfg) { _, _ in sem.signal() }
                sem.wait()
                Thread.sleep(forTimeInterval: 1.5)
            }
            var addr = AEAddressDesc()
            let id = Array(bundleId.utf8)
            AECreateDesc(DescType(typeApplicationBundleID), id, id.count, &addr)
            let status = AEDeterminePermissionToAutomateTarget(&addr, AEEventClass(typeWildCard), AEEventID(typeWildCard), true)
            AEDisposeDesc(&addr)
            lines.append("\(name): " + (status == noErr ? "allowed" : status == OSStatus(errAEEventNotPermitted) ? "not allowed (switch it on in System Settings > Privacy & Security > Automation)" : "not available (\(status))"))
        }
        let trusted = AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
        lines.append("Accessibility (for WhatsApp): " + (trusted ? "allowed" : "switch {reply} on in System Settings > Privacy & Security > Accessibility"))
        DispatchQueue.main.async {
            let a = NSAlert()
            a.messageText = "{reply} sending permissions"
            a.informativeText = lines.joined(separator: "\n")
            a.runModal()
            exit(0)
        }
    }
    app.run()
} else if CommandLine.arguments.dropFirst().first == "--consent" {
    // The request must come from this bundle's own process: only it has NSContactsUsageDescription and the
    // addressbook entitlement, so only it can make macOS show the prompt (and list {reply} under Contacts).
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.activate(ignoringOtherApps: true)
    CNContactStore().requestAccess(for: .contacts) { granted, _ in
        let alert = DispatchQueue.main
        alert.async {
            let a = NSAlert()
            a.messageText = granted ? "{reply} can read your Contacts." : "{reply} cannot read your Contacts."
            a.informativeText = granted ? "Names in your inbox will now come from your address book." : "Switch {reply} on in System Settings > Privacy & Security > Contacts if you want real names."
            a.runModal()
            exit(granted ? 0 : 1)
        }
    }
    app.run()
} else if CommandLine.arguments.dropFirst().first == "--service" {
    let child = spawn([cfg.entry])
    do { try child.run() } catch { FileHandle.standardError.write(Data("{reply}: cannot start node: \(error)\n".utf8)); exit(1) }
    var sources: [DispatchSourceSignal] = []
    for sig in [SIGTERM, SIGINT] {
        signal(sig, SIG_IGN)
        let s = DispatchSource.makeSignalSource(signal: sig, queue: .main)
        s.setEventHandler { child.terminate() }
        s.resume()
        sources.append(s)
    }
    DispatchQueue.global().async { child.waitUntilExit(); exit(child.terminationStatus) }
    dispatchMain()
} else {
    let p = spawn([cfg.launcher, "start", "--background"])
    do { try p.run(); p.waitUntilExit(); exit(p.terminationStatus) } catch { exit(1) }
}
