import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Release-build variant of wdio.conf.js: drives src-tauri/target/release/
// tterm.exe. Use to verify bugs that only manifest in the bundled/minified
// production frontend (e.g. issue #1's frozen SSH tabs, reported against a
// release build and invisible to the dev-server frontend).
//
// Prereqs:
//   1. cargo build --release            (release backend; note: plain cargo
//      builds keep devUrl in tauri.conf.json, so the exe still loads the
//      frontend from http://127.0.0.1:1420 — we serve the bundle there)
//   2. NODE_ENV=development vite build --outDir dist-dev
//      (production-style minified bundle, but with the DEV-only __tterm
//      debug API the e2e specs use to reach TerminalTab instances)
//   3. vite preview --outDir dist-dev --port 1420 --strictPort
//   4. bun run test:e2e:release [-- --spec e2e/specs/ompfreeze.e2e.js]
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appExe = path.resolve(__dirname, "../src-tauri/target/release/tterm.exe");
const driverDir = path.resolve(__dirname, "drivers");

let tauriDriver;

async function waitForPort(port, host, timeoutMs) {
  const net = await import("node:net");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const sock = net.connect({ port, host });
      sock.once("connect", () => {
        sock.end();
        resolve(true);
      });
      sock.once("error", () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for ${host}:${port}`);
}

function killTree(child) {
  if (!child || child.killed) return;
  if (process.platform === "win32") {
    spawn(`taskkill /pid ${child.pid} /T /F`, { shell: true, stdio: "ignore" });
  } else {
    child.kill();
  }
}

export const config = {
  hostname: "127.0.0.1",
  port: 4444,
  specs: [path.resolve(__dirname, "specs/**/*.e2e.js")],
  maxInstances: 1,
  capabilities: [
    {
      "tauri:options": { application: appExe },
    },
  ],
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 60000 },
  logLevel: "warn",

  beforeSession: () => {
    process.env.PATH = `${driverDir}${path.delimiter}${process.env.PATH}`;
    tauriDriver = spawn(process.platform === "win32" ? "tauri-driver.exe" : "tauri-driver", [], {
      stdio: [null, "inherit", "inherit"],
      env: process.env,
    });
    tauriDriver.on("error", (e) => console.error("tauri-driver spawn failed:", e));
    return waitForPort(4444, "127.0.0.1", 15000);
  },

  afterSession: () => {
    killTree(tauriDriver);
  },
};
