#!/usr/bin/env node
/* UI-integrity audit for the Azkript shell.
 *
 * WHY THIS EXISTS
 * ---------------
 * The user is tired of reporting visual defects one screenshot at a time: an icon a pixel
 * off its label, a clipped descender, a hover slab that ignores its parent's rounded
 * corner, two halves of a fused control that do not meet, a 14px hit target. Each report
 * has required a new probe. This script sweeps every surface once and reports the whole
 * set of *measured* defect classes in one run, so a fix can be aimed instead of guessed.
 *
 * WHAT IT MEASURES
 * ----------------
 * Every surface is one real page state (a view, a ribbon tab, the collapsed ribbon, the
 * Start Center, the read dock, the split pane, or a dialog opened through its own ribbon
 * command), in both themes. Raw geometry is collected in the page by MEASURE; every
 * judgement is made in Node by judge(), so the rules are reviewable in one place.
 *
 *   CLIP        text whose glyph ink is cut by a clip edge: scrollWidth/scrollHeight vs
 *               clientWidth/clientHeight plus per-line Range rects and canvas font ink.
 *               Deliberate -webkit-line-clamp and text-overflow: ellipsis are measured
 *               and reported as observations, not failures (see judge()).
 *   VCENTER     icon BOX centre vs its text line-box centre, icon beside label: > 1px.
 *   HCENTER     icon BOX centre x vs label block centre x, icon above label: > 1px.
 *   BASELINE    an inline <svg> in a non-flex context (seated on the text baseline), or
 *               align-items: baseline on a flex/grid ancestor holding an <svg>.
 *   INK         drawn glyph centre off its own viewBox centre by > 0.75 units (24-unit
 *               grid), measured from the live <use>'s painted rect. This is the ARTWORK
 *               class; VCENTER/HCENTER are the LAYOUT classes and compare the icon box, so
 *               a glyph drawn off-centre is reported once (here), not twice.
 *   OVERFLOW    an IN-FLOW child painting asymmetrically outside a painted parent's box, or
 *               a block whose in-flow content overflows its painted box. Symmetric bleed
 *               and absolutely-positioned anchored labels are observations.
 *   SEAM        a fused control (parts whose corner radii only make sense fused) whose
 *               halves do not share an edge, or whose heights differ. Overlay parts
 *               (absolute arrow inside a container) are measured as observations.
 *   SIZE-DRIFT  same role, same row: two rendering sizes of the same thing (> 1px).
 *   RADIUS      a painted child at the corner of a rounded parent whose own corner radius
 *               is smaller than the parent's; unpainted idle slabs are observations.
 *   ALIGN-X     stacked controls/rows whose content-box left edge differs from siblings.
 *   RULE        a separator off the centre of the box it divides, or one that fails to span
 *               an off-centre box; doubled seams where two touching siblings both paint a
 *               facing border. Deliberately asymmetric margins are NOT tested.
 *   FOCUS       a control matching :focus-visible where NOTHING paints on focus: no own
 *               outline/box-shadow/background/border gain AND no ancestor gains one via
 *               :focus-within. Composite fields whose wrapper draws the ring pass, and each
 *               passing control is listed as a FOCUS-OK observation with its evidence.
 *
 * OBSERVATIONS (measured, never failing): CONTRAST, CLAMP (deliberate -webkit-line-clamp),
 * ELLIPSIS (deliberate text-overflow), TIGHT (line-box overflow with no glyph lost),
 * CLIP-NOINK (scroll overflow with no text at the edge), OVERLAY (absolute part insets),
 * OVERFLOW-CENTRED (symmetric bleed / anchored label), HIT-AREA (painted vs reachable box
 * below 24x24 — the dense desktop ribbon is deliberate, so this measures but never fails),
 * FOCUS-OK (the mechanism that indicated focus), OBS-HOVER (idle-unpainted corner child).
 *
 * VACUOUS-PASS GUARD
 * ------------------
 * A surface that yields fewer than MIN_MEASURED_PER_SURFACE judged objects is a FAILURE,
 * never a skip, and a full run must clear MIN_MEASURED_TOTAL. A `--only` run must clear the
 * per-surface floor times the surfaces it actually measured, so filtering cannot vacuously
 * pass. This repo has already shipped an audit that passed on zero measurements; the guard
 * is why this one cannot.
 *
 * ALLOWLIST ROT
 * -------------
 * ALLOWED is currently EMPTY because every entry that was tried matched nothing — those
 * containers never lose glyph ink, so the CLIP detector never produces a candidate for
 * them. Entries are matched against measured candidates and every entry must actually match
 * during the run; an entry that stops matching FAILS the run, so the map cannot rot.
 *
 * NEGATIVE CONTROLS (`--self-test`)
 * --------------------------------
 * A detector that never fires proves nothing. `--self-test` renders a fixture page in the
 * browser (injected DOM + inline styles only; app/** is never touched) containing one real
 * instance of every defect class, runs the same MEASURE + judge code, and asserts each
 * detector fires on its fixture WITH the expected measured value (so a control cannot pass
 * by fabricating a number). It also re-breaks the real app's own controls for CLIP and
 * VCENTER so those two are proven against the shipped structures, and strips the controls to
 * prove the vacuous guard fails. 19 controls.
 *
 * Usage:
 *   node scripts/audit-ui-integrity.cjs                       # full sweep, exit 0 = clean
 *   node scripts/audit-ui-integrity.cjs --only=view:scen      # surfaces matching a substring
 *   node scripts/audit-ui-integrity.cjs --only=dialog,ribbon
 *   node scripts/audit-ui-integrity.cjs --json                # also write reports/ui-integrity.json
 *   node scripts/audit-ui-integrity.cjs --dump                # raw measured data per surface
 *   node scripts/audit-ui-integrity.cjs --self-test           # negative controls
 *   node scripts/audit-ui-integrity.cjs --self-test --verbose # per-control detail
 *
 * Exit code: 0 clean, 1 any defect category fired / vacuous guard / allowlist rot.
 *
 * Environment: Node 22, playwright-core from rea/node_modules, installed Chrome.
 * Unset ELECTRON_RUN_AS_NODE before running (this host sets it).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const PLAYWRIGHT = path.join(ROOT, "rea", "node_modules", "playwright-core");
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
const VERBOSE = argv.includes("--verbose");
const JSON_FILE = path.join(ROOT, "reports", "ui-integrity.json");
const ONLY = flag("only", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const VIEWPORT = { width: 1440, height: 900 };

/* ------------------------------------------------------------------ */
/* thresholds                                                          */
/* ------------------------------------------------------------------ */

/* 1px. A box is rounded once per measurement, so a genuine 1px disagreement is real and
 * <= 1px counts as aligned. */
const TOL = 1;
/* 0.75 viewBox units on the 24-unit icon grid, as specified. At the smallest icon size in
 * the shell (a 10px split chevron) that is 0.31 CSS px; at a 23px ribbon icon it is
 * 0.72 CSS px. The artwork is hand-drawn on this grid, so a quarter-unit miss is a genuine
 * drawing error rather than rasterisation noise. */
const INK_TOL_UNITS = 0.75;
/* A glyph must lose more than this much ink before it is called clipped. Calibrated
 * against pixels, not guessed: the reported "Target Script Length" cut measured 0.875 CSS
 * px of lost descender, and canvas metrics and rasterisation stop agreeing at ~0.25px. */
const INK_CLIP_TOL = 0.5;
/* The minimum hit target the user asked this class to enforce. */
const HIT_MIN = 24;

/* VACUOUS-PASS GUARD ---------------------------------------------------------------
 * Derived from the measured tree: the thinnest real surface is the Start Center (27
 * measured controls/pairs); the dialogs sit at 24-70 and the ribbon tabs at 90-260. A
 * floor of 10 sits under every real surface and far above zero, so a surface that loses
 * its controls fails loudly instead of passing on a handful of leftovers.
 * 68 surfaces x 10 = 680 implied by the per-surface rule; the run must clear 400, which
 * also catches "a few surfaces measured, the rest did not". */
const MIN_MEASURED_PER_SURFACE = 10;
const MIN_MEASURED_TOTAL = 400;

/* ------------------------------------------------------------------ */
/* surfaces                                                            */
/* ------------------------------------------------------------------ */

const VIEWS = ["script", "sceneview", "navigator", "characters", "reports", "beatboard"];
const RIBBON_TABS = ["home", "file", "edit", "view", "format", "insert", "document", "tools", "production", "help"];
const THEMES = ["light", "dark"];

const closeStartCenter = (page) => page.evaluate(() => document.getElementById("startCenter")?.close());
const clickRail = (page, view) =>
  page.evaluate((v) => document.querySelector(`.rail__item[data-view="${v}"]`)?.click(), view);
/* Theme through the documented dataset switch rather than the toggle button, so the surface
 * does not depend on the toggle's current state. */
const setTheme = (page, theme) =>
  page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
    document.body.dataset.theme = t;
  }, theme);
const clickRibbonTab = (page, tab) =>
  page.evaluate((t) => document.querySelector(`[data-ribbon-tab="${t}"]`)?.click(), tab);
const runCommand = (page, command) =>
  page.evaluate((c) => document.querySelector(`[data-ribbon-command="${c}"]`)?.click(), command);

/* Dialogs reached through the real ribbon command that opens them (verified present on the
 * named tab in this build). */
const DIALOGS = [
  ["settings", "tools", "tools-options"],
  ["pageLayout", "document", "doc-page-layout"],
  ["goto", "edit", "edit-goto"],
  ["welcome", "help", "help-welcome"],
  ["castList", "format", "format-cast-list"],
  ["renameCharacter", "edit", "edit-rename-character"],
  ["assignVoices", "tools", "tools-assign-voices"],
  ["find", "edit", "edit-find"],
  ["emoji", "edit", "edit-emoji"],
  ["about", "help", "help-about"],
  ["targetLength", "document", "doc-target-length"],
  ["watermark", "document", "doc-watermark"],
  ["titlePage", "document", "doc-title-page"],
  ["macros", "document", "doc-macros"],
  ["scriptCompare", "tools", "tools-script-compare"],
  ["help", "help", "help-button"],
];

const openDialog = async (page, tab, command) => {
  if (command === "help-button") {
    await page.evaluate(() => document.getElementById("helpButton")?.click());
  } else {
    await clickRibbonTab(page, tab);
    await page.waitForTimeout(180);
    await runCommand(page, command);
  }
  await page.waitForTimeout(450);
};

const SURFACES = [
  ...VIEWS.flatMap((view) =>
    THEMES.map((theme) => ({
      name: `view:${view}:${theme}`,
      theme,
      setup: async (page) => {
        await closeStartCenter(page);
        await setTheme(page, theme);
        await clickRail(page, view);
      },
    }))
  ),
  ...RIBBON_TABS.flatMap((tab) =>
    THEMES.map((theme) => ({
      name: `ribbon:${tab}:${theme}`,
      theme,
      setup: async (page) => {
        await closeStartCenter(page);
        await setTheme(page, theme);
        await clickRibbonTab(page, tab);
      },
    }))
  ),
  ...THEMES.map((theme) => ({
    name: `ribbon:collapsed:${theme}`,
    theme,
    setup: async (page) => {
      await closeStartCenter(page);
      await setTheme(page, theme);
      await page.evaluate(() => {
        const pin = document.getElementById("ribbonPinButton");
        if (pin && pin.getAttribute("aria-pressed") !== "true") pin.click();
      });
    },
  })),
  ...THEMES.map((theme) => ({
    name: `startCenter:${theme}`,
    theme,
    setup: async (page) => {
      await setTheme(page, theme);
      await page.evaluate(() => {
        const d = document.getElementById("startCenter");
        if (d && !d.open) d.showModal();
        d?.classList.add("is-ready");
      });
    },
  })),
  ...THEMES.map((theme) => ({
    name: `readDock:${theme}`,
    theme,
    setup: async (page) => {
      await closeStartCenter(page);
      await setTheme(page, theme);
      await page.evaluate(() => {
        const dock = document.getElementById("readDock");
        if (!dock?.classList.contains("is-open")) document.getElementById("readToggle")?.click();
      });
    },
  })),
  ...THEMES.map((theme) => ({
    name: `splitView:${theme}`,
    theme,
    setup: async (page) => {
      await closeStartCenter(page);
      await setTheme(page, theme);
      await clickRibbonTab(page, "view");
      await page.waitForTimeout(180);
      await runCommand(page, "view-split-v");
    },
  })),
  ...DIALOGS.flatMap(([name, tab, command]) =>
    THEMES.map((theme) => ({
      name: `dialog:${name}:${theme}`,
      theme,
      setup: async (page) => {
        await closeStartCenter(page);
        await setTheme(page, theme);
        await openDialog(page, tab, command);
      },
    }))
  ),
];

/* ------------------------------------------------------------------ */
/* ALLOWED / exemption map                                             */
/* ------------------------------------------------------------------ */
/* Empty by design: every entry that was tried here (`.ribbon__scroller`, `.inspector`,
 * `.scene-view-table`, `input.search-field__input`) failed to match a single measured clip
 * candidate, because those elements never lose glyph ink — the scroll containers reach
 * their content and the input scrolls at the caret, so the CLIP detector does not even
 * produce a candidate for them. Keeping dead entries is precisely the rot this map's rule
 * exists to catch, so they were removed rather than emitted as permanent failures.
 *
 * Add an entry only when a measured CLIP candidate is genuinely deliberate, with the reason
 * that is still true when a reviewer looks at the element. */
const ALLOWED = {};

/* ------------------------------------------------------------------ */
/* in-page measurement (raw geometry only; every judgement is in Node)  */
/* ------------------------------------------------------------------ */

function MEASURE() {
  /* This function is serialised into the page, so it cannot close over this module's scope:
   * any threshold it needs is mirrored here, next to the constant it must equal. */
  const INK_CLIP_TOL = 0.5; /* mirror of the module constant */
  const HIT_MIN = 24; /* mirror of the module constant */
  const TOL = 1; /* mirror of the module constant */

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
  const CONTROL = [
    "button",
    "a[href]",
    "select",
    "textarea",
    "input:not([type=hidden])",
    "summary",
    "[role=button]",
    "[role=tab]",
    "[role=menuitem]",
    "[role=switch]",
    "[role=option]",
  ].join(",");

  /* A control nested inside another control is not separately pointer-reachable: a
   * <selectedcontent><button> is Chromium's own internals inside a <select>, and a <button>
   * inside a <summary> belongs to the summary. Measuring those as 152x12 and 22x12 "touch
   * targets" is a measurement artefact, not a defect. */
  const nestedInControl = (el) => {
    const parent = el.parentElement;
    if (!parent) return false;
    return !!parent.closest("select, summary, button, a[href], label");
  };

  /* Content that is not presented to the user cannot have a visible defect: a closed read
   * dock is translated off-screen behind `aria-hidden="true"`. Its glyphs are clipped by the
   * shell, but nobody can see them, so reporting them buries the defects that are visible. */
  const hiddenFromUser = (el) => !!el.closest('[aria-hidden="true"], [inert]');

  /* ---------- small helpers ---------- */

  const csCache = new Map();
  const csOf = (el) => {
    let cs = csCache.get(el);
    if (!cs) {
      cs = getComputedStyle(el);
      csCache.set(el, cs);
    }
    return cs;
  };

  const sel = (el) => {
    if (!el || el.nodeType !== 1) return "?";
    if (el === document.body) return "body";
    let s = el.tagName.toLowerCase();
    if (el.id) s += `#${el.id}`;
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean) : [];
    for (const c of cls.slice(0, 2)) s += `.${c}`;
    return s;
  };

  const roleOf = (el) => {
    /* No id in the role: #fxD1/#fxD2 (or #guidesToggle/#invisiblesToggle) are the same
     * visual role and must land in one drift group, which an id-keyed role would split. */
    const tag = el.tagName.toLowerCase();
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).sort().join(".") : "";
    return `${tag}.${cls}`;
  };
  /* Focus rules are written against classes, so a class-keyed identity is right for
   * dedupe — but a classless control is identified by its id instead, or every classless
   * button on the page would collapse into one sample. */
  const focusKeyOf = (el) => {
    const role = roleOf(el);
    if (el.className && typeof el.className === "string" && el.className.trim()) return role;
    return `${role}${el.id ? `#${el.id}` : `[${el.getAttribute("type") || ""}]`}`;
  };

  /* The effective hit area, not just the painted box.
   *
   * A 14px arrow with a `::after { inset: -5px }` overlay has a 24px target, and
   * `app/tests/touch-targets.cjs` already treats that expansion as the contract. Probing
   * the pointer target is the only way to tell a small-looking control that is easy to hit
   * from a genuine pixel-hunt. */
  const hitArea = (el) => {
    if (!el || el.nodeType !== 1) return { w: 0, h: 0, probed: false };
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return { w: 0, h: 0, probed: false };
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hits = (x, y) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit));
    };
    const reach = (dx, dy) => {
      let d = 0;
      while (d < 16) {
        const s = d + 0.5;
        if (!hits(cx + dx * s, cy + dy * s)) break;
        d = s;
      }
      return d;
    };
    const w = reach(1, 0) + reach(-1, 0);
    const h = reach(0, 1) + reach(0, -1);
    /* Reach at least the painted box (a control can be partly covered by a sibling). */
    return { w: +Math.max(w, r.width).toFixed(1), h: +Math.max(h, r.height).toFixed(1), probed: true };
  };

  const isVisible = (el) => {
    if (!el || el.nodeType !== 1) return false;
    /* checkVisibility() is the only reliable gate. During a view/ribbon transition an
     * element can be mid-animation with `clientWidth === 0` while display/visibility still
     * compute as visible, and measuring it invents impossible numbers ("scrollWidth 0 on
     * the app shell"). Both conditions are required. */
    if (typeof el.checkVisibility === "function") {
      if (!el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    }
    const cs = csOf(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return false;
    if (Number(cs.opacity) === 0) return false;
    if (el.closest("[hidden]")) return false;
    if (el.closest("dialog:not([open])")) return false;
    const r = el.getBoundingClientRect();
    /* A box that claims area but has no client area is not laid out yet — EXCEPT for an
     * inline element, whose clientWidth/clientHeight are legitimately 0 by definition. */
    const isInline = /^inline/.test(cs.display);
    if (!isInline && el.clientWidth === 0 && el.clientHeight === 0) return false;
    return r.width >= 1 && r.height >= 1;
  };

  /* Accepts either a DOMRect-like ({x,y,width,height}) or the clipped rect shape
   * ({left,top,right,bottom,w,h}) used by clippedVisibleRect. */
  const box = (r) => ({
    x: +(r.x ?? r.left).toFixed(2),
    y: +(r.y ?? r.top).toFixed(2),
    w: +(r.width ?? r.w).toFixed(2),
    h: +(r.height ?? r.h).toFixed(2),
  });

  /* Computed colours arrive as rgb()/rgba() or as color(srgb ... / a); both are parsed so a
   * themed surface (which uses color(srgb ...) for translucent strokes) does not silently
   * read as transparent. */
  const parseColor = (str) => {
    if (!str) return null;
    const s = String(str).trim();
    if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    let m = s.match(/^rgba?\(([^)]+)\)$/i);
    if (m) {
      const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
        return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
      }
    }
    m = s.match(/^color\(srgb\s+([^)]+)\)$/i);
    if (m) {
      const parts = m[1].split(/[\s/]+/).filter(Boolean).map(Number);
      if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
        return { r: parts[0] * 255, g: parts[1] * 255, b: parts[2] * 255, a: parts.length > 3 ? parts[3] : 1 };
      }
    }
    return null;
  };

  const alphaOf = (colorStr) => {
    const c = parseColor(colorStr);
    return c ? c.a : 0;
  };

  const borderPx = (cs, side) => {
    const w = Number.parseFloat(cs[`border${side}Width`]);
    const style = cs[`border${side}Style`];
    if (!Number.isFinite(w) || w <= 0 || style === "none" || style === "hidden") return 0;
    if (alphaOf(cs[`border${side}Color`]) < 0.05) return 0;
    return w;
  };

  const borderTotal = (cs) => ["Top", "Right", "Bottom", "Left"].reduce((a, s) => a + borderPx(cs, s), 0);

  /* Corner radii, TL, TR, BL, BR. A percentage radius means "fully round", represented as a
   * large number so it always satisfies a corner-curvature comparison. */
  const cornersOf = (cs) => {
    return ["TopLeft", "TopRight", "BottomLeft", "BottomRight"].map((s) => {
      const v = cs[`border${s}Radius`];
      return /%/.test(v) ? 999 : Number.parseFloat(v) || 0;
    });
  };
  const maxRadius = (cs) => Math.max(...cornersOf(cs));

  const composite = (base, top) => ({
    r: top.r * top.a + base.r * (1 - top.a),
    g: top.g * top.a + base.g * (1 - top.a),
    b: top.b * top.a + base.b * (1 - top.a),
    a: top.a + base.a * (1 - top.a),
  });
  /* Painted background behind `el`: canvas white, then every ancestor layer outermost to
   * innermost. Gradient backgrounds are unknown here and flagged by the caller via
   * `hasGradient`. */
  const effectiveBg = (el) => {
    const layers = [];
    for (let a = el; a; a = a.parentElement) {
      const cs = csOf(a);
      const c = parseColor(cs.backgroundColor);
      if (c && c.a > 0) layers.push(c);
    }
    let out = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) out = composite(out, layers[i]);
    return out;
  };

  const hasGradient = (el) => {
    /* A gradient only matters when it is visible through every translucent layer above it.
     * Stopping at the first fully opaque background is essential: the app's body paints a
     * radial gradient, so without this every text node on the page would be skipped as
     * "over a gradient" and the contrast detector would silently measure nothing. */
    for (let a = el; a; a = a.parentElement) {
      const cs = csOf(a);
      const bi = cs.backgroundImage;
      if (bi && bi !== "none" && /gradient|url\(/i.test(bi)) return true;
      const c = parseColor(cs.backgroundColor);
      if (c && c.a >= 0.999) return false;
    }
    return false;
  };

  const relLum = (c) => {
    const f = (v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const contrast = (a, b) => {
    const l1 = relLum(a);
    const l2 = relLum(b);
    const hi = Math.max(l1, l2);
    const lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  };

  const textLabel = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim().slice(0, 48);
    const own = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(" ")
      .trim();
    const text = own || (el.textContent || "").replace(/\s+/g, " ").trim();
    return text.slice(0, 48);
  };

  const uids = new WeakMap();
  let nextUid = 0;
  const uidOf = (el) => {
    if (!el) return 0;
    if (!uids.has(el)) uids.set(el, ++nextUid);
    return uids.get(el);
  };

  /* One rect per rendered line. In Chromium a text range rect is the FONT box (ascent +
   * descent), not the CSS line-height, so its centre depends only on the font, not on
   * whether the label happens to contain a descender. That is what makes it a stable
   * comparison target for VCENTER. */
  const lineRects = (node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return [...range.getClientRects()].filter((r) => r.width > 0.5 && r.height > 0.5);
  };

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const metricsFor = (parentEl, sample) => {
    const cs = csOf(parentEl);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    /* Apply text-transform first: a caption whose source is "Proofing" but which renders
     * as "PROOFING" would otherwise be measured with the descender of the "g". */
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
    };
  };
  /* Where the glyph ink sits on a line rect. A rect that is already the font box needs no
   * line-height centring; only a rect demonstrably taller than the font box (a line box
   * supplied by something else) has the font box centred inside it. */
  const inkBox = (rect, met) => {
    const fontBox = met.fontAscent + met.fontDescent;
    const isFontBox = Math.abs(rect.height - fontBox) <= 1.5;
    const baseline = isFontBox
      ? rect.top + met.fontAscent
      : rect.top + ((met.lineHeight || rect.height) - fontBox) / 2 + met.fontAscent;
    return { top: baseline - met.inkAscent, bottom: baseline + met.inkDescent };
  };

  /* Drawn-ink box of a <use>, in screen pixels.
   *
   * NOT getBBox()+getScreenCTM(). For a `<use>` referencing a `<symbol>` with its own
   * viewBox, Chromium reports getBBox() in the SYMBOL's units (0-24) while the use's
   * getScreenCTM() has scale 1 — it does not include the symbol viewport's scale — so
   * mapping one through the other divides by the wrong factor. Measured on a 14px plus
   * icon it claimed the glyph sat 5 units (≈2.9px) off centre when it renders dead centre.
   *
   * getBoundingClientRect() on the `<use>` is the painted box in CSS px and is verifiably
   * right: the plus path spans 15 of 24 units, and in a 14px icon it measures 8.75px
   * (15/24 x 14); the play triangle spans 11 units and measures 10.54px in a 23px icon
   * (11/24 x 23). Both match to 0.01px. The unit conversion then divides by the icon's own
   * px-per-unit, which is exact. */
  const inkScreen = (useEl, svgEl) => {
    try {
      const r = useEl.getBoundingClientRect();
      const sr = svgEl.getBoundingClientRect();
      if (!r.width || !r.height || !sr.width || !sr.height) return null;
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
    } catch {
      return null;
    }
  };

  /* ---------- 1. interactive controls ---------- */
  const controls = [];
  /* Control record -> live element. Kept in a Map so the browser-side return value stays
   * plain JSON while the probes below can still reach the real node. */
  const live = new Map();
  for (const el of document.querySelectorAll(CONTROL)) {
    if (el.closest(EXCLUDE)) continue;
    if (nestedInControl(el)) continue;
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    const cs = csOf(el);
    const inDialog = !!el.closest("dialog[open]");
    const svgs = [...el.querySelectorAll("svg")]
      .filter((s) => !s.closest(".svg-sprite") && isVisible(s))
      .map((s) => {
        const b = s.getBoundingClientRect();
        return { w: +b.width.toFixed(2), h: +b.height.toFixed(2) };
      });
    controls.push({
      sel: sel(el),
      role: roleOf(el),
      focusKey: focusKeyOf(el),
      tag: el.tagName.toLowerCase(),
      label: textLabel(el),
      box: box(r),
      w: +r.width.toFixed(2),
      h: +r.height.toFixed(2),
      svgs: svgs.slice(0, 3),
      radius: maxRadius(cs),
      bg: cs.backgroundColor,
      display: cs.display,
      parentUid: uidOf(el.parentElement),
      parentSel: sel(el.parentElement),
      inDialog,
      disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
      focusable: el.tabIndex >= 0 && !el.disabled,
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
      overflow: `${cs.overflowX}/${cs.overflowY}`,
    });
    /* The element itself, kept off the serialisable record (it would be dead weight in the
     * JSON dump and a cycle in the browser-side return value). */
    live.set(controls[controls.length - 1], el);
  }

  /* ---------- 2. icon + label pairs ---------- */
  /* A "unit" is the control (or nearest labelled non-interactive wrapper) that owns both a
   * visible icon and a visible text label of its own. A nested labelled control makes the
   * unit compound and it is skipped, so a split button's arrow is never paired with its
   * neighbour's label. */
  const ownsLabel = (unit, interactive) => {
    const walker = document.createTreeWalker(unit, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = (n.textContent || "").trim();
      if (!t) continue;
      const p = n.parentElement;
      if (!p || p.closest("svg") || p.closest(".svg-sprite")) continue;
      if (!isVisible(p)) continue;
      const owner = p.closest(INTERACTIVE);
      if (interactive ? owner !== unit : owner !== null) continue;
      if (lineRects(n).length) return true;
    }
    return false;
  };
  const labelNodes = (unit, interactive) => {
    const out = [];
    const walker = document.createTreeWalker(unit, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = (n.textContent || "").trim();
      if (!t) continue;
      const p = n.parentElement;
      if (!p || p.closest("svg") || p.closest(".svg-sprite")) continue;
      if (!isVisible(p)) continue;
      const owner = p.closest(INTERACTIVE);
      if (interactive ? owner !== unit : owner !== null) continue;
      const rects = lineRects(n);
      if (!rects.length) continue;
      out.push({ parent: p, text: t.replace(/\s+/g, " "), rects });
    }
    return out;
  };
  const unitFor = (svg) => {
    const ctrl = svg.parentElement.closest(INTERACTIVE);
    if (ctrl && isVisible(ctrl) && ownsLabel(ctrl, true)) return { unit: ctrl, interactive: true };
    let a = svg.parentElement;
    for (let hops = 0; a && a !== document.body && hops < 4; a = a.parentElement, hops++) {
      if (a.matches(INTERACTIVE)) return null;
      if (ownsLabel(a, false)) return { unit: a, interactive: false };
    }
    return null;
  };
  const isCompound = (unit) => {
    for (const other of unit.querySelectorAll(INTERACTIVE)) {
      if (!isVisible(other)) continue;
      if (ownsLabel(other, true)) return true;
    }
    return false;
  };

  const pairs = [];
  const doneUnits = new Set();
  for (const svg of document.querySelectorAll("svg")) {
    if (svg.closest(EXCLUDE)) continue;
    if (svg.closest(".svg-sprite")) continue;
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
      const sr = s.getBoundingClientRect();
      for (const line of allLines) {
        const rect = line.rect;
        const gapRight = rect.left - sr.right;
        const gapLeft = sr.left - rect.right;
        const gap = Math.max(gapRight, gapLeft);
        const vOverlap = Math.min(rect.bottom, sr.bottom) - Math.max(rect.top, sr.top);
        const rowish = vOverlap > Math.min(rect.height, sr.height) * 0.3;
        if (gap >= -8 && gap <= 24 && rowish) {
          const cand = { svg: s, line, orientation: "ROW", gap };
          if (!pick || cand.gap < pick.gap) pick = cand;
        }
      }
      if (pick) continue;
      const vGap = block.top - sr.bottom;
      const cx = (sr.left + sr.right) / 2;
      if (vGap >= -2 && vGap <= 16 && Math.abs(cx - (block.left + block.right) / 2) <= 18) {
        pick = { svg: s, line: null, orientation: "STACK", gap: vGap };
      }
    }
    if (!pick) continue;

    const sr = pick.svg.getBoundingClientRect();
    const scs = getComputedStyle(pick.svg);
    const target = pick.orientation === "ROW" && sr.height > lineH * 1.5 && allLines.length > 1 ? block : pick.orientation === "ROW" ? pick.line.rect : block;

    /* Icon ink centre: the visual object the user sees. Falls back to the icon's box centre
     * when a glyph cannot be measured (e.g. a raster image). */
    const useEl = pick.svg.querySelector("use");
    const ink = useEl ? inkScreen(useEl, pick.svg) : null;
    const inkCx = ink ? (ink.left + ink.right) / 2 : (sr.left + sr.right) / 2;
    const inkCy = ink ? (ink.top + ink.bottom) / 2 : (sr.top + sr.bottom) / 2;
    /* VCENTER/HCENTER are LAYOUT classes: is the icon box seated correctly against the
     * label? INK is the DRAWING class: is the artwork centred inside its own box?
     *
     * Mixing them double-reports one defect. "Play" is the worked example: its icon box is
     * perfectly centred over its label (0.01px), but the triangle path is drawn 1.5 units
     * right of the 24-unit grid, so an ink-based HCENTER reported 1.45px here AND an INK
     * finding of 1.5 units for the same path. The fix is one change in the sprite, so it
     * must be one finding. Layout classes therefore compare the icon BOX centre, and INK
     * carries the artwork. The measured ink offset is still reported in VCENTER/HCENTER's
     * metric when it exists, so the reader can see both numbers. */
    const boxCx = (sr.left + sr.right) / 2;
    const boxCy = (sr.top + sr.bottom) / 2;
    const inkOffX = +(inkCx - boxCx).toFixed(2);
    const inkOffY = +(inkCy - boxCy).toFixed(2);

    const chain = [];
    for (let e = unit, i = 0; e && e !== document.body && i < 4; e = e.parentElement, i++) {
      const cs = getComputedStyle(e);
      chain.push({ sel: sel(e), display: cs.display, alignItems: cs.alignItems });
    }
    const baselineHolder = chain.find((c) => /flex|grid/.test(c.display) && c.alignItems === "baseline");

    pairs.push({
      unit: sel(unit),
      unitRole: roleOf(unit),
      unitTag: unit.tagName.toLowerCase(),
      unitUid: uidOf(unit),
      parentUid: uidOf(unit.parentElement),
      parentSel: sel(unit.parentElement),
      label: (pick.line ? pick.line.text : labels.map((l) => l.text).join(" ")).slice(0, 40),
      orientation: pick.orientation,
      iconDisplay: scs.display,
      iconSize: { w: +sr.width.toFixed(2), h: +sr.height.toFixed(2) },
      text: {
        left: +target.left.toFixed(2),
        cx: +((target.left + target.right) / 2).toFixed(2),
        cy: +((target.top + target.bottom) / 2).toFixed(2),
        lines: allLines.length,
      },
      blockCx: +((block.left + block.right) / 2).toFixed(2),
      dCy: +(boxCy - (target.top + target.bottom) / 2).toFixed(2),
      dCx: +(boxCx - (block.left + block.right) / 2).toFixed(2),
      inkOffX,
      inkOffY,
      gap: +pick.gap.toFixed(2),
      baselineHolder: baselineHolder ? baselineHolder.sel : null,
      chain,
      unitBox: box(ur),
    });
  }

  /* ---------- 3. drawn-glyph centring (INK) ---------- */
  const inks = [];
  for (const use of document.querySelectorAll("svg use")) {
    const svg = use.ownerSVGElement;
    if (!svg || svg.closest(EXCLUDE) || svg.closest(".svg-sprite")) continue;
    if (!isVisible(svg)) continue;
    const href = use.getAttribute("href") || use.getAttribute("xlink:href") || "";
    if (!href.startsWith("#")) continue;
    const symbol = document.getElementById(href.slice(1));
    if (!symbol) continue;
    const vbAttr = (symbol.getAttribute("viewBox") || svg.getAttribute("viewBox") || "0 0 24 24").trim();
    const vb = vbAttr.split(/[\s,]+/).map(Number);
    if (vb.length !== 4 || !vb[2] || !vb[3]) continue;
    const ink = inkScreen(use, svg);
    if (!ink) continue;
    const sr = svg.getBoundingClientRect();
    if (!sr.width || !sr.height) continue;
    /* px per viewBox unit: the symbol's viewport is the instance svg's box, so the same
     * conversion holds whether or not the instance carries its own viewBox. */
    const pxPerUnitX = sr.width / vb[2];
    const pxPerUnitY = sr.height / vb[3];
    const boxCx = sr.left + sr.width / 2;
    const boxCy = sr.top + sr.height / 2;
    const inkCx = (ink.left + ink.right) / 2;
    const inkCy = (ink.top + ink.bottom) / 2;
    inks.push({
      /* Identified by the SYMBOL, not by the element that happens to render it: artwork
       * that is drawn off-centre is one defect in the sprite, even when thirty ribbon
       * buttons show it. The unit is kept in the label so a reader can see where it bites. */
      sel: `svg use[href="${href}"]`,
      unitSel: sel(svg.parentElement),
      href,
      vb: vbAttr,
      dxUnits: +((inkCx - boxCx) / pxPerUnitX).toFixed(2),
      dyUnits: +((inkCy - boxCy) / pxPerUnitY).toFixed(2),
      dxPx: +(inkCx - boxCx).toFixed(2),
      dyPx: +(inkCy - boxCy).toFixed(2),
      iconW: +sr.width.toFixed(2),
      inkW: ink.w,
      inkH: ink.h,
    });
  }

  /* ---------- 4. clipped text ---------- */
  const clips = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(EXCLUDE)) continue;
    if (el.tagName.toLowerCase() === "svg" || el.closest("svg")) continue;
    if (hiddenFromUser(el)) continue;
    if (!isVisible(el)) continue;
    const cs = csOf(el);
    const hidesX = /hidden|clip/.test(cs.overflowX);
    const hidesY = /hidden|clip/.test(cs.overflowY);
    if (!hidesX && !hidesY) continue;
    if (el.matches("input, select, textarea")) continue;
    /* A clipper with no content box cannot clip anything, and its scroll* numbers are
     * meaningless. This is the guard that stops the impossible "scrollWidth 0, 104px of
     * scrollHeight" reading on a mid-transition container. */
    if (el.clientWidth === 0 || el.clientHeight === 0) continue;

    const r = el.getBoundingClientRect();
    const clipBox = {
      left: r.left + el.clientLeft,
      top: r.top + el.clientTop,
      right: r.left + el.clientLeft + el.clientWidth,
      bottom: r.top + el.clientTop + el.clientHeight,
    };
    const scrollDx = hidesX ? el.scrollWidth - el.clientWidth : 0;
    const scrollDy = hidesY ? el.scrollHeight - el.clientHeight : 0;
    const clampN = /^\d+$/.test(cs.webkitLineClamp) ? Number.parseInt(cs.webkitLineClamp, 10) : Infinity;

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
      /* The nearest ancestor that clips OR scrolls owns this text. Stopping at a scrollable
       * ancestor too is essential: text inside a scroll body is reachable, and attributing
       * it to an outer clip wrapper invents a clip nobody can see. */
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
      rects.forEach((rect, lineIndex) => {
        if (lineIndex >= clampN) {
          clampTruncated = true;
          return;
        }
        const crossesV = hidesY && (rect.top < clipBox.top - 0.5 || rect.bottom > clipBox.bottom + 0.5);
        const crossesH = hidesX && (rect.left < clipBox.left - 0.5 || rect.right > clipBox.right + 0.5);
        if (!crossesV && !crossesH) return;
        textCrosses = true;
        const ink = inkBox(rect, met);
        const overTop = hidesY ? clipBox.top - ink.top : 0;
        const overBottom = hidesY ? ink.bottom - clipBox.bottom : 0;
        const overLeft = hidesX ? clipBox.left - rect.left : 0;
        const overRight = hidesX ? rect.right - clipBox.right : 0;
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

    clips.push({
      sel: sel(el),
      parentSel: sel(el.parentElement),
      scrollDx: Math.max(0, scrollDx),
      scrollDy: Math.max(0, scrollDy),
      inkClip: worst || { delta: 0, side: "none" },
      textCrosses,
      clampTruncated,
      clamp: Number.isFinite(clampN) ? clampN : null,
      textOverflow: cs.textOverflow,
      clientW: el.clientWidth,
      clientH: el.clientHeight,
      scrollW: el.scrollWidth,
      scrollH: el.scrollHeight,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      text: (firstText || (el.textContent || "").trim()).replace(/\s+/g, " ").slice(0, 52),
    });
  }

  /* ---------- 5. fused composites (SEAM) ---------- */
  const composites = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(EXCLUDE) || el.closest(".svg-sprite")) continue;
    if (!isVisible(el)) continue;
    const kids = [...el.children].filter(isVisible);
    if (kids.length < 2 || kids.length > 6) continue;
    if (!kids.every((k) => k.matches(INTERACTIVE))) continue;
    const cs = csOf(el);
    const painted = maxRadius(cs) > 0 || borderTotal(cs) > 0 || alphaOf(cs.backgroundColor) > 0;
    if (!painted) continue;
    const wrapR = el.getBoundingClientRect();
    const parts = kids.map((k) => {
      const kcs = getComputedStyle(k);
      const kr = k.getBoundingClientRect();
      return {
        sel: sel(k),
        box: box(kr),
        abs: kcs.position === "absolute",
        corners: cornersOf(kcs),
        radius: maxRadius(kcs),
        bgA: alphaOf(kcs.backgroundColor),
        display: kcs.display,
      };
    });
    const cls = typeof el.className === "string" ? el.className : "";
    composites.push({
      sel: sel(el),
      cls: cls.slice(0, 60),
      knownGroup: /(^|[\s-])(rb-split|segmented|input-group|btn-group|button-group)([\s-]|$)/i.test(cls),
      direction: cs.flexDirection || cs.gridAutoFlow || "",
      declaredGap: Number.parseFloat(cs.gap) || 0,
      radius: maxRadius(cs),
      overflow: `${cs.overflowX}/${cs.overflowY}`,
      wrap: box(wrapR),
      parts,
    });
  }

  /* ---------- 6. painted overflow (OVERFLOW) ---------- */
  /* Containers that are deliberately allowed to hang content outside themselves: overlays,
   * and the beat board's deliberately larger-than-viewport canvas. */
  const OVERFLOW_EXEMPT = /popover|dropdown|menu\b|tooltip|toast|overlay|backdrop|sr-only|visually-hidden|sprite|flyout|context-menu|palette|autocomplete|suggest|beat-board|beatboard/i;
  const OVERFLOW_CAP = 400;
  const overflows = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(EXCLUDE) || el.closest(".svg-sprite")) continue;
    if (el.closest('[aria-hidden="true"], [inert]')) continue;
    if (!isVisible(el)) continue;
    const cs = csOf(el);
    const painted = maxRadius(cs) > 0 || borderTotal(cs) > 0 || alphaOf(cs.backgroundColor) > 0;
    if (!painted) continue;
    if (cs.position === "fixed") continue;
    const pr = el.getBoundingClientRect();
    if (pr.width < 6 || pr.height < 6) continue;
    const cls = typeof el.className === "string" ? el.className : "";
    if (OVERFLOW_EXEMPT.test(cls) || OVERFLOW_EXEMPT.test(el.id)) continue;

    /* (a) content overflowing its own painted box.
     *
     * `scrollWidth > clientWidth` alone is not overflow: a flex/grid CHILD shrinks its box
     * to `clientWidth` while its content lays out wider, and the difference is exactly the
     * part that overflows. Buttons that hold an icon plus a label report 5px of "overflow"
     * this way on dozens of controls. Only a box whose content PARENT cannot shrink (a
     * block/flow container) has a real overflow here, and even then the test is confirmed
     * against the painted box rather than trusted on its own. */
    const shrinkable = /flex|grid/.test(cs.display) && cs.display !== "block";
    if (!shrinkable && /visible/.test(`${cs.overflowX}/${cs.overflowY}`)) {
      const dx = el.scrollWidth - el.clientWidth;
      const dy = el.scrollHeight - el.clientHeight;
      if (dx > 1 || dy > 1) {
        /* Content overflow only counts when something IN FLOW causes it. A card whose
         * absolutely-positioned donut/legend bleeds past it reports scrollHeight overflow
         * while the box itself is fine — that is deliberate bleed, not a broken box. */
        const inFlowSpill = [...el.children].some((k) => {
          if (!isVisible(k)) return false;
          if (getComputedStyle(k).position === "absolute" || getComputedStyle(k).position === "fixed") return false;
          const kr = k.getBoundingClientRect();
          return kr.right - pr.right > TOL || kr.bottom - pr.bottom > TOL || pr.left - kr.left > TOL || pr.top - kr.top > TOL;
        });
        overflows.push({
          kind: inFlowSpill ? "content" : "centred",
          parent: sel(el),
          parentCls: cls.slice(0, 48),
          parentBox: box(pr),
          child: null,
          dx: Math.max(0, dx),
          dy: Math.max(0, dy),
          text: textLabel(el).slice(0, 40),
          deltas: { left: 0, right: 0, top: 0, bottom: 0 },
        });
      }
    }
    if (overflows.length >= OVERFLOW_CAP) break;

    /* (b) a child painted outside its parent's box */
    for (const k of el.children) {
      if (!isVisible(k)) continue;
      const kcs = getComputedStyle(k);
      if (kcs.position === "fixed") continue;
      if (OVERFLOW_EXEMPT.test(typeof k.className === "string" ? k.className : "")) continue;
      if (k.tagName === "DIALOG") continue;
      const kr = k.getBoundingClientRect();
      if (kr.width < 4 || kr.height < 4) continue;
      /* Signed overhang per edge, measured against the PARENT'S BORDER BOX:
       * positive = the child sticks out past that edge, negative = it sits inside.
       *
       * A child fully inside its parent (all four negative) is not overflow at all — the
       * first version recorded those and produced 80 "centred" observations per surface,
       * which is how the real findings got buried. Only a positive edge is interesting. */
      const left = +(pr.left - kr.left).toFixed(2);
      const right = +(kr.right - pr.right).toFixed(2);
      const top = +(pr.top - kr.top).toFixed(2);
      const bottom = +(kr.bottom - pr.bottom).toFixed(2);
      const overX = Math.max(left, right);
      const overY = Math.max(top, bottom);
      if (overX <= TOL && overY <= TOL) continue; /* fully contained */

      /* Symmetric bleed: the child sticks out past BOTH edges of one axis by the same
       * amount. That is a chart deliberately larger than its box, drawn symmetrically —
       * e.g. `#dialogueDonut` at left -115 / right -115 is INSET (both negative, so caught
       * above), while a true bleed is +15 / +15. */
      const bleedX = left > TOL && right > TOL && Math.abs(left - right) <= 0.5;
      const bleedY = top > TOL && bottom > TOL && Math.abs(top - bottom) <= 0.5;

      /* An ABSOLUTELY POSITIONED child that hangs outside its anchor is a documented
       * pattern — a bar-chart value above its bar, a count badge on a tab. Its overhang is
       * an observation, not a broken container. An IN-FLOW child that overhangs is content
       * the box failed to contain, which is the actual defect class. */
      const anchoredOutside = kcs.position === "absolute";
      const exempt = bleedX || bleedY || anchoredOutside;
      overflows.push({
        kind: exempt ? "centred" : "child",
        parent: sel(el),
        parentCls: cls.slice(0, 48),
        parentBox: box(pr),
        child: sel(k),
        childAbs: anchoredOutside,
        deltas: { left, right, top, bottom },
        dx: +Math.max(0, overX).toFixed(2),
        dy: +Math.max(0, overY).toFixed(2),
        text: textLabel(k).slice(0, 40),
      });
      if (overflows.length >= OVERFLOW_CAP) break;
    }
    if (overflows.length >= OVERFLOW_CAP) break;
  }

  /* ---------- 7. painted children in rounded corners (RADIUS) ---------- */
  const radiusKids = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(EXCLUDE) || el.closest(".svg-sprite")) continue;
    if (!isVisible(el)) continue;
    const cs = csOf(el);
    const R = maxRadius(cs);
    if (!(R > 0.5)) continue;
    if (cs.overflowX !== "visible" || cs.overflowY !== "visible") continue;
    const pr = el.getBoundingClientRect();
    if (pr.width < 8 || pr.height < 8) continue;
    /* padding box: the child is laid out inside the border, so the corner curvature the
     * child can violate is the padding-box radius. */
    const padLeft = pr.left + el.clientLeft;
    const padTop = pr.top + el.clientTop;
    const padRight = padLeft + el.clientWidth;
    const padBottom = padTop + el.clientHeight;
    const innerR = Math.max(0, R - Math.max(el.clientLeft, el.clientTop));
    if (!(innerR > 0.5)) continue;
    for (const k of el.children) {
      if (!isVisible(k)) continue;
      const kcs = getComputedStyle(k);
      const kr = k.getBoundingClientRect();
      if (kr.width < 4 || kr.height < 4) continue;
      if (kcs.position === "fixed") continue;
      const eps = 1.2;
      const corners = [];
      if (Math.abs(kr.left - padLeft) <= eps && Math.abs(kr.top - padTop) <= eps) corners.push("TL");
      if (Math.abs(kr.right - padRight) <= eps && Math.abs(kr.top - padTop) <= eps) corners.push("TR");
      if (Math.abs(kr.left - padLeft) <= eps && Math.abs(kr.bottom - padBottom) <= eps) corners.push("BL");
      if (Math.abs(kr.right - padRight) <= eps && Math.abs(kr.bottom - padBottom) <= eps) corners.push("BR");
      if (!corners.length) continue;
      const kidCorners = cornersOf(kcs);
      const kidR = corners.reduce((m, c) => Math.max(m, kidCorners[{ TL: 0, TR: 1, BL: 2, BR: 3 }[c]]), 0);
      if (kidR >= innerR - 0.5) continue;
      radiusKids.push({
        parent: sel(el),
        parentCls: (typeof el.className === "string" ? el.className : "").slice(0, 48),
        parentRadius: +innerR.toFixed(2),
        parentOverflow: `${cs.overflowX}/${cs.overflowY}`,
        child: sel(k),
        childRadius: kidR,
        childBgA: alphaOf(kcs.backgroundColor),
        childBox: box(kr),
        parentBox: box(pr),
        corners,
        delta: +(innerR - kidR).toFixed(2),
      });
      if (radiusKids.length >= 40) break;
    }
    if (radiusKids.length >= 40) break;
  }

  /* ---------- 8. left-edge alignment (ALIGN-X) ---------- */
  /* The content-box left edge: border box + the element's own border. Measuring every row
   * with the SAME metric is what makes the comparison meaningful — mixing "painted box" for
   * one row with "leftmost glyph ink" for another reported a 0.78px difference between two
   * scene headings whose first letters simply have different side bearings. */
  const edgeOf = (el) => {
    const cs = csOf(el);
    const r = el.getBoundingClientRect();
    return +(r.left + (Number.parseFloat(cs.borderLeftWidth) || 0)).toFixed(2);
  };
  const sigOf = (el) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).sort().join(".") : "";
    return `${el.tagName.toLowerCase()}.${cls}`;
  };
  const alignGroups = [];
  for (const parent of document.querySelectorAll("body *")) {
    if (parent.closest(EXCLUDE) || parent.closest(".svg-sprite")) continue;
    if (!isVisible(parent)) continue;
    const kids = [...parent.children].filter(isVisible);
    if (kids.length < 3) continue;
    const boxes = kids.map((k) => k.getBoundingClientRect());
    let stacked = true;
    for (let i = 1; i < boxes.length; i++) {
      if (boxes[i].top - boxes[i - 1].top < 4) {
        stacked = false;
        break;
      }
      const overlap = Math.min(boxes[i].right, boxes[i - 1].right) - Math.max(boxes[i].left, boxes[i - 1].left);
      if (overlap < Math.min(boxes[i].width, boxes[i - 1].width) * 0.5) {
        stacked = false;
        break;
      }
    }
    if (!stacked) continue;
    const controlsKids = kids.filter((k) => k.matches(CONTROL) || k.matches(INTERACTIVE));
    if (controlsKids.length >= 3) {
      alignGroups.push({
        kind: "controls",
        parent: sel(parent),
        rows: kids.map((k) => ({ sel: sel(k), edge: edgeOf(k) })),
      });
      continue;
    }
    /* table-ish: identical child signature, compare each row's first painted child */
    const sameSig = kids.every((k) => sigOf(k) === sigOf(kids[0]));
    if (sameSig && kids.length >= 3) {
      const firsts = kids.map((k) => {
        const f = [...k.children].find(isVisible);
        return f ? +f.getBoundingClientRect().left.toFixed(2) : null;
      });
      if (firsts.filter((x) => x !== null).length >= 3) {
        alignGroups.push({ kind: "rows", parent: sel(parent), rows: kids.map((k, i) => ({ sel: sel(k), edge: firsts[i] })) });
      }
    }
  }

  /* ---------- 9. separators and doubled seams (RULE) ---------- */
  const dividers = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(EXCLUDE) || el.closest(".svg-sprite")) continue;
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    const vertical = r.width <= 2 && r.height >= 6;
    const horizontal = r.height <= 2 && r.width >= 6;
    if (!vertical && !horizontal) continue;
    const cs = csOf(el);
    const painted = alphaOf(cs.backgroundColor) > 0.02 || borderTotal(cs) > 0;
    if (!painted) continue;
    const cls = typeof el.className === "string" ? el.className : "";
    const id = el.id || "";
    const named = /divider|separator|seam|rule|(^|[\s_-])sep([\s_-]|$)/i.test(`${cls} ${id}`);
    if (!named && el.getAttribute("aria-hidden") !== "true") continue;
    const parent = el.parentElement;
    if (!parent || parent === document.body) continue;
    const pcs = csOf(parent);
    const pr = parent.getBoundingClientRect();
    const pLeft = pr.left + parent.clientLeft;
    const pTop = pr.top + parent.clientTop;
    const pW = parent.clientWidth;
    const pH = parent.clientHeight;
    const centreDelta = vertical
      ? +(r.top + r.height / 2 - (pTop + pH / 2)).toFixed(2)
      : +(r.left + r.width / 2 - (pLeft + pW / 2)).toFixed(2);
    /* Does the separator span the box it divides?
     *
     * A divider that is meant to divide a row should reach both ends of that row (or be
     * centred, which centreDelta already covers). The measured quantity is the larger of
     * the two end gaps: zero means it spans, and a positive number is the unpainted slack at
     * one end. Separators that are deliberately short — `.rb-sep` is a fixed 20px tall inside
     * a 27px row, `.quick-access__divider` a fixed 14px inside 26px — are centred instead,
     * so they are judged by centreDelta and pass the span test with a documented tolerance. */
    const span = vertical ? +r.height.toFixed(2) : +r.width.toFixed(2);
    const boxSpan = vertical ? pH : pW;
    const fullSpan = Math.abs(+(boxSpan - span).toFixed(2));
    /* A separator that is centred AND shorter than its box is a fixed-size tick mark, which
     * is the app's own idiom (`.rb-sep`, `.quick-access__divider`). Only an OFF-CENTRE
     * separator that also fails to span is a defect, so the span test is gated on the
     * centring test having passed. */
    const spanDefect = Math.abs(centreDelta) <= TOL && fullSpan > TOL ? 0 : null;
    dividers.push({
      sel: sel(el),
      parent: sel(parent),
      vertical,
      box: box(r),
      parentBox: box(pr),
      centreDelta,
      span,
      parentH: vertical ? pH : pW,
      fullSpan: spanDefect,
      parentDisplay: pcs.display,
      parentGap: Number.parseFloat(pcs.gap) || 0,
    });
  }
  const doubled = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(EXCLUDE) || el.closest(".svg-sprite")) continue;
    if (!isVisible(el)) continue;
    const sib = el.nextElementSibling;
    if (!sib || !isVisible(sib)) continue;
    const a = csOf(el);
    const b = csOf(sib);
    const ar = el.getBoundingClientRect();
    const br = sib.getBoundingClientRect();
    const aRight = borderPx(a, "Right");
    const bLeft = borderPx(b, "Left");
    if (aRight > 0 && bLeft > 0 && Math.abs(ar.right - br.left) < 1) {
      doubled.push({ a: sel(el), b: sel(sib), seam: +(aRight + bLeft).toFixed(2), axis: "vertical" });
      continue;
    }
    const aBottom = borderPx(a, "Bottom");
    const bTop = borderPx(b, "Top");
    if (aBottom > 0 && bTop > 0 && Math.abs(ar.bottom - br.top) < 1) {
      doubled.push({ a: sel(el), b: sel(sib), seam: +(aBottom + bTop).toFixed(2), axis: "horizontal" });
    }
  }

  /* ---------- 10. hit targets ---------- */
  /* Only controls whose PAINTED box is under the minimum are worth probing: the probe is
   * the expensive part, and a control that is already large cannot fail. */
  const hitTargets = [];
  for (const c of controls) {
    if (c.w >= HIT_MIN && c.h >= HIT_MIN) continue;
    const area = hitArea(live.get(c));
    if (!area.probed) continue;
    const min = Math.min(area.w, area.h);
    hitTargets.push({
      sel: c.sel,
      role: c.role,
      label: c.label,
      w: area.w,
      h: area.h,
      paintedW: c.w,
      paintedH: c.h,
      min,
      probed: area.probed,
    });
  }

  /* ---------- 11. same-role drift within one row (SIZE-DRIFT) ---------- */
  /* Grouped by shared parent AND shared visual row. A parent alone is too coarse: the scene
   * list's rows all nest under one container but they are stacked, and a wrapped ribbon row
   * holds controls on two different lines — comparing a 73px row to an 89px row reports a
   * "drift" that is really two different rows. */
  const sizeGroups = new Map();
  for (const c of controls) {
    if (!c.svgs.length) continue;
    const key = `${c.parentUid}|${c.role}`;
    if (!sizeGroups.has(key)) sizeGroups.set(key, []);
    sizeGroups.get(key).push(c);
  }
  const sizeDrift = [];
  for (const group of sizeGroups.values()) {
    if (group.length < 2) continue;
    /* Split by row: same top edge (within 2px) means same visual line. */
    const rows = new Map();
    for (const c of group) {
      const rowKey = Math.round(c.box.y / 2);
      if (!rows.has(rowKey)) rows.set(rowKey, []);
      rows.get(rowKey).push(c);
    }
    for (const row of rows.values()) {
      if (row.length < 2) continue;
      const icons = [...new Set(row.map((c) => `${c.svgs[0].w}x${c.svgs[0].h}`))];
      const heights = [...new Set(row.map((c) => String(c.h)))];
      if (icons.length < 2 && heights.length < 2) continue;
      sizeDrift.push({
        parent: row[0].parentSel,
        role: row[0].role,
        parts: row.map((c) => ({ sel: c.sel, label: c.label, icon: `${c.svgs[0].w}x${c.svgs[0].h}`, h: c.h, w: c.w })),
      });
    }
  }

  /* ---------- 12. focus indicators ---------- */
  /* The style properties a focus indicator can plausibly be painted with. Comparing these
   * focused vs unfocused catches a border-color/background change, not only outline and
   * box-shadow. */
  const FOCUS_PROPS = [
    "outlineStyle",
    "outlineWidth",
    "outlineColor",
    "boxShadow",
    "borderTopColor",
    "borderRightColor",
    "borderBottomColor",
    "borderLeftColor",
    "borderTopWidth",
    "borderBottomWidth",
    "backgroundColor",
    "backgroundImage",
    "color",
    "filter",
    "opacity",
    "transform",
  ];
  const snapshotStyle = (el) => {
    const cs = getComputedStyle(el);
    const snap = {};
    for (const p of FOCUS_PROPS) snap[p] = cs[p];
    /* Two levels of ancestors is not enough. The shell's search fields are INNER fields of
     * a composite group: `.search-field input { border: 0; outline: none; }` deliberately,
     * and the visible ring is painted by `.search-field:focus-within` (styles.css:1040),
     * `.find-field:focus-within` (styles-desktop.css:1280) on the wrapper. Walking four
     * levels and requiring `:focus-within` on the ancestor is what separates "the group
     * draws the ring" from "nothing is indicated at all". */
    const ancestors = [];
    let a = el.parentElement;
    for (let i = 0; a && a !== document.body && i < 4; a = a.parentElement, i++) {
      const acs = getComputedStyle(a);
      const asnap = {};
      for (const p of FOCUS_PROPS) asnap[p] = acs[p];
      asnap.focusWithin = a.matches(":focus-within");
      ancestors.push(asnap);
    }
    return { self: snap, ancestors };
  };
  /* An indicator is paint that APPEARS or gets STRONGER on focus.
   *
   * Diffing alone is not enough: a rule that sets `border-color: transparent` on
   * :focus-visible changes three computed properties while REMOVING the only outline the
   * control had. That is the opposite of a focus indicator, and counting it as one is how a
   * focus audit passes everything. Each candidate is therefore checked for being newly
   * visible, not merely different. */
  const alphaOfCss = (color) => {
    const c = parseColor(color);
    return c ? c.a : 0;
  };
  const paintsOnFocus = (beforeSnap, afterSnap) => {
    const reasons = [];
    /* outline: must have width AND a non-none style in the focused state */
    const ow = Number.parseFloat(afterSnap.outlineWidth) || 0;
    if (ow > 0 && afterSnap.outlineStyle !== "none" && afterSnap.outlineStyle !== "hidden") {
      if (afterSnap.outlineStyle !== beforeSnap.outlineStyle || afterSnap.outlineWidth !== beforeSnap.outlineWidth || afterSnap.outlineColor !== beforeSnap.outlineColor) {
        reasons.push(`outline ${afterSnap.outlineStyle} ${afterSnap.outlineWidth}`);
      }
    }
    /* box-shadow: appears or changes */
    if (afterSnap.boxShadow && afterSnap.boxShadow !== "none" && afterSnap.boxShadow !== beforeSnap.boxShadow) {
      reasons.push("box-shadow");
    }
    /* background: must gain opacity, not lose it */
    if (afterSnap.backgroundColor !== beforeSnap.backgroundColor) {
      if (alphaOfCss(afterSnap.backgroundColor) > alphaOfCss(beforeSnap.backgroundColor) + 0.01) reasons.push("background");
    }
    if (afterSnap.backgroundImage !== beforeSnap.backgroundImage && afterSnap.backgroundImage !== "none") reasons.push("background-image");
    /* border colour: must gain opacity (a border fading to transparent is not an indicator),
     * and the border must actually be painted. */
    const borderProps = ["borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor"];
    for (const p of borderProps) {
      if (afterSnap[p] === beforeSnap[p]) continue;
      const wKey = p.replace("Color", "Width");
      const w = Number.parseFloat(afterSnap[wKey]) || 0;
      if (w > 0 && alphaOfCss(afterSnap[p]) > alphaOfCss(beforeSnap[p]) + 0.01) {
        reasons.push(`border ${p}`);
        break;
      }
    }
    if (afterSnap.color !== beforeSnap.color) reasons.push("color");
    if (afterSnap.filter !== beforeSnap.filter && afterSnap.filter !== "none") reasons.push("filter");
    return reasons;
  };

  /* Sample by ROLE, prioritising open-dialog controls and then the shell: the shell is the
   * same on every surface, so a dialog's own controls must not be starved. A control that is
   * already :focus-visible with a painted indicator is equally valid evidence that the
   * stylesheet covers that role, so one sample per role is enough. */
  /* Sample by ROLE, prioritising whatever the caller cares most about. Controls inside the
   * fixture container (negative-control runs) and inside open dialogs sort first, so the
   * sample budget can never starve the controls under test. */
  const focusPool = controls
    .filter((c) => !c.disabled)
    .slice()
    .sort((a, b) => {
      const an = a.sel.includes("#fx") ? 2 : a.inDialog ? 1 : 0;
      const bn = b.sel.includes("#fx") ? 2 : b.inDialog ? 1 : 0;
      return bn - an;
    });
  const focusResults = [];
  const seenFocus = new Set();
  const prevActive = document.activeElement;
  /* 80 role samples: this host's shell alone has 41 distinct focusable role classes and the
   * dialog surfaces add more. A 16-sample cap silently stopped measuring most of them, which
   * is exactly the kind of blind spot this audit exists to avoid. */
  for (const c of focusPool) {
    if (focusResults.length >= 80) break;
    if (seenFocus.has(c.focusKey)) continue;
    seenFocus.add(c.focusKey);
    const el = live.get(c);
    if (!el || !isVisible(el)) continue;
    /* Snapshot the unfocused computed style first: a visible focus indicator does not have
     * to be an outline or a shadow. `.search-field input` sets `outline: none` and the
     * WRAPPER paints a ring on `:focus-within`, and plenty of controls change
     * border-color/background instead. Diffing the computed style is the only test that
     * asks "did anything change for the user" rather than "is this one property set". */
    const before = snapshotStyle(el);
    try {
      el.focus({ preventScroll: true });
    } catch {
      continue;
    }
    if (document.activeElement !== el) continue;
    /* Fresh computed style: the style cache predates the focus state. */
    const fcs = getComputedStyle(el);
    const outlineWidth = Number.parseFloat(fcs.outlineWidth) || 0;
    const outlineVisible = outlineWidth > 0 && fcs.outlineStyle !== "none" && fcs.outlineStyle !== "hidden";
    const shadowVisible = !!fcs.boxShadow && fcs.boxShadow.trim() !== "none";
    const after = snapshotStyle(el);
    const selfReasons = paintsOnFocus(before.self, after.self);
    /* A composite group can own the ring: `.search-field input` is deliberately
     * `border: 0; outline: none` and `.search-field:focus-within` paints the ring on the
     * wrapper. An ancestor that both matches :focus-within AND gains paint is a visible
     * indicator for the control inside it. */
    let ancestorReasons = [];
    let ancestorSel = null;
    let a = el.parentElement;
    for (let i = 0; a && a !== document.body && i < before.ancestors.length; a = a.parentElement, i++) {
      const now = snapshotStyle(a).self;
      const within = a.matches(":focus-within");
      const r = paintsOnFocus(before.ancestors[i], now);
      /* :focus-within alone is not paint, but a changed box-shadow/border/background on a
       * :focus-within ancestor is. Record both so the report can be specific. */
      if (r.length || within !== before.ancestors[i].focusWithin) {
        ancestorReasons = r.length ? r : [];
        ancestorSel = sel(a);
        if (r.length) break;
      }
    }
    focusResults.push({
      sel: c.sel,
      label: c.label,
      focusKey: c.focusKey,
      focusVisible: el.matches(":focus-visible"),
      outlineVisible,
      shadowVisible,
      reasons: selfReasons,
      ancestorReasons,
      ancestorSel,
      outline: `${fcs.outlineStyle} ${fcs.outlineWidth} ${fcs.outlineColor}`,
      boxShadow: (fcs.boxShadow || "none").slice(0, 90),
    });
  }
  if (prevActive && typeof prevActive.focus === "function") {
    try {
      prevActive.focus({ preventScroll: true });
    } catch {
      /* restoring focus is best-effort */
    }
  }

  /* ---------- 13. contrast candidates (observation) ---------- */
  const texts = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(EXCLUDE) || el.closest(".svg-sprite")) continue;
    if (!isVisible(el)) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own.length) continue;
    if (hasGradient(el)) continue;
    const cs = csOf(el);
    const fg = parseColor(cs.color);
    if (!fg) continue;
    const bg = effectiveBg(el);
    const ratio = contrast(fg, bg);
    texts.push({
      sel: sel(el),
      text: own.map((n) => n.textContent.trim()).join(" ").slice(0, 40),
      color: cs.color,
      bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
      ratio: +ratio.toFixed(2),
    });
  }

  /* ---------- 14. clipped-and-visible geometry ---------- */
  /* Both OVERLAP and COVER below need the same primitive, and getting it wrong is what made
   * the first version of these detectors report 2711 false positives.
   *
   * A raw getBoundingClientRect() is NOT where an element paints. Content inside a scroll
   * container is clipped to that container's client box: the inspector's `.geometry-item`
   * measured `top 815 bottom 867.3` while `.inspector__body` is an `overflow-y: auto` box
   * ending at 859 and `footer.statusbar` starts at 859 — so the raw boxes "intersect" by
   * arithmetic while the geometry rows are simply scrolled below the fold and the statusbar
   * paints in its own region. Comparing raw rects is the same mistake as trusting
   * scrollHeight without checkVisibility, which this audit already fixed for CLIP.
   *
   * clippedVisibleRect() intersects the element's rect with the padding box of every
   * clipping ancestor, and returns null when nothing of the element actually paints. */
  const clipsAxis = (cs) => {
    const x = cs.overflowX !== "visible";
    const y = cs.overflowY !== "visible";
    return { x, y, any: x || y };
  };
  const clippedVisibleRect = (el) => {
    const r = el.getBoundingClientRect();
    let left = r.left;
    let top = r.top;
    let right = r.right;
    let bottom = r.bottom;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const acs = getComputedStyle(a);
      const clip = clipsAxis(acs);
      if (!clip.any) continue;
      const ar = a.getBoundingClientRect();
      const cl = ar.left + a.clientLeft;
      const ct = ar.top + a.clientTop;
      const cr = cl + a.clientWidth;
      const cb = ct + a.clientHeight;
      if (clip.x) {
        left = Math.max(left, cl);
        right = Math.min(right, cr);
      }
      if (clip.y) {
        top = Math.max(top, ct);
        bottom = Math.min(bottom, cb);
      }
    }
    /* Nothing paints: scrolled out of the fold, or clipped away entirely. */
    if (right - left <= 0.5 || bottom - top <= 0.5) return null;
    return { left, top, right, bottom, w: +(right - left).toFixed(2), h: +(bottom - top).toFixed(2) };
  };

  /* While a modal dialog is open, everything behind its backdrop is intentionally covered.
   * Only content inside the topmost modal can sensibly be judged. */
  const openDialogs = [...document.querySelectorAll("dialog[open]")];
  const topModal = openDialogs.length ? openDialogs[openDialogs.length - 1] : null;
  const behindModal = (el) => !!topModal && !topModal.contains(el);

  /* ---------- 15. sibling collision: OVERLAP ---------- */
  /* Two painted boxes that intersect on BOTH axes are one element painting over another.
   *
   * This is the class every containment metric misses. The worked example: a grid row with
   * `align-items: start` let `.report-card` grow past its 170px track and paint 41.4px over
   * the card beneath it. The card's own box was still valid, its child was still inside it,
   * and OVERFLOW read clean — nothing overflowed its own parent; the element simply sat on a
   * sibling.
   *
   * Excluded by design:
   *   - overlays that are SUPPOSED to float over their trigger (popovers, menus, tooltips,
   *     toasts, an open dialog and everything inside it);
   *   - ancestor/descendant pairs;
   *   - pairs in different stacking contexts;
   *   - anything clipped out of view (see clippedVisibleRect above).
   * Finally each candidate overlap is CONFIRMED with elementFromPoint at the centre of the
   * intersection, so the report describes something a user can actually see. */
  const OVERLAY_BY_DESIGN = /ribbon__popover|tooltip|dropdown|popover|context-menu|command-palette|menu__|toast|flyout|suggestions|autocomplete|select-popup|picker/i;
  const isOverlayEl = (el) => {
    if (el.matches?.("dialog[open]")) return true;
    if (el.closest?.("dialog[open]")) return true;
    if (el.getAttribute?.("role") === "menu" || el.getAttribute?.("role") === "listbox" || el.getAttribute?.("role") === "tooltip") return true;
    if (el.closest?.("[role='menu'],[role='listbox'],[role='tooltip']")) return true;
    /* Check ANCESTORS, not only the element itself. The toast stack is an overlay, but the
     * thing elementFromPoint returns inside it is a classless `span` in the message body — so
     * testing the hit element's own class missed every toast and reported the welcome toast
     * painting over the inspector as "covered text". */
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const cls = typeof a.className === "string" ? a.className : "";
      if (OVERLAY_BY_DESIGN.test(cls) || OVERLAY_BY_DESIGN.test(a.id || "")) return true;
    }
    const cs = getComputedStyle(el);
    return (cs.position === "absolute" || cs.position === "fixed") && cs.zIndex !== "auto";
  };

  /* The STACKING ROOT an element lives in: its nearest positioned ancestor (or the modal).
   * Two elements only collide when they share a stacking context — an element inside a
   * fixed/absolute overlay is meant to paint above page content, and treating that as a
   * collision flagged every dialog against the shell behind it. */
  const overlayRootOf = (el) => {
    /* Start at the PARENT: an absolutely-positioned element is not its own containing block. */
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (a.matches?.("dialog[open]")) return a;
      const cs = getComputedStyle(a);
      if (cs.position === "fixed" || cs.position === "absolute" || cs.position === "sticky") return a;
    }
    return document.body;
  };

  const paintedBoxes = [];
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest(EXCLUDE) || el.closest(".svg-sprite")) continue;
    if (el.closest('[aria-hidden="true"], [inert]')) continue;
    if (behindModal(el)) continue;
    if (!isVisible(el)) continue;
    if (isOverlayEl(el)) continue;
    const cs = csOf(el);
    /* Only elements that actually paint can occlude. */
    const paints = alphaOf(cs.backgroundColor) > 0.05 || borderTotal(cs) > 0 || cs.backgroundImage !== "none";
    if (!paints) continue;
    /* The box the user can actually see, not the arithmetic box. */
    const visible = clippedVisibleRect(el);
    if (!visible) continue;
    if (visible.w < 8 || visible.h < 8) continue;
    paintedBoxes.push({
      el,
      cs,
      sel: sel(el),
      cls: (typeof el.className === "string" ? el.className : "").slice(0, 48),
      r: visible,
      root: overlayRootOf(el),
      depth: (() => {
        let d = 0;
        for (let a = el; a; a = a.parentElement) d++;
        return d;
      })(),
    });
  }

  const overlaps = [];
  const OVERLAP_CAP = 200;
  /* Fixture boxes first: --self-test asserts on them and a cap must never decide which
   * controls get measured (that is a vacuous pass in disguise). */
  paintedBoxes.sort((a, b) => {
    const af = a.sel.includes("#fx") ? 0 : 1;
    const bf = b.sel.includes("#fx") ? 0 : 1;
    return af - bf;
  });
  for (let i = 0; i < paintedBoxes.length && overlaps.length < OVERLAP_CAP; i++) {
    const a = paintedBoxes[i];
    for (let j = i + 1; j < paintedBoxes.length && overlaps.length < OVERLAP_CAP; j++) {
      const b = paintedBoxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (a.root !== b.root) continue;
      if (a.r.right <= b.r.left + TOL || b.r.right <= a.r.left + TOL) continue;
      if (a.r.bottom <= b.r.top + TOL || b.r.bottom <= a.r.top + TOL) continue;
      const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ox <= TOL || oy <= TOL) continue;
      const rect = {
        x: +Math.max(a.r.left, b.r.left).toFixed(2),
        y: +Math.max(a.r.top, b.r.top).toFixed(2),
        w: +ox.toFixed(2),
        h: +oy.toFixed(2),
      };
      /* Confirm at the centre of the intersection: one of the pair must actually be the
       * topmost thing painted there, otherwise a third element intervenes and this is not a
       * collision the user sees. */
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) continue;
      const hit = document.elementFromPoint(cx, cy);
      const hitIsA = !!hit && (hit === a.el || a.el.contains(hit));
      const hitIsB = !!hit && (hit === b.el || b.el.contains(hit));
      if (!hitIsA && !hitIsB) continue;
      overlaps.push({
        a: a.sel,
        aCls: a.cls,
        aBox: box(a.r),
        aDepth: a.depth,
        aZ: a.cs.zIndex,
        b: b.sel,
        bCls: b.cls,
        bBox: box(b.r),
        bDepth: b.depth,
        bZ: b.cs.zIndex,
        ox: +ox.toFixed(2),
        oy: +oy.toFixed(2),
        rect,
        area: +(ox * oy).toFixed(1),
        onTop: hitIsA ? "a" : "b",
      });
    }
  }

  /* ---------- 16. occlusion: COVER (hit-test visibility) ---------- */
  /* Is the element's own TEXT the thing a user's pointer lands on?
   *
   * Every bounding-box test can pass while the text is invisible: inside a valid box, inside
   * its own card, non-zero opacity — and a sibling paints over it. The only honest test is to
   * ask the hit-tester at the glyph rects themselves. This is the difference between "is it
   * in the right place" and "can a user see it".
   *
   * Guards, each of which the first version lacked and each of which produced a false
   * positive class:
   *   - the glyph rect must survive ancestor clipping (scrolled-out text is not covered);
   *   - a modal makes everything behind it covered BY DESIGN, so a modal is not a defect;
   *   - an overlay (toast/popover/menu/tooltip) painting over content is transient or
   *     deliberate, not a collision;
   *   - only a fully-blocked element counts; a partly-covered label is a layout quirk. */
  /* Does `culprit` float in a DIFFERENT positioning plane from `textEl`, i.e. is it an
   * overlay that is supposed to paint above the content?
   *
   * A class-name list is not enough. `.read-dock` is `position: fixed; z-index: 85` and the
   * thing elementFromPoint returns inside it is a classless `<span>`, yet it legitimately
   * floats over the scenes panel behind it; the toast stack (z-index 120) is the same story.
   * Both are "an overlay above the page", while the report-card collision is two static
   * siblings in one plane.
   *
   * The test is structural: take the culprit's nearest positioned ancestor (its plane). If
   * that plane CONTAINS the covered text, the two share a layout plane and a cover is real.
   * If it does not contain the text, the culprit is floating above the text's plane, which is
   * what overlays are for. */
  const floatsAbove = (textEl, culprit) => {
    const plane = overlayRootOf(culprit);
    if (plane === document.body) return false;
    return !plane.contains(textEl);
  };

  const covers = [];
  const COVER_CAP = 60;
  {
    const textEls = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest(EXCLUDE) || el.closest(".svg-sprite")) continue;
      if (el.closest('[aria-hidden="true"], [inert]')) continue;
      if (behindModal(el)) continue;
      if (el.tagName.toLowerCase() === "svg" || el.closest("svg")) continue;
      if (!isVisible(el)) continue;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      if (!own.length) continue;
      const cs = csOf(el);
      if (cs.visibility !== "visible" || Number(cs.opacity) === 0) continue;
      const rects = [];
      for (const node of own) {
        for (const rect of lineRects(node)) {
          if (rect.width < 2 || rect.height < 2) continue;
          if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
          if (rect.right < 0 || rect.left > window.innerWidth) continue;
          /* Clip the glyph rect to what the element can actually paint. A line scrolled below
           * its container's fold is NOT covered — it is simply out of view. */
          const vis = clippedVisibleRect(el);
          if (!vis) continue;
          const cl = Math.max(rect.left, vis.left);
          const ct = Math.max(rect.top, vis.top);
          const cr = Math.min(rect.right, vis.right);
          const cb = Math.min(rect.bottom, vis.bottom);
          if (cr - cl < 2 || cb - ct < 2) continue;
          rects.push({ left: cl, top: ct, right: cr, bottom: cb, width: cr - cl, height: cb - ct });
        }
      }
      if (!rects.length) continue;
      textEls.push({ el, sel: sel(el), cs, rects, text: own.map((n) => n.textContent.trim()).join(" ").replace(/\s+/g, " ").slice(0, 48) });
    }
    for (const t of textEls) {
      if (covers.length >= COVER_CAP) break;
      const sampled = t.rects.slice(0, 6);
      const blocked = [];
      for (const rect of sampled) {
        const probes = [
          [rect.left + rect.width / 2, rect.top + rect.height / 2],
          [rect.left + Math.min(3, rect.width / 4), rect.top + rect.height / 2],
          [rect.right - Math.min(3, rect.width / 4), rect.top + rect.height / 2],
        ];
        let hitOwner = null;
        let hits = 0;
        let overlayHit = false;
        for (const [x, y] of probes) {
          if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue;
          hits++;
          const hit = document.elementFromPoint(x, y);
          if (!hit) continue;
          if (hit === t.el || t.el.contains(hit) || hit.contains(t.el)) continue;
          /* An overlay in a different plane is allowed to paint over content. */
          if (isOverlayEl(hit) || floatsAbove(t.el, hit)) overlayHit = true;
          if (!hitOwner) hitOwner = hit;
        }
        if (hits && hitOwner && !overlayHit) blocked.push({ rect, hit: hitOwner });
      }
      /* Covered only when EVERY sampled line is blocked by an outside, non-overlay element. */
      if (blocked.length !== sampled.length || blocked.length === 0) continue;
      const culprit = blocked[0].hit;
      covers.push({
        sel: t.sel,
        text: t.text,
        color: t.cs.color,
        lines: t.rects.length,
        sampled: sampled.length,
        blockedBy: sel(culprit),
        blockedByCls: (typeof culprit.className === "string" ? culprit.className : "").slice(0, 48),
        blockedByText: (culprit.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40),
        firstRect: {
          x: +blocked[0].rect.left.toFixed(2),
          y: +blocked[0].rect.top.toFixed(2),
          w: +blocked[0].rect.width.toFixed(2),
          h: +blocked[0].rect.height.toFixed(2),
        },
      });
    }
  }

  /* ---------- stats ---------- */
  const dialogsOpen = [...document.querySelectorAll("dialog[open]")].map((d) => d.id || d.className);
  const stats = {
    controls: controls.length,
    pairs: pairs.length,
    inks: inks.length,
    clips: clips.length,
    composites: composites.length,
    overflows: overflows.length,
    radiusKids: radiusKids.length,
    alignGroups: alignGroups.length,
    dividers: dividers.length,
    doubled: doubled.length,
    hitTargets: hitTargets.length,
    focusTested: focusResults.length,
    texts: texts.length,
    paintedBoxes: paintedBoxes.length,
    overlaps: overlaps.length,
    covers: covers.length,
    dialogs: dialogsOpen,
    theme: document.documentElement.dataset.theme || document.body.dataset.theme || "(unset)",
    viewport: { w: window.innerWidth, h: window.innerHeight },
  };

  return {
    stats,
    controls,
    pairs,
    inks,
    clips,
    composites,
    overflows,
    radiusKids,
    alignGroups,
    dividers,
    doubled,
    hitTargets,
    sizeDrift,
    focusResults,
    texts,
    overlaps,
    covers,
  };
}

/* ------------------------------------------------------------------ */
/* judgement                                                           */
/* ------------------------------------------------------------------ */

const CATEGORIES = [
  "CLIP",
  "VCENTER",
  "HCENTER",
  "BASELINE",
  "INK",
  "OVERFLOW",
  "OVERLAP",
  "COVER",
  "SEAM",
  "SIZE-DRIFT",
  "RADIUS",
  "ALIGN-X",
  "RULE",
  "FOCUS",
];
/* Measured, printed, and never a failure. Each one is a real geometry observation that
 * would be a false positive if it were reported as a defect. */
const OBSERVATIONS = [
  "CONTRAST",
  "CLAMP",
  "ELLIPSIS",
  "TIGHT",
  "CLIP-NOINK",
  "OVERLAY",
  "OBS-ALLOWED",
  "OBS-HOVER",
  "HIT-AREA",
  "OVERFLOW-CENTRED",
  "FOCUS-OK",
];

const allowedHit = (selector, category) => {
  for (const [key, entry] of Object.entries(ALLOWED)) {
    if (entry.cat === category && selector.includes(key)) return entry.reason;
  }
  return null;
};

function judge(surface, theme, m, allowedHits) {
  const defects = [];
  const add = (d) => {
    defects.push({ surface, theme, ...d });
  };

  /* ---- CLIP ---- */
  for (const c of m.clips) {
    const inkCut = c.inkClip.delta > INK_CLIP_TOL;
    const allowReason = allowedHit(c.sel, "CLIP") || allowedHit(c.parentSel, "CLIP");
    if (allowReason) {
      if (allowedHits) allowedHits.set(Object.keys(ALLOWED).find((k) => c.sel.includes(k) || c.parentSel.includes(k)), true);
      /* An allowlisted clipper is only exempt while no glyph is actually lost. */
      if (!inkCut) {
        add({
          category: "OBS-ALLOWED",
          selector: c.sel,
          label: c.text,
          metric: `clipper exempted (${allowReason}); scroll ${c.scrollDx}x${c.scrollDy}px, ink cut ${c.inkClip.delta}px`,
          delta: Math.max(c.scrollDx, c.scrollDy),
          observation: true,
        });
        continue;
      }
    }
    if (c.clampTruncated && !c.textCrosses) {
      add({
        category: "CLAMP",
        selector: c.sel,
        label: c.text,
        metric: `-webkit-line-clamp:${c.clamp} hides whole lines by design; scroll ${c.scrollDx}x${c.scrollDy}px, no rendered line crosses the edge`,
        delta: Math.max(c.scrollDx, c.scrollDy, 1),
        observation: true,
      });
      continue;
    }
    if (c.textCrosses && c.textOverflow === "ellipsis") {
      add({
        category: "ELLIPSIS",
        selector: c.sel,
        label: c.text,
        metric: `text-overflow: ellipsis truncates at the edge by design; scroll overflow ${c.scrollDx}x${c.scrollDy}px`,
        delta: Math.max(c.scrollDx, c.scrollDy, 1),
        observation: true,
      });
      continue;
    }
    if (c.textCrosses && !inkCut) {
      add({
        category: "TIGHT",
        selector: c.sel,
        label: c.text,
        metric: `a line rect crosses the ${c.overflowX}/${c.overflowY} edge but no glyph ink is lost (line-height vs font-box); scroll ${c.scrollDx}x${c.scrollDy}px`,
        delta: Math.max(c.scrollDx, c.scrollDy, 1),
        observation: true,
      });
      continue;
    }
    if (!c.textCrosses) {
      add({
        category: "CLIP-NOINK",
        selector: c.sel,
        label: c.text,
        metric: `scroll overflow ${c.scrollDx}x${c.scrollDy}px with no text at the clip edge (decorative child)`,
        delta: Math.max(c.scrollDx, c.scrollDy, 1),
        observation: true,
      });
      continue;
    }
    add({
      category: "CLIP",
      selector: c.sel,
      label: c.text,
      metric:
        `glyph ink cut ${c.inkClip.delta}px at the ${c.inkClip.side} edge` +
        (c.scrollDx > 1 || c.scrollDy > 1 ? `; scroll ${c.scrollDx}x${c.scrollDy}px` : "") +
        (c.clamp ? `; line-clamp:${c.clamp}` : "") +
        (allowReason ? ` [allowlisted: ${allowReason}]` : ""),
      delta: Math.max(c.inkClip.delta, c.scrollDx, c.scrollDy),
    });
  }

  /* ---- VCENTER / HCENTER / BASELINE ---- */
  /* These compare the icon BOX centre to the label, because they are layout classes. The
   * artwork's own off-centring is the INK class, measured separately — see the note in
   * section 2. Both numbers appear in the metric so nothing is hidden. */
  for (const p of m.pairs) {
    const inkNote = Math.abs(p.inkOffX) > 0.25 || Math.abs(p.inkOffY) > 0.25 ? `; drawn glyph sits ${p.inkOffX}x${p.inkOffY}px off its box centre (see INK)` : "";
    if (p.orientation === "ROW" && Math.abs(p.dCy) > TOL) {
      add({
        category: "VCENTER",
        selector: p.unit,
        label: p.label,
        metric: `icon box centre - text line centre = ${p.dCy}px (icon ${p.iconSize.w}x${p.iconSize.h}, gap ${p.gap}px)${inkNote}`,
        delta: Math.abs(p.dCy),
      });
    }
    if (p.orientation === "STACK" && Math.abs(p.dCx) > TOL) {
      add({
        category: "HCENTER",
        selector: p.unit,
        label: p.label,
        metric: `icon box centre x - label block centre x = ${p.dCx}px (icon above label)${inkNote}`,
        delta: Math.abs(p.dCx),
      });
    }
    /* inline <svg> in a non-flex context is seated on the text baseline */
    if (p.iconDisplay === "inline") {
      const parentDisplay = p.chain[1] ? p.chain[1].display : p.chain[0].display;
      if (!/flex|grid/.test(parentDisplay)) {
        add({
          category: "BASELINE",
          selector: p.unit,
          label: p.label,
          metric: `svg display:inline inside a ${parentDisplay} parent: painted on the text baseline (measured dCy=${p.dCy}px)`,
          delta: Math.max(Math.abs(p.dCy), 0.5),
        });
      }
    }
    if (p.baselineHolder) {
      add({
        category: "BASELINE",
        selector: p.unit,
        label: p.label,
        metric: `${p.baselineHolder} aligns items on baseline; an svg's baseline is its bottom edge (measured dCy=${p.dCy}px)`,
        delta: Math.max(Math.abs(p.dCy), 0.5),
      });
    }
  }

  /* ---- INK ---- */
  for (const k of m.inks) {
    const dx = Math.abs(k.dxUnits);
    const dy = Math.abs(k.dyUnits);
    if (dx <= INK_TOL_UNITS && dy <= INK_TOL_UNITS) continue;
    add({
      category: "INK",
      selector: k.sel,
      label: `${k.href} in ${k.unitSel}`,
      metric:
        `glyph ink centre is ${k.dxUnits} x ${k.dyUnits} viewBox units off the ${k.vb} centre ` +
        `(${k.dxPx} x ${k.dyPx} CSS px; ink ${k.inkW}x${k.inkH} units)`,
      delta: Math.max(dx, dy),
    });
  }

  /* ---- OVERFLOW ---- */
  for (const o of m.overflows) {
    if (o.kind === "content") {
      add({
        category: "OVERFLOW",
        selector: o.parent,
        label: o.text,
        metric: `content box overflows its painted box by ${o.dx}x${o.dy}px while overflow is visible`,
        delta: Math.max(o.dx, o.dy),
      });
    } else if (o.kind === "centred") {
      /* Symmetric overhang: the child is centred on a parent it is larger than. That is a
       * deliberate bleed/centring pattern, so it is measured and reported, not failed. */
      add({
        category: "OVERFLOW-CENTRED",
        selector: o.parent,
        label: o.text || o.child,
        metric:
          `child ${o.child} is centred on its parent and extends past it symmetrically: ` +
          `left ${o.deltas.left} right ${o.deltas.right} top ${o.deltas.top} bottom ${o.deltas.bottom}px`,
        delta: Math.max(o.dx, o.dy),
        observation: true,
      });
    } else {
      add({
        category: "OVERFLOW",
        selector: o.parent,
        label: o.text || o.child,
        metric:
          `child ${o.child} paints outside its parent: ` +
          `left ${o.deltas.left} right ${o.deltas.right} top ${o.deltas.top} bottom ${o.deltas.bottom}px` +
          (o.childAbs ? " (absolutely positioned)" : ""),
        delta: Math.max(o.dx, o.dy),
      });
    }
  }

  /* ---- OVERLAP ---- */
  /* Two painted, non-nested boxes intersecting on both axes. The measured quantity is the
   * intersecting rectangle, because that is literally how much of one element the other one
   * paints over. The shallower element is the one on top in paint order for normal flow, but
   * the report names both and lets a reader open the element. */
  for (const o of m.overlaps) {
    /* Which one a user actually sees on top is decided by the hit-test at the intersection
     * centre, not guessed from DOM depth: a later sibling usually wins, but z-index and
     * positioning can invert that. */
    const top = o.onTop === "a" ? o.a : o.b;
    const bottom = o.onTop === "a" ? o.b : o.a;
    add({
      category: "OVERLAP",
      selector: top,
      label: bottom,
      metric:
        `two painted siblings collide over a ${o.rect.w}x${o.rect.h}px rectangle at (${o.rect.x},${o.rect.y}); ` +
        `${top} paints over ${bottom} (${o.ox}x${o.oy}px intersection, ${o.area}px²)`,
      /* The penetration depth, not the long side. Two 360px-wide cards overlapping by
       * 41.33px vertically means one card covers 41.33px of the other — 360 is just the width
       * they happen to share, and reporting it buried the actual severity. The smaller axis is
       * the direction of the intrusion. */
      delta: Math.min(o.ox, o.oy),
    });
  }

  /* ---- COVER ---- */
  /* Text inside a valid box that no pointer can reach because something else paints over it.
   * Every bounding-box metric passes for these, so this is the only detector that catches
   * "the content is there but the user cannot see it". */
  for (const c of m.covers) {
    add({
      category: "COVER",
      selector: c.sel,
      label: c.text,
      metric:
        `all ${c.sampled} sampled line boxes of "${c.text}" are covered: ` +
        `elementFromPoint at the glyph rects returns ${c.blockedBy}` +
        (c.blockedByText ? ` ("${c.blockedByText}")` : "") +
        `, so the text is in the DOM but invisible and unclickable`,
      delta: +(c.firstRect.h || 1).toFixed(2) || 1,
    });
  }

  /* ---- SEAM ---- */
  for (const c of m.composites) {
    const parts = c.parts.slice().sort((a, b) => a.box.x - b.box.x);
    const rowLike = parts.every((p) => Math.abs(p.box.y - parts[0].box.y) <= Math.max(2, p.box.h * 0.25));
    const overlay = parts.some((p) => p.abs) && rowLike && parts.every((p, i) => i === 0 || p.box.x + p.box.w <= parts[0].box.x + parts[0].box.w + 0.5);
    if (overlay) {
      const wrapped = parts.find((p) => !p.abs) || parts[0];
      const abs = parts.find((p) => p.abs);
      if (abs) {
        const insets = {
          left: +(abs.box.x - c.wrap.x).toFixed(2),
          right: +(c.wrap.x + c.wrap.w - (abs.box.x + abs.box.w)).toFixed(2),
          top: +(abs.box.y - c.wrap.y).toFixed(2),
          bottom: +(c.wrap.y + c.wrap.h - (abs.box.y + abs.box.h)).toFixed(2),
        };
        add({
          category: "OVERLAY",
          selector: c.sel,
          label: abs.sel,
          metric:
            `absolutely positioned part inside a ${c.wrap.w}x${c.wrap.h} container; insets ` +
            `L${insets.left} R${insets.right} T${insets.top} B${insets.bottom}px ` +
            `(corner affordance: measured, not a failure)`,
          delta: Math.max(...Object.values(insets).map(Math.abs)),
          observation: true,
        });
        continue;
      }
    }
    if (!rowLike) continue; /* column layouts (e.g. split--large) are not side-by-side seams */

    /* Fused by design: the left part is rounded on its left corners and square on the
     * right, and the right part is the mirror image. Uniform-radius groups (timeline
     * segments, segmented controls) are deliberately separate pieces. */
    let fused = false;
    for (let i = 1; i < parts.length; i++) {
      const a = parts[i - 1];
      const b = parts[i];
      const aFused = a.corners[0] > 1 && a.corners[1] <= 1; /* TL round, TR square */
      const bFused = b.corners[1] > 1 && b.corners[0] <= 1; /* TR round, TL square */
      if (aFused && bFused) fused = true;
    }
    if (!fused && c.knownGroup) fused = true;
    if (!fused) continue;

    for (let i = 1; i < parts.length; i++) {
      const a = parts[i - 1];
      const b = parts[i];
      const gap = +(b.box.x - (a.box.x + a.box.w)).toFixed(2);
      if (Math.abs(gap) > 0.5) {
        add({
          category: "SEAM",
          selector: c.sel,
          label: `${a.sel} | ${b.sel}`,
          metric: `fused parts do not share an edge: ${gap}px gap between them (container ${c.wrap.w}x${c.wrap.h})`,
          delta: Math.abs(gap),
        });
      }
      const hDiff = +(b.box.h - a.box.h).toFixed(2);
      if (Math.abs(hDiff) > TOL) {
        add({
          category: "SEAM",
          selector: c.sel,
          label: `${a.sel} | ${b.sel}`,
          metric: `fused parts differ in height by ${hDiff}px (${a.box.h}px vs ${b.box.h}px)`,
          delta: Math.abs(hDiff),
        });
      }
      const vOffset = +(b.box.y - a.box.y).toFixed(2);
      if (Math.abs(vOffset) > TOL && Math.abs(hDiff) <= TOL) {
        add({
          category: "SEAM",
          selector: c.sel,
          label: `${a.sel} | ${b.sel}`,
          metric: `fused parts are not on one top edge: ${vOffset}px vertical offset`,
          delta: Math.abs(vOffset),
        });
      }
    }
  }

  /* ---- HIT-TARGET (observation only) ---- */
  /* The painted box and the pointer-reachable box are different facts.
   *
   * This is an OBSERVATION, not a failure. The shell is a dense desktop ribbon: 23px-tall
   * small buttons are pinned by `app/tests/type-scale.test.cjs` (104px track), the
   * split-arrow's 14px glyph is backed by a `::after { inset: -5px }` overlay that
   * `app/tests/touch-targets.cjs` proves works, and a 13px checkbox is a normal control.
   * Failing every one of those made 1132 instances of noise that buried the real defects.
   * The measured number is still reported, so a genuinely tiny target is visible in the
   * output without being called a defect. */
  for (const h of m.hitTargets) {
    const expanded = h.min >= HIT_MIN && (h.paintedW < HIT_MIN || h.paintedH < HIT_MIN);
    add({
      category: "HIT-AREA",
      selector: h.sel,
      label: h.label,
      metric: expanded
        ? `painted ${h.paintedW}x${h.paintedH}, reachable ${h.w}x${h.h} CSS px (transparent overlay expands the target)`
        : `painted ${h.paintedW}x${h.paintedH}, reachable ${h.w}x${h.h} CSS px — below ${HIT_MIN}x${HIT_MIN} (dense desktop ribbon; measured, not failed)`,
      delta: +(HIT_MIN - h.min).toFixed(2),
      observation: true,
    });
  }

  /* ---- SIZE-DRIFT ---- */
  for (const g of m.sizeDrift) {
    const icons = [...new Set(g.parts.map((p) => p.icon))];
    const heights = [...new Set(g.parts.map((p) => p.h))];
    if (icons.length > 1) {
      const nums = icons.filter((i) => i !== "none").map((i) => Number.parseFloat(i));
      add({
        category: "SIZE-DRIFT",
        selector: `${g.parent} > ${g.role}`,
        label: g.parts.map((p) => p.label).filter(Boolean).join(" / ").slice(0, 48),
        metric: `same role in one row renders icons ${icons.join(" vs ")} (${g.parts.length} controls)`,
        delta: nums.length > 1 ? +Math.max(...nums) - Math.min(...nums) : 1,
      });
    }
    if (heights.length > 1) {
      add({
        category: "SIZE-DRIFT",
        selector: `${g.parent} > ${g.role}`,
        label: g.parts.map((p) => p.label).filter(Boolean).join(" / ").slice(0, 48),
        metric: `same role in one row renders heights ${heights.join(" vs ")}px`,
        delta: +Math.max(...heights) - Math.min(...heights),
      });
    }
  }

  /* ---- RADIUS ---- */
  for (const k of m.radiusKids) {
    if (k.childBgA > 0.02) {
      add({
        category: "RADIUS",
        selector: k.child,
        label: k.parentCls || k.parent,
        metric:
          `painted child (${k.corners.join(",")}) has radius ${k.childRadius}px inside a rounded parent ` +
          `(inner radius ${k.parentRadius}px, overflow ${k.parentOverflow}); its square corner paints outside the curve`,
        delta: k.delta,
      });
    } else {
      add({
        category: "OBS-HOVER",
        selector: k.child,
        label: k.parentCls || k.parent,
        metric: `child touches the parent's rounded corner (${k.corners.join(",")}) but paints no background when idle; ` +
          `hover-unpainted is by design, hover-painted would be a RADIUS defect`,
        delta: k.delta,
        observation: true,
      });
    }
  }

  /* ---- ALIGN-X ---- */
  for (const g of m.alignGroups) {
    const edges = g.rows.map((r) => r.edge).filter((e) => e !== null && Number.isFinite(e));
    if (edges.length < 3) continue;
    const sorted = edges.slice().sort((a, b) => a - b);
    const modal = sorted[Math.floor(sorted.length / 2)];
    const deviating = g.rows.filter((r) => r.edge !== null && Math.abs(r.edge - modal) > TOL);
    if (!deviating.length) continue;
    if (deviating.length > 6) continue; /* an intentionally indented tree, not one ragged row */
    for (const r of deviating) {
      add({
        category: "ALIGN-X",
        selector: r.sel,
        label: g.parent,
        metric: `left edge ${r.edge}px vs ${modal}px for its siblings in ${g.kind} group ${g.parent} = ${(r.edge - modal).toFixed(2)}px`,
        delta: Math.abs(r.edge - modal),
      });
    }
  }

  /* ---- RULE ---- */
  for (const d of m.dividers) {
    if (Math.abs(d.centreDelta) > TOL) {
      add({
        category: "RULE",
        selector: d.sel,
        label: d.parent,
        metric:
          `${d.vertical ? "vertical" : "horizontal"} separator is ${d.centreDelta}px off the centre of the ` +
          `${d.parentDisplay} box it divides (separator ${d.height}px, parent ${d.parentH}px)`,
        delta: Math.abs(d.centreDelta),
      });
    }
    /* Deliberately NO equidistance-from-neighbours test.
     *
     * Spacing around a rule is a design rhythm, not a constraint: `.title-page__rule` is
     * `margin: 22px 0 20px`, so it sits 12px below its title and 10px above its credit by
     * design. Testing "equidistant" flagged that 2px asymmetry as a defect on every dialog
     * that renders a rule. The spec for this class is a separator that does not match the
     * box it divides — centring and full-span — which is what is measured above and below. */
    if (d.fullSpan !== null && d.fullSpan > TOL) {
      add({
        category: "RULE",
        selector: d.sel,
        label: d.parent,
        metric:
          `${d.vertical ? "vertical" : "horizontal"} separator spans ${d.span}px of a ${d.parentH}px ` +
          `${d.vertical ? "tall" : "wide"} box, leaving ${d.fullSpan}px unpainted at one end`,
        delta: d.fullSpan,
      });
    }
  }
  for (const d of m.doubled) {
    add({
      category: "RULE",
      selector: d.a,
      label: d.b,
      metric: `doubled ${d.axis} seam: ${d.a} and ${d.b} touch and both paint a facing border, so the line is ${d.seam}px instead of 1px`,
      delta: d.seam,
    });
  }

  /* ---- FOCUS ---- */
  for (const f of m.focusResults) {
    if (!f.focusVisible) continue;
    /* A visible indicator is paint that APPEARS on focus: an outline, a box-shadow, a
     * background or border that gains opacity, a colour/filter change, or any of those on a
     * :focus-within wrapper. A rule that only REMOVES paint is not an indicator. */
    if (f.outlineVisible || f.shadowVisible) continue;
    if (f.reasons && f.reasons.length) continue;
    if (f.ancestorReasons && f.ancestorReasons.length) continue;
    add({
      category: "FOCUS",
      selector: f.sel,
      label: f.label,
      metric:
        `matches :focus-visible but nothing appears on focus: outline ${f.outline}, box-shadow ${f.boxShadow}, ` +
        `and no computed-style gain on the control or any of its four ancestors`,
      delta: 1,
    });
  }
  /* Every focus sample is reported as an observation with its evidence, so "FOCUS = 0" can
   * be audited rather than believed: the reader can see WHICH mechanism indicated the focus
   * (own outline, own box-shadow, or a :focus-within wrapper) for each measured control. */
  for (const f of m.focusResults) {
    if (!f.focusVisible) continue;
    if (!f.outlineVisible && !f.shadowVisible && !(f.reasons && f.reasons.length) && !(f.ancestorReasons && f.ancestorReasons.length)) continue;
    const why = f.outlineVisible
      ? `outline ${f.outline}`
      : f.shadowVisible
        ? `own box-shadow ${f.boxShadow.slice(0, 48)}`
        : f.reasons && f.reasons.length
          ? `own ${f.reasons.join(", ")}`
          : `${f.ancestorSel} gains ${f.ancestorReasons.join(", ")} via :focus-within`;
    add({
      category: "FOCUS-OK",
      selector: f.sel,
      label: f.label,
      metric: `focus is indicated by ${why}`,
      delta: 0,
      observation: true,
    });
  }

  /* ---- CONTRAST (observation) ---- */
  for (const t of m.texts) {
    if (t.ratio > 1.5) continue;
    add({
      category: "CONTRAST",
      selector: t.sel,
      label: t.text,
      metric: `text ${t.color} on ${t.bg}: contrast ratio ${t.ratio}:1`,
      delta: +(1.5 - t.ratio).toFixed(2),
      observation: true,
    });
  }

  return defects;
}

/* ------------------------------------------------------------------ */
/* runner                                                              */
/* ------------------------------------------------------------------ */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function sweep() {
  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const results = [];
  const pageErrors = [];
  const allowedHits = new Map(Object.keys(ALLOWED).map((k) => [k, false]));
  const pages = new Map();

  const resetPage = async (page) => {
    await page.evaluate(() => {
      document.querySelectorAll("dialog[open]").forEach((d) => {
        try {
          d.close();
        } catch {
          /* a dialog mid-animation may refuse; the next state does not depend on it */
        }
      });
      const dock = document.getElementById("readDock");
      if (dock && dock.classList.contains("is-open")) document.getElementById("readToggle")?.click();
      const pin = document.getElementById("ribbonPinButton");
      if (pin && pin.getAttribute("aria-pressed") === "true") pin.click();
      document.querySelector('[data-ribbon-command="view-split-off"]')?.click();
      document.querySelector('[data-ribbon-tab="home"]')?.click();
      window.scrollTo(0, 0);
    });
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(120);
  };

  const getPage = async (theme) => {
    let page = pages.get(theme);
    if (page && !page.isClosed()) return page;
    page = await browser.newPage({ viewport: VIEWPORT });
    page.on("pageerror", (error) => pageErrors.push(`${theme}: ${String(error).slice(0, 160)}`));
    /* Silence table-read speech. This audit opens the read dock to measure it,
     * and `openReadDock()` calls `speakCurrent()` — without this stub the suite
     * speaks the screenplay out loud on the developer's machine. Must be
     * installed before goto() so it beats app.js. */
    await require("./lib/silence-speech.cjs").silenceSpeech(page);
    await page.goto(APP_URL);
    await page.waitForTimeout(1300);
    pages.set(theme, page);
    return page;
  };

  try {
    for (const surface of SURFACES) {
      if (ONLY.length && !ONLY.some((s) => surface.name.includes(s))) continue;
      const page = await getPage(surface.theme);
      let row;
      try {
        await resetPage(page);
        await surface.setup(page);
        await page.waitForTimeout(surface.name.startsWith("dialog:") ? 520 : 620);
        const m = await page.evaluate(MEASURE);
        const defects = judge(surface.name, surface.theme, m, allowedHits);
        row = {
          name: surface.name,
          theme: m.stats.theme,
          requestedTheme: surface.theme,
          measured: m.stats.controls + m.stats.pairs,
          stats: m.stats,
          defects,
        };
      } catch (error) {
        row = {
          name: surface.name,
          theme: surface.theme,
          requestedTheme: surface.theme,
          measured: 0,
          stats: {},
          defects: [],
          error: String(error).slice(0, 300),
        };
      }
      results.push(row);
      if (DUMP) {
        console.log(`\n## ${row.name}  ${JSON.stringify(row.stats)}`);
        if (row.error) console.log(`   ERROR ${row.error}`);
        for (const d of row.defects) {
          console.log(
            `   ${d.observation ? "[obs]" : "FAIL"} ${d.category.padEnd(11)} ${d.selector} | ${d.label} | ${d.metric} | delta ${d.delta}`
          );
        }
      } else if (!JSON_OUT && !SELF_TEST) {
        printSurface(row);
      }
      /* Keep the page deterministic for the next surface. */
      await page.waitForTimeout(80);
    }
  } finally {
    await browser.close();
  }

  return { results, pageErrors, allowedHits };
}

/* ------------------------------------------------------------------ */
/* reporting                                                           */
/* ------------------------------------------------------------------ */

function printSurface(r) {
  const counts = {};
  for (const d of r.defects) counts[d.category] = (counts[d.category] || 0) + 1;
  const keys = [...CATEGORIES, ...OBSERVATIONS].filter((c) => counts[c]);
  console.log(
    `\n== ${r.name}  theme=${r.theme}  measured=${r.measured} ` +
      `(controls ${r.stats.controls ?? 0}, pairs ${r.stats.pairs ?? 0})` +
      (r.stats.dialogs && r.stats.dialogs.length ? `  dialogs=${r.stats.dialogs.join(",")}` : "")
  );
  if (r.error) {
    console.log(`   MEASUREMENT ERROR: ${r.error}`);
    return;
  }
  console.log(`   ${keys.length ? keys.map((c) => `${c}=${counts[c]}`).join(" ") : "clean"}`);
  if (!r.defects.length) return;
  console.log(`   ${"cat".padEnd(12)} ${"selector".padEnd(34)} ${"label".padEnd(24)} ${"delta".padEnd(8)} metric`);
  for (const d of r.defects.slice().sort((a, b) => b.delta - a.delta)) {
    console.log(
      `   ${(d.observation ? "[obs] " : "").padEnd(6)}${d.category.padEnd(12)} ${(d.selector || "").slice(0, 34).padEnd(34)} ` +
        `${(d.label || "").slice(0, 24).padEnd(24)} ${String(d.delta).padEnd(8)} ${d.metric}`
    );
  }
}

function uniqDefects(list) {
  const map = new Map();
  for (const d of list) {
    const key = `${d.category}|${d.selector}|${d.label}`;
    if (!map.has(key)) map.set(key, { ...d, surfaces: new Set([d.surface]), themes: new Set([d.theme]), count: 1 });
    else {
      const hit = map.get(key);
      hit.surfaces.add(d.surface);
      hit.themes.add(d.theme);
      hit.count += 1;
    }
  }
  return [...map.values()].sort((a, b) => b.delta - a.delta);
}

function summarize(results, pageErrors, allowedHits) {
  const all = results.flatMap((r) => r.defects);
  const failing = all.filter((d) => !d.observation);
  const observations = all.filter((d) => d.observation);
  const byCat = {};
  for (const c of CATEGORIES) byCat[c] = failing.filter((d) => d.category === c);

  console.log("\n================================================================================");
  console.log("SUMMARY");
  console.log("================================================================================");
  console.log(`surfaces measured: ${results.length}`);
  const totalMeasured = results.reduce((a, r) => a + (r.measured || 0), 0);
  const totalControls = results.reduce((a, r) => a + (r.stats.controls || 0), 0);
  const totalPairs = results.reduce((a, r) => a + (r.stats.pairs || 0), 0);
  const totalInks = results.reduce((a, r) => a + (r.stats.inks || 0), 0);
  const totalClips = results.reduce((a, r) => a + (r.stats.clips || 0), 0);
  console.log(
    `measured elements: ${totalMeasured}  (controls ${totalControls}, icon+label pairs ${totalPairs}, ` +
      `drawn glyphs ${totalInks}, clip candidates ${totalClips})`
  );
  console.log("");
  console.log(`${"category".padEnd(12)}${"instances".padEnd(11)}${"unique".padEnd(8)}${"surfaces".padEnd(9)}worst delta`);
  for (const c of CATEGORIES) {
    const u = uniqDefects(byCat[c]);
    const worst = u.length ? Math.max(...u.map((d) => d.delta)) : 0;
    console.log(
      `${c.padEnd(12)}${String(byCat[c].length).padEnd(11)}${String(u.length).padEnd(8)}` +
        `${String(new Set(byCat[c].map((d) => d.surface)).size).padEnd(9)}${worst.toFixed(2)}`
    );
  }
  const obsByCat = {};
  for (const d of observations) obsByCat[d.category] = (obsByCat[d.category] || 0) + 1;
  console.log(
    `\n(observations, not failures: ${
      Object.entries(obsByCat)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ") || "none"
    })`
  );

  const uniq = uniqDefects(failing);
  console.log(`\nTOP OFFENDERS (${Math.min(20, uniq.length)} of ${uniq.length} distinct defects, ordered by delta)`);
  console.log(`${"#".padEnd(3)}${"category".padEnd(12)}${"surface".padEnd(26)}${"selector".padEnd(30)}${"delta".padEnd(8)}metric`);
  uniq.slice(0, 20).forEach((d, i) => {
    console.log(
      `${String(i + 1).padEnd(3)}${d.category.padEnd(12)}${d.surface.slice(0, 25).padEnd(26)}` +
        `${(d.selector || "").slice(0, 29).padEnd(30)}${d.delta.toFixed(2).padEnd(8)}` +
        `${d.metric.slice(0, 84)}${d.count > 1 ? ` [${d.count}x]` : ""}`
    );
  });

  /* ---- allowlist rot ---- */
  const rot = [...allowedHits.entries()].filter(([, hit]) => !hit).map(([key]) => key);
  console.log("");
  if (rot.length) {
    console.log(`ALLOWLIST ROT: FAIL — ${rot.length} entry(ies) matched nothing this run:`);
    for (const key of rot) console.log(`  ! ${key} (${ALLOWED[key].cat}) — ${ALLOWED[key].reason}`);
    console.log("  An allowlist entry that no longer matches is dead weight hiding a possible defect; remove it.");
  } else {
    console.log(`ALLOWLIST: PASS (${Object.keys(ALLOWED).length} entries, every one matched a measured candidate)`);
  }

  /* ---- vacuous-pass guard ---- */
  const guardFailures = [];
  for (const r of results) {
    if (r.error) guardFailures.push(`${r.name}: measurement threw (${r.error})`);
    else if ((r.measured || 0) < MIN_MEASURED_PER_SURFACE) {
      guardFailures.push(`${r.name}: ${r.measured} measured elements (floor ${MIN_MEASURED_PER_SURFACE}) — VACUOUS SURFACE`);
    }
  }
  if (totalMeasured < MIN_MEASURED_TOTAL) {
    /* A filtered run cannot clear the whole-app floor. Failing it would make --only
     * unusable, and silently lowering the floor would hide a real vacuous run, so the
     * exemption is explicit AND still bounded: a filtered run must clear the per-surface
     * floor times the number of surfaces it actually measured. */
    if (ONLY.length) {
      const implied = MIN_MEASURED_PER_SURFACE * results.length;
      if (totalMeasured < implied) {
        guardFailures.push(
          `filtered run total ${totalMeasured} measured elements (floor ${implied} = ${MIN_MEASURED_PER_SURFACE} x ${results.length} surfaces) — VACUOUS RUN`
        );
      }
    } else {
      guardFailures.push(`run total ${totalMeasured} measured elements (floor ${MIN_MEASURED_TOTAL}) — VACUOUS RUN`);
    }
  }
  if (results.length === 0) guardFailures.push("no surface matched --only, so nothing was measured");
  console.log("");
  if (guardFailures.length) {
    console.log("VACUOUS-PASS GUARD: FAIL");
    for (const f of guardFailures) console.log(`  ! ${f}`);
  } else {
    const floor = ONLY.length ? MIN_MEASURED_PER_SURFACE * results.length : MIN_MEASURED_TOTAL;
    console.log(
      `VACUOUS-PASS GUARD: PASS (every surface >= ${MIN_MEASURED_PER_SURFACE} measured elements; ` +
        `${totalMeasured} >= ${floor} total${ONLY.length ? " — filtered run" : ""})`
    );
  }
  if (pageErrors.length) {
    console.log(`PAGE ERRORS (${pageErrors.length}):`);
    for (const e of pageErrors.slice(0, 8)) console.log(`  ! ${e}`);
  }

  const ok = failing.length === 0 && guardFailures.length === 0 && rot.length === 0;
  console.log("");
  if (ok) {
    console.log(`RESULT: PASS — ${results.length} surfaces, ${totalMeasured} measured elements, no integrity defects.`);
  } else if (failing.length === 0) {
    console.log("RESULT: FAIL — the audit could not prove anything (see the guard/allowlist lines above).");
  } else {
    console.log(
      `RESULT: FAIL — ${failing.length} defect instances (${uniq.length} distinct) across ` +
        `${new Set(failing.map((d) => d.surface)).size} of ${results.length} surfaces.`
    );
  }

  return {
    ok,
    uniq,
    failing,
    observations,
    byCat,
    guardFailures,
    rot,
    totals: { measured: totalMeasured, controls: totalControls, pairs: totalPairs, inks: totalInks, clips: totalClips },
  };
}

/* ------------------------------------------------------------------ */
/* negative controls                                                   */
/* ------------------------------------------------------------------ */
/* Every break is injected in the browser (DOM + inline styles only); app/** is never
 * modified. Each control asserts that the detector fires on a defect it must catch —
 * otherwise a green audit means nothing. */

const FIXTURE = () => {
  const root = document.createElement("div");
  root.id = "fxRoot";
  root.setAttribute(
    "style",
    "position:fixed;left:8px;bottom:8px;z-index:2147483647;width:460px;padding:10px;" +
      "background:#fff;color:#111;border:1px solid #333;font:12px/1.4 sans-serif;display:block"
  );
  root.innerHTML = `
    <div id="fxRad" style="position:relative;width:140px;height:44px;border-radius:14px;background:#eee;overflow:visible">
      <div id="fxRadKid" style="position:absolute;right:0;top:0;width:16px;height:16px;background:#e00"></div>
    </div>
    <div id="fxOverflow" style="width:100px;height:30px;background:#eee;overflow:visible">
      <span id="fxWide" style="display:block;width:180px;height:14px;background:#0a0"></span>
    </div>
    <div id="fxSeam" style="display:inline-flex;height:24px;border-radius:6px;background:#eee;border:1px solid #000">
      <button id="fxSeamA" style="width:40px;height:24px;border:0;padding:0;border-radius:6px 0 0 6px">A</button>
      <button id="fxSeamB" style="width:20px;height:20px;border:0;padding:0;position:relative;left:3px;border-radius:0 6px 6px 0">B</button>
    </div>
    <div id="fxRule" style="display:flex;width:120px;height:24px">
      <span id="fxRuleA" style="width:40px;border-right:2px solid #000"></span>
      <span id="fxRuleB" style="width:40px;border-left:2px solid #000"></span>
    </div>
    <div id="fxDivisorRow" style="display:flex;align-items:center;width:140px;height:30px">
      <span style="width:20px;height:10px"></span>
      <span id="fxSep" class="divider" style="width:1px;height:18px;background:#000;margin:0 2px;position:relative;top:6px"></span>
      <span style="width:20px;height:10px"></span>
    </div>
    <div id="fxHit"><button id="fxHitBtn" style="width:12px;height:12px;padding:0"></button></div>
    <div id="fxFocus"><button id="fxFocusBtn" style="width:48px;height:24px">focus</button></div>
    <style>#fxFocusBtn:focus-visible { outline: none !important; box-shadow: none !important; border-color: transparent !important; background: #f0f0f0 !important; color: #111 !important; filter: none !important; }
      #fxRoot .fxbtn { width: 40px; height: 24px; padding: 0; }
      #fxRoot .fxsvg { display: block; }
      #fxRoot .fxsvg--12 { width: 12px !important; height: 12px !important; }
      #fxRoot .fxsvg--18 { width: 18px !important; height: 18px !important; }
    </style>
    <div id="fxContrast" style="background:#fff;color:#fefefe">nearly invisible</div>
    <div id="fxAlign" style="display:flex;flex-direction:column;gap:4px;width:220px">
      <input id="fxA1" style="width:120px;height:22px;margin:0">
      <input id="fxA2" style="width:120px;height:22px;margin:0 0 0 6px">
      <input id="fxA3" style="width:120px;height:22px;margin:0">
    </div>
    <div id="fxDrift" style="display:flex;gap:6px;align-items:center;width:220px;height:28px">
      <button id="fxD1" class="fxbtn"><svg class="fxsvg fxsvg--12" width="12" height="12" aria-hidden="true"><use href="#i-plus"></use></svg></button>
      <button id="fxD2" class="fxbtn"><svg class="fxsvg fxsvg--18" width="18" height="18" aria-hidden="true"><use href="#i-plus"></use></svg></button>
    </div>
    <div id="fxClip" style="width:90px;height:12px;overflow:hidden;white-space:nowrap">Clamped fine text</div>
    <button id="fxRow" style="display:flex;align-items:center;gap:6px;height:24px;padding:0 4px">
      <svg width="14" height="14" style="position:relative;top:3px" aria-hidden="true"><use href="#i-plus"></use></svg><span>Label</span>
    </button>
    <button id="fxStack" style="display:flex;flex-direction:column;align-items:center;width:60px;height:42px;padding:0">
      <svg width="12" height="12" style="position:relative;left:3px" aria-hidden="true"><use href="#i-plus"></use></svg><span>Lbl</span>
    </button>
    <div id="fxBaseline" style="display:flex;align-items:baseline;gap:4px;height:24px">
      <svg width="12" height="12" aria-hidden="true"><use href="#i-plus"></use></svg><span>Base</span>
    </div>
    <span id="fxInline"><svg width="12" height="12" style="display:inline" aria-hidden="true"><use href="#i-plus"></use></svg> inline text</span>
    <button id="fxInk" style="width:26px;height:26px;padding:0">
      <svg width="24" height="24" aria-hidden="true" style="display:block"><use href="#i-plus" style="transform: translateY(4px); transform-box: fill-box"></use></svg>
    </button>
    <!-- OVERLAP: two absolutely-positioned painted siblings intersecting by 10px on both axes. -->
    <div id="fxOverlapHost" style="position:relative;width:200px;height:60px">
      <div id="fxOvA" style="position:absolute;left:0;top:0;width:60px;height:40px;background:#0a0"></div>
      <div id="fxOvB" style="position:absolute;left:50px;top:30px;width:60px;height:40px;background:#00a"></div>
    </div>
    <!-- COVER: #fxCoverText sits inside a valid box but a later painted sibling covers it. -->
    <div id="fxCoverHost" style="position:relative;width:200px;height:40px">
      <div id="fxCoverText" style="position:absolute;left:4px;top:6px;width:180px;height:18px;color:#111;background:#fff">covered legend text</div>
      <div id="fxCoverSlab" style="position:absolute;left:0;top:0;width:200px;height:40px;background:#eee;color:#eee"></div>
    </div>
  `;
  document.body.appendChild(root);
  return root.childElementCount;
};

async function selfTest() {
  const { chromium } = require(PLAYWRIGHT);
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const results = [];
  const push = (control, expect, pass, detail) => results.push({ control, expect, pass, detail });
  const freshPage = async () => {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.goto(APP_URL);
    await page.waitForTimeout(1300);
    await page.evaluate(() => document.getElementById("startCenter")?.close());
    await page.waitForTimeout(220);
    return page;
  };

  try {
    /* 1. fixture: one real instance of every geometric defect class */
    {
      const page = await freshPage();
      await page.evaluate(FIXTURE);
      await page.waitForTimeout(300);
      const m = await page.evaluate(MEASURE);
      const defects = judge("selftest:fixture", "light", m, new Map());
      const find = (cat, needle, must) =>
        defects.find(
          (d) => d.category === cat && (d.selector.includes(needle) || (d.label || "").includes(needle)) && (!must || `${d.metric} ${d.label}`.includes(must))
        );
      /* [category, selector needle, why, must-contain] — `must` pins the measured NUMBER, so a
       * control cannot pass by firing with a fabricated value. */
      const checks = [
        ["CLIP", "fxClip", "clipped glyph in a fixed-height overflow:hidden box", null],
        ["VCENTER", "fxRow", "icon pushed 3px below its label's line centre", "3.4"],
        ["HCENTER", "fxStack", "icon pushed 3px off the label axis in a column", "3.0"],
        ["BASELINE", "fxBaseline", "flex row with align-items:baseline holding an svg", null],
        ["BASELINE", "fxInline", "display:inline svg inside a non-flex parent", null],
        ["INK", "fxInk", "glyph translated 4 units off its 24-unit viewBox centre", "4"],
        ["OVERFLOW", "fxOverflow", "in-flow child painted 80px outside its parent", "right 80"],
        ["SEAM", "fxSeam", "fused halves 3px apart and 4px different in height", "3px gap"],
        ["HIT-AREA", "fxHitBtn", "12x12 control whose reachable target is also 12x12", "12x12"],
        ["SIZE-DRIFT", "fxDrift", "same role rendering a 12px and an 18px icon in one row", "12x12 vs 18x18"],
        ["RADIUS", "fxRadKid", "square painted child in a 14px-rounded parent's corner", null],
        ["ALIGN-X", "fxA2", "input pulled 6px off its siblings' left edge", "6.00px"],
        ["RULE", "fxRuleA", "two touching siblings each painting a facing border", null],
        ["RULE", "fxSep", "1px separator sitting 6px below its row's centre", "6px off"],
        ["FOCUS", "fxFocusBtn", "focusable button whose :focus-visible paints nothing", null],
        ["CONTRAST", "fxContrast", "text colour #fefefe on a #fff background", null],
        ["OVERLAP", "fxOvA", "two painted absolute siblings intersecting by 10x10px", "10x10"],
        ["COVER", "fxCoverText", "text inside a valid box painted over by a later sibling", "covered legend text"],
      ];
      for (const [cat, needle, why, must] of checks) {
        const hit = find(cat, needle, must);
        push(
          `fixture: ${why}`,
          `${cat} must fire on #${needle}${must ? ` with the measured value containing "${must}"` : ""}`,
          !!hit,
          hit
            ? `${cat} fired: ${hit.selector} ${hit.metric.slice(0, 120)}`
            : `${cat} did NOT fire for ${needle}${must ? ` (wanted "${must}")` : ""}`
        );
      }
      if (VERBOSE) {
        console.log(`fixture measured: ${JSON.stringify(m.stats)}`);
        for (const d of defects) console.log(`  ${d.observation ? "[obs]" : "FAIL"} ${d.category.padEnd(11)} ${d.selector} | ${d.metric}`);
      }
      await page.close();
    }

    /* 2. real app: push every icon 3px down -> VCENTER must fire on shipped controls */
    {
      const page = await freshPage();
      const before = judge("selftest:vcenter-before", "light", await page.evaluate(MEASURE), new Map()).filter(
        (d) => d.category === "VCENTER"
      );
      await page.addStyleTag({ content: "svg { position: relative; top: 3px; }" });
      await page.waitForTimeout(250);
      const after = judge("selftest:vcenter-after", "light", await page.evaluate(MEASURE), new Map()).filter(
        (d) => d.category === "VCENTER"
      );
      const fresh = after.filter((d) => !before.some((b) => b.selector === d.selector));
      push(
        "app: icons 3px low",
        "VCENTER must fire on the app's own icon+label controls",
        fresh.length > 0,
        `VCENTER before=${before.length} after=${after.length} new=${fresh.length} first=${fresh[0] ? `${fresh[0].selector} ${fresh[0].delta}px` : "none"}`
      );
      await page.close();
    }

    /* 3. real app: force a ribbon label into a short clipped box -> CLIP must fire */
    {
      const page = await freshPage();
      await page.evaluate(() => document.querySelector('[data-ribbon-tab="document"]')?.click());
      await page.waitForTimeout(300);
      const before = judge("selftest:clip-before", "light", await page.evaluate(MEASURE), new Map()).filter(
        (d) => d.category === "CLIP"
      );
      await page.addStyleTag({
        content: "#ribbonDeck .rb-btn--large .rb-btn__label { max-height: 13px !important; -webkit-line-clamp: 1 !important; }",
      });
      await page.waitForTimeout(250);
      const after = judge("selftest:clip-after", "light", await page.evaluate(MEASURE), new Map()).filter(
        (d) => d.category === "CLIP"
      );
      const fresh = after.filter((d) => !before.some((b) => b.selector === d.selector && b.metric === d.metric));
      push(
        "app: clamp ribbon labels to 13px",
        "CLIP must fire where a label's glyph ink is cut",
        fresh.length > 0,
        `CLIP before=${before.length} after=${after.length} new=${fresh.length} first=${fresh[0] ? `${fresh[0].selector} ${fresh[0].metric.slice(0, 90)}` : "none"}`
      );
      await page.close();
    }

    /* 5. REAL APP: reproduce the `align-items: start` report-grid regression.
     *
     * This is the canonical OVERLAP defect — the one that motivated the class. Restoring the
     * bad rule makes a `.report-card` grow past its 170px row track and paint over the card
     * beneath it (measured 41.33px). A fixture alone would only prove the detector can add
     * rectangles; this proves it fires on the real shipped layout, and it is the exact
     * regression a future edit could reintroduce. app/** is never modified: the rule is
     * injected as a stylesheet. */
    {
      const page = await freshPage();
      await page.evaluate(() => document.querySelector('.rail__item[data-view="reports"]')?.click());
      await page.waitForTimeout(700);
      const before = judge("selftest:overlap-before", "light", await page.evaluate(MEASURE), new Map()).filter(
        (d) => d.category === "OVERLAP"
      );
      await page.addStyleTag({ content: ".report-grid { align-items: start !important; grid-auto-rows: minmax(170px, auto) !important; }" });
      await page.waitForTimeout(600);
      const after = judge("selftest:overlap-after", "light", await page.evaluate(MEASURE), new Map()).filter(
        (d) => d.category === "OVERLAP"
      );
      const fresh = after.filter((d) => !before.some((b) => b.selector === d.selector && b.label === d.label));
      const cardHit = fresh.find((d) => /report-card/.test(`${d.selector} ${d.label}`));
      push(
        "app: report-grid align-items:start regression",
        "OVERLAP must fire where one .report-card paints over another",
        fresh.length > 0 && !!cardHit,
        `OVERLAP before=${before.length} after=${after.length} new=${fresh.length} first=${cardHit ? `${cardHit.selector} over ${cardHit.label} ${cardHit.delta.toFixed(2)}px` : "none"}`
      );
      await page.close();
    }

    /* 6. REAL APP: the inspector's scrolled-out geometry rows must NOT be reported.
     *
     * The clip-aware bounds exist because the first OVERLAP version flagged
     * `.geometry-item` against `footer.statusbar` by comparing raw rects: the rows sit at
     * `top 815-867` inside an `overflow-y: auto` body that ends at 859, so they are simply
     * below the fold. This control asserts the fix: while the reports view is open (which is
     * where the real collision above lives, so OVERLAP is otherwise firing), the geometry
     * rows must never appear in the OVERLAP output. */
    {
      const page = await freshPage();
      /* Open the reports view so the genuine card collision IS present: the assertion is that
       * the geometry rows are absent from the same output, not that the output is empty. */
      await page.evaluate(() => document.querySelector('.rail__item[data-view="reports"]')?.click());
      await page.waitForTimeout(600);
      await page.addStyleTag({ content: ".report-grid { align-items: start !important; grid-auto-rows: minmax(170px, auto) !important; }" });
      await page.waitForTimeout(500);
      const overlaps = judge("selftest:overlap-clip", "light", await page.evaluate(MEASURE), new Map()).filter(
        (d) => d.category === "OVERLAP"
      );
      const geometryHits = overlaps.filter((d) => /geometry-item|geometry-grid/.test(`${d.selector} ${d.label}`));
      push(
        "app: scrolled-out inspector rows are not overlaps",
        "OVERLAP must NOT fire on clipped-below-the-fold .geometry-item boxes",
        geometryHits.length === 0,
        `OVERLAP total=${overlaps.length} geometry-item hits=${geometryHits.length}` +
          (geometryHits[0] ? ` first=${geometryHits[0].selector} over ${geometryHits[0].label}` : "")
      );
      await page.close();
    }

    /* 7. REAL APP: the genuine COVER case — a card's `.legend` hidden behind its sibling.
     *
     * Reproducing the bad grid rule again pushes the legend out of its card and under the
     * next card, which is exactly the "text in the DOM but invisible" failure the user
     * reported. This proves COVER fires on real shipped structure, not only on a fixture. */
    {
      const page = await freshPage();
      await page.evaluate(() => document.querySelector('.rail__item[data-view="reports"]')?.click());
      await page.waitForTimeout(700);
      const before = judge("selftest:cover-before", "light", await page.evaluate(MEASURE), new Map()).filter(
        (d) => d.category === "COVER"
      );
      await page.addStyleTag({ content: ".report-grid { align-items: start !important; grid-auto-rows: minmax(170px, auto) !important; }" });
      await page.waitForTimeout(600);
      const after = judge("selftest:cover-after", "light", await page.evaluate(MEASURE), new Map()).filter(
        (d) => d.category === "COVER"
      );
      const fresh = after.filter((d) => !before.some((b) => b.selector === d.selector && b.label === d.label));
      const legendHit = fresh.find((d) => /legend|Dialogue|Action/i.test(`${d.label} ${d.metric}`));
      push(
        "app: legend covered by the next report card",
        "COVER must fire where a .legend's text is painted over by a sibling card",
        fresh.length > 0 && !!legendHit,
        `COVER before=${before.length} after=${after.length} new=${fresh.length} first=${legendHit ? `${legendHit.selector} "${legendHit.label}" ${legendHit.metric.slice(0, 80)}` : "none"}`
      );
      await page.close();
    }

    /* 4. strip every control -> the vacuous guard must fail the surface */    {
      const page = await freshPage();
      await page.evaluate(() => {
        document.querySelectorAll("button, a[href], input, select, textarea, [role=button]").forEach((el) => el.remove());
      });
      const m = await page.evaluate(MEASURE);
      const measured = m.stats.controls + m.stats.pairs;
      push(
        "app: strip all controls",
        `vacuous guard must fail a surface with < ${MIN_MEASURED_PER_SURFACE} measured elements`,
        measured < MIN_MEASURED_PER_SURFACE,
        `measured=${measured} floor=${MIN_MEASURED_PER_SURFACE}`
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log("NEGATIVE CONTROLS (proof that each detector can fail a real defect)");
  console.log("--------------------------------------------------------------------------------");
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.control}`);
    console.log(`      expect: ${r.expect}`);
    console.log(`      detail: ${r.detail}`);
  }
  const failed = results.filter((r) => !r.pass);
  console.log("--------------------------------------------------------------------------------");
  console.log(
    failed.length
      ? `SELF-TEST: FAIL — ${failed.length}/${results.length} controls did not fire: ${failed.map((f) => f.control).join("; ")}`
      : `SELF-TEST: PASS — all ${results.length} injected defects were detected.`
  );
  return failed.length ? 1 : 0;
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
  if (ONLY.length) console.log(`--only: ${ONLY.join(", ")}`);

  const { results, pageErrors, allowedHits } = await sweep();
  const summary = summarize(results, pageErrors, allowedHits);

  if (JSON_OUT) {
    fs.mkdirSync(path.dirname(JSON_FILE), { recursive: true });
    const payload = {
      generatedAt: new Date().toISOString(),
      app: APP_URL,
      viewport: VIEWPORT,
      thresholds: {
        TOL,
        INK_TOL_UNITS,
        INK_CLIP_TOL,
        HIT_MIN,
        MIN_MEASURED_PER_SURFACE,
        MIN_MEASURED_TOTAL,
      },
      totals: summary.totals,
      vacuousGuard: {
        perSurface: MIN_MEASURED_PER_SURFACE,
        total: MIN_MEASURED_TOTAL,
        failures: summary.guardFailures,
      },
      allowlist: Object.fromEntries(
        Object.entries(ALLOWED).map(([key, entry]) => [key, { ...entry, matched: !!allowedHits.get(key) }])
      ),
      allowlistRot: summary.rot,
      categories: Object.fromEntries(
        Object.entries(summary.byCat).map(([k, list]) => [
          k,
          {
            instances: list.length,
            unique: uniqDefects(list).length,
            surfaces: [...new Set(list.map((d) => d.surface))],
            worstDelta: list.length ? Math.max(...list.map((d) => d.delta)) : 0,
          },
        ])
      ),
      observations: summary.observations.length,
      topOffenders: summary.uniq.slice(0, 20).map((d) => ({
        category: d.category,
        surface: d.surface,
        theme: d.theme,
        selector: d.selector,
        label: d.label,
        delta: d.delta,
        metric: d.metric,
        instances: d.count,
        surfaces: [...d.surfaces],
      })),
      defects: summary.uniq.map((d) => ({
        category: d.category,
        selector: d.selector,
        label: d.label,
        delta: d.delta,
        metric: d.metric,
        instances: d.count,
        surfaces: [...d.surfaces],
        themes: [...d.themes],
        sample: { surface: d.surface, theme: d.theme },
      })),
      surfaces: results.map((r) => ({
        name: r.name,
        theme: r.theme,
        requestedTheme: r.requestedTheme,
        measured: r.measured,
        stats: r.stats,
        error: r.error || null,
        defects: r.defects,
      })),
      pageErrors,
    };
    fs.writeFileSync(JSON_FILE, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`\nJSON written to ${path.relative(ROOT, JSON_FILE)}`);
  }

  process.exitCode = summary.ok ? 0 : 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
