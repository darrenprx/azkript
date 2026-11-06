/* UI type-scale regression guard.
 *
 * Why this exists: the app's chrome had drifted into 40-odd ad-hoc font sizes —
 * 7px, 7.5px, 8px, 8.5px, 9px, 9.5px — because each new component picked a
 * number that looked right in isolation. A CSS audit at the start of this work
 * counted 89 declarations at or below 9.5px, including 34 at exactly 9px and
 * seven at 7px or 7.5px. At 100% Windows scaling that reads as cramped: the
 * statusbar was 9px, ribbon group captions 9px, navigator metadata 9px, and
 * inspector section headings 8.5px, all under the point where Segoe UI's
 * x-height and stem contrast hold up on a standard-DPI panel.
 *
 * The fix was one documented ramp in app/styles.css `:root` (--fs-2xs … --fs-8xl,
 * plus --fs-display for the Start Center hero) and a migration of every chrome
 * declaration onto it. This file is the guard that keeps it from drifting back.
 * It is a static parse of the three stylesheets — no browser needed — so it runs
 * in the plain `node --test` suite.
 *
 * What it asserts:
 *   1. The scale exists and is documented (every token resolves, the floor is
 *      11px, the steps are strictly increasing).
 *   2. No user-facing font-size resolves below 11px. The only exceptions are an
 *      explicit, commented allowlist: the screenplay DOCUMENT body and the
 *      print/preview paper surfaces (pt-based, measured in inches), and purely
 *      decorative marks.
 *   3. Interactive control labels are at least 12px.
 *   4. No chrome declaration is a bare px literal: everything is a scale token,
 *      so a component cannot quietly reintroduce a one-off size.
 *   5. Neighbouring labels in the same row do not use wildly different sizes
 *      (a caption may be smaller than its label, but not by a whole tier).
 *   6. The screenplay document typography is untouched: --script-size is still
 *      12pt and the page geometry variables are still 8.5in x 11in.
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const SHEETS = ["app/styles.css", "app/styles-desktop.css", "app/styles-ribbon.css"];
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

/* ---------------------------------------------------------------- helpers -- */

/** Strip comments, keeping line structure so reported line numbers stay valid. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
}

/**
 * Parse a stylesheet into rules.
 * Returns [{ selector, atrules: [prelude], line, decls: [{ prop, value, line }] }].
 *
 * Newlines are folded to a single space inside the selector buffer: dropping them
 * outright glued a multi-line selector list like
 *   .paper__header,
 *   .paper__footer {
 * into ".paper__header,.paper__footer", which never matched the allowlist
 * (written the normal way, with a space after the comma).
 */
function parseRules(src) {
  const rules = [];
  const stack = [];
  let buf = "";
  let line = 1;
  let bufLine = 1;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "\n") {
      if (buf && !buf.endsWith(" ")) buf += " ";
      line += 1;
      continue;
    }
    if (ch === "{") {
      const prelude = buf.trim().replace(/\s+/g, " ");
      buf = "";
      if (prelude.startsWith("@")) {
        stack.push({ type: "at", prelude });
      } else {
        const rule = {
          selector: prelude,
          atrules: stack.filter((s) => s.type === "at").map((s) => s.prelude),
          line: bufLine,
          decls: [],
        };
        rules.push(rule);
        stack.push({ type: "rule", rule });
      }
      bufLine = line + 1;
      continue;
    }
    if (ch === "}") {
      buf = "";
      stack.pop();
      bufLine = line + 1;
      continue;
    }
    if (ch === ";") {
      const decl = buf.trim();
      buf = "";
      const top = stack[stack.length - 1];
      if (top && top.type === "rule") {
        /* Custom properties contain digits (--fs-2xs), so the property name
         * pattern must allow them; [a-zA-Z] alone silently dropped every scale
         * token and left the ramp looking empty. */
        const m = decl.match(/^(--[-a-zA-Z0-9]+|[-a-zA-Z]+)\s*:\s*([\s\S]*)$/);
        if (m) top.rule.decls.push({ prop: m[1], value: m[2].trim(), line: bufLine });
      }
      bufLine = line;
      continue;
    }
    if (!buf.trim() && !/\s/.test(ch)) bufLine = line;
    buf += ch;
  }
  return rules;
}

/** Split a comma-separated selector list into normalised parts. */
const selectorParts = (selector) =>
  selector
    .split(",")
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean);

/** Read the custom properties declared in the plain `:root` block. */
function readScale() {
  const rules = parseRules(stripComments(read("app/styles.css")));
  const rootRule = rules.find((rule) => rule.selector === ":root");
  assert.ok(rootRule, "app/styles.css must declare a :root block holding the type scale");
  const scale = {};
  for (const decl of rootRule.decls) {
    if (decl.prop.startsWith("--fs-")) scale[decl.prop] = decl.value.trim();
  }
  return scale;
}

/** Resolve a `font-size` value to a px number, or null if it is not px-resolvable. */
function resolvePx(value, scale, depth = 0) {
  const v = String(value).trim();
  if (depth > 4) return null;

  /* var(--token) with nothing else around it. The token's own value may be a
   * clamp (--fs-display is), so resolve it recursively. */
  const bareVar = v.match(/^var\(\s*(--fs-[a-z0-9]+)\s*\)$/i);
  if (bareVar) {
    const resolved = scale[bareVar[1]];
    if (resolved === undefined) return null;
    return resolvePx(resolved, scale, depth + 1);
  }

  /* calc(var(--token) * <number>) — the outline timeline keeps a zoom factor. */
  const calcVar = v.match(/^calc\(\s*var\(\s*(--fs-[a-z0-9]+)\s*\)\s*\*\s*([\d.]+)\s*\)$/i);
  if (calcVar) {
    const resolved = resolvePx(scale[calcVar[1]], scale, depth + 1);
    if (resolved === null) return null;
    return resolved * parseFloat(calcVar[2]);
  }

  /* clamp(a, b, c): the floor of the clamp is the smallest it can render. */
  const clampMatch = v.match(/^clamp\(\s*([^,]+),\s*([^,]+),\s*([^)]+)\s*\)$/i);
  if (clampMatch) return resolvePx(clampMatch[1], scale);

  /* Plain px, and pt converted at the CSS 96dpi ratio (1pt = 4/3 px). */
  const px = v.match(/^(-?[\d.]+)px$/);
  if (px) return parseFloat(px[1]);
  const pt = v.match(/^(-?[\d.]+)pt$/);
  if (pt) return (parseFloat(pt[1]) * 4) / 3;
  return null;
}

/** Every font-size declaration across the three sheets, with its context. */
function collect() {
  const scale = readScale();
  const out = [];
  for (const rel of SHEETS) {
    const rules = parseRules(stripComments(read(rel)));
    for (const rule of rules) {
      for (const decl of rule.decls) {
        if (decl.prop !== "font-size") continue;
        out.push({
          rel,
          selector: rule.selector,
          parts: selectorParts(rule.selector),
          atrules: rule.atrules,
          line: decl.line,
          raw: decl.value,
          px: resolvePx(decl.value, scale),
        });
      }
    }
  }
  return { scale, decls: out };
}

const where = (d) => `${d.rel}:${d.line} (${d.selector}${d.atrules.length ? " @ " + d.atrules.join(" / ") : ""})`;

/* ------------------------------------------------------- documented exceptions */

/* The floor. Functional UI text never goes below this. */
const FLOOR_PX = 11;
/* Interactive control labels never go below this. */
const CONTROL_PX = 12;

/* THE ONLY declarations allowed below the floor. Each entry names the exact
 * selector (and optionally the media condition) plus the reason it is exempt.
 * Adding an entry here is a design decision, not a shortcut: functional text
 * belongs on the scale. */
const BELOW_FLOOR_ALLOWED = [
  /* --- the screenplay document itself: set in points, paginated against the
   * page-fit math, and changed by the user's own font-size setting ---------- */
  { selector: ".paper__header, .paper__footer", reason: "document page header/footer, print scale" },
  { selector: ".paper--flow .paper__header, .paper--flow .paper__footer", reason: "document page header/footer on phone, print scale" },
  { selector: ".para.is-dual::after", reason: "dual-dialogue marker set in document points" },
  { selector: ".split-ref-para", reason: "script text in the split reference pane" },
  { selector: ".page-card__header, .page-card__footer", reason: "page-card header/footer, print scale" },
  { selector: ".page-card__footer", reason: "page-card folio, print scale" },
  { selector: ".scene-number", reason: "page-margin scene number, print scale" },
  { selector: '.screenplay-editor.show-scene-numbers .para.type-scene-heading::after', reason: "page-margin scene number, print scale" },
  { selector: ".title-page__top, .title-page__bottom", reason: "title page, print scale" },
  { selector: ".title-page__bottom", reason: "title page, print scale" },
  { selector: ".title-page__credit, .title-page__author, .title-page__source", reason: "title page, print scale" },
  { selector: ".title-page__source", reason: "title page, print scale" },
  { selector: ".title-page--compact h1", reason: "title page, print scale" },
  { selector: ".title-page--compact .title-page__credit, .title-page--compact .title-page__author, .title-page--compact .title-page__source", reason: "title page, print scale" },
  { selector: ".title-page--compact .title-page__top, .title-page--compact .title-page__bottom", reason: "title page, print scale" },
  { selector: ".title-page h1", reason: "title page, print scale" },
  { selector: ".paper--flow .para", reason: "screenplay body on phone" },
  { selector: ".screenplay-editor", reason: "screenplay body: var(--script-size)" },
  { selector: ".page-card__body.screenplay-editor", reason: "screenplay body: var(--script-size)" },
  { selector: ".pub-more", reason: "document (MORE) marker" },
  /* --- decorative marks that carry no information on their own ------------ */
  { selector: ".paper.has-watermark::before", reason: "rotated paper watermark art" },
  { selector: ".page-card.has-watermark::after", reason: "watermark art on page cards" },
  { selector: ".start-center::before", reason: "decorative Start Center backdrop glyph" },
  { selector: ".editor-meta__right .pill-btn", reason: "font-size:0 hides the label at narrow widths" },
];

/**
 * Elements that ARE a control, so their own label must be >= 12px. Matched
 * against the selector text.
 *
 * A caption INSIDE a control (a shortcut hint, a chip's secondary line, an
 * inline field name) is deliberately NOT in this list: it only has to clear the
 * 11px floor. That distinction is the whole point — the 12px rule is about the
 * words that tell you what a control does, not about every string that happens
 * to live inside one.
 */
const CONTROL_LABEL_MATCHERS = [
  /(^|[\s,>+~])button([\s,:.\[>]|$)/,
  /rb-btn/,
  /\.btn(?:--|[\s,:.{[]|$)/,
  /menubar__item/,
  /rail__item/,
  /inspector-tab/,
  /navigator-tab/,
  /split-pane__tab/,
  /settings-nav__tab/,
  /status-link/,
  /segmented__item/,
  /icon-btn/,
  /pill-btn/,
  /wide-btn/,
  /text-btn/,
  /rb-combo/,
  /layer-chip/,
  /meta-chip/,
  /\.field (input|select|textarea)/,
  /(search-field|find-field|command-search|outline-copy) (input|select|textarea)/,
  /command-item/,
  /menu-flyout__item/,
  /rb-menu__item/,
  /find-option/,
  /element-choice/,
  /theme-swatch/,
  /accent-swatch/,
  /smart-type__item/,
  /recent-item__copy strong/,
  /start-quick__item span/,
  /scene-item__heading/,
  /sv-heading/,
  /location-row/,
  /scene-table(?:[^_]|$)/,
  /sv-row/,
  /focus-exit/,
];

/**
 * Selectors that match a control pattern above but are a CAPTION, not the
 * control's own label. Each needs a reason; the test asserts the reason exists.
 */
const CONTROL_CAPTIONS = [
  { selector: ".status-link kbd", reason: "shortcut key glyph inside the status link, not its label" },
  { selector: ".command-item small", reason: "uppercase shortcut hint beside a command's label" },
  {
    selector: ".sv-row--head",
    reason:
      "table column captions, not a control: the header row is read as a group of labels " +
      "above the data and is deliberately at the metadata size",
  },
  { selector: ".location-row__meta", reason: "secondary count caption inside a report row" },
  { selector: ".smart-type__item small", reason: "shortcut hint beside a smart-type label" },
  { selector: '.rb-combo--element .rb-combo__value::before', reason: 'inline "Element" field caption inside the combo' },
];

const isControlLabel = (selector) => {
  if (!CONTROL_LABEL_MATCHERS.some((re) => re.test(selector))) return false;
  const normalised = selector.replace(/\s+/g, " ").trim();
  /* A caption overrides the control match for exactly that selector. */
  if (CONTROL_CAPTIONS.some((entry) => entry.selector === normalised)) return false;
  return true;
};

/** True when the declaration says the element is not rendered as text. */
function isSuppressed(decl) {
  return decl.px === null || decl.px === 0;
}

/* -------------------------------------------------------------------- tests -- */

test("the type scale is declared, documented and monotonic", () => {
  const scale = readScale();
  const tokens = Object.keys(scale).sort((a, b) => {
    const na = Number(a.match(/-(\d+xs|\d+xl)$/)?.[1] ? 0 : 0);
    return 0;
  });
  assert.ok(scale["--fs-2xs"], "the scale must define --fs-2xs as its floor");
  assert.equal(
    parseFloat(scale["--fs-2xs"]),
    FLOOR_PX,
    `--fs-2xs must be the documented ${FLOOR_PX}px floor (got ${scale["--fs-2xs"]})`,
  );

  /* Every token must be a resolvable px value (or an allowed clamp) ... */
  for (const [token, value] of Object.entries(scale)) {
    const px = resolvePx(value, scale);
    assert.ok(px !== null && Number.isFinite(px), `${token}: "${value}" does not resolve to a px size`);
  }

  /* ... and the numeric ramp must strictly increase, so "one step up" is real. */
  const numeric = ["2xs", "xs", "sm", "md", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl"];
  let previous = 0;
  for (const stop of numeric) {
    const token = `--fs-${stop}`;
    const value = scale[token];
    assert.ok(value !== undefined, `the scale is missing ${token} (the ramp is broken)`);
    const px = parseFloat(value);
    assert.ok(
      px > previous,
      `${token} (${value}) must be larger than the previous step (${previous}px); the ramp must strictly increase`,
    );
    previous = px;
  }

  /* The scale must be documented in place: a bare token list is not enough. */
  const source = read("app/styles.css");
  const rootBlock = source.slice(source.indexOf(":root {"), source.indexOf("--fs-2xs"));
  assert.match(rootBlock, /UI type scale/i, "the scale needs a section comment naming it");
  assert.match(rootBlock, /FLOOR IS \d+px/i, "the scale comment must state the floor");
});

test("no user-facing font-size resolves below the 11px floor", () => {
  const { decls } = collect();
  const exempt = new Set(
    BELOW_FLOOR_ALLOWED.map((entry) => entry.selector.replace(/\s+/g, " ").trim()),
  );
  const violations = [];
  for (const decl of decls) {
    if (isSuppressed(decl)) continue;
    if (decl.px >= FLOOR_PX - 0.001) continue;
    const normalised = decl.selector.replace(/\s+/g, " ").trim();
    if (exempt.has(normalised)) continue;
    violations.push(`${where(decl)} sets font-size: ${decl.raw} (${decl.px}px)`);
  }
  assert.deepEqual(
    violations,
    [],
    "font-size below the 11px floor outside the documented allowlist:\n  " +
      violations.join("\n  ") +
      "\nIf this is genuinely decorative, add it to BELOW_FLOOR_ALLOWED with a reason.",
  );
});

test("every allowlisted exception carries a reason and still exists", () => {
  const { decls } = collect();
  const declared = new Set(decls.map((d) => d.selector.replace(/\s+/g, " ").trim()));
  for (const entry of BELOW_FLOOR_ALLOWED) {
    assert.ok(
      typeof entry.reason === "string" && entry.reason.trim().length > 8,
      `allowlist entry "${entry.selector}" needs a one-line reason`,
    );
    assert.ok(
      declared.has(entry.selector.replace(/\s+/g, " ").trim()),
      `allowlist entry "${entry.selector}" no longer matches any font-size rule — ` +
        "remove it so the allowlist cannot hide a future violation",
    );
  }
});

test("interactive control labels are at least 12px", () => {
  const { decls } = collect();
  const violations = [];
  const seen = new Set();
  for (const decl of decls) {
    if (isSuppressed(decl)) continue;
    if (!decl.parts.some(isControlLabel)) continue;
    /* Deduplicate: a selector may set font-size in several media queries. */
    const key = `${decl.selector}|${decl.raw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (decl.px >= CONTROL_PX - 0.001) continue;
    violations.push(`${where(decl)} sets a control label to ${decl.raw} (${decl.px}px, needs >= ${CONTROL_PX}px)`);
  }
  assert.deepEqual(
    violations,
    [],
    "interactive control labels below 12px:\n  " + violations.join("\n  "),
  );
});

test("every control-caption exemption carries a reason and still exists", () => {
  const { decls } = collect();
  const declared = new Set(decls.map((d) => d.selector.replace(/\s+/g, " ").trim()));
  for (const entry of CONTROL_CAPTIONS) {
    assert.ok(
      typeof entry.reason === "string" && entry.reason.trim().length > 8,
      `control-caption entry "${entry.selector}" needs a one-line reason`,
    );
    assert.ok(
      declared.has(entry.selector.replace(/\s+/g, " ").trim()),
      `control-caption entry "${entry.selector}" no longer matches any font-size rule — remove it ` +
        "so the exemption cannot mask a real control label shrinking",
    );
    /* An exemption is only legitimate while the thing actually matches a control
     * pattern; otherwise it is stale noise. */
    assert.ok(
      CONTROL_LABEL_MATCHERS.some((re) => re.test(entry.selector)),
      `control-caption entry "${entry.selector}" does not match any control pattern; ` +
        "it does not need an exemption",
    );
  }
});

test("chrome font sizes are scale tokens, not bare px literals", () => {
  const { decls, scale } = collect();
  /* Decorative art is exempt: it is a clamp() over a viewport-relative range that
   * no fixed ramp can express, and it carries no information a user reads. */
  const DECORATIVE_ART = new Set([".start-center::before", ".page-card.has-watermark::after"]);
  const literal = [];
  for (const decl of decls) {
    const raw = decl.raw.trim();
    if (decl.px === null || decl.px === 0) continue; // print pt sizes and font-size:0
    if (/pt$/i.test(raw)) continue; // document typography is measured in points
    if (raw.includes("var(--fs-")) continue; // on the scale
    if (DECORATIVE_ART.has(decl.selector.replace(/\s+/g, " ").trim())) continue;
    literal.push(`${where(decl)} still uses a literal ${raw}`);
  }
  assert.deepEqual(
    literal,
    [],
    "chrome font-size declarations must use the scale tokens (var(--fs-*)):\n  " +
      literal.join("\n  ") +
      `\nAvailable: ${Object.keys(scale).join(", ")}`,
  );
});

test("neighbouring labels in the same row do not use wildly different sizes", () => {
  const { decls } = renderPairs();
  const offenders = [];
  for (const pair of decls) {
    const [a, b] = pair.sizes;
    const ratio = Math.max(a, b) / Math.min(a, b);
    if (ratio > 1.6 + 1e-9) {
      offenders.push(
        `${pair.group}: "${pair.a}" is ${a}px and "${pair.b}" is ${b}px (ratio ${ratio.toFixed(2)}); ` +
          "siblings on one row must stay within one tier",
      );
    }
  }
  assert.deepEqual(offenders, [], "row-mate font sizes diverge too far:\n  " + offenders.join("\n  "));
});

/**
 * Known same-row pairs. Each pair is two selectors that render next to each
 * other, so their sizes should read as one tier. Values are pulled from the
 * stylesheets rather than hard-coded, so this fails when either side drifts.
 */
function renderPairs() {
  const { decls } = collect();
  const PAIRS = [
    /* .status-item has no font-size of its own; it inherits .statusbar's, which
     * is how the whole row gets its size. Compare the row's size to the items
     * that override it. */
    { group: "statusbar", a: ".statusbar", b: ".status-link" },
    { group: "statusbar", a: ".statusbar", b: ".status-pill" },
    { group: "navigator row", a: ".scene-item__heading", b: ".scene-item__meta" },
    { group: "navigator head", a: ".panel-head h2", b: ".count-pill" },
    { group: "editor meta chips", a: ".meta-chip", b: ".pill-btn" },
    { group: "inspector form", a: ".field input, .field select", b: ".toggle-row" },
    { group: "inspector tabs", a: ".inspector-tab", b: ".inspector-section h3" },
    { group: "ribbon buttons", a: ".rb-btn--small", b: ".rb-btn--compact" },
    { group: "ribbon tabs", a: ".ribbon-tabs .menubar__item", b: ".ribbon-quick" },
    { group: "menu rows", a: ".rb-menu__item", b: ".rb-menu__shortcut" },
    { group: "command palette", a: ".command-item", b: ".command-item small" },
    { group: "start center", a: ".start-quick__item span", b: ".start-quick__item small" },
    { group: "recent files", a: ".recent-item__copy strong", b: ".recent-item__date" },
  ];
  const result = [];
  for (const pair of PAIRS) {
    const sizeOf = (selector) => {
      const normalised = selector.replace(/\s+/g, " ").trim();
      const hits = decls.filter(
        (d) => d.selector.replace(/\s+/g, " ").trim() === normalised && !isSuppressed(d) && d.atrules.length === 0,
      );
      /* A selector may be declared in more than one sheet; the last one wins in
       * cascade order, which is the load order of the <link> tags. */
      const hit = hits[hits.length - 1];
      return hit ? hit.px : null;
    };
    const a = sizeOf(pair.a);
    const b = sizeOf(pair.b);
    assert.ok(a !== null, `row-pair fixture references "${pair.a}", which has no font-size declaration`);
    assert.ok(b !== null, `row-pair fixture references "${pair.b}", which has no font-size declaration`);
    result.push({ group: pair.group, a: pair.a, b: pair.b, sizes: [a, b] });
  }
  return { decls: result };
}

test("the screenplay document typography is untouched", () => {
  const css = stripComments(read("app/styles.css"));

  /* The screenplay body size must still be 12pt and still be a variable. */
  assert.match(
    css,
    /--script-size:\s*12pt\s*;/,
    "--script-size must stay 12pt; the UI ramp must never move the screenplay body",
  );

  /* Page geometry is the paper, not the UI. If this moves, the page-fit math and
   * the print output move with it. */
  assert.match(css, /--page-w:\s*8\.5in\s*;/, "--page-w must stay 8.5in");
  assert.match(css, /--page-h:\s*11in\s*;/, "--page-h must stay 11in");
  assert.match(css, /--page-top:\s*1in\s*;/, "--page-top must stay 1in");
  assert.match(css, /--page-bottom:\s*1in\s*;/, "--page-bottom must stay 1in");

  /* The editor and the page-card body must both still consume the variable. */
  const { decls } = collect();
  const editor = decls.find((d) => d.selector === ".screenplay-editor" && d.rel === "app/styles.css");
  assert.ok(editor, "app/styles.css must still declare .screenplay-editor's font-size");
  assert.equal(
    editor.raw.replace(/\s+/g, " "),
    "var(--script-size)",
    ".screenplay-editor must still use var(--script-size), not a chrome token",
  );
  const pageBody = decls.find((d) => d.selector === ".page-card__body.screenplay-editor");
  assert.ok(pageBody, "app/styles-desktop.css must still declare the page-card body font-size");
  assert.equal(
    pageBody.raw.replace(/\s+/g, " "),
    "var(--script-size)",
    "the page-card body must still use var(--script-size), not a chrome token",
  );
});

test("the fixed shell rows keep the row heights their content was balanced against", () => {
  /* The rebalance was tuned against these tracks. Growing one silently would
   * re-clip the row's content without any other test noticing. */
  const ribbon = stripComments(read("app/styles-ribbon.css"));
  assert.match(
    ribbon,
    /\.app-shell\s*\{[^}]*grid-template-rows:\s*48px\s+34px\s+104px\s+minmax\(0,\s*1fr\)\s+30px\s*;/,
    "the shell row template must stay 48px titlebar / 34px tabs / 104px ribbon / 1fr / 30px statusbar",
  );

  /* The compact ribbon used on narrow windows is the same five tracks. */
  assert.match(
    ribbon,
    /grid-template-rows:\s*48px\s+34px\s+92px\s+minmax\(0,\s*1fr\)\s+30px\s*;/,
    "the <=880px ribbon track must stay 92px",
  );
});
