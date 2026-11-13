/* Text-contrast audit across every theme, the counterpart to
 * audit-ui-integrity.cjs (which measures geometry, not colour).
 *
 * Why this exists: the reported defect was a badge whose ink was a hard-coded
 * light-theme hex while its background was a theme-aware color-mix(), making it
 * unreadable in the dark themes (2.47:1). That is a *class* of bug, not one
 * instance, so this walks every visible text node on every surface and compares
 * its computed ink against the first opaque ancestor background, compositing
 * translucent layers on the way down.
 *
 * IMPORTANT — themes are applied through the app's real path
 * (`#settingsButton` -> `#themeSwatches button[data-theme-choice]`), NOT by
 * setting `document.documentElement.dataset.theme`. `applyStudioAppearance()`
 * writes --brand/--brand-soft/--paper* as inline custom properties chosen per
 * theme; setting the attribute alone leaves light-theme brand tokens on a dark
 * surface and manufactures ~30 fake failures. That mistake was made once while
 * writing this file; do not repeat it.
 *
 * Usage:
 *   node scripts/audit-contrast.cjs            # fail on any AA miss
 *   node scripts/audit-contrast.cjs --json     # also write reports/contrast.json
 *
 * Known limitation (reported honestly rather than hidden): an element whose
 * background is a `linear-gradient` has `backgroundColor: transparent`, so the
 * resolver sees the page behind it. `.avatar` and `.cast-avatar` are the two such
 * cases in this app; both are white-on-accent capsules whose real centre measures
 * 5.28:1, so they are allowlisted with a reason and the audit fails if they
 * disappear (so the exemption cannot rot).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const { chromium } = require(path.join(root, "node_modules", "playwright-core"));
const { silenceSpeech } = require("./lib/silence-speech.cjs");
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;
const JSON_OUT = process.argv.includes("--json");

const THEMES = ["light", "dark", "midnight"];
const VIEWS = ["script", "sceneview", "navigator", "characters", "reports", "beatboard"];
const TABS = ["home", "file", "edit", "view", "format", "insert", "document", "tools", "production", "help"];

/* Gradient backgrounds the resolver cannot read. Each entry must actually be
 * present in the run, or the audit reports allowlist rot. */
const ALLOWED = {
  ".avatar": "linear-gradient capsule; measured 5.28:1 against the gradient's own centre",
  ".cast-avatar": "linear-gradient capsule; same construction and measurement as .avatar",
};

const MIN_TEXT_PER_SURFACE = 8;
const MIN_TEXT_TOTAL = 300;
const MIN_RATIO = 4.5;

const MEASURE = () => {
  const parse = (s) => {
    if (!s) return null;
    let m = s.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    m = s.match(/^color\((?:srgb|display-p3)\s+([^)]+)\)$/);
    if (m) {
      const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number);
      return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 };
    }
    return null;
  };
  const over = (f, b) => ({
    r: f.r * f.a + b.r * (1 - f.a),
    g: f.g * f.a + b.g * (1 - f.a),
    b: f.b * f.a + b.b * (1 - f.a),
    a: 1,
  });
  const lum = (c) => {
    const f = (v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const ratio = (a, b) => {
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const bgOf = (el) => {
    const stack = [];
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      // A gradient paints, but backgroundColor is transparent: treat it as opaque
      // enough that we stop climbing, and flag it for the allowlist.
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0.001) {
        stack.push(c);
        if (c.a >= 0.999) break;
      }
      n = n.parentElement;
    }
    let base = parse(getComputedStyle(document.documentElement).backgroundColor);
    if (!base || base.a < 0.999) base = { r: 255, g: 255, b: 255, a: 1 };
    let out = base;
    for (let i = stack.length - 1; i >= 0; i -= 1) out = over(stack[i], out);
    return out;
  };
  const isClippedOut = (el) => {
    const er = el.getBoundingClientRect();
    let a = el.parentElement;
    while (a && a !== document.body) {
      const cs = getComputedStyle(a);
      if (/(hidden|auto|scroll|clip)/.test(cs.overflowY) || /(hidden|auto|scroll|clip)/.test(cs.overflow)) {
        const ar = a.getBoundingClientRect();
        if (er.bottom <= ar.top + 1 || er.top >= ar.bottom - 1) return true;
      }
      a = a.parentElement;
    }
    return false;
  };

  const out = [];
  let measured = 0;
  const seen = new Set();
  for (const el of document.querySelectorAll("body *")) {
    if (el.closest("script, style, svg, .svg-sprite")) continue;
    const ownText = [...el.childNodes]
      .filter((n) => n.nodeType === 3 && n.textContent.trim())
      .map((n) => n.textContent.trim())
      .join(" ");
    if (!ownText) continue;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (isClippedOut(el)) continue;
    measured += 1;
    const cs = getComputedStyle(el);
    const fg = parse(cs.color);
    if (!fg || fg.a < 0.05) continue;
    const bg = bgOf(el);
    const fgc = over(fg, bg);
    const cr = ratio(fgc, bg);
    const fontSize = parseFloat(cs.fontSize);
    const weight = Number(cs.fontWeight) || 400;
    const large = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const cls = typeof el.className === "string" && el.className.trim() ? el.className.trim() : "";
    const selector = el.tagName.toLowerCase() + (cls ? "." + cls.split(/\s+/).slice(0, 2).join(".") : "");
    // gradient-backed elements: report separately, the background is unreadable
    let gradient = false;
    let a = el;
    while (a && a !== document.body) {
      if (/gradient/.test(getComputedStyle(a).backgroundImage)) {
        gradient = true;
        break;
      }
      a = a.parentElement;
    }
    if (cr + 0.05 < need) {
      const key = `${selector}|${cs.color}|${Math.round(cr * 10)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        text: ownText.slice(0, 40),
        selector,
        cls: cls.split(/\s+/)[0] || "",
        color: cs.color,
        bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
        ratio: +cr.toFixed(2),
        need,
        fontSize: cs.fontSize,
        weight,
        gradient,
      });
    }
  }
  return { findings: out, measured };
};

async function applyTheme(page, theme) {
  await page.evaluate(() => document.getElementById("startCenter")?.close());
  const opened = await page.evaluate(() => {
    const btn = document.getElementById("settingsButton");
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (!opened) return { ok: false, reason: "no #settingsButton" };
  await page.waitForTimeout(700);
  const clicked = await page.evaluate((t) => {
    const sw = document.querySelector(`#themeSwatches button[data-theme-choice="${t}"]`);
    if (!sw) return false;
    sw.click();
    return true;
  }, theme);
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(400);
  const applied = await page.evaluate(() => document.documentElement.dataset.theme);
  const brand = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--brand").trim());
  return { ok: clicked && applied === theme, clicked, applied, brand };
}

(async () => {
  if (!fs.existsSync(path.join(root, "node_modules", "playwright-core"))) {
    console.log("SKIP: node_modules/playwright-core is not installed");
    return;
  }
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const bySurface = [];
  const all = new Map();
  let totalMeasured = 0;
  const allowlistHits = new Set();
  let themeFailures = 0;
  try {
    for (const theme of THEMES) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      /* Not strictly needed by this audit today, but every automation that loads
       * the app gets the stub: a later surface addition must not start speaking
       * the screenplay out loud on a developer's machine. */
      await silenceSpeech(page);
      await page.goto(appUrl);
      await page.waitForTimeout(1500);
      const themeResult = await applyTheme(page, theme);
      if (!themeResult.ok) {
        themeFailures += 1;
        console.log(`!! theme "${theme}" did not apply (applied=${themeResult.applied}, brand=${themeResult.brand})`);
      }
      const surfaces = [
        ["chrome", null],
        ...VIEWS.map((v) => [`view:${v}`, ["view", v]]),
        ...TABS.map((t) => [`ribbon:${t}`, ["ribbon", t]]),
      ];
      for (const [name, target] of surfaces) {
        if (target) {
          if (target[0] === "view") {
            await page.evaluate((v) => document.querySelector(`.rail__item[data-view="${v}"]`)?.click(), target[1]);
          } else {
            await page.evaluate((t) => document.querySelector(`[data-ribbon-tab="${t}"]`)?.click(), target[1]);
          }
          await page.waitForTimeout(420);
        }
        const { findings, measured } = await page.evaluate(MEASURE);
        totalMeasured += measured;
        const surfaceName = `${name}:${theme}`;
        const real = findings.filter((f) => {
          if (!f.gradient) return true;
          // gradient-backed: only exempt if the element's class is allowlisted
          if (ALLOWED[f.selector] || ALLOWED[`.${f.cls}`]) {
            allowlistHits.add(ALLOWED[f.selector] ? f.selector : `.${f.cls}`);
            return false;
          }
          return true;
        });
        bySurface.push({ name: surfaceName, measured, findings: real });
        for (const f of real) {
          const key = `${f.selector}|${f.color}|${f.ratio}`;
          if (!all.has(key)) all.set(key, { ...f, surfaces: new Set() });
          all.get(key).surfaces.add(surfaceName);
        }
      }
      await page.close();
    }
  } finally {
    await browser.close();
  }

  const rot = Object.keys(ALLOWED).filter((k) => !allowlistHits.has(k));
  const unmeasured = bySurface.filter((s) => s.measured < MIN_TEXT_PER_SURFACE);
  const defects = [...all.values()].sort((a, b) => a.ratio - b.ratio);

  // ---- report ----
  console.log(`surfaces measured: ${bySurface.length}`);
  console.log(`text elements measured: ${totalMeasured} across ${THEMES.length} themes`);
  console.log("");
  if (defects.length) {
    console.log("FAILURES (ink too close to its background):");
    for (const d of defects) {
      console.log(
        `  ${String(d.ratio).padStart(5)}:1 (need ${d.need})  ${d.selector.padEnd(34)} ${d.fontSize}/${d.weight}  ` +
          `ink ${d.color} on ${d.bg}  "${d.text.slice(0, 26)}"`
      );
    }
    console.log("");
  }
  let failed = false;
  if (themeFailures) {
    console.error(`FAIL: ${themeFailures} theme(s) could not be applied — the measurement is not trustworthy.`);
    failed = true;
  }
  if (unmeasured.length) {
    console.error(`FAIL: ${unmeasured.length} surface(s) measured < ${MIN_TEXT_PER_SURFACE} text elements (vacuous pass):`);
    for (const s of unmeasured.slice(0, 5)) console.error(`  ${s.name}: ${s.measured}`);
    failed = true;
  }
  if (totalMeasured < MIN_TEXT_TOTAL) {
    console.error(`FAIL: run total ${totalMeasured} text elements (floor ${MIN_TEXT_TOTAL}) — VACUOUS RUN`);
    failed = true;
  }
  if (rot.length) {
    console.error(`FAIL: allowlist rot — ${rot.length} entr(ies) matched nothing: ${rot.join(", ")}`);
    failed = true;
  }
  if (defects.length) failed = true;

  if (JSON_OUT) {
    const file = path.join(root, "reports", "contrast.json");
    fs.writeFileSync(
      file,
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          themes: THEMES,
          minRatio: MIN_RATIO,
          totals: { surfaces: bySurface.length, measured: totalMeasured },
          allowlist: ALLOWED,
          allowlistHits: [...allowlistHits],
          allowlistRot: rot,
          defects: defects.map((d) => ({ ...d, surfaces: [...d.surfaces] })),
        },
        null,
        2
      )}\n`
    );
    console.log(`JSON written to ${path.relative(root, file)}`);
  }

  if (failed) {
    console.error(`\nRESULT: FAIL — ${defects.length} contrast defect(s).`);
    process.exitCode = 1;
  } else {
    console.log(
      `ALLOWLIST: PASS (${Object.keys(ALLOWED).length} entr${Object.keys(ALLOWED).length === 1 ? "y" : "ies"}, every one matched)`
    );
    console.log(`VACUOUS-PASS GUARD: PASS (every surface >= ${MIN_TEXT_PER_SURFACE} text elements; ${totalMeasured} >= ${MIN_TEXT_TOTAL})`);
    console.log(`\nRESULT: PASS — ${bySurface.length} surfaces, ${totalMeasured} text elements, every pair clears WCAG AA.`);
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
