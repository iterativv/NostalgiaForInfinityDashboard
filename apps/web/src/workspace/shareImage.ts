// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Share as image — dependency-free DOM → PNG capture.
 *
 * `captureElementAsPngBlob` clones the target, freezes the live look by
 * copying every computed style property (resolved — no `var()` left for
 * the isolated render to miss), embeds the document's own stylesheets (so
 * classes, pseudo-elements and container queries keep working), snapshots
 * `<canvas>` contents (lightweight-charts panes, Carbon canvases) as `<img>`
 * data URLs, hides overlay scrollbars, then renders the clone through an
 * SVG `<foreignObject>` onto a 2x canvas.
 *
 * Why both inlining AND embedded CSS: the SVG `<img>` sandbox loads no
 * external resources, so class-only styling (Carbon tags/tables, nfi pills)
 * would otherwise fall back to black serif on the dark g100 background —
 * exactly the unreadable export this fixes. Inlined resolved values carry
 * the Carbon g100 palette; the embedded stylesheet covers what inlining
 * cannot (pseudo-elements, `::placeholder`, container queries). The wrapper
 * keeps the Carbon theme scope (`cds--g100`) so any remaining `var()`
 * references still resolve.
 *
 * No external libraries: html-to-image/html2canvas are only transitive
 * Carbon deps and are never imported — this file works offline.
 *
 * Targets:
 * - single widget: `[data-panel-id="<panelId>"]` (Panel root, every mount)
 * - whole page: `.nfi-workspace-host` (active page's visible workspace)
 */

/** Locate a hosted widget panel by its workspace panel id. */
export function findPanelElement(panelId: string): HTMLElement | null {
  try {
    return document.querySelector<HTMLElement>(
      `[data-panel-id="${CSS.escape(panelId)}"]`,
    );
  } catch {
    return null;
  }
}

/** The active page's visible workspace (screenshot target for pages). */
export function findWorkspaceHost(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".nfi-workspace-host");
}

/**
 * Freeze the live look onto the clone by copying every computed property
 * with its resolved value (Carbon tokens become concrete `rgb()` — no
 * `var()` survives to break in the isolated SVG render) and priority (so
 * `!important` helpers like `.nfi-pnl-positive` keep their tone).
 *
 * `getComputedStyle().cssText` is unreliable across browsers (empty in
 * some), so properties are copied one by one. The clone's pre-existing
 * inline style is the starting point and every resolved value overwrites
 * it — computed already reflects inline + classes, and overwriting drops
 * the raw `var(--cds-…)` references that would dangle outside the Theme
 * subtree. Animations and transitions are frozen off: a static snapshot
 * must never catch a mid-keyframe state.
 */
function copyComputedStyles(source: Element, clone: Element): void {
  try {
    const computed = window.getComputedStyle(source);
    // SAFETY: cloning an HTMLElement yields the same element kind — the DOM
    // API just declares its return as the Node base.
    const target = clone as HTMLElement;
    const style = target.style;

    for (let i = 0; i < computed.length; i++) {
      const prop = computed[i];

      if (!prop) continue;

      try {
        style.setProperty(
          prop,
          computed.getPropertyValue(prop),
          computed.getPropertyPriority(prop),
        );
      } catch {
        // Shorthands and engine-internal properties reject setProperty —
        // their longhands are copied separately in the same loop.
      }
    }

    try {
      style.setProperty("animation", "none", "important");
      style.setProperty("transition", "none", "important");
      style.setProperty("caret-color", "transparent");
    } catch {
      // Cosmetic freeze only — the export is correct without it.
    }
  } catch {
    // Genuinely unstyled (SVG internals, etc.) — keep the clone as-is.
  }

  const sourceChildren = source.children;
  const cloneChildren = clone.children;

  for (let i = 0; i < sourceChildren.length && i < cloneChildren.length; i++) {
    const s = sourceChildren[i];
    const c = cloneChildren[i];

    if (s && c) copyComputedStyles(s, c);
  }
}

function snapshotCanvases(sourceRoot: Element, cloneRoot: Element): void {
  const sourceCanvases = sourceRoot.querySelectorAll("canvas");
  const cloneCanvases = cloneRoot.querySelectorAll<HTMLCanvasElement>("canvas");
  sourceCanvases.forEach((sourceCanvas, index) => {
    const cloneCanvas = cloneCanvases[index];

    if (!cloneCanvas) return;

    try {
      const url = sourceCanvas.toDataURL("image/png");
      const img = document.createElement("img");
      img.src = url;
      img.width = sourceCanvas.width;
      img.height = sourceCanvas.height;
      // Keep the layout box the canvas occupied.
      const rect = sourceCanvas.getBoundingClientRect();
      img.style.width = `${rect.width}px`;
      img.style.height = `${rect.height}px`;
      img.style.maxWidth = "100%";
      cloneCanvas.replaceWith(img);
    } catch {
      // Tainted canvas (never expected — no external images): leave blank.
    }
  });
}

function copyScrollPositions(source: Element, clone: Element): void {
  if (source instanceof HTMLElement && clone instanceof HTMLElement) {
    try {
      clone.scrollTop = source.scrollTop;
      clone.scrollLeft = source.scrollLeft;
    } catch {
      // Non-scrollable — ignore.
    }
  }

  const sourceChildren = source.children;
  const cloneChildren = clone.children;

  for (let i = 0; i < sourceChildren.length; i++) {
    const s = sourceChildren[i];
    const c = cloneChildren[i];

    if (s && c) copyScrollPositions(s, c);
  }
}

/**
 * Inline copy of every same-origin stylesheet (Carbon, Plex, app CSS).
 * Cross-origin sheets throw on `cssRules` access and are skipped — the
 * per-element inlined values above already carry their contribution.
 * Covers what inlining cannot: pseudo-elements, `::placeholder`,
 * container queries and `:hover`-independent structural rules.
 */
function collectDocumentCssText(): string {
  const parts: string[] = [];

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;

      if (!rules) continue;

      const css: string[] = [];

      for (const rule of Array.from(rules)) css.push(rule.cssText);

      if (css.length > 0) parts.push(css.join("\n"));
    } catch {
      // Cross-origin stylesheet — unreadable, skipped by design.
    }
  }

  try {
    const adopted =
      // SAFETY: `adoptedStyleSheets` exists on modern Document — the cast
      // only narrows the lib type that may not declare it yet.
      (document as Document & { adoptedStyleSheets?: CSSStyleSheet[] })
        .adoptedStyleSheets ?? [];

    for (const sheet of adopted) {
      try {
        const css: string[] = [];

        for (const rule of Array.from(sheet.cssRules)) css.push(rule.cssText);

        if (css.length > 0) parts.push(css.join("\n"));
      } catch {
        // Unreadable constructed sheet — skipped.
      }
    }
  } catch {
    // Older engines without constructed stylesheets — nothing to add.
  }

  return parts.join("\n");
}

/**
 * Carbon theme scope for the isolated render. The app always renders inside
 * `<Theme theme="g100">`, which defines every `--cds-*` token on its
 * wrapper — the clone loses that ancestor, so the SVG wrapper re-enters
 * the same scope (class + `data-carbon-theme`) and the embedded
 * stylesheet's `.cds--g100` rule re-provides the tokens.
 */
function themeClassFor(dataTheme: string): string {
  if (dataTheme === "white") return "cds--white";

  if (dataTheme === "g10") return "cds--g10";

  if (dataTheme === "g90") return "cds--g90";

  return "cds--g100";
}

function carbonThemeScope(el: HTMLElement) {
  const fallback = { themeClass: "cds--g100", dataTheme: "g100" };

  try {
    const host = el.closest("[data-carbon-theme]");

    if (host) {
      const dataTheme =
        host.getAttribute("data-carbon-theme")?.trim() || fallback.dataTheme;

      const themeClass =
        Array.from(host.classList).find((c) =>
          /^cds--(white|g10|g90|g100)$/.test(c),
        ) ?? themeClassFor(dataTheme);

      return { themeClass, dataTheme };
    }

    const themed = el.closest(".cds--white, .cds--g10, .cds--g90, .cds--g100");

    if (themed) {
      const themeClass =
        ["cds--white", "cds--g10", "cds--g90", "cds--g100"].find((c) =>
          themed.classList.contains(c),
        ) ?? fallback.themeClass;

      return {
        themeClass,
        dataTheme: themeClass.replace("cds--", ""),
      };
    }
  } catch {
    // DOM lookup failed — fall through to the g100 default below.
  }

  return fallback;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new Error("Could not render the captured image"));
    img.src = url;
  });
}

/**
 * Render `el` to a PNG blob. Uses the element's on-screen size (bounding
 * rect, falling back to scroll size for clipped hosts) at 2x for crisp
 * text on retina displays.
 */
export async function captureElementAsPngBlob(
  el: HTMLElement,
  opts?: { scale?: number },
): Promise<Blob> {
  const rect = el.getBoundingClientRect();

  const width = Math.max(
    1,
    Math.round(rect.width || el.scrollWidth || el.clientWidth || 800),
  );

  const height = Math.max(
    1,
    Math.round(rect.height || el.scrollHeight || el.clientHeight || 600),
  );

  const scale = opts?.scale ?? 2;

  // SAFETY: cloning an HTMLElement yields the same element kind — the DOM
  // API just declares its return as the Node base.
  const clone = el.cloneNode(true) as HTMLElement;
  // Canvas snapshots first so the replacement `<img>`s exist before style
  // freezing copies the canvas layout box onto them.
  snapshotCanvases(el, clone);
  copyComputedStyles(el, clone);
  copyScrollPositions(el, clone);

  // Overlay scrollbars are chrome, not content — hide them in the export.
  clone.querySelectorAll<HTMLElement>(".nfi-slim-track").forEach((track) => {
    track.style.setProperty("display", "none", "important");
  });

  let background = "#161616";

  try {
    const computed = window.getComputedStyle(el);

    if (
      computed.backgroundColor &&
      computed.backgroundColor !== "rgba(0, 0, 0, 0)"
    ) {
      background = computed.backgroundColor;
    }
  } catch {
    // Keep the g100 fallback.
  }

  const { themeClass, dataTheme } = carbonThemeScope(el);
  const documentCss = collectDocumentCssText();

  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.margin = "0";
  clone.style.background = background;
  clone.style.overflow = "hidden";

  const serializer = new XMLSerializer();
  let cloneHtml: string;

  try {
    cloneHtml = serializer.serializeToString(clone);
  } catch {
    cloneHtml = clone.outerHTML;
  }

  // Stylesheets travel inside CDATA so raw `<`/`&` in CSS (data-URL SVG
  // arrows, attribute selectors) never break the outer XML parse. `]]>`
  // cannot appear in valid CSS unescaped; split it defensively anyway.
  const safeCss = documentCss.replaceAll("]]>", "]]]]><![CDATA[>");

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
    `<div xmlns="http://www.w3.org/1999/xhtml" class="${themeClass}" data-carbon-theme="${dataTheme}" style="width:${width}px;height:${height}px;margin:0;padding:0;overflow:hidden;background:${background};color-scheme:dark;">` +
    (safeCss.length > 0 ? `<style><![CDATA[${safeCss}]]></style>` : "") +
    cloneHtml +
    `</div></foreignObject></svg>`;

  const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = await loadImage(svgUrl);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");

  if (!ctx) throw new Error("Canvas 2D is unavailable in this browser");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  );

  if (!blob) throw new Error("Could not encode the captured image as PNG");

  return blob;
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug.slice(0, 48) : "export";
}

function timestampSuffix(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");

  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }
}

/** Copy a PNG blob to the OS clipboard; throws with a human message. */
export async function copyPngBlob(blob: Blob): Promise<void> {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    typeof ClipboardItem === "undefined"
  ) {
    throw new Error(
      "Clipboard image copy is not supported in this browser — use Download instead",
    );
  }

  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  } catch {
    throw new Error(
      "The browser blocked clipboard access — grant permission or use Download instead",
    );
  }
}

/** Capture one widget panel and either download or copy the PNG. */
export async function shareWidgetAsImage(
  panelId: string,
  action: "download" | "copy",
  title?: string,
): Promise<void> {
  const el = findPanelElement(panelId);

  if (!el) throw new Error("Could not find that widget on the page");
  const blob = await captureElementAsPngBlob(el);

  if (action === "download") {
    downloadBlob(
      blob,
      `widget-${slugify(title ?? panelId)}-${timestampSuffix()}.png`,
    );
  } else {
    await copyPngBlob(blob);
  }
}

/** Capture the whole visible page (workspace host) and download/copy it. */
export async function sharePageAsImage(
  action: "download" | "copy",
  pageName?: string,
): Promise<void> {
  const el = findWorkspaceHost();

  if (!el) throw new Error("Could not find the workspace on the page");
  const blob = await captureElementAsPngBlob(el);

  if (action === "download") {
    downloadBlob(
      blob,
      `page-${slugify(pageName ?? "workspace")}-${timestampSuffix()}.png`,
    );
  } else {
    await copyPngBlob(blob);
  }
}
