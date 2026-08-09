import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    // ES2022 minimum: with the default "modules" target (es2020), esbuild's
    // minifier mis-lowers logical assignment (`x ||= {}`): it drops the
    // variable's declaration while keeping the write (esbuild #4508, fixed in
    // esbuild 0.28.2; vite 6.4 pins 0.25.x). In the production bundle this
    // broke xterm.js's DECRQM handler (`CSI ? Pm $ p`) with an uncaught
    // ReferenceError that permanently killed the write/parse loop — SSH tabs
    // froze the moment an app queried a private mode (issue #1: omp's TUI
    // startup query wedged the whole tab). ES2022 needs no such lowering, and
    // WebView2/WKWebView have supported it for years.
    target: "es2022",
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/@xterm")) return "xterm";
        },
      },
    },
  },
}));
