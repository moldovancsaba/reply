# Local deploy (macOS): `make run` installs/reloads `com.reply.hub` LaunchAgent from this repo.
# Validate plist vs checkout: `make doctor`. CI build gate: `cd chat && npm test && npm run lint`.
.PHONY: run
run:
	$(MAKE) install-service

.PHONY: stop
stop:
	@chmod +x ./runbook/stop.sh
	@./runbook/stop.sh

.PHONY: status
status:
	./runbook/status.sh

.PHONY: doctor
doctor:
	chmod +x ./runbook/doctor.sh
	./runbook/doctor.sh

.PHONY: install-ReplyMenubar
install-ReplyMenubar:
	chmod +x ./tools/macos/ReplyMenubar/install_ReplyMenubar.sh
	./tools/macos/ReplyMenubar/install_ReplyMenubar.sh

.PHONY: run-ReplyMenubar
run-ReplyMenubar:
	open "$$HOME/Applications/ReplyMenubar.app"

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

# --- {hatori} sibling (https://github.com/moldovancsaba/hatori) — expected at ../hatori from this repo root ---
.PHONY: hatori-clone
hatori-clone:
	@if [ -d "$$(cd .. && pwd)/hatori/.git" ]; then echo "Already present: $$(cd .. && pwd)/hatori"; \
	else echo "Cloning moldovancsaba/hatori -> $$(cd .. && pwd)/hatori ..." && git clone https://github.com/moldovancsaba/hatori.git "$$(cd .. && pwd)/hatori"; fi

.PHONY: hatori-bootstrap
hatori-bootstrap:
	@$(MAKE) hatori-clone
	@HATORI_ROOT="$$(cd .. && pwd)/hatori"; \
	test -d "$$HATORI_ROOT/.git" || (echo "Missing $$HATORI_ROOT — run: make hatori-clone" && exit 1); \
	echo "Running official Hatori bootstrap (venv, DB reset, models, LaunchAgent)…"; \
	cd "$$HATORI_ROOT" && make up && sleep 6 && ./tools/scripts/hatori_bootstrap.sh

.PHONY: hatori-doctor
hatori-doctor:
	@test -d "$$(cd .. && pwd)/hatori" && (cd "$$(cd .. && pwd)/hatori" && $(MAKE) doctor) || echo "No ../hatori — run: make hatori-clone"

.PHONY: hatori-preflight
hatori-preflight:
	@chmod +x ./tools/scripts/reply_hatori_preflight.sh
	@./tools/scripts/reply_hatori_preflight.sh
