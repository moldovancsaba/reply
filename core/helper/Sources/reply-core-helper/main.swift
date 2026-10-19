import Foundation
import HelperCore

signal(SIGPIPE, SIG_IGN) // a reader that went away must end the export quietly, not crash it
exit(CLI.run(Array(CommandLine.arguments.dropFirst())))
