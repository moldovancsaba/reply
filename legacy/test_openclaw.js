const { execFile } = require("child_process");

const bin = "openclaw";
const args = [
  "message",
  "send",
  "--channel",
  "whatsapp",
  "--target",
  "+36706010707",
  "--message",
  "test from node",
  "--json"
];

execFile(bin, args, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
  console.log("error:", error);
  console.log("stdout:", stdout);
  console.log("stderr:", stderr);
});
