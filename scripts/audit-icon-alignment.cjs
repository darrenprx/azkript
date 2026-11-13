#!/usr/bin/env node
/* Icon/label alignment + text-clipping audit for the Azkript shell.
 *
 * WHY THIS EXISTS
 * ---------------
 * The user reported "there are still icon not aligned" and "small ui conflict still
 * exist", attaching screenshots of: a ribbon group caption overlapping a button label,
 * a clipped "Target Script Length" label, a "Macros" button whose icon looks broken,
 * and a three-row help menu ("Start from a template / Open the sample script / Read the
 * user guide") whose icons sit visibly high relative to their text.
 *
 * The caption overlap is owned by a separate change. This script covers the rest:
 * icon/label alignment across the whole shell, and clipped chrome text.
 *
 * WHAT IT MEASURES
 * ----------------
 * A "pair" is one control that renders a visible inline SVG next to a visible text
 * label of its own (a nested labelled control makes the unit compound and it is
 * skipped, so a split button's arrow is never paired with its neighbour's label).
 * For every pair it records raw geometry and CSS, and every judgement is made in Node
 * so the rules are reviewable in one place:
 *
 *   VCENTER   icon centre vs label centre, icon beside label (ROW)  > 1px
 *   HCENTER   icon centre vs label block centre, icon above label   > 1px
 *   INLINE    the SVG computes `display: inline`, i.e. it is seated on the text
 *             baseline instead of being a block/flex item. This is the root cause of
 *             the reported Welcome-menu defect; measured at -5.5px on all three rows.
 *   BASELINE  a flex/grid ancestor aligns items on `baseline`, where an SVG has no
 *             baseline of its own (its baseline is its bottom margin edge)
 *   SIZE      the same control role renders two different icon sizes across the run
 *   LABEL-X   in one vertical list, labels do not start at the same offset from their
 *             row's left edge — i.e. icon boxes of differing widths make the label
 *             column ragged
 *   INK       the drawn glyph is not centred in its own icon box
 *   CLIP      text is actually cut: the specified scrollWidth/scrollHeight test, plus a
 *             measured-ink test (a cut glyph is what the user sees; the reported
 *             "Target Script Length" defect moves scrollHeight by only 1px while the
 *             rendered descenders are cut)
 *
 * VACUOUS-PASS GUARD
 * ------------------
 * A surface yielding fewer than MIN_PAIRS_PER_SURFACE measured pairs is a FAILURE, never
 * a skip, and the whole run must clear MIN_PAIRS_TOTAL. Both constants are stated next
 * to the numbers they were derived from. This repo has already shipped one audit that
 * passed on zero measurements.
 *
 * NEGATIVE CONTROL (`--self-test`)
 * -------------------------------
 * A detector that never fails proves nothing, so `--self-test` runs the SAME measurement
 * code and the SAME judgement code against four deliberately broken pages, produced only
 * by page.addStyleTag / DOM removal in the browser (app/** is never touched):
 *
 *   shift     move every icon 3px down                -> must report VCENTER
 *   baseline  force icon rows onto align-items:baseline -> must report BASELINE
 *   clamp     clamp 2-line ribbon labels to one line   -> must report CLIP
 *   strip     remove every <svg>                       -> the vacuous guard must fail
 *
 * Usage:
 *   node scripts/audit-icon-alignment.cjs                    # full sweep, exit 0 = clean
 *   node scripts/audit-icon-alignment.cjs --json             # machine-readable result
 *   node scripts/audit-icon-alignment.cjs --dump             # raw pairs/clips per surface
 *   node scripts/audit-icon-alignment.cjs --only=view:script:light
 *   node scripts/audit-icon-alignment.cjs --self-test        # negative controls
 *   node scripts/audit-icon-alignment.cjs --app=<dir>        # measure a copy of the app
 *
 * Environment: Node 22, the pinned playwright-core dependency, installed Chrome.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const PLAYWRIGHT = path.join(ROOT, "node_modules", "playwright-core");
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";

const argv = process.argv.slice(2);
const flag = (name, fallback = "") => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const APP_DIR = path.resolve(ROOT, flag("app", "app"));
const APP_URL = pathToFileURL(path.join(APP_DIR, "index.html")).href;
const JSON_OUT = argv.includes("--json");
const DUMP = argv.includes("--dump");
const SELF_TEST = argv.includes("--self-test");
const ONLY = flag("only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const VIEWPORT = { width: 1440, height: 900 };

/* ------------------------------------------------------------------ */
/* thresholds                                                          */
/* ------------------------------------------------------------------ */

/* 1px, as reported. A box is rounded once per measurement, so a genuine 1px
 * disagreement is real and <= 1px counts as aligned. */
const TOL = 1;
/* Icon artwork has to sit within 1.5px of its own box centre: tighter starts flagging
 * deliberate optical compensation, looser hides a genuinely drawn-off glyph. */
const INK_TOL = 1.5;
/* A glyph must lose more than this much ink before it is called clipped.
 *
 * Calibrated against pixels, not guessed: the "Target Script Length" label was screenshotted
 * at 8x both constrained and with its line-clamp lifted. Constrained, its ink stops 1px (at
 * 8x) short of the client box; unclamped, the same ink extends 6px (at 8x) past it — so the
 * clip genuinely removes 0.875 CSS px of descender. 0.5 sits below that real cut and above
 * the ~0.25px at which canvas metrics and font rasterisation stop agreeing. */
const INK_CLIP_TOL = 0.5;

/* VACUOUS-PASS GUARD ---------------------------------------------------------------
 * Derived from the measured unfixed tree: the thinnest surface yields 13 pairs (the
 * 6 views x 2 themes sit at 30-46; the 10 ribbon tabs 13-28; the 6 dialogs plus read
 * dock and Start Center 13-30). A floor of 10 sits under every real surface and far
 * above zero, so a surface that loses most of its icons fails loudly instead of passing
 * on a handful of leftovers. */
const MIN_PAIRS_PER_SURFACE = 10;
/* 38 surfaces x 10 = 380 implied by the per-surface rule; the run must clear 400, which
 * also catches "a few surfaces measured, the rest did not". */
const MIN_PAIRS_TOTAL = 400;

/* ------------------------------------------------------------------ */
/* surfaces                                                            */
/* ------------------------------------------------------------------ */

const VIEWS = ["script", "sceneview", "navigator", "characters", "reports", "beatboard"];
const RIBBON_TABS = ["home", "file", "edit", "view", "format", "insert", "document", "tools", "production", "help"];
const THEMES = ["light", "dark"];

const closeStartCenter = (page) => page.evaluate(() => document.getElementById("startCenter")?.close());
const clickRail = (page, view) =>
  page.evaluate((v) => document.querySelector(`.rail__item[data-view="${v}"]`)?.click(), view);
const setTheme = (page, theme) =>
  page.evaluate((want) => {
    if (document.documentElement.getAttribute("data-theme") !== want) document.getElementById("themeToggle")?.click();
  }, theme);

const SURFACES = [
  ...VIEWS.flatMap((view) =>
    THEMES.map((theme) => [
      `view:${view}:${theme}`,
      async (page) => {
        await closeStartCenter(page);
        await setTheme(page, theme);
        await clickRail(page, view);
      },
    ])
  ),
  ...RIBBON_TABS.flatMap((tab) =>
    THEMES.map((theme) => [
      `ribbon:${tab}:${theme}`,
      async (page) => {
        await closeStartCenter(page);
        await setTheme(page, theme);
        await page.evaluate((t) => document.querySelector(`[data-ribbon-tab="${t}"]`)?.click(), tab);
      },
    ])
  ),
  ["startCenter", async () => {}],
  [
    "readDock",
    async (page) => {
      await closeStartCenter(page);
      await page.evaluate(() => document.getElementById("readToggle")?.click());
    },
  ],
  [
    "dialog:settings",
    async (page) => {
      await closeStartCenter(page);
      await page.evaluate(() => document.getElementById("settingsButton")?.click());
    },
  ],
  [
    "dialog:pageSetup",
    async (page) => {
      await closeStartCenter(page);
      await page.evaluate(() => document.getElementById("pageSetupButton")?.click());
    },
  ],
  [
    "dialog:assignVoices",
    async (page) => {
      await closeStartCenter(page);
      await clickRail(page, "characters");
      await page.waitForTimeout(450);
      await page.evaluate(() => document.getElementById("charAssignVoicesBtn")?.click());
    },
  ],
  [
    "dialog:help",
    async (page) => {
      await closeStartCenter(page);
      await page.evaluate(() => document.getElementById("helpButton")?.click());
    },
  ],
  /* The reported three-row list is in Help > Welcome; reached the way a user reaches it
   * (Help tab, then the Welcome command). */
  [
    "dialog:welcome",
    async (page) => {
      await closeStartCenter(page);
      await page.evaluate(() => document.querySelector('[data-ribbon-tab="help"]')?.click());
      await page.waitForTimeout(400);
      await page.evaluate(() => document.querySelector('[data-ribbon-command="help-welcome"]')?.click());
    },
  ],
];

/* ------------------------------------------------------------------ */
/* ALLOWED / exemption map                                             */
/* ------------------------------------------------------------------ */
/* Deliberately short. Every entry has to be a reason that is still true when a reviewer
 * looks at the element; "it looked fine" is not a reason. Matched against the audit's
 * selector for the element and, for CLIP, its parent. */
const ALLOWED = {
  /* The value box of a customizable <select>. Truncating the value with an ellipsis is
   * the documented reason that box exists — it is what keeps the arrow outside the
   * clip — and the full value is one click away in the picker. */
  selectedcontent: "select value box: ellipsis is by design, full value lives in the picker",
  /* Table Read voice/rate selects: same object, same reason. */
  "div.read-dock__settings select": "read-dock select value box: ellipsis by design",
  /* Editable single-line fields scroll their content at the caret; scrollWidth >
   * clientWidth is normal for an <input> and the value is reachable by clicking in. */
  "input.sv-inline-input": "editable field: scrolls at the caret, not clipped static text",
  "input.search-field__input": "editable field: scrolls at the caret",
  /* Containers that clip for structure or decoration, never to hide a label. */
  "div.ambient": "decorative ambient backdrop; clip is the effect",
  "div#appShell.app-shell": "shell grid; clip is the window edge, no label relies on it",
  "div.ribbon__scroller": "ribbon horizontal scroller; content is reachable by scrolling",
  "aside#inspector.inspector": "inspector pane clips its scrolling body; the body itself scrolls",
  /* Scene-view table cells hold document data, not chrome: an ellipsised scene heading is
   * correct table behaviour and the full value is in the tooltip. */
  "button.sv-jump-btn": "scene-view data cell: ellipsis on document data, full value in tooltip",
};

/* ------------------------------------------------------------------ */
/* in-page measurement (raw geometry only; every judgement is in Node)  */
/* ------------------------------------------------------------------ */

const MEASURE = () => {
  /* mirrored from the constants above: this function is serialised into the page, so it
   * cannot close over this module's scope */
  const INK_CLIP_TOL = 0.5;

  const EXCLUDE = ".svg-sprite, .paper, .screenplay-editor, .para, .page-card, .print-root";
  const INTERACTIVE = [
    "button",
    "a[href]",
    "label",
    "select",
    "summary",
    "input[type=checkbox]",
    "input[type=radio]",
    "[role=button]",
    "[role=tab]",
    "[role=menuitem]",
    "[role=option]",
    "[role=switch]",
  ].join(",");

  const sel = (el) => {
    if (!el || el.nodeType !== 1) return "?";
    if (el === document.body) return "body";
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean) : [];
    for (const c of cls.slice(0, 2)) s += `.${c}`;
    return s;
  };

  const isVisible = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (Number(cs.opacity) === 0) return false;
    if (el.closest("[hidden]")) return false;
    if (el.closest("dialog:not([open])")) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  };

  /* One client rect per rendered line. In Chromium the height of a text range rect is the
   * font box (ascent + descent), not the CSS line-height, and its centre is the font box
   * centre — which depends only on the font, not on whether the label happens to contain
   * a descender. That is what makes it a stable comparison target. */
  const lineRects = (node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
  };

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const metricsFor = (parentEl, sample) => {
    const cs = getComputedStyle(parentEl);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    /* Apply text-transform before measuring. Without this, a caption whose source text is
     * "Proofing" but which renders as "PROOFING" is measured with the ascender of the "f"
     * and the descender of the "g", which invent 2px of ink that is not on screen. */
    const shown =
      cs.textTransform === "uppercase"
        ? sample.toUpperCase()
        : cs.textTransform === "lowercase"
          ? sample.toLowerCase()
          : sample;
    const m = ctx.measureText(shown);
    const lh = Number.parseFloat(cs.lineHeight);
    return {
      lineHeight: Number.isFinite(lh) ? lh : null,
      fontAscent: m.fontBoundingBoxAscent,
      fontDescent: m.fontBoundingBoxDescent,
      inkAscent: m.actualBoundingBoxAscent,
      inkDescent: m.actualBoundingBoxDescent,
      fontSize: Number.parseFloat(cs.fontSize),
    };
  };
  /* Where the glyph ink actually is on a line rect.
   *
   * A Chromium text range rect spans the FONT box (ascent + descent), not the CSS
   * line-height: measured 15px for an 11px font whose font box is 12+3. So the baseline is
   * rect.top + fontAscent and there is nothing to centre — doing the line-height
   * centring here invents 2px of ink above every uppercase caption. Only when a rect is
   * demonstrably taller than the font box (a line box supplied by something else) is the
   * font box centred inside it. */
  const inkBox = (rect, met) => {
    const fontBox = met.fontAscent + met.fontDescent;
    const isFontBox = Math.abs(rect.height - fontBox) <= 1.5;
    const baseline = isFontBox
      ? rect.top + met.fontAscent
      : rect.top + ((met.lineHeight || rect.height) - fontBox) / 2 + met.fontAscent;
    return { top: baseline - met.inkAscent, bottom: baseline + met.inkDescent, baseline };
  };

  /* Text nodes that are labels of `unit`: not inside an icon, visible, and owned by the
   * unit itself (nearest interactive ancestor is the unit, or none when the unit is
   * itself non-interactive). */
  const labelNodes = (unit, interactiveUnit) => {
    const out = [];
    const walker = document.createTreeWalker(unit, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const text = (n.textContent || "").trim();
      if (!text) continue;
      const p = n.parentElement;
      if (!p || p.closest("svg") || p.closest(".svg-sprite")) continue;
      if (!isVisible(p)) continue;
      const owner = p.closest(INTERACTIVE);
      if (interactiveUnit ? owner !== unit : owner !== null) continue;
      const rects = lineRects(n);
      if (!rects.length) continue;
      out.push({ parent: p, text: text.replace(/\s+/g, " "), rects });
    }
    return out;
  };

  /* The unit an icon belongs to: its own control when that control already has a label,
   * otherwise the nearest non-interactive ancestor that holds a label. An icon-only
   * button therefore never pairs with a label belonging to another control. */
  const unitFor = (svg) => {
    const ctrl = svg.parentElement.closest(INTERACTIVE);
    if (ctrl && isVisible(ctrl) && labelNodes(ctrl, true).length) return { unit: ctrl, interactive: true };
    let a = svg.parentElement;
    for (let hops = 0; a && a !== document.body && hops < 4; a = a.parentElement, hops++) {
      if (a.matches(INTERACTIVE)) return null;
      if (labelNodes(a, false).length) return { unit: a, interactive: false };
    }
    return null;
  };

  /* Compound = holds another interactive control that has its own label, e.g. a split
   * button wrapping a labelled button plus an arrow. Pairing anything inside it with the
   * outer element's text is fiction. */
  const isCompound = (unit) => {
    for (const other of unit.querySelectorAll(INTERACTIVE)) {
      if (!isVisible(other)) continue;
      if (labelNodes(other, true).length) return true;
    }
    return false;
  };

  /* Is the unit's label left-anchored (so its left edge carries information) or is it
   * centred (so different left edges are the design, e.g. the rail's icon-over-label
   * buttons)? */
  const labelAnchor = (unit) => {
    const cs = getComputedStyle(unit);
    if (cs.textAlign === "center") return "center";
    if (/flex/.test(cs.display) && cs.flexDirection.startsWith("column") && cs.alignItems === "center") return "center";
    if (/flex/.test(cs.display) && cs.justifyContent === "center" && !cs.flexDirection.startsWith("column")) return "center";
    if (/grid/.test(cs.display) && cs.justifyItems === "center") return "center";
    return "left";
  };

  /* Element identity, so two different .ribbon-row siblings are not merged into a list. */
  const uids = new WeakMap();
  let nextUid = 0;
  const uidOf = (el) => {
    if (!uids.has(el)) uids.set(el, ++nextUid);
    return uids.get(el);
  };

  /* ---------- 1. icon + label pairs ---------- */
  const pairs = [];
  const doneUnits = new Set();
  for (const svg of document.querySelectorAll("svg")) {
    if (svg.closest(EXCLUDE)) continue;
    if (!isVisible(svg)) continue;
    const where = unitFor(svg);
    if (!where) continue;
    const { unit, interactive } = where;
    if (doneUnits.has(unit)) continue;
    doneUnits.add(unit);
    if (isCompound(unit)) continue;

    const labels = labelNodes(unit, interactive);
    if (!labels.length) continue;

    const svgs = [...unit.querySelectorAll("svg")].filter(
      (s) => !s.closest(".svg-sprite") && isVisible(s) && (!interactive || s.parentElement.closest(INTERACTIVE) === unit)
    );
    if (!svgs.length) continue;

    const ur = unit.getBoundingClientRect();
    const allLines = labels.flatMap((l) => l.rects.map((r) => ({ rect: r, parent: l.parent, text: l.text })));
    const block = {
      left: Math.min(...allLines.map((l) => l.rect.left)),
      right: Math.max(...allLines.map((l) => l.rect.right)),
      top: Math.min(...allLines.map((l) => l.rect.top)),
      bottom: Math.max(...allLines.map((l) => l.rect.bottom)),
    };
    const lineH = allLines[0].rect.height;

    /* Pick the icon that leads the label horizontally, else the one above it. */
    let pick = null;
    for (const s of svgs) {
      const r = s.getBoundingClientRect();
      for (const line of allLines) {
        const rect = line.rect;
        const gapRight = rect.left - r.right;
        const gapLeft = r.left - rect.right;
        const gap = Math.max(gapRight, gapLeft);
        const vOverlap = Math.min(rect.bottom, r.bottom) - Math.max(rect.top, r.top);
        const rowish = vOverlap > Math.min(rect.height, r.height) * 0.3;
        if (gap >= -8 && gap <= 24 && rowish) {
          const cand = { svg: s, line, orientation: "ROW", gap };
          if (!pick || cand.gap < pick.gap) pick = cand;
        }
      }
      if (pick) continue;
      const vGap = block.top - r.bottom;
      const cx = (r.left + r.right) / 2;
      if (vGap >= -2 && vGap <= 16 && Math.abs(cx - (block.left + block.right) / 2) <= 18) {
        pick = { svg: s, line: null, orientation: "STACK", gap: vGap };
      }
    }
    if (!pick) continue;

    const sr = pick.svg.getBoundingClientRect();
    const scs = getComputedStyle(pick.svg);

    /* Comparison target:
     *  - a tall icon spanning several label lines is visually one object with the whole
     *    block, so compare against the block;
     *  - otherwise compare against the line the icon actually sits on. */
    let target;
    let targetKind;
    if (pick.orientation === "ROW" && sr.height > lineH * 1.5 && allLines.length > 1) {
      target = block;
      targetKind = "block";
    } else if (pick.orientation === "ROW") {
      target = pick.line.rect;
      targetKind = "line";
    } else {
      target = block;
      targetKind = "block";
    }

    const chain = [];
    for (let e = unit, i = 0; e && e !== document.body && i < 4; e = e.parentElement, i++) {
      const cs = getComputedStyle(e);
      chain.push({ sel: sel(e), display: cs.display, alignItems: cs.alignItems });
    }
    const baselineHolder = chain.find((c) => /flex|grid/.test(c.display) && c.alignItems === "baseline");

    /* Drawn-glyph box in *screen* pixels — the only unit-safe way here, because a
     * `use`-of-symbol icon reports its bBox in the symbol's viewBox units while a
     * self-contained svg reports CSS px, and the two scale differently.
     *
     * The CTM is taken from the CONTENT element (the <use>), not from the outer <svg>:
     * an element's own transform is part of its own screen CTM but not of its bBox, so
     * measuring through the parent would silently treat a transformed glyph as centred —
     * exactly the defect this metric exists to find. */
    let inkOffset = null;
    try {
      const content = pick.svg.querySelector("use") || pick.svg;
      const b = content.getBBox();
      const ctm = content.getScreenCTM();
      if (ctm && b.width > 0 && b.height > 0) {
        const pt = pick.svg.createSVGPoint();
        const map = (x, y) => {
          pt.x = x;
          pt.y = y;
          const p = pt.matrixTransform(ctm);
          return { x: p.x, y: p.y };
        };
        const tl = map(b.x, b.y);
        const br = map(b.x + b.width, b.y + b.height);
        inkOffset = {
          x: +(tl.x + (br.x - tl.x) / 2 - (sr.left + sr.width / 2)).toFixed(2),
          y: +(tl.y + (br.y - tl.y) / 2 - (sr.top + sr.height / 2)).toFixed(2),
          w: +(br.x - tl.x).toFixed(2),
          h: +(br.y - tl.y).toFixed(2),
        };
      }
    } catch {
      inkOffset = null;
    }

    pairs.push({
      unit: sel(unit),
      unitUid: uidOf(unit),
      unitTag: unit.tagName.toLowerCase(),
      unitClasses: typeof unit.className === "string" ? unit.className.trim() : "",
      parent: unit.parentElement ? sel(unit.parentElement) : "?",
      parentUid: unit.parentElement ? uidOf(unit.parentElement) : 0,
      label: (pick.line ? pick.line.text : labels.map((l) => l.text).join(" ")).slice(0, 40),
      labelEl: pick.line ? sel(pick.line.parent) : sel(labels[0].parent),
      anchor: labelAnchor(unit),
      orientation: pick.orientation,
      targetKind,
      icon: {
        w: +sr.width.toFixed(2),
        h: +sr.height.toFixed(2),
        display: scs.display,
        verticalAlign: scs.verticalAlign,
        cx: +((sr.left + sr.right) / 2).toFixed(2),
        cy: +((sr.top + sr.bottom) / 2).toFixed(2),
      },
      text: {
        left: +target.left.toFixed(2),
        blockLeft: +block.left.toFixed(2),
        cx: +((target.left + target.right) / 2).toFixed(2),
        cy: +((target.top + target.bottom) / 2).toFixed(2),
        lines: allLines.length,
      },
      unitLeft: +ur.left.toFixed(2),
      unitW: +ur.width.toFixed(2),
      unitH: +ur.height.toFixed(2),
      dCy: +(((sr.top + sr.bottom) / 2) - ((target.top + target.bottom) / 2)).toFixed(2),
      dCx: +(((sr.left + sr.right) / 2) - ((block.left + block.right) / 2)).toFixed(2),
      gap: +pick.gap.toFixed(2),
      iconOffset: inkOffset,
      chain,
      baselineHolder: baselineHolder ? baselineHolder.sel : null,
    });
  }

  /* ---------- 2. vertical lists ---------- */
  /* Group pairs by parent element identity, keep only groups that are actually stacked
   * (consecutive rows separated vertically and horizontally overlapping) with >= 3
   * rows. A horizontal toolbar is not a list. */
  const groups = new Map();
  for (const p of pairs) {
    if (!groups.has(p.parentUid)) groups.set(p.parentUid, { parent: p.parent, rows: [] });
    groups.get(p.parentUid).rows.push(p);
  }
  const lists = [];
  for (const g of groups.values()) {
    if (g.rows.length < 3) continue;
    const rows = g.rows.slice().sort((a, b) => a.text.cy - b.text.cy);
    let stacked = true;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1];
      const b = rows[i];
      if (b.text.cy - a.text.cy < 6) {
        stacked = false;
        break;
      }
      const overlap = Math.min(a.unitLeft + a.unitW, b.unitLeft + b.unitW) - Math.max(a.unitLeft, b.unitLeft);
      if (overlap < Math.min(a.unitW, b.unitW) * 0.5) {
        stacked = false;
        break;
      }
    }
    if (!stacked) continue;
    lists.push({ parent: g.parent, rows });
  }

  /* ---------- 3. clipped text ---------- */
  const clips = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(EXCLUDE)) continue;
    if (el.tagName.toLowerCase() === "svg" || el.closest("svg")) continue;
    if (!isVisible(el)) continue;
    const cs = getComputedStyle(el);
    const clipsX = /hidden|clip/.test(cs.overflowX);
    const clipsY = /hidden|clip/.test(cs.overflowY);
    if (!clipsX && !clipsY) continue;
    const r = el.getBoundingClientRect();
    const box = {
      left: r.left + el.clientLeft,
      top: r.top + el.clientTop,
      right: r.left + el.clientLeft + el.clientWidth,
      bottom: r.top + el.clientTop + el.clientHeight,
    };
    /* the specified test */
    const scrollDx = clipsX ? el.scrollWidth - el.clientWidth : 0;
    const scrollDy = clipsY ? el.scrollHeight - el.clientHeight : 0;
    /* measured ink of the text this element is the nearest clipper for */
    let worst = null;
    let firstText = "";
    let anyInk = false;
    let textCrosses = false;
    let clampTruncated = false;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = (n.textContent || "").trim();
      if (!t) continue;
      const p = n.parentElement;
      if (!p || p.closest("svg") || p.closest(".svg-sprite") || p.closest(EXCLUDE)) continue;
      if (!isVisible(p)) continue;
      /* The nearest ancestor that clips OR scrolls owns this text. Stopping at the first
       * `overflow: auto`/`scroll` ancestor too is essential: text inside a scrollable body
       * is reachable, so attributing it to the outer `overflow: clip` wrapper invents a
       * 135px "clip" that nobody can see. Only text whose nearest such ancestor is `el`
       * itself is a candidate. */
      let owner = null;
      for (let a = p; a && a !== document.body; a = a.parentElement) {
        const acs = getComputedStyle(a);
        if (acs.overflowX !== "visible" || acs.overflowY !== "visible") {
          owner = a;
          break;
        }
      }
      if (owner !== el) continue;
      const rects = lineRects(n);
      if (!rects.length) continue;
      const met = metricsFor(p, t);
      if (!firstText) firstText = t;
      anyInk = true;
      /* Which lines does the clipper actually cut?
       *
       * A line is a candidate when its rect crosses the clip edge. Testing ink on lines
       * entirely inside the box compares the font's nominal descent against the box height
       * and reports sub-pixel "clipping" that is not on screen; and scrollWidth/scrollHeight
       * overflow with no text at the boundary is a decorative child (the reports stat-card's
       * ring), not clipped text.
       *
       * `-webkit-line-clamp: N` hides whole lines by design and getClientRects still reports
       * them, so only the first N lines are rendered and only they can be clipped. A hidden
       * line is recorded as clampTruncated (an intentional truncation); a *rendered* line
       * whose ink crosses the edge is a real cut — that distinction is exactly what separates
       * the scene-view's 3-line clamped action cell from the reported "Target Script Length"
       * descender cut. */
      const clampN = /^\d+$/.test(cs.webkitLineClamp) ? Number.parseInt(cs.webkitLineClamp, 10) : Infinity;
      rects.forEach((rect, lineIndex) => {
        if (lineIndex >= clampN) {
          clampTruncated = true;
          return;
        }
        const crossesV = clipsY && (rect.top < box.top - 0.5 || rect.bottom > box.bottom + 0.5);
        const crossesH = clipsX && (rect.left < box.left - 0.5 || rect.right > box.right + 0.5);
        if (!crossesV && !crossesH) return;
        textCrosses = true;
        const ink = inkBox(rect, met);
        /* the missing-ink amount is what falls outside the clip box */
        const overTop = clipsY ? box.top - ink.top : 0;
        const overBottom = clipsY ? ink.bottom - box.bottom : 0;
        const overLeft = clipsX ? box.left - rect.left : 0;
        const overRight = clipsX ? rect.right - box.right : 0;
        const d = Math.max(overTop, overBottom, overLeft, overRight, 0);
        if (d > (worst ? worst.delta : 0)) {
          worst = {
            delta: +d.toFixed(2),
            side: d === overTop ? "top" : d === overBottom ? "bottom" : d === overLeft ? "left" : "right",
          };
        }
      });
    }
    if (!anyInk) continue;
    if (scrollDx <= 1 && scrollDy <= 1 && (!worst || worst.delta <= INK_CLIP_TOL)) continue;
    const ownText = [...el.childNodes]
      .filter((c) => c.nodeType === 3)
      .map((c) => c.textContent.trim())
      .join(" ");
    /* Classify, because three different things produce the same scrollWidth/scrollHeight
     * signal and only one of them means the user cannot read a label:
     *
     *   CLIP      a text line crosses the clip edge: a glyph is actually cut, or an
     *             ellipsis replaces characters. This is the defect class the report cares
     *             about and the only one that fails the run.
     *   OVERFLOW  scroll overflow with no text at the boundary — a decorative child (the
     *             reports stat-card ring) or a box that is merely shorter than its content
     *             box. Reported as an observation with its measurement; not a text defect.
     *   TIGHT     scroll overflow whose only cause is a deliberately tight line-height (an
     *             11px/11px uppercase caption overflows its 11px box by 2px while every
     *             glyph still fits). Also an observation.
     *
     * The distinction matters: reporting all three as "clipped text" produced 243 entries
     * for one 11px caption style and buried the one real finding. */
    const inkConfirmed = !!worst && worst.delta > INK_CLIP_TOL;
    const clamp = cs.webkitLineClamp;
    const ellipsised = cs.textOverflow === "ellipsis" && scrollDx > 1;
    let kind;
    if (textCrosses && (inkConfirmed || ellipsised || scrollDx > 1)) kind = "CLIP";
    else if (!textCrosses && clampTruncated) kind = "CLAMPED";
    else if (!textCrosses) kind = "OVERFLOW";
    else kind = "TIGHT";
    clips.push({
      sel: sel(el),
      uid: uidOf(el),
      parent: sel(el.parentElement),
      kind,
      text: (ownText || firstText || (el.textContent || "").trim().replace(/\s+/g, " ")).slice(0, 48),
      target: firstText.slice(0, 40),
      scrollDx: Math.max(0, scrollDx),
      scrollDy: Math.max(0, scrollDy),
      inkClip: worst || { delta: 0, side: "none" },
      clientW: el.clientWidth,
      clientH: el.clientHeight,
      scrollW: el.scrollWidth,
      scrollH: el.scrollHeight,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      textOverflow: cs.textOverflow,
      lineClamp: clamp,
      rectW: +r.width.toFixed(1),
      rectH: +r.height.toFixed(1),
    });
  }

  return {
    pairs,
    lists: lists.map((l) => ({ parent: l.parent, uids: l.rows.map((r) => r.unitUid) })),
    clips,
    theme: document.documentElement.getAttribute("data-theme"),
    dialogs: [...document.querySelectorAll("dialog[open]")].map((d) => d.id || d.className),
    viewport: { w: window.innerWidth, h: window.innerHeight },
  };
};

/* ------------------------------------------------------------------ */
/* judgement                                                           */
/* ------------------------------------------------------------------ */

const allowedHit = (s) => Object.keys(ALLOWED).some((k) => s === k || s.startsWith(`${k} `) || s.includes(k));

function judge(surface, m, roleSizes) {
  const defects = [];

  for (const p of m.pairs) {
    const where = `${p.unit} "${p.label}"`;

    if (p.orientation === "ROW") {
      if (Math.abs(p.dCy) > TOL) {
        defects.push({
          category: "VCENTER",
          surface,
          control: where,
          metric: `icon centre - text ${p.targetKind} centre = ${p.dCy}px`,
          delta: Math.abs(p.dCy),
          selector: p.unit,
        });
      }
    } else if (Math.abs(p.dCx) > TOL) {
      defects.push({
        category: "HCENTER",
        surface,
        control: where,
        metric: `icon centre - label block centre = ${p.dCx}px (icon stacked over label)`,
        delta: Math.abs(p.dCx),
        selector: p.unit,
      });
    }

    /* inline SVG seated on the text baseline: the reported Welcome-menu defect */
    if (p.icon.display === "inline") {
      defects.push({
        category: "INLINE",
        surface,
        control: where,
        metric: `svg display:inline (seated on the text baseline), measured dCy=${p.dCy}px`,
        delta: Math.abs(p.dCy) || 0.5,
        selector: p.unit,
      });
    }

    /* flex/grid baseline alignment where the SVG has no baseline to contribute */
    if (p.baselineHolder) {
      defects.push({
        category: "BASELINE",
        surface,
        control: where,
        metric: `${p.baselineHolder} aligns items on baseline; an svg's baseline is its bottom edge`,
        delta: Math.abs(p.dCy) || 0.5,
        selector: p.unit,
      });
    }

    /* drawn glyph not centred in its own box */
    if (p.iconOffset && (Math.abs(p.iconOffset.x) > INK_TOL || Math.abs(p.iconOffset.y) > INK_TOL)) {
      defects.push({
        category: "INK",
        surface,
        control: where,
        metric: `glyph ink off-centre x=${p.iconOffset.x}px y=${p.iconOffset.y}px in a ${p.icon.w}x${p.icon.h} box`,
        delta: Math.max(Math.abs(p.iconOffset.x), Math.abs(p.iconOffset.y)),
        selector: p.unit,
      });
    }

    /* same role, different icon size — aggregated across the whole run */
    const role = `${p.unitTag}.${p.unitClasses.split(/\s+/).filter(Boolean).sort().join(".")}`;
    if (!roleSizes.has(role)) roleSizes.set(role, new Map());
    const sizes = roleSizes.get(role);
    const size = `${p.icon.w}x${p.icon.h}`;
    if (!sizes.has(size)) sizes.set(size, new Set());
    sizes.get(size).add(surface);
  }

  /* labels in a vertical list must start at one shared offset from the row's left edge */
  for (const list of m.lists) {
    const rows = list.uids.map((uid) => m.pairs.find((p) => p.unitUid === uid)).filter(Boolean);
    const usable = rows.filter((r) => r.anchor === "left");
    if (usable.length < 3) continue;
    const offsets = usable.map((r) => +(r.text.blockLeft - r.unitLeft).toFixed(2));
    const sorted = offsets.slice().sort((a, b) => a - b);
    const modal = sorted[Math.floor(sorted.length / 2)];
    for (const r of usable) {
      const off = +(r.text.blockLeft - r.unitLeft).toFixed(2);
      const d = off - modal;
      if (Math.abs(d) <= TOL) continue;
      defects.push({
        category: "LABEL-X",
        surface,
        control: `${r.unit} "${r.label}"`,
        metric: `label starts ${off}px into its row vs ${modal}px for siblings (list ${list.parent}) = ${d.toFixed(2)}px`,
        delta: Math.abs(d),
        selector: r.unit,
      });
    }
  }

  /* clipped text */
  for (const c of m.clips) {
    if (allowedHit(c.sel) || allowedHit(c.parent)) continue;
    const parts = [];
    if (c.scrollDx > 1) parts.push(`scrollWidth - clientWidth = ${c.scrollDx}px`);
    if (c.scrollDy > 1) parts.push(`scrollHeight - clientHeight = ${c.scrollDy}px`);
    if (c.inkClip.delta > INK_CLIP_TOL) parts.push(`glyph ink cut ${c.inkClip.delta}px at the ${c.inkClip.side} edge`);
    if (!parts.length) continue;
    const observation = c.kind !== "CLIP";
    defects.push({
      category: c.kind,
      surface,
      control: `${c.sel} "${c.text || c.target}"`,
      metric:
        parts.join("; ") +
        (c.kind === "TIGHT"
          ? " (tight line-height: no glyph lost, informational)"
          : c.kind === "OVERFLOW"
            ? " (box shorter than a decorative child; no text at the boundary, informational)"
            : c.kind === "CLAMPED"
              ? ` (-webkit-line-clamp:${c.lineClamp} hides whole lines by design, informational)`
              : ""),
      delta: Math.max(c.scrollDx, c.scrollDy, c.inkClip.delta),
      selector: c.sel,
      observation,
    });
  }

  return defects;
}

/* ------------------------------------------------------------------ */
/* runner                                                              */
/* ------------------------------------------------------------------ */

async function sweep() {
  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const results = [];
  const roleSizes = new Map();
  try {
    for (const [name, setup] of SURFACES) {
      if (ONLY.length && !ONLY.includes(name)) continue;
      const page = await browser.newPage({ viewport: VIEWPORT });
      /* This sweep opens the read dock (surface "readDock"), and opening it
       * triggers `speakCurrent()`. Silence speech before the app loads. */
      await require("./lib/silence-speech.cjs").silenceSpeech(page);
      await page.goto(APP_URL);
      await page.waitForTimeout(1300);
      await setup(page);
      await page.waitForTimeout(800);
      const m = await page.evaluate(MEASURE);
      const defects = judge(name, m, roleSizes);
      const row = { name, pairs: m.pairs.length, clips: m.clips.length, theme: m.theme, dialogs: m.dialogs, defects, raw: m };
      results.push(row);
      if (DUMP) {
        console.log(`\n## ${name}  pairs=${m.pairs.length} clips=${m.clips.length} lists=${m.lists.length} theme=${m.theme}`);
        for (const p of m.pairs) {
          console.log(
            `  ${p.orientation} dCy=${p.dCy} dCx=${p.dCx} gap=${p.gap} tgt=${p.targetKind} lines=${p.text.lines} icon=${p.icon.w}x${p.icon.h} ${p.icon.display} | ${p.unit} "${p.label}" anchor=${p.anchor} chain=${p.chain.map((c) => c.display + "/" + c.alignItems).join(">")}${p.baselineHolder ? " BASE:" + p.baselineHolder : ""}${p.iconOffset ? ` inkOff=${p.iconOffset.x}/${p.iconOffset.y}` : ""}`
          );
        }
        for (const c of m.clips) {
          console.log(
            `  CLIP ${c.sel} dx=${c.scrollDx} dy=${c.scrollDy} ink=${c.inkClip.delta}(${c.inkClip.side}) ${c.overflowX}/${c.overflowY} "${c.text || c.target}"`
          );
        }
      } else if (!JSON_OUT) {
        printSurface(row);
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }

  /* same-role icon-size drift needs the whole run */
  for (const r of results) {
    for (const p of r.raw.pairs) {
      const role = `${p.unitTag}.${p.unitClasses.split(/\s+/).filter(Boolean).sort().join(".")}`;
      const sizes = roleSizes.get(role);
      if (!sizes || sizes.size < 2) continue;
      const mine = `${p.icon.w}x${p.icon.h}`;
      const others = [...sizes.keys()].filter((s) => s !== mine);
      r.defects.push({
        category: "SIZE",
        surface: r.name,
        control: `${p.unit} "${p.label}"`,
        metric: `role ${role} renders ${mine} here but ${others.join(", ")} elsewhere`,
        delta: Math.abs(Number.parseFloat(mine) - Math.min(...others.map((s) => Number.parseFloat(s)))) || 1,
        selector: p.unit,
      });
    }
  }

  return results;
}

/* ------------------------------------------------------------------ */
/* reporting                                                           */
/* ------------------------------------------------------------------ */

const CATEGORIES = ["VCENTER", "HCENTER", "INLINE", "BASELINE", "LABEL-X", "SIZE", "INK", "CLIP"];
/* Observations are measured and printed but do not fail the run:
 *   TIGHT     glyphs all fit while the content box overflows (a deliberately tight line-height)
 *   OVERFLOW  scroll overflow with no text at the boundary (a decorative child)
 *   CLAMPED   -webkit-line-clamp hiding whole lines, by design
 * All three are real measurements worth seeing; none of them is a clipped label. */
const OBSERVATIONS = ["TIGHT", "OVERFLOW", "CLAMPED"];

function printSurface(r) {
  const counts = {};
  for (const d of r.defects) counts[d.category] = (counts[d.category] || 0) + 1;
  const summary = [...CATEGORIES, ...OBSERVATIONS].filter((c) => counts[c]).map((c) => `${c}=${counts[c]}`).join(" ");
  console.log(`\n== ${r.name}  pairs=${r.pairs} clips=${r.clips} theme=${r.theme}${r.dialogs.length ? " dialogs=" + r.dialogs.join(",") : ""}`);
  console.log(`   ${summary || "no defects"}`);
  if (!r.defects.length) return;
  console.log(`   ${"control".padEnd(44)} ${"metric".padEnd(70)} delta`);
  for (const d of r.defects.sort((a, b) => b.delta - a.delta)) {
    console.log(
      `   ${(d.observation ? "[obs] " : "").padEnd(6)}${(d.control || "").slice(0, 42).padEnd(44)} ${d.metric.slice(0, 70).padEnd(70)} ${d.delta.toFixed(2)}`
    );
  }
}

function uniqDefects(list) {
  const m = new Map();
  for (const d of list) {
    /* Keyed on the CONTROL, not on the metric text: 38 different ribbon labels share the
     * metric "glyph ink cut 1.16px at the bottom edge", and keying on the metric collapsed
     * all of them into one "unique" finding. */
    const k = `${d.category}|${d.selector}|${d.control}`;
    if (!m.has(k)) m.set(k, { ...d, surfaces: new Set([d.surface]), count: 1 });
    else {
      m.get(k).surfaces.add(d.surface);
      m.get(k).count++;
    }
  }
  return [...m.values()].sort((a, b) => b.delta - a.delta);
}

function summarize(results) {
  const all = results.flatMap((r) => r.defects);
  const failing = all.filter((d) => !d.observation);
  const observations = all.filter((d) => d.observation);
  const byCat = {};
  for (const c of CATEGORIES) byCat[c] = failing.filter((d) => d.category === c);

  console.log("\n================================================================================");
  console.log("SUMMARY");
  console.log("================================================================================");
  console.log(`surfaces measured: ${results.length}`);
  const totalPairs = results.reduce((a, r) => a + r.pairs, 0);
  const totalClips = results.reduce((a, r) => a + r.clips, 0);
  console.log(`icon+label pairs measured: ${totalPairs}    clipping candidates examined: ${totalClips}`);
  for (const c of CATEGORIES) {
    const u = uniqDefects(byCat[c]);
    console.log(
      `${c.padEnd(9)} instances=${String(byCat[c].length).padEnd(5)} unique=${String(u.length).padEnd(4)} surfaces=${new Set(byCat[c].map((d) => d.surface)).size}`
    );
  }
  if (observations.length) {
    const byObs = {};
    for (const d of observations) byObs[d.category] = (byObs[d.category] || 0) + 1;
    console.log(
      `(observations, not failures: ${Object.entries(byObs).map(([k, v]) => `${k}=${v}`).join(" ")} — measured and listed above, no text at the clip edge)`
    );
  }

  const uniq = uniqDefects(failing);
  /* The user-reported defects get their own line, always, whatever the ranking does. The
   * reported "Target Script Length" cut is 1.16px — real, but far below two 23px ellipses,
   * so a delta-ordered top-10 buries it. An audit that reports a real defect only when it
   * happens to rank high is a worse audit than one that names what was asked about. */
  const REPORTED = [/Target Script Length/, /Start from a template|Open the sample script|Read the user guide/];
  const reported = uniq.filter((d) => REPORTED.some((re) => re.test(d.control || "")));
  if (reported.length) {
    console.log("\nTHE DEFECTS THE USER REPORTED (always listed, whatever their rank)");
    for (const d of reported) {
      console.log(`  ${d.category.padEnd(8)} ${(d.control || "").slice(0, 46).padEnd(48)} ${d.metric.slice(0, 70)}  [${d.delta.toFixed(2)}px]`);
    }
  }

  /* One row per (label, metric family). 22 ribbon labels share the 1.16px descender cut and
   * two pairs share the 2.40px rise, so a plain sort filled the table with look-alike rows
   * and pushed whole defect classes off it. Distinct labels are what a reader needs here;
   * the per-surface tables above stay exact and exhaustive. */
  const shown = new Set();
  const distinct = [];
  for (const d of uniq) {
    const label = (d.control || "").replace(/^\S+\s+"?/, "").replace(/"$/, "");
    const family = `${label}|${d.metric.replace(/-?\d+(\.\d+)?/g, "N")}`;
    if (shown.has(family)) continue;
    shown.add(family);
    distinct.push(d);
  }
  console.log("\nTOP 10 OFFENDERS (distinct controls; delta = px of misalignment / clipping)");
  console.log(`${"#".padEnd(3)}${"surface".padEnd(22)}${"control".padEnd(40)}${"delta".padEnd(8)}metric`);
  distinct.slice(0, 10).forEach((d, i) => {
    console.log(
      `${String(i + 1).padEnd(3)}${d.surface.padEnd(22)}${(d.control || d.selector || "").slice(0, 39).padEnd(40)}${d.delta.toFixed(2).padEnd(8)}${d.metric.slice(0, 78)}`
    );
  });
  console.log(`  (${uniq.length} distinct defects in total — see the per-surface tables above for every instance)`);

  const failures = [];
  for (const r of results) {
    if (r.pairs < MIN_PAIRS_PER_SURFACE) {
      failures.push(`${r.name}: ${r.pairs} pairs measured (floor ${MIN_PAIRS_PER_SURFACE}) — VACUOUS SURFACE`);
    }
  }
  if (totalPairs < MIN_PAIRS_TOTAL) failures.push(`run total ${totalPairs} pairs (floor ${MIN_PAIRS_TOTAL}) — VACUOUS RUN`);

  console.log("");
  if (failures.length) {
    console.log("VACUOUS-PASS GUARD: FAIL");
    for (const f of failures) console.log(`  ! ${f}`);
  } else {
    console.log(`VACUOUS-PASS GUARD: PASS (every surface >= ${MIN_PAIRS_PER_SURFACE} pairs; ${totalPairs} >= ${MIN_PAIRS_TOTAL} total)`);
  }

  console.log("");
  if (failing.length === 0 && !failures.length) {
    console.log("RESULT: PASS — no icon/label misalignment or clipped text found.");
    return { code: 0, totalPairs, byCat, failures, uniq, failing, observations };
  }
  if (failing.length === 0) {
    console.log("RESULT: FAIL — the audit could not prove anything (see vacuous-pass guard).");
    return { code: 1, totalPairs, byCat, failures, uniq, failing, observations };
  }
  console.log(
    `RESULT: FAIL — ${all.length} defect instances (${uniq.length} unique) across ${new Set(all.map((d) => d.surface)).size} surfaces.`
  );
  return { code: 1, totalPairs, byCat, failures, uniq };
}

/* ------------------------------------------------------------------ */
/* negative controls                                                   */
/* ------------------------------------------------------------------ */
/* Runs the SAME MEASURE + judge code against deliberately broken pages. The breaks are
 * injected in the browser; app/** is never modified. Each control asserts that the
 * detector fires on a defect it must catch — otherwise a green audit means nothing. */
async function selfTest() {
  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const results = [];

  const freshPage = async (setup) => {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.goto(APP_URL);
    await page.waitForTimeout(1300);
    await page.evaluate(() => document.getElementById("startCenter")?.close());
    await page.waitForTimeout(250);
    if (setup) await setup(page);
    await page.waitForTimeout(300);
    return page;
  };

  try {
    /* 1. shift every icon 3px down -> VCENTER must fire */
    {
      const page = await freshPage();
      const beforeV = judge("control:shift-before", await page.evaluate(MEASURE), new Map()).filter((d) => d.category === "VCENTER").length;
      await page.addStyleTag({ content: `svg { position: relative; top: 3px; }` });
      await page.waitForTimeout(300);
      const v = judge("control:shift-after", await page.evaluate(MEASURE), new Map()).filter((d) => d.category === "VCENTER");
      const worst = v.sort((a, b) => b.delta - a.delta)[0];
      results.push({
        control: "shift icons 3px",
        expect: "VCENTER must fire (icon centre moves 3px off its label)",
        pass: v.length > beforeV && !!worst && worst.delta > TOL,
        detail: `VCENTER before=${beforeV} after=${v.length} worst=${worst ? worst.metric : "none"}`,
      });
      await page.close();
    }

    /* 2. force icon rows onto align-items:baseline -> BASELINE must fire */
    {
      const page = await freshPage();
      await page.addStyleTag({ content: `.rb-btn, .pill-btn, .ribbon-quick { align-items: baseline !important; }` });
      await page.waitForTimeout(300);
      const base = judge("control:baseline", await page.evaluate(MEASURE), new Map()).filter((d) => d.category === "BASELINE");
      results.push({
        control: "align-items: baseline",
        expect: "BASELINE must fire on the controls forced onto a text baseline",
        pass: base.length > 0,
        detail: `BASELINE=${base.length} first=${base[0] ? base[0].metric : "none"}`,
      });
      await page.close();
    }

    /* 3. clamp two-line ribbon labels to one line -> CLIP must fire */
    {
      const page = await freshPage((p) => p.evaluate(() => document.querySelector('[data-ribbon-tab="document"]')?.click()));
      const before = judge("control:clamp-before", await page.evaluate(MEASURE), new Map()).filter((d) => d.category === "CLIP");
      const beforeKeys = new Set(before.map((d) => `${d.selector}|${d.metric}`));
      await page.addStyleTag({
        content: `#ribbonDeck .rb-btn--large .rb-btn__label { -webkit-line-clamp: 1 !important; max-height: 15px !important; }`,
      });
      await page.waitForTimeout(300);
      const after = judge("control:clamp-after", await page.evaluate(MEASURE), new Map()).filter((d) => d.category === "CLIP");
      const fresh = after.filter((d) => !beforeKeys.has(`${d.selector}|${d.metric}`));
      results.push({
        control: "clamp label to 1 line",
        expect: "CLIP must fire on ribbon labels whose second line is cut off",
        pass: fresh.length > 0,
        detail: `new CLIP hits=${fresh.length} first=${fresh[0] ? `${fresh[0].selector} ${fresh[0].metric}` : "none"}`,
      });
      await page.close();
    }

    /* 4. remove every icon -> the vacuous guard must fail the surface */
    {
      const page = await freshPage();
      await page.evaluate(() => document.querySelectorAll("svg").forEach((s) => s.remove()));
      await page.waitForTimeout(200);
      const m = await page.evaluate(MEASURE);
      results.push({
        control: "strip all icons",
        expect: `vacuous guard must fail the surface (pairs < ${MIN_PAIRS_PER_SURFACE})`,
        pass: m.pairs.length < MIN_PAIRS_PER_SURFACE,
        detail: `pairs=${m.pairs.length} floor=${MIN_PAIRS_PER_SURFACE}`,
      });
      await page.close();
    }

    /* 5. restore the reported Welcome-menu layout -> INLINE must fire.
     *
     * The defect being reproduced: the row's label span was `display: block` and the SVG
     * inside it was `display: inline`, so the icon sat on the text baseline (measured
     * dCy = -5.5px on all three rows). Setting only `display: inline` on the svg is not
     * enough today because the span is a flex container, and a flex item's `display: inline`
     * is blockified — so the control has to put the span back to block as well. */
    {
      const page = await freshPage(async (p) => {
        await p.evaluate(() => document.querySelector('[data-ribbon-tab="help"]')?.click());
        await p.waitForTimeout(400);
        await p.evaluate(() => document.querySelector('[data-ribbon-command="help-welcome"]')?.click());
      });
      const beforeInline = judge("control:inline-before", await page.evaluate(MEASURE), new Map()).filter((d) => d.category === "INLINE").length;
      await page.addStyleTag({
        content: `#dialogBody .shortcut-row > span:first-child { display: block !important; }
                  #dialogBody .shortcut-row > span:first-child > svg { display: inline !important; vertical-align: baseline !important; }`,
      });
      await page.waitForTimeout(300);
      const inline = judge("control:inline", await page.evaluate(MEASURE), new Map()).filter((d) => d.category === "INLINE");
      results.push({
        control: "svg back to inline",
        expect: "INLINE must fire on the Welcome rows whose icon is seated on the text baseline",
        pass: inline.length > beforeInline && inline.length > 0,
        detail: `INLINE before=${beforeInline} after=${inline.length} first=${inline[0] ? inline[0].metric : "none"}`,
      });
      await page.close();
    }

    /* 6. widen one row's icon in the Welcome list -> LABEL-X must fire (ragged label column).
     * The list is the reported three-row menu: left-anchored rows that should share one label
     * offset from their row's left edge. */
    {
      const page = await freshPage(async (p) => {
        await p.evaluate(() => document.querySelector('[data-ribbon-tab="help"]')?.click());
        await p.waitForTimeout(400);
        await p.evaluate(() => document.querySelector('[data-ribbon-command="help-welcome"]')?.click());
      });
      const beforeX = judge("control:labelx-before", await page.evaluate(MEASURE), new Map()).filter((d) => d.category === "LABEL-X").length;
      await page.addStyleTag({
        content: `#dialogBody .shortcut-row[data-welcome="sample"] svg { width: 34px !important; height: 34px !important; }`,
      });
      await page.waitForTimeout(300);
      const labelX = judge("control:label-x", await page.evaluate(MEASURE), new Map()).filter((d) => d.category === "LABEL-X");
      results.push({
        control: "widen one icon box",
        expect: "LABEL-X must fire where a wider icon pushed its label off the shared left edge",
        pass: labelX.length > beforeX && labelX.length > 0,
        detail: `LABEL-X before=${beforeX} after=${labelX.length} first=${labelX[0] ? labelX[0].metric : "none"}`,
      });
      await page.close();
    }

    /* 7. give one icon role two sizes -> SIZE must fire (per-role size drift). */
    {
      const page = await freshPage();
      await page.addStyleTag({ content: `.rail__item[data-view="reports"] svg { width: 26px !important; height: 26px !important; }` });
      await page.waitForTimeout(300);
      const m1 = await page.evaluate(MEASURE);
      const sizes = new Map();
      judge("control:size-a", m1, sizes);
      /* SIZE is aggregated across surfaces in sweep(); do the same aggregation here for one
       * page so the control exercises the real code path. */
      const defects = [];
      for (const p of m1.pairs) {
        const role = `${p.unitTag}.${p.unitClasses.split(/\s+/).filter(Boolean).sort().join(".")}`;
        const s = sizes.get(role);
        if (!s || s.size < 2) continue;
        defects.push({ category: "SIZE", selector: p.unit, metric: `${role} ${[...s.keys()].join(" vs ")}` });
      }
      results.push({
        control: "one role, two sizes",
        expect: "SIZE must fire where identical sibling controls render different icon sizes",
        pass: defects.length > 0,
        detail: `SIZE=${defects.length} first=${defects[0] ? defects[0].metric : "none"}`,
      });
      await page.close();
    }

    /* 8. push the drawn glyph out of its own box -> INK must fire (artwork not centred).
     * Translating the <svg> would move box and ink together and measure as centred, so the
     * transform goes on the glyph content inside it. */
    {
      const page = await freshPage();
      const beforeInk = judge("control:ink-before", await page.evaluate(MEASURE), new Map()).filter((d) => d.category === "INK").length;
      await page.addStyleTag({ content: `.rail__item[data-view="characters"] svg use { transform: translateY(3px); }` });
      await page.waitForTimeout(300);
      const ink = judge("control:ink", await page.evaluate(MEASURE), new Map()).filter((d) => d.category === "INK");
      results.push({
        control: "offset drawn glyph",
        expect: "INK must fire when the drawn glyph no longer sits at its box centre",
        pass: ink.length > beforeInk && ink.length > 0,
        detail: `INK before=${beforeInk} after=${ink.length} first=${ink[0] ? ink[0].metric : "none"}`,
      });
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log("NEGATIVE CONTROLS (proof that the audit can fail)");
  console.log("--------------------------------------------------------------------------------");
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.control.padEnd(24)} ${r.detail}`);
    console.log(`      expected: ${r.expect}`);
  }
  const ok = results.every((r) => r.pass);
  console.log("--------------------------------------------------------------------------------");
  console.log(ok ? "SELF-TEST: PASS — every injected defect was detected." : "SELF-TEST: FAIL — the detector did not fire.");
  return ok ? 0 : 1;
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

(async () => {
  if (!fs.existsSync(PLAYWRIGHT)) {
    console.error(`SKIP: playwright-core not found at ${PLAYWRIGHT}`);
    process.exit(1);
  }
  if (SELF_TEST) {
    process.exitCode = await selfTest();
    return;
  }
  const results = await sweep();
  const { code, byCat, failures, totalPairs, uniq } = summarize(results);
  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          surfaces: results.map((r) => ({ name: r.name, pairs: r.pairs, clips: r.clips, theme: r.theme, defects: r.defects })),
          totals: {
            pairs: totalPairs,
            defects: results.flatMap((r) => r.defects).length,
            unique: uniq.length,
            byCategory: Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, v.length])),
          },
          vacuousGuard: { perSurface: MIN_PAIRS_PER_SURFACE, total: MIN_PAIRS_TOTAL, failures },
          allowed: ALLOWED,
          top10: uniq.slice(0, 10).map((d) => ({ surface: d.surface, selector: d.selector, delta: d.delta, metric: d.metric, category: d.category })),
        },
        null,
        2
      )
    );
  }
  process.exitCode = code;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
