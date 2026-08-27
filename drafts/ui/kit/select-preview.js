/**
 * Preview-only select portal helpers (mirrors src/ui/select.ts behavior).
 * App behavior remains authoritative; this is for drafts/*-preview.html demos.
 *
 * Usage:
 *   <script type="module" src="/drafts/ui/kit/select-preview.js"></script>
 *   // auto-binds [data-select] roots; listen for "tt-pick" on the root if needed.
 */
(function () {
  let portal = null;

  function unportal() {
    if (!portal) return;
    const { menu, parent, next } = portal;
    menu.classList.remove("open");
    if (next && next.parentNode === parent) parent.insertBefore(menu, next);
    else parent.appendChild(menu);
    portal = null;
  }

  function closeAll(except) {
    document.querySelectorAll(".tt-select.open").forEach((el) => {
      if (el !== except) el.classList.remove("open");
    });
    if (!except || portal?.root !== except) unportal();
  }

  function place(trigger, menu) {
    const rect = trigger.getBoundingClientRect();
    const menuH = Math.min(menu.scrollHeight, 220);
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const dropUp = spaceBelow < menuH && rect.top > spaceBelow;
    menu.style.left = `${rect.left}px`;
    menu.style.width = `${rect.width}px`;
    menu.style.right = "auto";
    if (dropUp) {
      menu.style.top = "auto";
      menu.style.bottom = `${window.innerHeight - rect.top + 4}px`;
    } else {
      menu.style.bottom = "auto";
      menu.style.top = `${rect.bottom + 4}px`;
    }
  }

  function open(root) {
    const trigger = root.querySelector(".tt-select-trigger");
    const menu = root.querySelector(".tt-select-menu");
    if (!trigger || !menu) return;
    closeAll();
    root.classList.add("open");
    portal = { menu, parent: menu.parentNode, next: menu.nextSibling, root };
    menu.classList.add("open", "tt-scroll");
    document.body.appendChild(menu);
    place(trigger, menu);
  }

  function pick(root, opt) {
    const valueEl = root.querySelector(".tt-select-value");
    const menu = portal?.root === root ? portal.menu : root.querySelector(".tt-select-menu");
    if (valueEl) valueEl.textContent = opt.textContent;
    (menu || root).querySelectorAll(".tt-option").forEach((o) => {
      o.setAttribute("aria-selected", o === opt ? "true" : "false");
    });
    root.classList.remove("open");
    unportal();
    root.dispatchEvent(
      new CustomEvent("tt-pick", { detail: opt.dataset.value, bubbles: true }),
    );
  }

  function bind(root) {
    if (root.dataset.ttSelectBound) return;
    root.dataset.ttSelectBound = "1";
    const trigger = root.querySelector(".tt-select-trigger");
    if (!trigger) return;
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      if (root.classList.contains("open")) closeAll();
      else open(root);
    });
  }

  function bindAll(scope) {
    (scope || document).querySelectorAll("[data-select], .tt-select").forEach(bind);
  }

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const opt = t.closest(".tt-option");
    if (opt) {
      e.stopPropagation();
      const menu = opt.closest(".tt-select-menu");
      const root =
        (portal && portal.menu === menu ? portal.root : null) || opt.closest(".tt-select");
      if (root) pick(root, opt);
      return;
    }
    if (!t.closest(".tt-select") && !t.closest(".tt-select-menu")) closeAll();
  });
  document.addEventListener(
    "scroll",
    (e) => {
      if (e.target instanceof Element && e.target.closest(".tt-select-menu")) return;
      closeAll();
    },
    true,
  );
  window.addEventListener("resize", () => closeAll());

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => bindAll());
  } else {
    bindAll();
  }

  window.ttSelectPreview = { bindAll, closeAll, open, pick };
})();
