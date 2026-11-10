"use client";

import { useEffect } from "react";

type Pref = "system" | "light" | "dark";

function applyTheme(pref: Pref) {
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.themePreference = pref;
}

function spyToc() {
  const items = Array.from(document.querySelectorAll<HTMLElement>('[data-layout-item="toc-item"]'));
  let current = items[0];
  for (const li of items) {
    const id = li.querySelector("a")?.getAttribute("href")?.slice(1);
    const h = id ? document.getElementById(id) : null;
    if (h && h.getBoundingClientRect().top <= 140) current = li;
  }
  items.forEach((li) => (li === current ? li.setAttribute("data-active", "true") : li.removeAttribute("data-active")));
}

/** Wires up the few interactions the static docs markup needs. */
export function Behavior() {
  useEffect(() => {
    const root = document.documentElement;
    const banner = document.getElementById("banner");
    const navbar = document.getElementById("navbar");

    const setVars = () => {
      const bh = banner && root.dataset.bannerState !== "hidden" ? banner.offsetHeight : 0;
      root.style.setProperty("--banner-height", `${bh}px`);
      const nh = navbar ? navbar.offsetHeight - bh : 96;
      root.style.setProperty("--mintlify-slot-header-height", `${Math.max(nh, 0)}px`);
    };
    // keep the fixed "Ask a question" bar lined up with the article column
    const alignBar = () => {
      const col = document.getElementById("content-area");
      if (!col) return;
      const r = col.getBoundingClientRect();
      root.style.setProperty("--assistant-left", `${r.left}px`);
      root.style.setProperty("--assistant-width", `${r.width}px`);
    };
    alignBar();
    window.addEventListener("resize", alignBar);
    setVars();
    const ro = new ResizeObserver(() => { setVars(); alignBar(); });
    if (banner) ro.observe(banner);
    if (navbar) ro.observe(navbar);

    let pref: Pref = "system";
    try { pref = (localStorage.getItem("aai-theme") as Pref) || "system"; } catch {}
    applyTheme(pref);
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onMq = () => pref === "system" && applyTheme(pref);
    mq.addEventListener("change", onMq);

    const onClick = async (e: MouseEvent) => {
      const t = e.target as HTMLElement;

      if (t.closest('[aria-label="Dismiss banner"]')) {
        root.dataset.bannerState = "hidden";
        banner?.remove();
        setVars();
        return;
      }
      if (t.closest("#theme-preference-menu-trigger")) {
        pref = ({ system: "light", light: "dark", dark: "system" } as const)[pref];
        try { localStorage.setItem("aai-theme", pref); } catch {}
        applyTheme(pref);
        return;
      }
      const copy = t.closest<HTMLElement>('[data-testid="copy-code-button"]');
      if (copy) {
        const code = copy.closest(".code-block")?.querySelector("pre code");
        if (code) await navigator.clipboard.writeText(code.textContent ?? "");
        return;
      }
      if (t.closest("#page-context-menu-button")) {
        await navigator.clipboard.writeText(document.querySelector(".mdx-content")?.textContent ?? "");
      }
    };
    document.addEventListener("click", onClick);
    spyToc();
    window.addEventListener("scroll", spyToc, { passive: true });

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", alignBar);
      mq.removeEventListener("change", onMq);
      document.removeEventListener("click", onClick);
      window.removeEventListener("scroll", spyToc);
    };
  }, []);
  return null;
}
