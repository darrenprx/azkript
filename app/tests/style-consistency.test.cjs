/* Guard the two defects reported in this session.
 *
 * 1. "This scene view and many other part use different style other than rest of the app"
 *    — the Scene View rendered as plain grey browser inputs because its stylesheet
 *    described an OLDER markup shape (.sv-num, .sv-color-dot, .sv-heading,
 *    .sv-title-input, .sv-head) while the renderer emitted .sv-cell--num, .sv-color-bar,
 *    .sv-cell--heading, .sv-inline-input, .sv-row--head. Every selector missed, so the
 *    elements fell back to user-agent defaults. A missing style is invisible to review:
 *    the elements exist, they just look like a different product.
 *
 * 2. "Each time I clicked on view change it refreshes the page twice" — two competing
 *    entrance animations. `styles.css` animated `.view.is-active` with `viewIn` while
 *    `styles-desktop.css` animated `.view.is-entering` with `viewEnter`; setView() adds
 *    both classes and removes `is-entering` after 360ms, which STARTED the `viewIn`
 *    animation at that point. One click played the entrance twice, ~350ms apart.
 *
 * These are static checks, so they run in the normal unit suite without a browser. The
 * behavioural versions live in scripts/audit-class-drift.cjs,
 * scripts/audit-control-styling.cjs and scripts/probe-view-transition.cjs.
 *
 * Run: node --test app/tests/style-consistency.test.cjs
 */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..", "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const CSS_FILES = ["app/styles.css", "app/styles-desktop.css", "app/styles-ribbon.css"];
const rendererPath = "app/js/renderer";
const js = fs.readdirSync(path.join(root, rendererPath)).filter(file => file.endsWith(".js"))
  .map(file => read(`${rendererPath}/${file}`)).join("\n");
const html = read("app/index.html");
const css = CSS_FILES.map(read).join("\n");
/* Comments are stripped for the "dead selector" check because this codebase documents
 * its removed classes in prose ("the earlier .sv-color-dot rule matched nothing"). A
 * selector search that cannot tell code from commentary reports a fixed defect forever. */
const cssCode = CSS_FILES.map(read)
  .join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, " ");

/** Classes the renderer writes, from class="..." and classList calls. */
function markupClasses(source) {
  const found = new Set();
  for (const m of source.matchAll(/class(?:Name)?\s*=\s*[`"']([^`"']*)[`"']/g)) {
    const raw = m[1];
    if (/[{};:,()[\]]/.test(raw.replace(/\$\{[^}]*\}/g, ""))) continue;
    for (const token of raw.replace(/\$\{[^}]*\}/g, " ").split(/\s+/)) {
      if (/^[a-z][a-z0-9_-]*$/.test(token)) found.add(token);
    }
  }
  for (const m of source.matchAll(/classList\.(?:add|remove|toggle)\(\s*["'`]([a-z][a-z0-9_-]*)/g)) {
    found.add(m[1]);
  }
  return found;
}

const inCss = new Set([...css.matchAll(/\.(-?[a-zA-Z_][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));

/* Classes that may legitimately have no rule of their own. Each entry is a promise the
 * reviewer can check: a wrapper inherits from its parent, a state flag is only meaningful
 * in a compound selector, and so on. Keep this list short and defensible. */
const ALLOWED = new Map([
  ["button-row", "layout wrapper; children carry the styling"],
  ["custom-report-body", "container filled with styled children at runtime"],
  ["editor-meta__left", "flex wrapper"],
  ["sprint-widget__actions", "flex wrapper"],
  ["view-head__tools", "flex wrapper"],
  ["revision-mini", "parent of .revision-mini__row, which is styled"],
  ["start-panel--recent", "modifier on the styled .start-panel"],
  ["start-panel--templates", "modifier on the styled .start-panel"],
  ["rail-toggle", "extra hook on a .icon-btn"],
  ["pub-dual", "modifier on the styled .dual-block"],
  ["is-busy", "state flag, styled via a compound selector"],
  ["is-ready", "state flag, styled via a compound selector"],
  ["is-printing", "state flag, styled via a compound selector"],
  ["is-page-mode", "state flag, styled via a compound selector"],
  ["page-mode", "body state flag; `.page-mode .paper` carries the styles"],
  ["tags-mode", "state flag, styled via a compound selector"],
  ["theme-dark", "theme marker; custom properties do the work"],
  ["theme-midnight", "theme marker; custom properties do the work"],
  ["toast--", "template prefix fragment"],
  ["type-", "template prefix fragment"],
]);

test("every class the renderer emits has a stylesheet rule (or a documented reason)", () => {
  // Only the classes that appeared in the Scene View defect are required here; the full
  // sweep is scripts/audit-class-drift.cjs, which needs the JS parser to stay in sync.
  const candidates = markupClasses(`${js}\n${html}`);
  const unstyled = [...candidates].filter((c) => !inCss.has(c) && !ALLOWED.has(c)).sort();
  assert.deepEqual(
    unstyled,
    [],
    `these classes are emitted by the renderer but no stylesheet rule matches them, so the ` +
      `elements paint with user-agent defaults (this is exactly how the Scene View rendered ` +
      `as grey browser inputs):\n  ${unstyled.map((c) => `.${c}`).join("\n  ")}\n` +
      "Add the rule, rename to the class the CSS already defines, or document it in ALLOWED."
  );
});

test("the Scene View markup classes all have rules", () => {
  /* The specific regression: the stylesheet kept describing the previous markup. Assert
   * positively that the CURRENT names are styled, so a future rename cannot silently drop
   * the styling again. */
  const REQUIRED = [
    ".sv-row",
    ".sv-row--head",
    ".sv-cell",
    ".sv-cell--num",
    ".sv-cell--heading",
    ".sv-cell--action",
    ".sv-cell--badge",
    ".sv-cell--actions",
    ".sv-color-bar",
    ".sv-jump-btn",
    ".sv-inline-input",
    ".scene-view-card",
  ];
  const missing = REQUIRED.filter((selector) => !new RegExp(`${selector.replace(".", "\\.")}[\\s,{:]`).test(css));
  assert.deepEqual(
    missing,
    [],
    `these Scene View selectors are missing from the stylesheets: ${missing.join(", ")}`
  );

  // And the OLD names must be gone from the CODE, so a stale rule cannot mask a rename.
  // Checked against the comment-stripped sheet, since the comments intentionally name the
  // classes that were removed.
  const DEAD = [".sv-num", ".sv-color-dot", ".sv-heading", ".sv-title-input", ".sv-syn-input", ".sv-head,"];
  const survived = DEAD.filter((selector) => cssCode.includes(selector));
  assert.deepEqual(
    survived,
    [],
    `dead Scene View selectors are still present (they match no markup): ${survived.join(", ")}`
  );
});

test("the Scene View inline editors are styled as app controls, not platform fields", () => {
  const rule = css.match(/\.sv-inline-input\s*\{([^}]*)\}/);
  assert.ok(rule, ".sv-inline-input has no rule, so the inputs render as native Windows fields");
  const body = rule[1];
  assert.match(body, /appearance:\s*none/, ".sv-inline-input must disable the platform appearance");
  assert.match(body, /border:\s*1px solid/, ".sv-inline-input needs a hairline border, not the UA bevel");
  assert.match(body, /border-radius:\s*\d/, ".sv-inline-input needs rounded corners");
  // A transparent resting background is what makes it read as table text rather than a box.
  assert.match(body, /background:\s*transparent/, ".sv-inline-input should be transparent at rest");
});

test("a view has exactly ONE entrance animation", () => {
  /* The double-refresh. `.view.is-active` must not carry an animation, because setView()
   * keeps that class permanently and strips `is-entering`, which would restart any
   * animation keyed on the surviving class. */
  const cssRule = cssCode.match(/\.view\.is-active\s*\{([^}]*)\}/);
  assert.ok(cssRule, "expected a .view.is-active rule (even if it only neutralises animation)");
  const anim = cssRule[1].match(/animation:\s*([^;]+);/);
  assert.ok(anim, ".view.is-active should declare `animation: none` to document the invariant");
  assert.match(
    anim[1].trim(),
    /^none$/,
    `.view.is-active declares "animation: ${anim[1].trim()}". The view entrance must be keyed ` +
      "only on .is-entering (the transient class setView removes), or removing that class " +
      "restarts the other animation and one view change animates in twice."
  );

  /* Count ENTRANCE animations specifically. `viewExit` is declared twice on purpose (once
   * in the base sheet, once as a more specific override in the desktop sheet, both using
   * `!important`), and that is not a defect — the exit never restarts because the panel is
   * hidden immediately after. The invariant that matters is that exactly ONE animation can
   * play when a view BECOMES active. */
  const animationsForView = [...cssCode.matchAll(/\.view[.a-zA-Z_-]*\s*\{[^}]*animation:\s*([a-zA-Z][\w-]*)/g)].map(
    (m) => m[1]
  );
  const entrances = animationsForView.filter((name) => /^view(In|Enter)$/.test(name));
  assert.equal(
    entrances.length,
    1,
    `a view must have exactly one ENTRANCE animation, found ${entrances.length}: ` +
      `${entrances.join(", ")} (all view animations seen: ${animationsForView.join(", ")}). ` +
      "Two entrance animations means one view change animates in twice."
  );
  assert.equal(entrances[0], "viewEnter", `the entrance animation should be viewEnter, found ${entrances[0]}`);
});

test("setView starts the entrance exactly once", () => {
  const setView = read(`${rendererPath}/workspace-layout.js`).match(/function setView\(view\)\s*\{([\s\S]*?)\n  \}\n/);
  assert.ok(setView, "setView() not found in the workspace layout controller");
  const body = setView[1];
  const addEntries = (body.match(/classList\.add\("is-entering"\)/g) || []).length;
  assert.equal(
    addEntries,
    1,
    `setView adds "is-entering" ${addEntries} times; the entrance animation would restart ` +
      `that many times for one view change`
  );
  const timeouts = (body.match(/remove\("is-entering"\)/g) || []).length;
  assert.ok(timeouts >= 1, "setView never removes is-entering, so the entrance class latches");
});

test("the Scene View row grid fits the workspace at the default window width", () => {
  /* The table's min-width is derived from the column template; if someone raises a column
   * minimum without raising min-width, cells clip. Keeping the arithmetic here means the
   * comment in the stylesheet and the test cannot disagree.
   *
   * Note the two separate rules: `.scene-view-table .sv-row { min-width }` comes first, and
   * the bare `.sv-row { display:grid; grid-template-columns; ... }` after it. Searching for
   * the FIRST `.sv-row {` block therefore finds the min-width rule, not the template — the
   * failure mode that made this test report "could not read the grid template". */
  const templateRule = [...cssCode.matchAll(/(?:^|\n)\s*\.sv-row\s*\{([^}]*)\}/g)].find((m) =>
    /grid-template-columns/.test(m[1])
  );
  assert.ok(templateRule, "could not find a .sv-row rule declaring grid-template-columns");
  const template = templateRule[1].match(/grid-template-columns:\s*([\s\S]*?);/);
  assert.ok(template, "could not read the grid-template-columns value");
  /* Tokenise by matching `Npx` or `minmax(Npx, ...)` rather than splitting on spaces:
   * `minmax(140px, 2.4fr)` contains a space, so a plain split reports 12 "columns". */
  const tokens = [...template[1].matchAll(/(?:minmax\(\s*(\d+)px[^)]*\)|(\d+)px)/g)];
  const columns = tokens.map((m) => Number(m[1] ?? m[2]));
  assert.equal(
    columns.length,
    8,
    `expected 8 columns, parsed ${columns.length} from "${template[1].replace(/\s+/g, " ").trim()}"`
  );
  const gap = Number((templateRule[1].match(/gap:\s*(\d+)px/) || [])[1] || 0);
  const paddingSide = Number((templateRule[1].match(/padding:\s*\d+px\s+(\d+)px/) || [])[1] || 0);
  const minimum = columns.reduce((sum, value) => sum + value, 0) + gap * 7 + paddingSide * 2;

  const minWidthMatch = cssCode.match(/\.scene-view-table \.sv-row\s*\{[^}]*min-width:\s*(\d+)px/);
  assert.ok(minWidthMatch, ".scene-view-table .sv-row has no min-width");
  const declared = Number(minWidthMatch[1]);
  assert.ok(
    declared >= minimum,
    `the row grid needs at least ${minimum}px but min-width is ${declared}px, so cells will clip`
  );
  // Available width measured at the default 1440px window with both side panels open.
  const AVAILABLE = 728;
  assert.ok(
    minimum <= AVAILABLE,
    `the eight columns need ${minimum}px, which exceeds the ${AVAILABLE}px available at the ` +
      "default window, so the table would scroll and hide the actions column"
  );
});
