#!/usr/bin/env node
/* Regression audit for toolbar-row alignment.
 *
 * The report this answers: "this button also don't align with other on horizontal".
 * The root cause was structural, not cosmetic: `.view-head__tools` had no CSS rule at
 * all, so it stayed `display: block`. Its children are inline-level control boxes
 * (`.pill-btn` inline-flex, `.segmented` inline-flex, `select.pill-select` inline-block)
 * plus one flex block (`.view-head__stat`), so they flowed as inline boxes and wrapped
 * onto ragged baselines: measured at 1440x900 in the Beat Board the container was
 * 327x93 and its five children sat at y=223, 223, 253, 256, 286 - four distinct
 * baseline rows. Control heights also disagreed (30px pills next to a 32px segmented
 * control and a 45px stat block, and a <select> whose text baseline parks it a few
 * pixels below its neighbours).
 *
 * This audit measures geometry, not CSS selectors, so it does not care whether the
 * eventual fix is flex, grid or something else. For every one of the six views, at
 * three viewport widths and in both themes, it records the bounding box of every
 * visible direct child of the two toolbar row containers:
 *
 *   - `.view-head__tools`  (sceneview, navigator, beatboard, characters, reports)
 *   - `.editor-meta__right` (script)
 *
 * and then fails on any of:
 *
 *   RAGGED     children that fit on one line still sit on more than one vertical
 *              centre line (report lists the distinct y-bands), or two children that
 *              visually share a line have centre lines more than 1px apart.
 *   WRAPPING   more than one distinct top coordinate among the row's controls when
 *              the whole row would have fitted on one line.
 *   HEIGHT     sibling controls in the same row whose outer heights differ by more
 *              than 1px. One shared control height is the design intent; "it is a
 *              deliberately compact control" is still a defect in this row. The only
 *              exception is the one below, and it is a read-out, not a control.
 *   NOTHING    a (view, width, theme) slot measured zero children, or fewer than two
 *              children in the expected row. A previous probe in this codebase
 *              reported PASS on zero measurements; that failure mode is fatal here.
 *
 * Usage:
 *   node scripts/audit-toolbar-alignment.cjs                 # full matrix, exit 0 = green
 *   node scripts/audit-toolbar-alignment.cjs --json           # machine-readable result
 *   node scripts/audit-toolbar-alignment.cjs --app=reports/some-copy
 *   node scripts/audit-toolbar-alignment.cjs --views=beatboard,navigator
 *
 * `--app=` points the same measurement logic at a copy of the app; that is how the
 * mutation tests in the task description are run without touching app/**.
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
const VIEW_FILTER = flag("views", "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

/* 1px tolerance, as specified. Sub-pixel layout is rounded once per measurement, so
 * a genuine 1px disagreement is real; anything <= 1px is treated as aligned. */
const TOL = 1;

const VIEWS = ["script", "sceneview", "navigator", "beatboard", "characters", "reports"];
const WIDTHS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
];
const THEMES = ["light", "dark"];

/* The row container each view is required to show. A view that does not show its
 * container fails as "measured nothing" instead of silently passing. */
const EXPECTED_ROW = {
  script: ".editor-meta__right",
  sceneview: ".view-head__tools",
  navigator: ".view-head__tools",
  beatboard: ".view-head__tools",
  characters: ".view-head__tools",
  reports: ".view-head__tools",
};

/* Justified exceptions, kept deliberately short. Entries are selectors matched
 * against a child; they are excluded from the shared-height assertion only. They are
 * still required to share the row's centre line and are still reported in the table.
 *
 * `.view-head__stat` is a read-out (a large count stacked over its caption), not a
 * control. It has no interactive surface, so "one shared control height" does not
 * apply to it; it must merely sit on the row's centre line. */
const ALLOWED = {
  ".view-head__stat": "read-out block (count over caption), not a control: shares the row centre line, deliberately not a 30px control",
};

/* ------------------------------------------------------------------ */
/* in-page measurement                                                */
/* ------------------------------------------------------------------ */

/* Returns raw geometry only; every judgement is made in Node so the assertions are
 * reviewable in one place. */
const READ = () => {
  const isVisible = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (el.closest("[hidden]")) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  };
  const describe = (el) => {
    const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean) : [];
    const text = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ");
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      cls,
      text: text.slice(0, 42),
    };
  };
  /* What counts as a "control" for the shared-height assertion. Wrappers that hold a
   * control (search field, cards-across caption+select) count as controls themselves:
   * the row aligns their outer boxes. */
  const CONTROL = [
    "button",
    "select",
    "input",
    "textarea",
    ".pill-btn",
    ".pill-select",
    ".icon-btn",
    ".segmented",
    ".search-field",
    ".card-across-control",
    ".zoom-control",
  ].join(",");

  const out = [];
  for (const el of document.querySelectorAll(".view-head__tools, .editor-meta__right")) {
    if (!isVisible(el)) continue;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const parent = el.parentElement;
    const parentStyle = getComputedStyle(parent);
    const parentPadL = Number.parseFloat(parentStyle.paddingLeft) || 0;
    const parentPadR = Number.parseFloat(parentStyle.paddingRight) || 0;
    /* The row width the toolbar is entitled to: the parent's content box. The bug
     * itself squeezes the container (327px inside an ample view head), so using the
     * container's own used width as the "would fit" bound would let the defect pass.
     * The parent's content box is the space the row is actually given. */
    const parentContentWidth = parent.clientWidth - parentPadL - parentPadR;
    const columnGap = Number.parseFloat(cs.columnGap);

    const children = [...el.children]
      .filter(isVisible)
      .map((child) => {
        const b = child.getBoundingClientRect();
        const c = getComputedStyle(child);
        return {
          ...describe(child),
          x: b.left,
          y: b.top,
          width: b.width,
          height: b.height,
          midY: (b.top + b.bottom) / 2,
          display: c.display,
          control: child.matches(CONTROL),
          inlineLevel: /^inline/.test(c.display),
        };
      });

    out.push({
      selector: el.matches(".view-head__tools") ? ".view-head__tools" : ".editor-meta__right",
      panel: (el.closest("[data-view-panel]") || { dataset: {} }).dataset.viewPanel || "?",
      display: cs.display,
      flexWrap: cs.flexWrap,
      alignItems: cs.alignItems,
      columnGap: Number.isFinite(columnGap) ? columnGap : 0,
      containerWidth: rect.width,
      containerHeight: rect.height,
      parentContentWidth,
      children,
    });
  }
  return out;
};

/* ------------------------------------------------------------------ */
/* assertions                                                         */
/* ------------------------------------------------------------------ */

const round = (n) => Math.round(n * 10) / 10;
const fmtEl = (c) => {
  const id = c.id ? `#${c.id}` : "";
  const cls = c.cls.length ? `.${c.cls.join(".")}` : "";
  return `<${c.tag}${id}${cls}> "${c.text || "(no text)"}"`;
};

/* Group children into visual lines: two boxes share a line when their vertical
 * overlap exceeds half of the shorter box. A taller centred stat block therefore
 * belongs to the pill row, while a control that wrapped to the next line does not. */
function visualBands(kids) {
  const bands = [];
  for (const kid of [...kids].sort((a, b) => a.y - b.y)) {
    const band = bands[bands.length - 1];
    const kidBottom = kid.y + kid.height;
    if (band) {
      const overlap = Math.min(band.bottom, kidBottom) - Math.max(band.top, kid.y);
      if (overlap > Math.min(band.height, kid.height) / 2) {
        band.kids.push(kid);
        band.top = Math.min(band.top, kid.y);
        band.bottom = Math.max(band.bottom, kidBottom);
        band.height = band.bottom - band.top;
        continue;
      }
    }
    bands.push({ top: kid.y, bottom: kidBottom, height: kid.height, kids: [kid] });
  }
  return bands;
}

function judgeRow(row, ctx) {
  const issues = [];
  const kids = row.children;

  const push = (code, detail, extra = {}) =>
    issues.push({ code, view: ctx.view, width: ctx.width, theme: ctx.theme, row: row.selector, detail, ...extra });

  /* Requirement 4: a row with nothing in it is a failure, not a pass. */
  if (kids.length < 2) {
    push(
      "NOTHING",
      `${row.selector} exposed ${kids.length} measurable child(ren); the audit cannot verify alignment on an empty row`,
    );
    return { issues, fits: null, bands: 0, needed: 0, available: row.parentContentWidth, controls: [] };
  }

  /* Which children can share a line?
   *
   * In a row layout (flex/grid) every child is a flex/grid item and can sit beside its
   * siblings, so all of them participate and their used widths are meaningful.
   *
   * In a block/inline container only the inline-level children can share a line: a
   * block-level child (`.view-head__stat` is `display:flex`, hence block-level) forces
   * a line break and stretches to the container's width. Counting its stretched width
   * as "needed" would make the row claim it cannot fit and let a genuinely ragged
   * toolbar pass — exactly the false pass the pre-fix Characters row produced
   * (359.6px-wide stretched stat -> "does not fit" -> skipped). So block-level
   * children are excluded from the single-line width estimate and instead prove the
   * row is broken by themselves (they always start a new band). */
  const rowLayout = /^(inline-)?(flex|grid)$/.test(row.display);
  const inlineKids = kids.filter((c) => c.inlineLevel);
  const participants = rowLayout ? kids : inlineKids;
  const gap = row.columnGap || 0;
  /* A block container separates inline boxes with word spacing, not a gap. */
  const space = rowLayout ? gap : 4;
  const needed = participants.reduce((sum, c) => sum + c.width, 0) + space * Math.max(0, participants.length - 1);
  const available = row.parentContentWidth;
  const fits = needed <= available + TOL;
  const bands = visualBands(kids);
  const controls = kids.filter((c) => c.control);
  const spanOf = (values) => Math.max(...values) - Math.min(...values);
  const forcedBreak = !rowLayout && kids.length > inlineKids.length;

  /* (a) RAGGED ROWS: when the row's line participants would fit on one line, the
   * children's centre lines must all agree within tolerance. Report the y-bands. */
  if (bands.length > 1 && (fits || forcedBreak)) {
    const bandText = bands
      .map(
        (b) =>
          `y=${round(b.top)}..${round(b.bottom)} mid=${round((b.top + b.bottom) / 2)} ` +
          `[${b.kids.map(fmtEl).join(" | ")}]`,
      )
      .join("  ;  ");
    const centreSpan = spanOf(kids.map((c) => c.midY));
    if (centreSpan > TOL) {
      const why = forcedBreak
        ? `a block-level child (${kids.filter((c) => !c.inlineLevel).map(fmtEl).join(", ")}) forces its own line ` +
          `in a "${row.display}" container instead of joining the row`
        : `the row's line participants need ${round(needed)}px of ${round(available)}px available`;
      push(
        "RAGGED",
        `${kids.length} children occupy ${bands.length} distinct vertical bands (${why}); ` +
          `centre lines span ${round(centreSpan)}px: ${bandText}`,
        { bands: bands.length, needed, available },
      );
    }
  }

  /* (a) RAGGED, per-line form: children sharing a visual line must have centre lines
   * within tolerance. This also catches a row that wraps legitimately at a narrow
   * viewport but still drops one control off the shared centre line. */
  for (const band of bands) {
    const mids = band.kids.map((c) => c.midY);
    const span = spanOf(mids);
    if (span > TOL) {
      push(
        "RAGGED",
        `centre lines ${round(span)}px apart on one visual line (y=${round(band.top)}..${round(band.bottom)}): ` +
          band.kids.map((c) => `${fmtEl(c)} midY=${round(c.midY)}`).join(" | "),
      );
    }
  }

  /* (c) WRAPPING: more than one distinct top coordinate among the controls while the
   * controls would have fitted on one line — the row wrapped although it did not need
   * to. Tops within tolerance are one band, so a 2px-taller neighbour whose centre
   * still matches is reported as HEIGHT, not as wrapping. */
  const rowControls = rowLayout ? controls : controls.filter((c) => c.inlineLevel);
  const controlsFit =
    rowControls.reduce((sum, c) => sum + c.width, 0) + space * Math.max(0, rowControls.length - 1) <=
    available + TOL;
  if (rowControls.length > 1 && (forcedBreak || controlsFit)) {
    const sorted = rowControls.map((c) => c.y).sort((a, b) => a - b);
    const groups = [];
    for (const top of sorted) {
      const group = groups[groups.length - 1];
      if (group && top - group[group.length - 1] <= TOL) group.push(top);
      else groups.push([top]);
    }
    if (groups.length > 1) {
      push(
        "WRAPPING",
        `${rowControls.length} controls would fit on one line (need ` +
          `${round(needed)}px of ${round(available)}px) but start at ${groups.length} distinct top ` +
          `coordinates: ${rowControls.map((c) => `${c.id || c.cls[0] || c.tag} top=${round(c.y)}`).join(", ")}`,
      );
    }
  }

  /* (b) HEIGHT MISMATCH: one shared control height per row.
   *
   * The page payload has no live element to run `matches()` against, so the ALLOWED
   * selectors are matched on the serialized shape (tag/id/class). They are all
   * class selectors, so the sync check after this function reduces to "the class is
   * present"; a future tag or id selector must extend `isAllowed` here too. */
  const isAllowed = (c) => {
    for (const sel of Object.keys(ALLOWED)) {
      if (sel.startsWith(".") && c.cls.includes(sel.slice(1))) return true;
      if (!sel.startsWith(".") && !sel.startsWith("#") && c.tag === sel) return true;
      if (sel.startsWith("#") && c.id === sel.slice(1)) return true;
    }
    return false;
  };
  const heightChecked = controls.filter((c) => !isAllowed(c));
  if (heightChecked.length > 1) {
    const heights = heightChecked.map((c) => c.height);
    const span = Math.max(...heights) - Math.min(...heights);
    if (span > TOL) {
      issues.push({
        code: "HEIGHT",
        view: ctx.view,
        width: ctx.width,
        theme: ctx.theme,
        row: row.selector,
        detail:
          `sibling controls differ by ${round(span)}px: ` +
          heightChecked.map((c) => `${c.id || c.cls[0] || c.tag}=${round(c.height)}px`).join(", "),
      });
    }
  }

  /* Report-only: the allowlisted exceptions should still be centred on the row. */
  return { issues, fits, bands: bands.length, needed, available, controls };
}

/* The ALLOWED map documents *why* an exception exists; the matcher in `isAllowed`
 * keys on serialized id/class/tag. Reject an entry neither half can express. */
for (const sel of Object.keys(ALLOWED)) {
  if (!/^[.#]/.test(sel) && !/^[a-z][a-z0-9-]*$/.test(sel)) {
    console.error(`internal: unusable ALLOWED selector ${sel}`);
    process.exit(2);
  }
  if (!ALLOWED[sel] || ALLOWED[sel].length < 20) {
    console.error(`internal: ALLOWED entry ${sel} needs a written reason`);
    process.exit(2);
  }
}

/* ------------------------------------------------------------------ */
/* driver                                                             */
/* ------------------------------------------------------------------ */

async function setTheme(page, theme) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await page.evaluate(() => document.documentElement.dataset.theme || "");
    if (current === theme) return true;
    await page.evaluate(() => document.getElementById("themeToggle")?.click());
    await page.waitForTimeout(500);
  }
  return (await page.evaluate(() => document.documentElement.dataset.theme || "")) === theme;
}

async function activateView(page, view) {
  const clicked = await page.evaluate((v) => {
    const item = document.querySelector(`.rail__item[data-view="${v}"]`);
    if (!item) return false;
    item.click();
    return true;
  }, view);
  if (!clicked) return "no .rail__item for this view";
  await page.waitForTimeout(750);
  const active = await page.evaluate((v) => {
    const panel = document.querySelector(`[data-view-panel="${v}"]`);
    if (!panel) return false;
    if (panel.hidden) return false;
    const cs = getComputedStyle(panel);
    return cs.display !== "none" && cs.visibility !== "hidden";
  }, view);
  if (!active) {
    await page.waitForTimeout(700);
    return (await page.evaluate((v) => {
      const panel = document.querySelector(`[data-view-panel="${v}"]`);
      return !!panel && !panel.hidden;
    }, view))
      ? null
      : "panel never became active";
  }
  return null;
}

(async () => {
  if (!fs.existsSync(PLAYWRIGHT)) {
    console.error(`SKIP/FAIL: playwright-core is missing at ${PLAYWRIGHT}`);
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(path.join(APP_DIR, "index.html"))) {
    console.error(`FAIL: no app entry point at ${path.join(APP_DIR, "index.html")}`);
    process.exitCode = 1;
    return;
  }

  const { chromium } = require(PLAYWRIGHT);
  const views = VIEW_FILTER.length ? VIEWS.filter((v) => VIEW_FILTER.includes(v)) : VIEWS;
  if (VIEW_FILTER.length && !views.length) {
    console.error(`FAIL: --views=${VIEW_FILTER.join(",")} matched no known view`);
    process.exitCode = 1;
    return;
  }

  console.log(`toolbar alignment audit`);
  console.log(`  app:     ${path.join(APP_DIR, "index.html")}`);
  console.log(`  matrix:  ${views.length} view(s) x ${WIDTHS.length} width(s) x ${THEMES.length} theme(s) = ${views.length * WIDTHS.length * THEMES.length} row slots`);
  console.log(`  tolerance: ${TOL}px on centre lines, top bands and control heights\n`);

  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const results = [];
  const coverage = [];

  try {
    for (const size of WIDTHS) {
      for (const theme of THEMES) {
        const context = await browser.newContext({
          viewport: { width: size.width, height: size.height },
          colorScheme: "light",
        });
        const page = await context.newPage();
        const pageErrors = [];
        page.on("pageerror", (err) => pageErrors.push(String(err && err.message ? err.message : err)));

        await page.goto(APP_URL, { waitUntil: "load" });
        await page.waitForTimeout(1500);
        await page.evaluate(() => document.getElementById("startCenter")?.close());
        await page.waitForTimeout(300);

        const themeOk = await setTheme(page, theme);
        if (!themeOk) {
          results.push({
            view: "(all)",
            width: size.width,
            height: size.height,
            theme,
            selector: "-",
            display: "-",
            kids: 0,
            bands: 0,
            issues: [{
              code: "NOTHING",
              view: "(all)",
              width: size.width,
              theme,
              row: "-",
              detail: `could not switch the app to the "${theme}" theme; nothing measured`,
            }],
          });
          await context.close();
          continue;
        }

        for (const view of views) {
          const viewError = await activateView(page, view);
          const slot = { view, width: size.width, height: size.height, theme };
          if (viewError) {
            results.push({
              ...slot,
              selector: EXPECTED_ROW[view],
              display: "-",
              kids: 0,
              bands: 0,
              issues: [{
                code: "NOTHING",
                view,
                width: size.width,
                theme,
                row: EXPECTED_ROW[view],
                detail: `could not activate the view: ${viewError}`,
              }],
            });
            coverage.push({ ...slot, expected: EXPECTED_ROW[view], measured: 0, kids: 0 });
            continue;
          }

          const rows = await page.evaluate(READ);
          const expected = EXPECTED_ROW[view];
          const matching = rows.filter((r) => r.selector === expected && r.panel === view);
          coverage.push({ ...slot, expected, measured: matching.length, kids: matching.reduce((n, r) => n + r.children.length, 0) });

          if (!matching.length) {
            results.push({
              ...slot,
              selector: expected,
              display: "-",
              kids: 0,
              bands: 0,
              issues: [{
                code: "NOTHING",
                view,
                width: size.width,
                theme,
                row: expected,
                detail:
                  `expected row container ${expected} in view "${view}" measured nothing ` +
                  `(visible rows found: ${rows.length ? rows.map((r) => r.selector).join(", ") : "none"})`,
              }],
            });
            continue;
          }

          for (const row of matching) {
            const ctx = { view, width: size.width, height: size.height, theme };
            const judged = judgeRow(row, ctx);
            results.push({
              ...slot,
              selector: row.selector,
              display: row.display,
              kids: row.children.length,
              bands: judged.bands,
              needed: judged.needed,
              available: judged.available,
              heights: row.children.map((c) => `${c.id || c.cls[0] || c.tag}:${round(c.height)}`),
              displayValues: row.children.map((c) => c.display),
              issues: judged.issues,
            });
          }

          /* Any *other* visible toolbar row in this view is measured too, so a future
           * second row cannot slip past unmeasured. */
          for (const row of rows.filter((r) => !matching.includes(r))) {
            const ctx = { view, width: size.width, height: size.height, theme };
            const judged = judgeRow(row, ctx);
            results.push({
              ...slot,
              selector: row.selector,
              display: row.display,
              kids: row.children.length,
              bands: judged.bands,
              needed: judged.needed,
              available: judged.available,
              heights: row.children.map((c) => `${c.id || c.cls[0] || c.tag}:${round(c.height)}`),
              issues: judged.issues,
            });
          }
        }

        if (pageErrors.length) {
          console.log(`  page errors in ${size.width}x${size.height} ${theme}: ${pageErrors[0]}`);
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  /* Requirement 4, second layer: a run that measured nothing is a FAILURE, never a
   * pass. The per-slot NOTHING issues already cover the individual rows; this catches
   * the whole-matrix case (e.g. the app failed to boot) and still prints the table and
   * diagnostics below, so the reason for the failure is visible. */
  const totalKids = results.reduce((n, r) => n + (r.kids || 0), 0);
  const measuredSlots = coverage.filter((c) => c.kids > 0).length;
  const expectedSlots = views.length * WIDTHS.length * THEMES.length;
  const vacuous = totalKids === 0;

  /* ---- table ---- */
  const rows = [];
  for (const r of results) {
    const status = r.issues.length ? `FAIL ${[...new Set(r.issues.map((i) => i.code))].join("+")}` : "ok";
    rows.push({
      view: r.view,
      size: `${r.width}x${r.height}`,
      theme: r.theme,
      row: r.selector,
      display: r.display,
      kids: String(r.kids),
      bands: String(r.bands),
      heights: (r.heights || []).join(" ") || "-",
      status,
    });
  }
  const widths = {
    view: Math.max(4, ...rows.map((r) => r.view.length)),
    size: 9,
    theme: 5,
    row: Math.max(3, ...rows.map((r) => r.row.length)),
    display: Math.max(7, ...rows.map((r) => r.display.length)),
    kids: 4,
    bands: 5,
    heights: Math.max(6, ...rows.map((r) => r.heights.length)),
    status: Math.max(6, ...rows.map((r) => r.status.length)),
  };
  console.log(
    `${"view".padEnd(widths.view)}  ${"viewport".padEnd(widths.size)}  ${"theme".padEnd(widths.theme)}  ` +
      `${"row".padEnd(widths.row)}  ${"display".padEnd(widths.display)}  ${"kids".padEnd(widths.kids)}  ` +
      `${"bands".padEnd(widths.bands)}  ${"heights".padEnd(widths.heights)}  status`,
  );
  for (const r of rows) {
    console.log(
      `${r.view.padEnd(widths.view)}  ${r.size.padEnd(widths.size)}  ${r.theme.padEnd(widths.theme)}  ` +
        `${r.row.padEnd(widths.row)}  ${r.display.padEnd(widths.display)}  ${r.kids.padEnd(widths.kids)}  ` +
        `${r.bands.padEnd(widths.bands)}  ${r.heights.padEnd(widths.heights)}  ${r.status}`,
    );
  }

  const issues = results.flatMap((r) => r.issues);
  const failingRows = results.filter((r) => r.issues.length).length;
  console.log(
    `\ncoverage: ${measuredSlots}/${expectedSlots} row slot(s) measured >=1 child; ` +
      `${totalKids} child box(es) measured; ${results.length} row(s) checked`,
  );
  console.log(`allowlisted exception(s): ${Object.entries(ALLOWED).map(([k, v]) => `${k} - ${v}`).join("; ") || "none"}\n`);

  if (vacuous) {
    console.log(`FAIL: audit measured nothing - 0 measurable toolbar children across the whole matrix.`);
    console.log(
      "      A green result here would be vacuous: nothing was measured, so nothing was\n" +
        "      verified. This is a failure even though no alignment rule was violated.",
    );
    process.exitCode = 1;
    return;
  }

  if (issues.length) {
    console.log(`FAIL: ${issues.length} alignment defect(s) in ${failingRows} row(s):\n`);
    for (const issue of issues) {
      console.log(`  [${issue.code}] view=${issue.view} viewport=${issue.width} theme=${issue.theme} row=${issue.row}`);
      console.log(`      ${issue.detail}`);
    }
    console.log(
      "\nA toolbar row is one line of equal-height controls. `.view-head__tools` needs a row\n" +
        "layout (display:flex/grid with align-items:center and a shared control height), and the\n" +
        "script view's `.editor-meta__right` needs its icon button to match its 30px pills.\n" +
        "Fix the stylesheet, not this audit.",
    );
    process.exitCode = 1;
  } else {
    console.log(
      `PASS: ${views.length} view(s) x ${WIDTHS.length} width(s) x ${THEMES.length} theme(s): every toolbar row ` +
        `is a single line of equal-height controls (tolerance ${TOL}px), ` +
        `${totalKids} child box(es) measured.`,
    );
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ ok: issues.length === 0 && !vacuous, results, coverage, issues }, null, 2));
  }
})().catch((error) => {
  console.error("FAIL: audit crashed before completing the matrix");
  console.error(error);
  process.exitCode = 1;
});
