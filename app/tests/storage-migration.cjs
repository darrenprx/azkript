/* Browser-level test for the storage rename and its migration safety.
 *
 * The app used to persist its workspace under `fdstudio.*` keys and now writes
 * `azkript.*`. Two classes of bug have to stay fixed here, because both cost
 * the user work:
 *
 *   1. A stale pre-rename copy must not outlive a successful migration, or
 *      "Clear local data" leaves it behind and the deleted draft comes back.
 *   2. A pre-rename copy must never be deleted while it still holds the ONLY
 *      copy of newer work. The app was renamed while old builds were still
 *      writing `fdstudio.*`, so the legacy key can legitimately be the newest
 *      document in the profile.
 *
 * Both are asserted per-step rather than in one aggregate, so a partial revert
 * fails loudly.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const playwrightPath = path.join(root, "rea", "node_modules", "playwright-core");
if (!fs.existsSync(playwrightPath)) {
  console.log("SKIP: rea/node_modules/playwright-core is not installed");
  process.exit(0);
}
const { chromium } = require(playwrightPath);
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

const DOC_KEYS = [
  "azkript.document.v3",
  "azkript.document.v2",
  "fdstudio.document.v3",
  "fdstudio.document.v2",
];
const PREFS_KEYS = [
  "azkript.prefs.v2",
  "azkript.prefs.v1",
  "fdstudio.prefs.v2",
  "fdstudio.prefs.v1",
];

const draft = (title, savedAt, html = title) =>
  JSON.stringify({
    title,
    savedAt,
    paragraphs: [{ id: `p-${title}`, type: "Action", html }],
  });

const T = {
  older: "2026-10-01T00:00:00.000Z",
  middle: "2026-10-10T00:00:00.000Z",
  newer: "2026-10-20T00:00:00.000Z",
};

/* Seed localStorage exactly once per browser context. addInitScript runs on
 * every navigation, so without this guard a reload would re-create the very
 * keys the test just proved were pruned. */
async function openPage(browser, seed) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.addInitScript((entries) => {
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    try {
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    } catch {
      /* storage unavailable */
    }
  }, seed);
  await page.goto(appUrl);
  await page.waitForTimeout(1100);
  return { context, page, errors };
}

async function keysOf(page, pattern) {
  return page.evaluate(
    (re) => Object.keys(localStorage).filter((key) => new RegExp(re).test(key)).sort(),
    pattern,
  );
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const allErrors = [];

  /* 1. Legacy-only profile: migrates, keeps the content, prunes the old key. */
  {
    const { context, page, errors } = await openPage(browser, {
      "fdstudio.document.v3": draft("Legacy Profile Draft", T.middle, "EXT. LEGACY PROFILE - DAY"),
      "fdstudio.prefs.v2": JSON.stringify({ theme: "dark", zoom: 1.15 }),
    });
    assert.equal(await page.locator("#docTitle").innerText(), "Legacy Profile Draft");
    assert.match(await page.locator("#editor").innerText(), /LEGACY PROFILE - DAY/);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");

    const migrated = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("azkript.document.v3")),
    );
    assert.equal(migrated.title, "Legacy Profile Draft");
    assert.equal(migrated.paragraphs.length, 1);

    const keys = await keysOf(page, "document|prefs");
    assert.deepEqual(keys, ["azkript.document.v3", "azkript.prefs.v2"], `saw ${keys}`);
    allErrors.push(...errors);
    await context.close();
  }

  /* 2. Every legacy spelling is read and pruned, not just v3. */
  for (const key of DOC_KEYS.slice(1)) {
    const { context, page, errors } = await openPage(browser, {
      [key]: draft(`From ${key}`, T.middle),
    });
    assert.equal(
      await page.locator("#docTitle").innerText(),
      `From ${key}`,
      `${key} must be read`,
    );
    const keys = await keysOf(page, "document");
    assert.deepEqual(keys, ["azkript.document.v3"], `${key} must be pruned, saw ${keys}`);
    allErrors.push(...errors);
    await context.close();
  }
  for (const key of PREFS_KEYS.slice(1)) {
    const { context, page, errors } = await openPage(browser, {
      [key]: JSON.stringify({ theme: "dark" }),
    });
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.theme),
      "dark",
      `${key} preferences must be read`,
    );
    const keys = await keysOf(page, "prefs");
    assert.deepEqual(keys, ["azkript.prefs.v2"], `${key} must be pruned, saw ${keys}`);
    allErrors.push(...errors);
    await context.close();
  }

  /* 3. Current copy newer than the legacy copy: current wins, legacy is pruned. */
  {
    const { context, page, errors } = await openPage(browser, {
      "azkript.document.v3": draft("Current Newer", T.newer),
      "fdstudio.document.v3": draft("Legacy Older", T.older),
      "azkript.prefs.v2": JSON.stringify({ theme: "light" }),
      "fdstudio.prefs.v2": JSON.stringify({ theme: "dark" }),
    });
    assert.equal(await page.locator("#docTitle").innerText(), "Current Newer");
    const keys = await keysOf(page, "document|prefs");
    assert.deepEqual(keys, ["azkript.document.v3", "azkript.prefs.v2"], `saw ${keys}`);

    /* The pruned keys must stay gone across a reload, not just for one boot. */
    await page.reload();
    await page.waitForTimeout(1000);
    assert.equal(await page.locator("#docTitle").innerText(), "Current Newer");
    allErrors.push(...errors);
    await context.close();
  }

  /* 4. THE DATA-LOSS REGRESSION: the legacy copy is NEWER than the current one.
   *    Booting must adopt that newer work, never delete it. */
  {
    const { context, page, errors } = await openPage(browser, {
      "azkript.document.v3": draft("Current Older", T.older),
      "fdstudio.document.v3": draft("Legacy Newer", T.newer),
    });
    assert.equal(
      await page.locator("#docTitle").innerText(),
      "Legacy Newer",
      "the newest saved draft must win regardless of which key holds it",
    );
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("azkript.document.v3")),
    );
    assert.equal(stored.title, "Legacy Newer", "the newer work must be re-saved under the current key");

    await page.reload();
    await page.waitForTimeout(1000);
    assert.equal(
      await page.locator("#docTitle").innerText(),
      "Legacy Newer",
      "the newer draft must survive a reload",
    );
    allErrors.push(...errors);
    await context.close();
  }

  /* 5. Clear local data must not resurrect anything, and must remove legacy
   *    spellings too — the confirm dialog has to survive its own opener.
   *
   *    The legacy key is injected AFTER boot on purpose. Normal boot already
   *    prunes it, so seeding it up front would let this test pass even if the
   *    clear handler forgot legacy keys entirely. Injecting it reproduces the
   *    only situation where the handler's own cleanup matters: a legacy copy
   *    that reappeared while the window was open (another build, a restored
   *    profile snapshot, a synced browser profile). */
  {
    const { context, page, errors } = await openPage(browser, {
      "azkript.document.v3": draft("ToDelete", T.newer),
    });
    await page.evaluate((ghost) => {
      localStorage.setItem("fdstudio.document.v3", ghost);
    }, draft("Ghost", T.older));

    await page.locator("#settingsButton").click();
    await page.waitForTimeout(500);
    await page.locator('button.btn--danger:has-text("Clear local data")').click();
    await page.waitForTimeout(600);
    assert.equal(
      await page.locator("#appDialog").evaluate((el) => el.open),
      true,
      "confirmation opened from a dialog must stay open",
    );
    assert.equal(await page.locator("#dialogTitle").innerText(), "Clear local data?");
    await page.locator('#appDialog .btn--danger:has-text("Clear data")').click();
    await page.waitForTimeout(1500);

    const keys = await keysOf(page, "document");
    assert.deepEqual(
      keys,
      [],
      `clear local data must remove every doc spelling, including one injected after boot; saw ${keys}`,
    );

    await page.reload();
    await page.waitForTimeout(1400);
    const title = await page.locator("#docTitle").innerText();
    assert.equal(/ToDelete|Ghost/.test(title), false, `deleted draft resurrected as ${title}`);
    allErrors.push(...errors);
    await context.close();
  }

  /* 6. A failed write must never delete the only surviving copy. */
  {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__seeded2")) return;
      sessionStorage.setItem("__seeded2", "1");
      localStorage.setItem(
        "fdstudio.document.v3",
        JSON.stringify({
          title: "OnlyCopy",
          savedAt: "2026-10-15T00:00:00.000Z",
          paragraphs: [{ id: "x", type: "Action", html: "precious" }],
        }),
      );
      /* Simulate a full quota / blocked storage for the current key only. */
      const realSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function patched(key, value) {
        if (key === "azkript.document.v3") {
          throw new DOMException("QuotaExceededError", "QuotaExceededError");
        }
        return realSetItem.call(this, key, value);
      };
    });
    await page.goto(appUrl);
    await page.waitForTimeout(1200);
    assert.equal(await page.locator("#docTitle").innerText(), "OnlyCopy");
    const legacy = await page.evaluate(() => localStorage.getItem("fdstudio.document.v3"));
    assert.notEqual(
      legacy,
      null,
      "a failed migration write must not delete the last copy of the document",
    );
    await context.close();
  }

  /* 7. The same rule for preferences: an unreadable/never-written current key
   *    must not authorise deleting the legacy copy. */
  {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__seeded3")) return;
      sessionStorage.setItem("__seeded3", "1");
      localStorage.setItem("fdstudio.prefs.v2", JSON.stringify({ theme: "dark" }));
      const realSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function patched(key, value) {
        if (key === "azkript.prefs.v2") {
          throw new DOMException("QuotaExceededError", "QuotaExceededError");
        }
        return realSetItem.call(this, key, value);
      };
    });
    await page.goto(appUrl);
    await page.waitForTimeout(1200);
    /* The dark theme is applied from the legacy copy… */
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
    /* …so it must still exist for the next launch. */
    const legacyPrefs = await page.evaluate(() => localStorage.getItem("fdstudio.prefs.v2"));
    assert.notEqual(
      legacyPrefs,
      null,
      "a failed preference write must not delete the only copy of the preferences",
    );
    allErrors.push(...errors);
    await context.close();
  }

  assert.deepEqual(allErrors, []);
  console.log("PASS: storage migration test");
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  process.exit(1);
});
