import { beforeEach, describe, expect, it } from "vitest";
import { createForwardTable, forwardConfigLine, parseForwardLine } from "../src/ui/forwardtable";

// Group order is fixed: Local, Remote, Dynamic.
function group(root: HTMLElement, kind: "local" | "remote" | "dynamic"): HTMLElement {
  const idx = { local: 0, remote: 1, dynamic: 2 }[kind];
  return root.querySelectorAll<HTMLElement>(".ft-group")[idx];
}

function addRowIn(groupEl: HTMLElement) {
  const row = groupEl.querySelector<HTMLElement>(".ft-add-row")!;
  return {
    listenPort: row.querySelector<HTMLInputElement>('input[aria-label="Listen port"]')!,
    targetHost: row.querySelector<HTMLInputElement>('input[aria-label="Target host"]'),
    targetPort: row.querySelector<HTMLInputElement>('input[aria-label="Target port"]'),
    add: row.querySelector<HTMLButtonElement>(".ft-add")!,
  };
}

const displayRowsIn = (groupEl: HTMLElement) =>
  groupEl.querySelectorAll<HTMLElement>(".ft-row:not(.ft-add-row)");

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("forward table — groups", () => {
  it("renders Local / Remote / Dynamic groups, each with an add-row", () => {
    const t = createForwardTable();
    document.body.appendChild(t.el);
    const groups = t.el.querySelectorAll<HTMLElement>(".ft-group");
    expect(groups).toHaveLength(3);
    expect(groups[0].querySelector(".ft-group-title")!.textContent).toBe("Local (-L)");
    expect(groups[1].querySelector(".ft-group-title")!.textContent).toBe("Remote (-R)");
    expect(groups[2].querySelector(".ft-group-title")!.textContent).toBe("Dynamic (-D)");
    expect(t.el.querySelectorAll(".ft-add-row")).toHaveLength(3);
    // Target host placeholder locates the side and shows the empty-default.
    expect(addRowIn(groups[0]).targetHost!.placeholder).toBe("127.0.0.1 (Remote)");
    expect(addRowIn(groups[1]).targetHost!.placeholder).toBe("127.0.0.1 (Local)");
    // Dynamic group has no target inputs in its add-row.
    const dyn = addRowIn(groups[2]);
    expect(dyn.targetHost).toBeNull();
    expect(dyn.targetPort).toBeNull();
  });

  it("Add in the Local group commits a local row", () => {
    const t = createForwardTable();
    document.body.appendChild(t.el);
    const a = addRowIn(group(t.el, "local"));
    a.listenPort.value = "8080";
    a.targetHost!.value = "db.internal";
    a.targetPort!.value = "5432";
    a.add.click();
    expect(t.rows()).toEqual([
      {
        kind: "local",
        listenHost: "127.0.0.1",
        listenPort: 8080,
        targetHost: "db.internal",
        targetPort: 5432,
      },
    ]);
    expect(displayRowsIn(group(t.el, "local"))[0].textContent).toContain("db.internal:5432");
    const after = addRowIn(group(t.el, "local"));
    expect(after.listenPort.value).toBe("");
    expect(after.targetHost!.value).toBe("");
    expect(after.targetPort!.value).toBe("");
  });

  it("Add after typing via input events still clears listen / host / port", () => {
    const t = createForwardTable();
    document.body.appendChild(t.el);
    const a = addRowIn(group(t.el, "remote"));
    a.listenPort.value = "9090";
    a.listenPort.dispatchEvent(new Event("input"));
    a.targetHost!.value = "db";
    a.targetHost!.dispatchEvent(new Event("input"));
    a.targetPort!.value = "80";
    a.targetPort!.dispatchEvent(new Event("input"));
    a.add.click();
    const after = addRowIn(group(t.el, "remote"));
    expect(after.listenPort.value).toBe("");
    expect(after.targetHost!.value).toBe("");
    expect(after.targetPort!.value).toBe("");
  });

  it("Add in the Dynamic group needs only a listen port", () => {
    const t = createForwardTable();
    document.body.appendChild(t.el);
    const a = addRowIn(group(t.el, "dynamic"));
    a.listenPort.value = "1080";
    a.add.click();
    expect(t.rows()).toEqual([
      { kind: "dynamic", listenHost: "127.0.0.1", listenPort: 1080, targetHost: "", targetPort: 0 },
    ]);
    expect(displayRowsIn(group(t.el, "dynamic"))[0].textContent).toContain("SOCKS5");
    expect(addRowIn(group(t.el, "dynamic")).listenPort.value).toBe("");
  });

  it("rule violation blocks the commit and flags the input", () => {
    const t = createForwardTable();
    document.body.appendChild(t.el);
    const a = addRowIn(group(t.el, "remote"));
    a.listenPort.value = "0";
    a.targetHost!.value = "db.internal";
    a.targetPort!.value = "5432";
    a.add.click();
    expect(t.rows()).toHaveLength(0);
    expect(a.listenPort.classList.contains("ft-invalid")).toBe(true);

    a.listenPort.value = "9090";
    a.targetHost!.value = "has space";
    a.add.click();
    expect(t.rows()).toHaveLength(0);
    expect(a.targetHost!.classList.contains("ft-invalid")).toBe(true);
  });

  it("blank target host commits as 127.0.0.1", () => {
    const t = createForwardTable();
    document.body.appendChild(t.el);
    const a = addRowIn(group(t.el, "remote"));
    a.listenPort.value = "9090";
    a.targetHost!.value = "";
    a.targetPort!.value = "80";
    a.add.click();
    expect(t.rows()).toEqual([
      {
        kind: "remote",
        listenHost: "127.0.0.1",
        listenPort: 9090,
        targetHost: "127.0.0.1",
        targetPort: 80,
      },
    ]);
  });

  it("edit swaps a row to inputs and ✓ applies the change", () => {
    const t = createForwardTable([
      {
        kind: "local",
        listenHost: "127.0.0.1",
        listenPort: 8080,
        targetHost: "db.internal",
        targetPort: 5432,
      },
    ]);
    document.body.appendChild(t.el);
    displayRowsIn(group(t.el, "local"))[0].querySelector<HTMLButtonElement>(".ft-edit")!.click();

    const editing = t.el.querySelector<HTMLElement>(".ft-editing")!;
    const target = editing.querySelector<HTMLInputElement>('input[aria-label="Target host"]')!;
    expect(target.value).toBe("db.internal");
    target.value = "pg.internal";
    editing.querySelector<HTMLButtonElement>(".ft-ok")!.click();

    expect(t.rows()[0].targetHost).toBe("pg.internal");
    expect(t.el.querySelector(".ft-editing")).toBeNull();
  });

  it("edit cancel leaves the row untouched; delete removes it", () => {
    const t = createForwardTable([
      {
        kind: "remote",
        listenHost: "127.0.0.1",
        listenPort: 9090,
        targetHost: "a",
        targetPort: 80,
      },
    ]);
    document.body.appendChild(t.el);
    displayRowsIn(group(t.el, "remote"))[0].querySelector<HTMLButtonElement>(".ft-edit")!.click();
    const editing = t.el.querySelector<HTMLElement>(".ft-editing")!;
    editing.querySelector<HTMLInputElement>('input[aria-label="Target host"]')!.value = "changed";
    editing.querySelector<HTMLButtonElement>(".ft-cancel")!.click();
    expect(t.rows()[0].targetHost).toBe("a");

    displayRowsIn(group(t.el, "remote"))[0].querySelector<HTMLButtonElement>(".ft-del")!.click();
    expect(t.rows()).toHaveLength(0);
  });

  it("listen cells show the port only and the add button is a + icon", () => {
    const t = createForwardTable([
      {
        kind: "local",
        listenHost: "127.0.0.1",
        listenPort: 8080,
        targetHost: "db.internal",
        targetPort: 5432,
      },
    ]);
    document.body.appendChild(t.el);

    // Add-row: no "127.0.0.1 :" pin, icon-only add button.
    const a = addRowIn(group(t.el, "local"));
    expect(a.listenPort.closest(".ft-listen")!.querySelector(".ft-pin")).toBeNull();
    expect(a.add.querySelector("svg")).not.toBeNull();
    expect(a.add.title).toBe("Add local forward");
    expect(a.add.className).toBe("ft-btn ft-add");

    // Display row: listen cell is the bare port; full address on the title.
    const listen = displayRowsIn(group(t.el, "local"))[0].querySelector<HTMLElement>(".ft-listen")!;
    expect(listen.textContent).toBe("8080");
    expect(listen.title).toBe("127.0.0.1:8080");
  });
});

describe("forward config line helpers", () => {
  it("forwardConfigLine and parseForwardLine round-trip local/remote", () => {
    const row = {
      kind: "local" as const,
      listenHost: "127.0.0.1",
      listenPort: 8080,
      targetHost: "db.internal",
      targetPort: 5432,
    };
    expect(forwardConfigLine(row)).toBe("127.0.0.1:8080 db.internal:5432");
    expect(parseForwardLine("127.0.0.1:8080 db.internal:5432", "local")).toEqual(row);
    expect(parseForwardLine("garbage", "local")).toBeNull();
  });

  it("dynamic lines carry a single endpoint", () => {
    const row = {
      kind: "dynamic" as const,
      listenHost: "127.0.0.1",
      listenPort: 1080,
      targetHost: "",
      targetPort: 0,
    };
    expect(forwardConfigLine(row)).toBe("127.0.0.1:1080");
    expect(parseForwardLine("127.0.0.1:1080", "dynamic")).toEqual(row);
    expect(parseForwardLine("127.0.0.1:1080 extra:1", "dynamic")).toBeNull();
  });
});

describe("forward table — lit rendering (migration acceptance)", () => {
  it("half-typed add-row in one group survives a commit in another", () => {
    const t = createForwardTable();
    document.body.appendChild(t.el);

    // Type into the Remote add-row (no commit, no blur).
    const remote = addRowIn(group(t.el, "remote"));
    remote.listenPort.value = "9090";
    remote.listenPort.dispatchEvent(new Event("input"));
    const remoteListenNode = remote.listenPort;

    // Commit a row in the Local group — old rebuild wiped Remote's input.
    const local = addRowIn(group(t.el, "local"));
    local.listenPort.value = "8080";
    local.targetHost!.value = "db";
    local.targetPort!.value = "5432";
    local.add.click();

    // Remote's pending input is intact, on the SAME input node.
    const remoteAfter = addRowIn(group(t.el, "remote"));
    expect(remoteAfter.listenPort).toBe(remoteListenNode);
    expect(remoteAfter.listenPort.value).toBe("9090");
  });

  it("committed display rows keep node identity across re-renders (keyed repeat)", () => {
    const t = createForwardTable([
      { kind: "local", listenHost: "127.0.0.1", listenPort: 8080, targetHost: "a", targetPort: 80 },
    ]);
    document.body.appendChild(t.el);
    const rowBefore = displayRowsIn(group(t.el, "local"))[0];

    const a = addRowIn(group(t.el, "local"));
    a.listenPort.value = "8081";
    a.targetHost!.value = "b";
    a.targetPort!.value = "81";
    a.add.click();

    expect(displayRowsIn(group(t.el, "local"))[0]).toBe(rowBefore);
    expect(t.rows()).toHaveLength(2);
  });

  it("async onAdd success clears the add-row; rejection keeps the values", async () => {
    let accept = true;
    const t = createForwardTable([], { onAdd: async () => accept });
    document.body.appendChild(t.el);
    const local = addRowIn(group(t.el, "local"));
    local.listenPort.value = "8080";
    local.targetHost!.value = "a";
    local.targetPort!.value = "80";
    local.add.click();
    await Promise.resolve();
    const afterOk = addRowIn(group(t.el, "local"));
    expect(afterOk.listenPort.value).toBe("");
    expect(afterOk.targetHost!.value).toBe("");
    expect(afterOk.targetPort!.value).toBe("");

    accept = false;
    afterOk.listenPort.value = "8081";
    afterOk.targetHost!.value = "b";
    afterOk.targetPort!.value = "81";
    afterOk.add.click();
    await Promise.resolve();
    const afterNo = addRowIn(group(t.el, "local"));
    expect(afterNo.listenPort.value).toBe("8081");
    expect(afterNo.targetHost!.value).toBe("b");
    expect(afterNo.targetPort!.value).toBe("81");
  });
});
