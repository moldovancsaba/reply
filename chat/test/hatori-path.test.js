"use strict";

const test = require("node:test");
const assert = require("node:assert");
const path = require("path");

const { resolveHatoriProjectPath, hatoriProjectPathFromChatDir } = require("../hatori-lifecycle.js");

test("resolveHatoriProjectPath honors REPLY_HATORI_PROJECT_PATH", (t) => {
    const prev = process.env.REPLY_HATORI_PROJECT_PATH;
    t.after(() => {
        if (prev === undefined) delete process.env.REPLY_HATORI_PROJECT_PATH;
        else process.env.REPLY_HATORI_PROJECT_PATH = prev;
    });
    process.env.REPLY_HATORI_PROJECT_PATH = "/tmp/hatori-override";
    const chatDir = "/fake/reply/chat";
    assert.strictEqual(resolveHatoriProjectPath(chatDir), path.resolve("/tmp/hatori-override"));
});

test("resolveHatoriProjectPath falls back to sibling layout", (t) => {
    const prev = process.env.REPLY_HATORI_PROJECT_PATH;
    t.after(() => {
        if (prev === undefined) delete process.env.REPLY_HATORI_PROJECT_PATH;
        else process.env.REPLY_HATORI_PROJECT_PATH = prev;
    });
    delete process.env.REPLY_HATORI_PROJECT_PATH;
    const chatDir = "/Users/Shared/Projects/reply/chat";
    assert.strictEqual(resolveHatoriProjectPath(chatDir), hatoriProjectPathFromChatDir(chatDir));
});
