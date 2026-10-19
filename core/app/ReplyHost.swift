import Foundation

// {reply}.app host. macOS attaches Full Disk Access to the program that launches the service, so the service is started
// from this signed, named bundle: System Settings then lists "{reply}" with its icon instead of a bare "node".
//   reply --service   run the Reply Core service as a child of this app (what the login agent starts)
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

if CommandLine.arguments.dropFirst().first == "--service" {
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
