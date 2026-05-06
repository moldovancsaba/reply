#!/usr/bin/env node
"use strict";

const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const { dataPath } = require("../app-paths.js");

const DB_PATH = process.env.REPLY_CHAT_DB_PATH || dataPath("chat.db");
const FAIL_ON_ISSUES = process.argv.includes("--fail-on-issues");
const JSON_OUTPUT = process.argv.includes("--json");

function openDb(dbPath) {
  const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY);
  try {
    db.configure("busyTimeout", 20000);
  } catch {
    // ignore if unsupported
  }
  return db;
}

function allDb(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function getDb(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function closeDb(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function collectAudit(db) {
  const overview = await getDb(db, `
    SELECT
      (SELECT COUNT(*) FROM conversation_snapshots) AS conversations,
      (SELECT COUNT(*) FROM conversation_messages) AS messages,
      (SELECT COUNT(*) FROM conversation_channel_capabilities) AS capability_rows,
      (SELECT COUNT(*) FROM conversation_index) AS conversation_index_rows
  `);

  const capabilityMismatches = await allDb(db, `
    WITH message_channels AS (
      SELECT
        conversation_id,
        COUNT(DISTINCT channel) AS channel_count,
        GROUP_CONCAT(DISTINCT channel) AS channels
      FROM conversation_messages
      GROUP BY conversation_id
    ),
    capability_channels AS (
      SELECT
        conversation_id,
        COUNT(DISTINCT channel) AS channel_count,
        GROUP_CONCAT(DISTINCT channel) AS channels
      FROM conversation_channel_capabilities
      GROUP BY conversation_id
    )
    SELECT
      cs.conversation_id,
      cs.title,
      COALESCE(mc.channels, '') AS message_channels,
      COALESCE(cc.channels, '') AS capability_channels,
      COALESCE(mc.channel_count, 0) AS message_channel_count,
      COALESCE(cc.channel_count, 0) AS capability_channel_count
    FROM conversation_snapshots cs
    LEFT JOIN message_channels mc ON mc.conversation_id = cs.conversation_id
    LEFT JOIN capability_channels cc ON cc.conversation_id = cs.conversation_id
    WHERE COALESCE(mc.channels, '') != COALESCE(cc.channels, '')
    ORDER BY cs.latest_message_at DESC, cs.conversation_id DESC
  `);

  const duplicateConversationIndexHandles = await allDb(db, `
    SELECT
      handle,
      COUNT(*) AS duplicates
    FROM conversation_index
    GROUP BY handle
    HAVING COUNT(*) > 1
    ORDER BY duplicates DESC, handle ASC
  `);

  const staleSameMembershipSnapshots = await allDb(db, `
    WITH grouped AS (
      SELECT
        COALESCE(external_thread_id, 'direct:' || channel) AS thread_scope,
        membership_fingerprint,
        COUNT(*) AS snapshot_count,
        GROUP_CONCAT(conversation_id) AS conversation_ids,
        MAX(latest_message_at) AS latest_message_at
      FROM conversation_snapshots
      GROUP BY 1, 2
      HAVING COUNT(*) > 1
    )
    SELECT
      thread_scope,
      membership_fingerprint,
      snapshot_count,
      conversation_ids,
      latest_message_at
    FROM grouped
    ORDER BY latest_message_at DESC, snapshot_count DESC
  `);

  const snapshotsWithoutMessages = await allDb(db, `
    SELECT
      cs.conversation_id,
      cs.title,
      cs.latest_message_at
    FROM conversation_snapshots cs
    LEFT JOIN conversation_messages cm ON cm.conversation_id = cs.conversation_id
    WHERE cm.message_id IS NULL
    ORDER BY cs.latest_message_at DESC, cs.conversation_id DESC
  `);

  return {
    dbPath: DB_PATH,
    checkedAt: new Date().toISOString(),
    overview: {
      conversations: Number(overview?.conversations) || 0,
      messages: Number(overview?.messages) || 0,
      capabilityRows: Number(overview?.capability_rows) || 0,
      conversationIndexRows: Number(overview?.conversation_index_rows) || 0,
    },
    checks: {
      capabilityMismatches,
      duplicateConversationIndexHandles,
      staleSameMembershipSnapshots,
      snapshotsWithoutMessages,
    },
  };
}

function summarize(report) {
  return {
    capabilityMismatchCount: report.checks.capabilityMismatches.length,
    duplicateConversationIndexHandleCount: report.checks.duplicateConversationIndexHandles.length,
    staleSameMembershipSnapshotCount: report.checks.staleSameMembershipSnapshots.length,
    snapshotsWithoutMessagesCount: report.checks.snapshotsWithoutMessages.length,
  };
}

function printHuman(report) {
  const summary = summarize(report);
  console.log(`conversation-integrity audit`);
  console.log(`db: ${report.dbPath}`);
  console.log(`checked_at: ${report.checkedAt}`);
  console.log(`overview: conversations=${report.overview.conversations} messages=${report.overview.messages} capability_rows=${report.overview.capabilityRows} conversation_index_rows=${report.overview.conversationIndexRows}`);
  console.log(`capability_mismatch_count: ${summary.capabilityMismatchCount}`);
  console.log(`duplicate_conversation_index_handle_count: ${summary.duplicateConversationIndexHandleCount}`);
  console.log(`stale_same_membership_snapshot_count: ${summary.staleSameMembershipSnapshotCount}`);
  console.log(`snapshots_without_messages_count: ${summary.snapshotsWithoutMessagesCount}`);

  const sections = [
    ["capability mismatches", report.checks.capabilityMismatches.slice(0, 10)],
    ["duplicate conversation_index handles", report.checks.duplicateConversationIndexHandles.slice(0, 10)],
    ["stale same-membership snapshots", report.checks.staleSameMembershipSnapshots.slice(0, 10)],
    ["snapshots without messages", report.checks.snapshotsWithoutMessages.slice(0, 10)],
  ];

  for (const [label, rows] of sections) {
    if (!rows.length) continue;
    console.log(`\n${label}:`);
    for (const row of rows) {
      console.log(`- ${JSON.stringify(row)}`);
    }
  }
}

async function main() {
  const db = openDb(DB_PATH);
  try {
    const report = await collectAudit(db);
    const summary = summarize(report);
    if (JSON_OUTPUT) {
      process.stdout.write(`${JSON.stringify({ ...report, summary }, null, 2)}\n`);
    } else {
      printHuman(report);
    }
    const issueCount =
      summary.capabilityMismatchCount +
      summary.duplicateConversationIndexHandleCount +
      summary.staleSameMembershipSnapshotCount +
      summary.snapshotsWithoutMessagesCount;
    if (FAIL_ON_ISSUES && issueCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    await closeDb(db);
  }
}

main().catch((error) => {
  console.error(`[conversation-integrity] audit failed: ${error.message}`);
  process.exitCode = 1;
});
