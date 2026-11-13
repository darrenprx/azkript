/* Probe: does clicking a scene land on THAT scene?
 *
 * Report under test: "Clicking some scene also jump to a previous scene."
 *
 * Builds a long document through the app's real FDX import path (so the editor
 * overflows and the landing position is measurable), then clicks every scene in
 * each place a user can click one:
 *    - the navigator scene list            (#sceneList .scene-item)
 *    - a Scene View row                    (#sceneViewTable .sv-jump-btn)
 *    - an Index Cards card                 (#sceneGrid .scene-card)
 *    - the navigator list with a filter on (#sceneSearch)
 * and measures which scene the app treats as active afterwards.
 *
 * "Active scene" is read from the navigator's own `.is-active` row — the same
 * indicator the user sees — not from the paragraph selection, because the two
 * can disagree (that disagreement is the bug).
 *
 * Exit code: 0 = every click landed on its own scene, 1 = mismatches listed.
 * A document that yields 0 scenes/cards is a FAILURE, never a pass.
 *
 * Usage: node scripts/probe-scene-nav.cjs [--json] [--diag] [--heights]
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const asJson = process.argv.includes("--json");
const diag = process.argv.includes("--diag");
const heightSweep = process.argv.includes("--heights");
const playwrightPath = path.join(root, "node_modules", "playwright-core");
if (!fs.existsSync(playwrightPath)) {
  console.error("SKIP: node_modules/playwright-core is not installed");
  process.exit(2);
}
const { chromium } = require(playwrightPath);
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
/* APP_ROOT lets the probe run against a copy of the app (used to prove the probe
 * fails on pre-fix code without touching the workspace's own app/ directory). */
const appRoot = process.env.APP_ROOT ? path.resolve(process.env.APP_ROOT) : path.join(root, "app");
const appUrl = pathToFileURL(path.join(appRoot, "index.html")).href;

const SCENE_COUNT = 8;
const PARAS_PER_SCENE = 10;
const POST_CLICK_SETTLE_MS = 1400;

/* A long FDX document, imported through the app's real import path.
 * Scene 1 is named so a "PLATEAU" filter selects scenes 2..8 only, which lets the
 * filtered-list case be measured as a distinct surface.
 * `shortTail` makes the last scene too short to be centred: the scroll clamps at
 * the end of the document, so that one scene lands lower than the others. */
function buildFdx(docVariant) {
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const blocks = [];
  let id = 0;
  const add = (type, text) => {
    id += 1;
    blocks.push(
      `    <Paragraph Type="${type}" id="p${String(id).padStart(3, "0")}">\n      <Text>${esc(text)}</Text>\n    </Paragraph>`,
    );
  };
  /* A document with no scene headings at all: used to prove the "measured 0
   * scenes" guard reports a FAILURE instead of silently passing. */
  if (docVariant === "noScenes") {
    for (let line = 1; line <= 6; line += 1) {
      add("Action", `Orphan action line ${line}, with no scene heading anywhere in this document.`);
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<FinalDraft DocumentType="Script" Template="No" Version="6">
  <Content>
${blocks.join("\n")}
  </Content>
</FinalDraft>`;
  }
  for (let scene = 1; scene <= SCENE_COUNT; scene += 1) {
    const heading = scene === 1 ? "EXT. RIDGE - NIGHT" : `INT. PLATEAU ${scene} MARKER - DAY`;
    add("Scene Heading", heading);
    const lines = docVariant === "shortTail" && scene === SCENE_COUNT ? 1 : PARAS_PER_SCENE;
    for (let line = 1; line <= lines; line += 1) {
      add(
        "Action",
        `Scene ${scene} action beat ${line}. The camera drifts across the room while the radio crackles softly.`,
      );
    }
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<FinalDraft DocumentType="Script" Template="No" Version="6">
  <Content>
${blocks.join("\n")}
  </Content>
</FinalDraft>`;
}

/* Measure where the editor is and which scene the app reports as active. */
const READ_STATE = () => {
  const editor = document.getElementById("editor");
  const scroll = document.getElementById("paperScroll");
  const rows = [...document.querySelectorAll("#sceneList .scene-item")];
  const paras = editor ? [...editor.querySelectorAll(".para")] : [];
  const c = scroll.getBoundingClientRect();
  const headings = paras.filter((p) => p.dataset.type === "Scene Heading");
  /* Offset of each scene heading from the top of the reading viewport. */
  const offsets = headings.map((h) => Math.round(h.getBoundingClientRect().top - c.top));
  const activeRow = rows.find((row) => row.classList.contains("is-active")) || null;
  return {
    sceneRowCount: rows.length,
    rowIds: rows.map((row) => row.dataset.sceneId || null),
    rowHeadings: rows.map((row) => (row.querySelector(".scene-item__heading") || {}).textContent || ""),
    activeRowIndex: rows.findIndex((row) => row.classList.contains("is-active")),
    activeRowId: activeRow ? activeRow.dataset.sceneId || null : null,
    activeRowHeading: activeRow ? (activeRow.querySelector(".scene-item__heading") || {}).textContent || "" : null,
    activeRowCount: rows.filter((row) => row.classList.contains("is-active")).length,
    activeOutlineIndex: [...document.querySelectorAll("#outlineTrack .outline-segment")].findIndex((s) =>
      s.classList.contains("is-active"),
    ),
    activeParaText: ((editor && editor.querySelector(".para.is-active")) || {}).textContent || "",
    scrollTop: Math.round(scroll.scrollTop),
    viewportHeight: Math.round(c.height),
    /* True when the scroll was clamped by the end of the document, i.e. the
     * requested centre position was past the last possible scrollTop. */
    clampedAtEnd: Math.round(scroll.scrollTop) + Math.round(c.height) >= scroll.scrollHeight - 2,
    headingOffsets: offsets,
    headingIds: headings.map((h) => h.dataset.id),
    topVisibleHeadingIndex: (() => {
      let found = -1;
      offsets.forEach((off, i) => {
        if (off <= 2) found = i;
      });
      return found;
    })(),
    /* Offset of the heading for a given scene id, and its position in document order. */
    headingOffsetById: Object.fromEntries(headings.map((h, i) => [h.dataset.id, offsets[i]])),
    /* The scene the app SHOULD consider active for the current scroll position:
     * the last heading at or above the anchor line (the 0.38 + 4px rule the scroll
     * handler implements). This is the contract a manual scroll must honour. */
    anchorSceneIndex: (() => {
      const anchor = Math.round(c.height * 0.38) + 4;
      let found = -1;
      offsets.forEach((off, i) => {
        if (off <= anchor) found = i;
      });
      return found;
    })(),
  };
};

/* Record the navigator's active-row flips over time after a click. */
const INSTALL_SPY = () => {
  window.__navLog = [];
  const stamp = () => Math.round(performance.now());
  const sceneList = document.getElementById("sceneList");
  const paperScroll = document.getElementById("paperScroll");
  new MutationObserver((records) => {
    for (const rec of records) {
      if (rec.type !== "attributes" || rec.attributeName !== "class") continue;
      const row = rec.target;
      if (!row.classList || !row.classList.contains("scene-item")) continue;
      window.__navLog.push({
        t: stamp(),
        row: [...sceneList.querySelectorAll(".scene-item")].indexOf(row),
        active: row.classList.contains("is-active"),
      });
    }
  }).observe(sceneList, { subtree: true, attributes: true, attributeFilter: ["class"] });
  paperScroll.addEventListener(
    "scroll",
    () => {
      window.__navLog.push({ t: stamp(), scrollTop: Math.round(paperScroll.scrollTop) });
    },
    { passive: true },
  );
};

async function openDoc(page, docVariant) {
  await page.goto(appUrl);
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.getElementById("startCenter")?.close());
  await page.waitForTimeout(300);
  await page.setInputFiles("#fileInput", {
    name: "long-scene-nav.fdx",
    mimeType: "text/xml",
    buffer: Buffer.from(buildFdx(docVariant), "utf8"),
  });
  await page.waitForTimeout(1800);
}

async function setView(page, view) {
  await page.evaluate((v) => document.querySelector(`.rail__item[data-view="${v}"]`)?.click(), view);
  await page.waitForTimeout(900);
}

async function applyFilter(page, query) {
  await page.evaluate((q) => {
    const input = document.getElementById("sceneSearch");
    input.value = q;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, query);
  await page.waitForTimeout(700);
}

/* Click displayed row `i` in the given surface. Returns the clicked heading. */
async function clickScene(page, surface, i) {
  if (surface === "navigator" || surface === "navigator-filtered") {
    return page.evaluate((idx) => {
      const row = [...document.querySelectorAll("#sceneList .scene-item")][idx];
      if (!row) return null;
      const heading = (row.querySelector(".scene-item__heading") || {}).textContent || "";
      row.click();
      return heading;
    }, i);
  }
  if (surface === "sceneview") {
    return page.evaluate((idx) => {
      const row = [...document.querySelectorAll("#sceneViewTable .sv-row:not(.sv-row--head)")][idx];
      if (!row) return null;
      const btn = row.querySelector(".sv-jump-btn");
      const heading = btn ? btn.textContent : "";
      if (btn) btn.click();
      return heading;
    }, i);
  }
  if (surface === "cards") {
    return page.evaluate((idx) => {
      const card = [...document.querySelectorAll("#sceneGrid .scene-card")][idx];
      if (!card) return null;
      const heading = (card.querySelector("h3") || {}).textContent || "";
      card.click();
      return heading;
    }, i);
  }
  throw new Error(`unknown surface ${surface}`);
}

async function runSurface(browser, cfg) {
  const page = await browser.newPage({
    viewport: cfg.viewport,
    /* The scroll handler races the smooth scroll. Reduced motion makes goToScene's
     * scroll instant, which removes that race and exposes the geometric defect
     * deterministically; the default (animated) mode is measured too, because the
     * animated flicker is what the user actually reports. */
    reducedMotion: cfg.motion === "reduced" ? "reduce" : "no-preference",
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await openDoc(page, cfg.docVariant);
  if (cfg.surface === "sceneview") await setView(page, "sceneview");
  if (cfg.surface === "cards" || cfg.surface === "navigator-filtered") await setView(page, "navigator");
  if (cfg.surface === "navigator-filtered") await applyFilter(page, "PLATEAU");
  await page.evaluate(INSTALL_SPY);

  const atRest = await page.evaluate(READ_STATE);
  const targetCount =
    cfg.surface === "cards"
      ? await page.evaluate(() => document.querySelectorAll("#sceneGrid .scene-card").length)
      : atRest.sceneRowCount;
  const entry = {
    surface: cfg.surface,
    docVariant: cfg.docVariant || "balanced",
    motion: cfg.motion || "animated",
    viewport: cfg.viewport,
    importedSceneCount: await page.evaluate(
      () => document.querySelectorAll("#editor .para[data-type='Scene Heading']").length,
    ),
    clickableCount: targetCount,
    viewportHeight: atRest.viewportHeight,
    clicks: [],
    errors,
  };

  /* Ids of the rows/cards that will be clicked, in visible order, captured up front. */
  const clickedIds = await page.evaluate((surface) => {
    if (surface === "cards") {
      return [...document.querySelectorAll("#sceneGrid .scene-card")].map((c) => c.dataset.sceneId || null);
    }
    if (surface === "sceneview") {
      return [...document.querySelectorAll("#sceneViewTable .sv-row:not(.sv-row--head)")].map((r) => {
        const btn = r.querySelector(".sv-jump-btn");
        return btn ? btn.dataset.svJump : null;
      });
    }
    return [...document.querySelectorAll("#sceneList .scene-item")].map((r) => r.dataset.sceneId || null);
  }, cfg.surface);

  for (let i = 0; i < targetCount; i += 1) {
    await page.evaluate(() => {
      window.__navLog.length = 0;
    });
    const clickedHeading = await clickScene(page, cfg.surface, i);
    await page.waitForTimeout(POST_CLICK_SETTLE_MS);
    const after = await page.evaluate(READ_STATE);
    const log = await page.evaluate(() => window.__navLog);
    const flipped = log.filter((l) => !("scrollTop" in l) || l.row !== undefined);
    /* The scene id of the row that was actually clicked, captured before the click,
     * so the assertion is on identity rather than on a possibly-shifted index. */
    const clickedId = clickedIds[i] || null;
    const clickedDocIndex = clickedId ? after.headingIds.indexOf(clickedId) : -1;
    entry.clicks.push({
      clickIndex: i,
      clickedHeading,
      clickedId,
      clickedDocIndex,
      clickedOffset: clickedId ? after.headingOffsetById[clickedId] : null,
      activeRowIndex: after.activeRowIndex,
      activeRowId: after.activeRowId,
      activeRowHeading: after.activeRowHeading,
      activeRowCount: after.activeRowCount,
      activeOutlineIndex: after.activeOutlineIndex,
      activeParaText: after.activeParaText,
      headingIds: after.headingIds,
      headingOffsets: after.headingOffsets,
      topVisibleHeadingIndex: after.topVisibleHeadingIndex,
      clampedAtEnd: after.clampedAtEnd,
      viewportHeight: after.viewportHeight,
      scrollTop: after.scrollTop,
      scrollEventCount: log.filter((l) => l.scrollTop !== undefined && l.row === undefined).length,
      flipSequence: flipped.map((l) => `${l.active ? "+" : "-"}${l.row}@${l.t}ms`),
    });
  }
  if (cfg.checkScrollTracking) entry.scrollTracking = await checkScrollTracking(page);
  await page.close();
  return entry;
}

/* Regression guard: after a click, the navigator highlight must still track plain
 * manual scrolling. A fix that keeps the clicked scene pinned forever would make
 * this fail, and that would be a new bug rather than a repair. */
async function checkScrollTracking(page) {
  const before = await page.evaluate(READ_STATE);
  const jumped = await page.evaluate((targetIdx) => {
    const scroll = document.getElementById("paperScroll");
    const headings = [...document.getElementById("editor").querySelectorAll(".type-scene-heading")];
    const c = scroll.getBoundingClientRect();
    const heading = headings[targetIdx];
    if (!heading) return false;
    const wanted = Math.round(scroll.scrollTop + heading.getBoundingClientRect().top - c.top - 24);
    scroll.scrollTo({ top: Math.max(0, wanted), behavior: "auto" });
    return true;
  }, 5);
  await page.waitForTimeout(900);
  const after = await page.evaluate(READ_STATE);
  return {
    jumped,
    scrollTopBefore: before.scrollTop,
    scrollTopAfter: after.scrollTop,
    activeRowIndexBefore: before.activeRowIndex,
    activeRowIndexAfter: after.activeRowIndex,
    activeRowHeadingAfter: after.activeRowHeading,
    topSceneAfter: after.topVisibleHeadingIndex,
    anchorSceneAfter: after.anchorSceneIndex,
  };
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const report = { surfaces: [] };
  try {
    const configs = [
      /* Self-test of the guard: a document with no scene headings must FAIL the
       * probe, never quietly pass as "0 mismatches". Remove with --no-selftest. */
      ...(process.argv.includes("--no-selftest")
        ? []
        : [{ viewport: { width: 1440, height: 900 }, surface: "navigator", motion: "reduced", docVariant: "noScenes" }]),
      /* Reduced motion first: instant scroll, so the geometric defect is measured
       * without racing the scroll handler. These are the deterministic assertions. */
      { viewport: { width: 1440, height: 900 }, surface: "navigator", motion: "reduced" },
      { viewport: { width: 1440, height: 1000 }, surface: "navigator", motion: "reduced" },
      { viewport: { width: 1440, height: 1080 }, surface: "navigator", motion: "reduced" },
      { viewport: { width: 1920, height: 1080 }, surface: "navigator", motion: "reduced" },
      { viewport: { width: 1440, height: 900 }, surface: "navigator", motion: "reduced", docVariant: "shortTail" },
      { viewport: { width: 1440, height: 1000 }, surface: "sceneview", motion: "reduced" },
      { viewport: { width: 1440, height: 1000 }, surface: "cards", motion: "reduced" },
      { viewport: { width: 1440, height: 1000 }, surface: "navigator-filtered", motion: "reduced" },
      /* Animated mode: the production path. The smooth scroll flicker is what the
       * user sees, so it is measured too. This run also checks that the highlight
       * still follows plain scrolling after a click. */
      { viewport: { width: 1440, height: 1000 }, surface: "navigator", checkScrollTracking: true },
    ];
    if (heightSweep) {
      for (const h of [860, 880, 900, 920, 930, 940, 960, 1000]) {
        configs.push({ viewport: { width: 1440, height: h }, surface: "navigator" });
      }
    }
    for (const cfg of configs) report.surfaces.push(await runSurface(browser, cfg));
  } finally {
    await browser.close();
  }

  /* Assertions. A click must make ITS OWN scene the active scene. "Active" is
   * read from the navigator's `.is-active` row and the outline's is-active
   * segment, which is what the user sees — not the paragraph selection, which
   * can disagree with them (that disagreement is the bug). The comparison is on
   * scene identity (data-scene-id), not on list position, so a filtered navigator
   * list cannot produce a false pass or a bogus off-by-N. */
  const failures = [];
  for (const s of report.surfaces) {
    const tag = `${s.surface}${s.docVariant !== "balanced" ? `(${s.docVariant})` : ""}` +
      `[${s.motion}]@${s.viewport.width}x${s.viewport.height}`;
    if (s.importedSceneCount === 0) {
      failures.push(`${tag}: FAIL measured 0 scenes in the document`);
      continue;
    }
    if (s.clickableCount === 0) {
      failures.push(`${tag}: FAIL measured 0 clickable scenes/cards`);
      continue;
    }
    /* Regression guard: the highlight must still follow plain scrolling after a
     * click. A fix that pins the clicked scene forever would fail here. */
    if (s.scrollTracking) {
      const t = s.scrollTracking;
      if (t.anchorSceneAfter !== t.activeRowIndexAfter) {
        failures.push(
          `${tag}: after a manual scroll the highlight stopped following the viewport ` +
            `(scene at the anchor line=${t.anchorSceneAfter}, highlighted row=${t.activeRowIndexAfter})`,
        );
      }
    }
    for (const c of s.clicks) {
      if (!c.clickedId) {
        failures.push(`${tag}: FAIL click ${c.clickIndex} had no scene id to compare against`);
        continue;
      }
      if (c.activeRowId !== c.clickedId) {
        failures.push(
          `${tag}: clicked "${c.clickedHeading}" (document scene ${c.clickedDocIndex + 1}) but scene ` +
            `"${c.activeRowHeading}" (document scene ${
              c.activeRowId ? c.headingIds.indexOf(c.activeRowId) + 1 : "none"
            }) is the active one — the clicked heading sits ${c.clickedOffset}px below the viewport top, ` +
            `past the 190px active-scene threshold`,
        );
      }
    }
  }

  if (asJson) {
    console.log(JSON.stringify({ ...report, failures }, null, 2));
    process.exitCode = failures.length ? 1 : 0;
    return;
  }

  console.log(`surfaces measured: ${report.surfaces.length}`);
  for (const s of report.surfaces) {
    const h = s.clicks[0] ? s.clicks[0].viewportHeight : 0;
    const anchor = Math.round(h * 0.38);
    console.log(
      `\n=== ${s.surface}${s.docVariant !== "balanced" ? ` (${s.docVariant})` : ""} [${s.motion}] ` +
        `@ ${s.viewport.width}x${s.viewport.height} — ` +
        `reading viewport ${h}px, click centres the heading at ${anchor}px, active-scene threshold is 190px` +
        `${s.surface === "navigator-filtered" ? `, ${s.clickableCount} of ${s.importedSceneCount} rows shown` : ""} ===`,
    );
    if (s.errors.length) s.errors.forEach((e) => console.log(`  ! pageerror ${e}`));
    if (s.scrollTracking) {
      const t = s.scrollTracking;
      const tracked = t.anchorSceneAfter === t.activeRowIndexAfter;
      console.log(
        `  manual scroll to scene 6: scrollTop ${t.scrollTopBefore} -> ${t.scrollTopAfter}, ` +
          `activeRow ${t.activeRowIndexBefore} -> ${t.activeRowIndexAfter}, anchorScene=${t.anchorSceneAfter} ` +
          `-> highlight ${tracked ? "still tracks scrolling (OK)" : "FAILED to track scrolling"}`,
      );
    }
    for (const c of s.clicks) {
      const bad = c.activeRowIndex !== c.clickIndex;
      console.log(
        `  click ${c.clickIndex} "${c.clickedHeading}" -> activeRow=${c.activeRowIndex} ` +
          `"${c.activeRowHeading}" (outline=${c.activeOutlineIndex}) ` +
          `clickedOffset=${c.headingOffsets[c.clickIndex]}px topScene=${c.topVisibleHeadingIndex}` +
          `${c.clampedAtEnd ? " [scroll clamped at document end]" : ""}` +
          `${bad ? "   <-- WRONG: lands on a different scene" : ""}`,
      );
      if (diag) {
        console.log(`        activeRow flips: ${c.flipSequence.join(" ") || "(none)"}`);
        console.log(`        scroll: ${c.scrollTop}px over ${c.scrollEventCount} events; activeParagraph="${c.activeParaText.slice(0, 44)}"`);
        console.log(`        heading offsets from viewport top: ${c.headingOffsets.join(" ")}`);
      }
    }
  }
  console.log(`\nfailures: ${failures.length}`);
  failures.forEach((f) => console.log(`  FAIL ${f}`));
  process.exitCode = failures.length ? 1 : 0;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
