.PHONY: run
run:
	./runbook/start.sh

.PHONY: stop
stop:
	./runbook/stop.sh

.PHONY: status
status:
	./runbook/status.sh

.PHONY: install-reply-toolbar
install-reply-toolbar:
	chmod +x ./tools/macos/reply-toolbar/install_menubar_app.sh
	./tools/macos/reply-toolbar/install_menubar_app.sh

.PHONY: run-reply-toolbar
run-reply-toolbar:
	open "$$HOME/Applications/reply-toolbar.app"
