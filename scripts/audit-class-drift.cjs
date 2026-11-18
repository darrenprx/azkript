/* Find classes the renderer emits that no stylesheet styles — and CSS that no markup uses.
 *
 * Why this exists. The Scene View shipped looking unfinished: plain grey browser
 * default <input> boxes and grey <button> pills on a dark app background. The cause was
 * not a missing rule but a RENAME: the stylesheet still described an older markup shape
 * (.sv-num, .sv-color-dot, .sv-heading, .sv-title-input) while renderSceneView() emitted
 * (.sv-cell--num, .sv-color-bar, .sv-cell--heading, .sv-inline-input). Every selector
 * missed, so the elements fell back to user-agent defaults, which is exactly what
 * "uses a different style other than rest of the app" looks like.
 *
 * A selector that matches nothing is invisible to review, to unit tests, and to the
 * palette audit — the element still exists, it is just unstyled. So this sweeps the
 * class names the JS actually writes against the class names the CSS actually defines.
 *
 * Usage: node scripts/audit-class-drift.cjs [--strict] [--json]
 *   --strict   also fail on CSS classes that no markup references
 *   --json     machine-readable output
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const STRICT = process.argv.includes("--strict");
const JSON_OUT = process.argv.includes("--json");

const CSS_FILES = ["app/styles.css", "app/styles-desktop.css", "app/styles-ribbon.css"];
const RENDERER = "app/js/renderer";
const JS_FILES = ["app/js/model.js", "app/js/fdx.js", "app/js/pagination.js",
  ...fs.readdirSync(path.join(root, RENDERER)).filter(file => file.endsWith(".js")).map(file => `${RENDERER}/${file}`)];

/* Class names that are deliberately unmatched, each needing a reason. Keeping this
 * short and honest is the point: it is the list a reviewer must be able to defend.
 *
 * A wrapper <div> with no rule of its own is NORMAL, not a defect — it inherits layout
 * from its parent and its children carry the styling. What is a defect is a LEAF that
 * paints with user-agent defaults: an <input>, <button>, <select>, or a text-bearing
 * element whose look the app is responsible for. ALLOWED_WRAPPERS below records the
 * wrappers so the audit does not cry wolf on them, and the audit still fails on any
 * leaf it cannot explain. */
const ALLOWED_WRAPPERS = new Map([
  ["button-row", "layout wrapper; its .pill-btn children are styled"],
  ["custom-report-body", "container the report renderer fills with styled children"],
  ["editor-meta__left", "flex wrapper in the editor meta row"],
  ["sprint-widget__actions", "flex wrapper for the sprint buttons"],
  ["view-head__tools", "flex wrapper for the view header's controls"],
  ["revision-mini", "parent of .revision-mini__row, which carries the styling"],
  ["start-panel--recent", "modifier on .start-panel; the base class is styled"],
  ["start-panel--templates", "modifier on .start-panel; the base class is styled"],
  ["rail-toggle", "extra hook on a .icon-btn; the icon-btn rule styles it"],
  ["pub-dual", "modifier on .dual-block, which carries the grid styling"],
  // State flags, styled through compound selectors on a parent.
  ["is-busy", "state flag; styled via a compound selector"],
  ["is-ready", "state flag; styled via a compound selector"],
  ["is-printing", "state flag; styled via a compound selector"],
  ["is-page-mode", "state flag; styled via a compound selector"],
  ["page-mode", "body state flag; `.page-mode .paper` and siblings carry the styles"],
  ["tags-mode", "state flag on the editor; styled via a compound selector"],
  ["theme-dark", "theme marker; --* tokens do the work"],
  ["theme-midnight", "theme marker; --* tokens do the work"],
  // Prefix fragments left by template-literal stripping.
  ["toast--", "template prefix fragment (toast--${kind}); composed name is styled"],
  ["type-", "template prefix fragment (type-${value}); composed name is styled"],
]);

/* Dataset keys: the extractor matches `data-sv-title` etc. as if they were classes. */
const DATASET_KEYS = new Set([
  "sv-title",
  "sv-synopsis",
  "sv-scene",
  "sv-jump",
  "sv-move",
  "sv-edit",
  "sv-id",
  "sv-col",
]);

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

/** Class names appearing in JS template literals: class="a b" and classList calls. */
function jsClasses(source) {
  const found = new Set();
  /* Only accept a `class="..."` whose value looks like a class LIST. The naive
   * version of this also picked up JSON payloads and attribute strings that merely
   * contain the word `class` (e.g. `{ className: "key" }`), which produced a page of
   * false "unstyled class" failures the first time this script ran. A class list is
   * space-separated lowercase tokens, optionally with a __element / --modifier part,
   * and may contain template expressions that are stripped below. */
  for (const m of source.matchAll(/class(?:Name)?\s*=\s*[`"']([^`"']*)[`"']/g)) {
    const raw = m[1];
    // A value with quotes, braces, colons or commas is data, not a class list.
    if (/[{};:,()[\]]/.test(raw.replace(/\$\{[^}]*\}/g, ""))) continue;
    for (const token of raw.replace(/\$\{[^}]*\}/g, " ").split(/\s+/)) {
      /* Any lowercase token is a candidate. The data-looking values that caused the
       * earlier false positives (JSON keys, attribute names) are already excluded by
       * the punctuation check above, so this can stay permissive enough to accept BEM
       * names like `app-mark__glyph--small` (hyphen BEFORE the `__`, which a stricter
       * pattern rejected). */
      if (/^[a-z][a-z0-9_-]*$/.test(token)) found.add(token);
    }
  }
  for (const m of source.matchAll(/classList\.(?:add|remove|toggle)\(\s*["'`]([a-z][a-z0-9_-]*)/g)) {
    found.add(m[1]);
  }
  return found;
}

/** Class names the CSS defines. Handles comma groups and escapes. */
function cssClasses(source) {
  const found = new Set();
  for (const m of source.matchAll(/\.(-?[a-zA-Z_][a-zA-Z0-9_-]*)/g)) {
    found.add(m[1]);
  }
  return found;
}

const jsSource = JS_FILES.map(read).join("\n");
const cssSource = CSS_FILES.map(read).join("\n");
const html = read("app/index.html");

const inJs = jsClasses(jsSource);
const inHtml = jsClasses(html);
const inMarkup = new Set([...inJs, ...inHtml]);
const inCss = cssClasses(cssSource);

const unstyled = [...inMarkup].filter((c) => !inCss.has(c)).sort();
const unused = [...inCss]
  .filter((c) => !inMarkup.has(c))
  // selectors that only exist as hooks for JS state, or third-party/print safety
  .filter((c) => !/^(is-|has-|js-|no-|drag-|drop-|anim-)/.test(c))
  .sort();

const unexplained = unstyled.filter((c) => !ALLOWED_WRAPPERS.has(c) && !DATASET_KEYS.has(c));
const unexplainedUnused = unused.filter((c) => !ALLOWED_WRAPPERS.has(c));

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      {
        unstyled,
        unexplained,
        unusedCount: unused.length,
        unused: unused.slice(0, 200),
        markupClassCount: inMarkup.size,
        cssClassCount: inCss.size,
      },
      null,
      2
    )
  );
} else {
  console.log(`classes in markup: ${inMarkup.size}   classes in CSS: ${inCss.size}\n`);
  console.log(`== classes with NO CSS of their own (${unstyled.length}) ==`);
  for (const c of unstyled) {
    const reason = ALLOWED_WRAPPERS.get(c);
    const dataset = DATASET_KEYS.has(c);
    const status = reason ? "ok  " : dataset ? "data" : "FAIL";
    const note = reason || (dataset ? "dataset key (data-*), not a class" : "   <-- renders with browser defaults");
    console.log(`  ${status} .${c}${reason ? `  — ${reason}` : dataset ? `  — ${note}` : note}`);
  }
  console.log(`\n== CSS classes with no markup (${unused.length}) ==`);
  for (const c of unused.slice(0, 60)) {
    console.log(`  .${c}`);
  }
  if (unused.length > 60) console.log(`  ... and ${unused.length - 60} more`);
}

const failed = unexplained.length > 0 || (STRICT && unexplainedUnused.length > 0);
if (failed) {
  console.error(
    `\nFAIL: ${unexplained.length} class(es) are emitted by the renderer but styled by nothing` +
      (STRICT ? `, and ${unexplainedUnused.length} CSS class(es) match no markup` : "") +
      ".\nAn unstyled element is invisible to review: it renders with user-agent defaults and\n" +
      "looks like a different design system next to the rest of the app.\n" +
      "Either add the rule, rename the class to the one the CSS already defines, or add it to\n" +
      "ALLOWED_UNSTYLED in scripts/audit-class-drift.cjs with a reason."
  );
  process.exitCode = 1;
} else {
  console.log("\nPASS: every class the renderer emits is styled (or documented as a non-class hook).");
}
