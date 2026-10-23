// Touch swipe scrolling. A vertical finger drag scrolls the buffer; lifting
// with speed coasts. A new touch, or a pointer/touch cancel, stops the coast
// and drops the in-flight gesture so an interrupted finger never sticks.

import { swallow } from "../core/errorlog";

export const TOUCH_SCROLL_SLOP = 10;
const SAMPLE_MS = 80;
const MAX_VELOCITY = 2.4; // px/ms
const COAST_MIN = 0.15; // px/ms — below this, lift does not fling
const COAST_STOP = 0.02; // px/ms
const COAST_TAU = 90; // ms

export interface TouchScrollTarget {
  scrollLines(amount: number): void;
  clearSelection(): void;
}

export interface CoastStep {
  velocity: number;
  delta: number;
}

/** One inertia frame. `velocity` is px/ms (positive scrolls toward newer lines). */
export function coastStep(velocity: number, dt: number): CoastStep {
  if (dt <= 0 || velocity === 0) return { velocity: 0, delta: 0 };
  const decay = Math.exp(-dt / COAST_TAU);
  const next = velocity * decay;
  const delta = ((velocity + next) / 2) * dt;
  return { velocity: Math.abs(next) < COAST_STOP ? 0 : next, delta };
}

interface Sample {
  t: number;
  y: number;
}

interface Gesture {
  pointerId: number;
  originX: number;
  originY: number;
  lastY: number;
  pending: number;
  scrolling: boolean;
  samples: Sample[];
}

function applyDelta(
  terminal: TouchScrollTarget,
  cellH: number,
  pending: number,
  delta: number,
): number {
  const next = pending + delta;
  const lines = Math.trunc(next / cellH);
  if (lines !== 0) terminal.scrollLines(lines);
  return next - lines * cellH;
}

export function attachTouchScroll(
  element: HTMLElement,
  terminal: TouchScrollTarget,
  cellHeightPx: () => number = () => 16,
): () => void {
  let gesture: Gesture | null = null;
  let coastVel = 0;
  let coastPending = 0;
  let coastRaf = 0;
  let coastLast = 0;

  const cellH = () => {
    const h = cellHeightPx();
    return h > 0 ? h : 16;
  };

  const stopCoast = () => {
    coastVel = 0;
    coastPending = 0;
    if (coastRaf !== 0) {
      cancelAnimationFrame(coastRaf);
      coastRaf = 0;
    }
  };

  const coastFrame = (now: number) => {
    coastRaf = 0;
    const dt = coastLast === 0 ? 16 : Math.min(64, now - coastLast);
    coastLast = now;
    const step = coastStep(coastVel, dt);
    coastVel = step.velocity;
    coastPending = applyDelta(terminal, cellH(), coastPending, step.delta);
    if (coastVel !== 0) coastRaf = requestAnimationFrame(coastFrame);
  };

  const startCoast = (velocity: number) => {
    const v = Math.max(-MAX_VELOCITY, Math.min(MAX_VELOCITY, velocity));
    if (Math.abs(v) < COAST_MIN) return;
    stopCoast();
    coastVel = v;
    coastLast = 0;
    coastRaf = requestAnimationFrame(coastFrame);
  };

  const releaseCapture = (id: number) => {
    try {
      if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
    } catch {
      swallow();
    }
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    if (e.target instanceof Element && e.target.closest(".scrollbar")) return;
    // A new finger interrupts the coast and any swipe already in progress.
    stopCoast();
    if (gesture) releaseCapture(gesture.pointerId);
    gesture = {
      pointerId: e.pointerId,
      originX: e.clientX,
      originY: e.clientY,
      lastY: e.clientY,
      pending: 0,
      scrolling: false,
      samples: [],
    };
  };

  const onMove = (e: PointerEvent) => {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    const dx = e.clientX - gesture.originX;
    const dyTotal = e.clientY - gesture.originY;
    if (!gesture.scrolling) {
      if (Math.abs(dyTotal) < TOUCH_SCROLL_SLOP || Math.abs(dyTotal) <= Math.abs(dx)) return;
      gesture.scrolling = true;
      terminal.clearSelection();
      try {
        element.setPointerCapture(e.pointerId);
      } catch {
        swallow();
      }
    }
    e.preventDefault();
    e.stopPropagation();
    const dy = gesture.lastY - e.clientY;
    gesture.lastY = e.clientY;
    gesture.pending = applyDelta(terminal, cellH(), gesture.pending, dy);
    const now = e.timeStamp || performance.now();
    gesture.samples.push({ t: now, y: e.clientY });
    const cutoff = now - SAMPLE_MS;
    while (gesture.samples.length > 1 && gesture.samples[0].t < cutoff) gesture.samples.shift();
  };

  const velocityOf = (g: Gesture): number => {
    const s = g.samples;
    if (s.length < 2) return 0;
    const a = s[0];
    const b = s[s.length - 1];
    const dt = b.t - a.t;
    if (dt <= 0) return 0;
    return (a.y - b.y) / dt;
  };

  // Touch also synthesizes mouse events. xterm starts a selection on
  // mousedown, and the matching mousemove would extend it under the swipe.
  const onMouseMove = (e: MouseEvent) => {
    if (!gesture?.scrolling) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    terminal.clearSelection();
  };

  const onUp = (e: PointerEvent) => {
    if (!gesture || e.pointerId !== gesture.pointerId) return;
    const g = gesture;
    gesture = null;
    releaseCapture(e.pointerId);
    if (g.scrolling) startCoast(velocityOf(g));
  };

  // pointercancel / touchcancel: the OS took the finger. Drop everything so
  // the next swipe starts clean — including a coast that was still running.
  const onCancel = (e: Event) => {
    if (e instanceof PointerEvent && gesture && e.pointerId !== gesture.pointerId) return;
    if (gesture) releaseCapture(gesture.pointerId);
    gesture = null;
    stopCoast();
  };

  element.addEventListener("pointerdown", onDown);
  element.addEventListener("pointermove", onMove, { capture: true, passive: false });
  element.addEventListener("mousemove", onMouseMove, { capture: true });
  element.addEventListener("pointerup", onUp);
  element.addEventListener("pointercancel", onCancel);
  element.addEventListener("touchcancel", onCancel);

  return () => {
    element.removeEventListener("pointerdown", onDown);
    element.removeEventListener("pointermove", onMove, { capture: true });
    element.removeEventListener("mousemove", onMouseMove, { capture: true });
    element.removeEventListener("pointerup", onUp);
    element.removeEventListener("pointercancel", onCancel);
    element.removeEventListener("touchcancel", onCancel);
    if (gesture) releaseCapture(gesture.pointerId);
    gesture = null;
    stopCoast();
  };
}
