// Runs the API and the worker as two separate processes inside one container, for hosts
// that offer a single free service. It forwards stop signals to both, waits for each one
// to finish its own graceful shutdown, and exits non-zero if either process dies on its own
// so the platform restarts the whole service.
const { spawn } = require("node:child_process");

const children = [
  { name: "api", file: "apps/api/dist/index.js" },
  { name: "worker", file: "apps/worker/dist/index.js" },
].map((c) => ({
  ...c,
  proc: spawn(process.execPath, [c.file], { stdio: "inherit" }),
  exited: false,
}));

let shuttingDown = false;
let exitCode = 0;

function log(level, msg, extra) {
  console.log(JSON.stringify({ level, time: new Date().toISOString(), app: "flowforge", service: "supervisor", msg, ...extra }));
}

function stopAll(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    if (!c.exited) c.proc.kill(signal);
  }
}

for (const c of children) {
  c.proc.on("exit", (code, signal) => {
    c.exited = true;
    if (code !== 0) exitCode = 1;
    if (!shuttingDown) {
      log(50, `${c.name} exited unexpectedly, stopping the other process`, { code, signal });
      stopAll("SIGTERM");
    }
    if (children.every((x) => x.exited)) {
      log(30, "all processes stopped", { exitCode });
      process.exit(exitCode);
    }
  });
}

process.on("SIGTERM", () => {
  log(30, "stop requested", { signal: "SIGTERM" });
  stopAll("SIGTERM");
});
process.on("SIGINT", () => {
  log(30, "stop requested", { signal: "SIGINT" });
  stopAll("SIGINT");
});
log(30, "supervisor started", { pids: children.map((c) => c.proc.pid) });