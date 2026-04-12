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
	@python3 -c 'from pathlib import Path; home=Path.home(); repo=Path.cwd(); template=(repo / "tools" / "launchd" / "com.reply.hub.plist").read_text(encoding="utf-8"); out=template.replace("__HOME__", str(home)).replace("__REPO_ROOT__", str(repo)); target=home / "Library" / "LaunchAgents" / "com.reply.hub.plist"; target.write_text(out, encoding="utf-8"); print("Wrote", target)'
	@launchctl unload "$$HOME/Library/LaunchAgents/com.reply.hub.plist" >/dev/null 2>&1 || true
	@launchctl load -w "$$HOME/Library/LaunchAgents/com.reply.hub.plist"
	@echo "Service installed: com.reply.hub"
	@echo "If you moved this repo, run \`make run\` again from the new root (see also: make doctor)."

.PHONY: uninstall-service
uninstall-service:
	@launchctl unload "$$HOME/Library/LaunchAgents/com.reply.hub.plist" >/dev/null 2>&1 || true
	@rm -f "$$HOME/Library/LaunchAgents/com.reply.hub.plist"
	@echo "Service removed: com.reply.hub"
