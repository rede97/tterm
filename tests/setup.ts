// Shared vitest setup: happy-dom has no canvas implementation. xterm.js master
// (6.1.0-beta) builds its DOM renderer's WidthCache inside Terminal.open() and
// hard-asserts a 2d context, so every test that opens a Terminal needs this stub.
// Only "2d" is faked — "webgl"/"webgl2" still return null, preserving the old
// fallback behavior for the webgl addon.

const ctx2dStub = new Proxy(
  {
    measureText: () => ({ width: 1 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    canvas: null,
  },
  {
    get(target, prop) {
      if (prop in target) return (target as Record<PropertyKey, unknown>)[prop];
      return () => {};
    },
  },
);

if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = ((contextType: string) =>
    contextType === "2d" ? ctx2dStub : null) as typeof HTMLCanvasElement.prototype.getContext;
}

// happy-dom declares OffscreenCanvas but its getContext returns null; xterm
// master prefers OffscreenCanvas whenever the constructor merely exists, so
// patch it as well (same stub — only "2d", webgl still null).
if (typeof OffscreenCanvas !== "undefined") {
  OffscreenCanvas.prototype.getContext = ((contextType: string) =>
    contextType === "2d"
      ? ctx2dStub
      : null) as unknown as typeof OffscreenCanvas.prototype.getContext;
}
