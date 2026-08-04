// AI session sharing, end to end: real app window + real hub + real HTTP
// client (this spec runs in Node). Covers the full chain the design doc
// promises an agent: prompt document, screen snapshot, rate limit, input,
// long-poll wake-up, and revocation.
describe("AI session sharing", () => {
  let shareUrl;
  let screenUrl;
  let inputUrl;

  it("creates a share for the active tab", async () => {
    await browser.waitUntil(async () => (await $$("#tabs .tab")).length >= 1, { timeout: 15000 });
    shareUrl = await browser.executeAsync((done) => {
      (async () => {
        const mgr = window.__tterm.mgr;
        const id = mgr.activeTabId;
        await mgr.shareTab(id);
        done(mgr.get(id).shareUrl || null);
      })();
    });
    expect(shareUrl).toBeTruthy();

    // The tab shows the shared indicator.
    const marked = await browser.execute(() => {
      const mgr = window.__tterm.mgr;
      return mgr.get(mgr.activeTabId).tabElement.classList.contains("shared");
    });
    expect(marked).toBe(true);

    const u = new URL(shareUrl);
    screenUrl = `${u.origin}${u.pathname}/screen${u.search}`;
    inputUrl = `${u.origin}${u.pathname}/input${u.search}`;
  });

  it("serves the self-describing prompt document", async () => {
    const resp = await fetch(shareUrl);
    expect(resp.status).toBe(200);
    const doc = await resp.text();
    expect(doc).toContain("/screen");
    expect(doc).toContain("/input");
    expect(doc).toContain("/screenshot");
    expect(doc).toContain("UTF-8");
    expect(doc).toContain("untrusted");
    // Wrong token → 403.
    const bad = await fetch(shareUrl.replace(/token=[0-9a-f]+/, "token=deadbeef"));
    expect(bad.status).toBe(403);
  });

  it("returns a character-level screen snapshot", async () => {
    const resp = await fetch(screenUrl);
    expect(resp.status).toBe(200);
    const snap = await resp.json();
    expect(snap.cols).toBeGreaterThan(0);
    expect(snap.rows).toBeGreaterThan(0);
    expect(Array.isArray(snap.lines)).toBe(true);
    expect(snap.lines.length).toBe(snap.rows);
    expect(typeof snap.seq).toBe("number");
    globalThis.__shareSeq = snap.seq;
  });

  it("rate-limits plain polls (429)", async () => {
    // The previous test's snapshot counts as this second's poll.
    const resp = await fetch(screenUrl);
    expect(resp.status).toBe(429);
  });

  it("types into the session and sees the echo (input + long-poll)", async () => {
    const marker = "SHARE_E2E_OK";
    const type = await fetch(inputUrl, { method: "POST", body: `echo ${marker}\r` });
    expect(type.status).toBe(200);

    // Long-poll until the marker lands on screen (each wake re-checks).
    let found = false;
    for (let i = 0; i < 5 && !found; i++) {
      const seq = globalThis.__shareSeq;
      const resp = await fetch(`${screenUrl}&wait=${seq}&timeout=10`);
      expect(resp.status).toBe(200);
      const snap = await resp.json();
      globalThis.__shareSeq = snap.seq;
      found = snap.lines.some((l) => l.includes(marker));
    }
    expect(found).toBe(true);
  });

  it("sends Unicode text via JSON input (Chinese-safe)", async () => {
    const marker = "SHARE_UNI_\u4e2d\u6587";
    const resp = await fetch(inputUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `echo ${marker}\r` }),
    });
    expect(resp.status).toBe(200);

    let found = false;
    for (let i = 0; i < 5 && !found; i++) {
      const seq = globalThis.__shareSeq;
      const r = await fetch(`${screenUrl}&wait=${seq}&timeout=10`);
      expect(r.status).toBe(200);
      const snap = await r.json();
      globalThis.__shareSeq = snap.seq;
      found = snap.lines.some((l) => l.includes(marker));
    }
    expect(found).toBe(true);
  });

  it("sends named keys and shortcuts via JSON input", async () => {
    // ctrl+c then enter — cmd.exe echoes "^C".
    const resp = await fetch(inputUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys: ["ctrl+c", "enter"] }),
    });
    expect(resp.status).toBe(200);

    let found = false;
    for (let i = 0; i < 5 && !found; i++) {
      const seq = globalThis.__shareSeq;
      const r = await fetch(`${screenUrl}&wait=${seq}&timeout=10`);
      expect(r.status).toBe(200);
      const snap = await r.json();
      globalThis.__shareSeq = snap.seq;
      found = snap.lines.some((l) => l.includes("^C"));
    }
    expect(found).toBe(true);
  });

  it("returns a PNG screenshot of the screen", async () => {
    const u = new URL(screenUrl);
    const shotUrl = `${u.origin}${u.pathname.replace(/screen$/, "screenshot")}${u.search}`;
    const resp = await fetch(shotUrl);
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toContain("image/png");
    const bytes = new Uint8Array(await resp.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(1000);
    // PNG magic: 89 50 4E 47
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("revocation cuts access immediately (403)", async () => {
    await browser.executeAsync((done) => {
      (async () => {
        const mgr = window.__tterm.mgr;
        await mgr.shareTab(mgr.activeTabId); // toggles off
        done();
      })();
    });
    const resp = await fetch(shareUrl);
    expect(resp.status).toBe(403);
  });
});
