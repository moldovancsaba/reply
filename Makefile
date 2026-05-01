# Local run (macOS): `make run` starts the hub in the current user session.
# Optional legacy LaunchAgent install remains under `make run-launchd`. CI build gate: `cd chat && npm test && npm run lint`.
.PHONY: run
run:
	chmod +x ./tools/scripts/reply_session_start.sh
	./tools/scripts/reply_session_start.sh

.PHONY: run-app
run-app:
	chmod +x ./script/build_and_run.sh ./app/reply-app/build-bundle.sh
	./script/build_and_run.sh --verify

.PHONY: build-app
build-app:
	chmod +x ./app/reply-app/build-bundle.sh
	cd ./app/reply-app && ./build-bundle.sh

.PHONY: stop
stop:
	@chmod +x ./runbook/stop.sh
	@./runbook/stop.sh

.PHONY: status
status:
	./runbook/status.sh

.PHONY: run-launchd
run-launchd:
	$(MAKE) install-service

.PHONY: doctor
doctor:
	chmod +x ./runbook/doctor.sh
	./runbook/doctor.sh

.PHONY: install-service
install-service:
	chmod +x ./tools/scripts/reply_service.sh
	@mkdir -p "$$HOME/Library/LaunchAgents" "$$HOME/Library/Logs/Reply"
	@python3 -c 'from pathlib import Path; import shutil; home=Path.home(); repo=Path.cwd(); cand=[shutil.which("node") or "", "/opt/homebrew/bin/node", "/usr/local/bin/node"]; node_bin=next((c for c in cand if c and Path(c).is_file()), cand[1]); template=(repo / "tools" / "launchd" / "com.reply.hub.plist").read_text(encoding="utf-8"); out=template.replace("__HOME__", str(home)).replace("__REPO_ROOT__", str(repo)).replace("__REPLY_NODE_BIN__", node_bin); target=home / "Library" / "LaunchAgents" / "com.reply.hub.plist"; target.write_text(out, encoding="utf-8"); print("Wrote", target, "| REPLY_NODE_BIN=" + node_bin)'
	@launchctl unload "$$HOME/Library/LaunchAgents/com.reply.hub.plist" >/dev/null 2>&1 || true
	@launchctl load -w "$$HOME/Library/LaunchAgents/com.reply.hub.plist"
	@echo "Service installed: com.reply.hub"
	@echo "If you moved this repo, run \`make run\` again from the new root (see also: make doctor)."

.PHONY: uninstall-service
uninstall-service:
	@launchctl unload "$$HOME/Library/LaunchAgents/com.reply.hub.plist" >/dev/null 2>&1 || true
	@rm -f "$$HOME/Library/LaunchAgents/com.reply.hub.plist"
	@echo "Service removed: com.reply.hub"
