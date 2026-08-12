import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appExe = path.resolve(__dirname, "../src-tauri/target/debug/tterm.exe");
const driverDir = path.resolve(__dirname, "drivers");

let tauriDriver;
let viteDev;

// Poll until the vite dev server accepts TCP connections.
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

// Kill a process tree on Windows (taskkill /T), plain kill elsewhere.
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
      // tauri-driver handles the session; it spawns msedgedriver internally.
      "tauri:options": { application: appExe },
    },
  ],
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 60000 },
  logLevel: "warn",

  beforeSession: () => {
    // Debug builds navigate to devUrl — start the vite dev server first.
    // NOTE: always use 127.0.0.1, never "localhost" — IPv6 loopback (::1)
    // resolution breaks WebView2 connectivity on Windows.
    // Launch vite directly via node (no shell wrapper) so the E2E runner
    // can reliably kill the dev server afterwards.
    const viteBin = path.resolve(__dirname, "../node_modules/vite/bin/vite.js");
    viteDev = spawn(process.execPath, [viteBin], {
      stdio: [null, "inherit", "inherit"],
    });
    viteDev.on("error", (e) => console.error("vite dev spawn failed:", e));

    // Make the pinned msedgedriver visible to tauri-driver.
    process.env.PATH = `${driverDir}${path.delimiter}${process.env.PATH}`;
    tauriDriver = spawn(process.platform === "win32" ? "tauri-driver.exe" : "tauri-driver", [], {
      stdio: [null, "inherit", "inherit"],
      env: process.env,
    });
    tauriDriver.on("error", (e) => console.error("tauri-driver spawn failed:", e));

    return waitForPort(1420, "127.0.0.1", 30000).then(() => waitForPort(4444, "127.0.0.1", 15000));
  },

  afterSession: () => {
    killTree(tauriDriver);
    killTree(viteDev);
  },
};
