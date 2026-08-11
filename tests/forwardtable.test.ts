import { describe, it, expect, beforeEach } from "vitest";
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
    // Target host placeholder locates the side: remote for -L, local for -R.
    expect(addRowIn(groups[0]).targetHost!.placeholder).toBe("Host (Remote)");
    expect(addRowIn(groups[1]).targetHost!.placeholder).toBe("Host (Local)");
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
      { kind: "local", listenHost: "127.0.0.1", listenPort: 8080, targetHost: "db.internal", targetPort: 5432 },
    ]);
    expect(displayRowsIn(group(t.el, "local"))[0].textContent).toContain("db.internal:5432");
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
    a.targetHost!.value = "";
    a.add.click();
    expect(t.rows()).toHaveLength(0);
    expect(a.targetHost!.classList.contains("ft-invalid")).toBe(true);
  });

  it("edit swaps a row to inputs and ✓ applies the change", () => {
    const t = createForwardTable([
      { kind: "local", listenHost: "127.0.0.1", listenPort: 8080, targetHost: "db.internal", targetPort: 5432 },
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
      { kind: "remote", listenHost: "127.0.0.1", listenPort: 9090, targetHost: "a", targetPort: 80 },
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
});

describe("forward config line helpers", () => {
  it("forwardConfigLine and parseForwardLine round-trip local/remote", () => {
    const row = { kind: "local" as const, listenHost: "127.0.0.1", listenPort: 8080, targetHost: "db.internal", targetPort: 5432 };
    expect(forwardConfigLine(row)).toBe("127.0.0.1:8080 db.internal:5432");
    expect(parseForwardLine("127.0.0.1:8080 db.internal:5432", "local")).toEqual(row);
    expect(parseForwardLine("garbage", "local")).toBeNull();
  });

  it("dynamic lines carry a single endpoint", () => {
    const row = { kind: "dynamic" as const, listenHost: "127.0.0.1", listenPort: 1080, targetHost: "", targetPort: 0 };
    expect(forwardConfigLine(row)).toBe("127.0.0.1:1080");
    expect(parseForwardLine("127.0.0.1:1080", "dynamic")).toEqual(row);
    expect(parseForwardLine("127.0.0.1:1080 extra:1", "dynamic")).toBeNull();
  });
});
