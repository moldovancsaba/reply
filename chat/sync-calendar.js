const crypto = require("crypto");
const path = require("path");
const { execFile } = require("child_process");
const { addDocuments, connect } = require("./vector-store.js");
const { saveMessages } = require("./message-store.js");
const statusManager = require("./status-manager.js");
const { dataPath, ensureDataHome } = require("./app-paths.js");
const SWIFT_CALENDAR_EXPORTER = path.join(__dirname, "native", "apple-calendar-export.swift");
const XCRUN_BIN = "/usr/bin/xcrun";

function updateStatus(status) {
  statusManager.update("calendar", status);
}

function escapeForAppleScript(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function sanitizeField(value) {
  return String(value || "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function stableCalendarId(event) {
  const seed = [
    event.calendar,
    event.title,
    event.start,
    event.end,
    event.location,
  ].join("||");
  return crypto.createHash("sha1").update(seed).digest("hex");
}

async function getExistingCalendarIds() {
  try {
    const db = await connect();
    const table = await db.openTable("documents");
    const rows = await table
      .query()
      .where("source = 'apple-calendar'")
      .select(["id"])
      .execute();
    const ids = new Set();
    for await (const batch of rows) {
      for (const row of batch) {
        const value = row?.toJSON ? row.toJSON() : row;
        if (value?.id) ids.add(String(value.id));
      }
    }
    return ids;
  } catch {
    return new Set();
  }
}

async function readCalendarEvents() {
  const raw = await new Promise((resolve, reject) => {
    ensureDataHome();
    const binPath = dataPath("bin", "apple-calendar-export");
    execFile(
      XCRUN_BIN,
      ["--sdk", "macosx", "swiftc", "-parse-as-library", SWIFT_CALENDAR_EXPORTER, "-o", binPath],
      { maxBuffer: 20 * 1024 * 1024, timeout: 120000 },
      (compileErr, _compileStdout, compileStderr) => {
        if (compileErr) {
          const detail = String(compileStderr || compileErr.message || "").trim();
          return reject(new Error(detail || "Calendar export compile failed"));
        }
        execFile(
          binPath,
          [],
          { maxBuffer: 50 * 1024 * 1024, timeout: 120000 },
          (err, stdout, stderr) => {
        if (err) {
          const detail = String(stderr || err.message || "").trim();
          return reject(new Error(detail || "Calendar export failed"));
        }
        resolve(String(stdout || "").trim());
          }
        );
      }
    );
  });
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  return (Array.isArray(parsed) ? parsed : [])
    .map((event) => ({
      calendar: sanitizeField(event.calendar),
      title: sanitizeField(event.title),
      start: sanitizeField(event.start),
      end: sanitizeField(event.end),
      location: sanitizeField(event.location),
      description: sanitizeField(event.description),
    }))
    .filter((event) => event.title && event.start);
}

async function syncCalendar(limit = null) {
  try {
    updateStatus({ state: "running", progress: 0, message: "Reading Apple Calendar events..." });
    const events = await readCalendarEvents();
    const boundedEvents = Number(limit) > 0 ? events.slice(0, Number(limit)) : events;

    if (boundedEvents.length === 0) {
      const stats = {
        state: "idle",
        progress: 100,
        message: "No calendar events found in the sync window.",
        lastSync: new Date().toISOString(),
        total: 0,
        processed: 0,
        added: 0
      };
      updateStatus(stats);
      return stats;
    }

    const existingIds = await getExistingCalendarIds();
    const docs = [];
    const messages = [];

    for (let i = 0; i < boundedEvents.length; i += 1) {
      const event = boundedEvents[i];
      if (i % 25 === 0) {
        updateStatus({
          state: "running",
          progress: Math.round((i / boundedEvents.length) * 100),
          message: `Preparing event ${i + 1}/${boundedEvents.length}...`,
        });
      }

      const eventId = `apple-calendar-${stableCalendarId(event)}`;
      const text = [
        `[${event.start}] Calendar: ${event.title}`,
        `Calendar: ${event.calendar}`,
        `Starts: ${event.start}`,
        event.end ? `Ends: ${event.end}` : "",
        event.location ? `Location: ${event.location}` : "",
        event.description ? `Notes: ${event.description}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      messages.push({
        id: eventId,
        text,
        source: "apple-calendar",
        handle: event.calendar || "Calendar",
        timestamp: new Date(event.start).toISOString(),
        path: `${event.calendar}/${event.title}`,
      });

      if (!existingIds.has(eventId)) {
        docs.push({
          id: eventId,
          text,
          source: "apple-calendar",
          path: `${event.calendar}/${event.title}`,
        });
      }
    }

    updateStatus({
      state: "running",
      progress: 80,
      message: `Saving ${messages.length} calendar events...`,
    });

    await saveMessages(messages);
    if (docs.length > 0) {
      await addDocuments(docs);
    }

    const stats = {
      state: "idle",
      progress: 100,
      message: `Calendar sync complete. ${messages.length} events indexed.`,
      lastSync: new Date().toISOString(),
      total: boundedEvents.length,
      processed: messages.length,
      added: docs.length,
    };
    updateStatus(stats);
    return stats;
  } catch (error) {
    updateStatus({
      state: "error",
      progress: 0,
      message: error.message,
    });
    throw error;
  }
}

module.exports = {
  syncCalendar,
};

if (require.main === module) {
  const limitArg = process.argv.includes("--limit")
    ? Number(process.argv[process.argv.indexOf("--limit") + 1] || 0)
    : null;

  syncCalendar(limitArg).catch((error) => {
    console.error(error);
    updateStatus({ state: "error", message: error.message });
    process.exitCode = 1;
  });
}
