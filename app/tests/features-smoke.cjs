/* Browser feature smoke for the expanded Azkript surface. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..", "..");
const { chromium } = require(path.join(root, "rea", "node_modules", "playwright-core"));
const chrome = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const appUrl = pathToFileURL(path.join(root, "app", "index.html")).href;

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: chrome });
  const context = await browser.newContext({
    viewport: { width: 1500, height: 1000 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto(appUrl);
  await page.waitForTimeout(900);

  // Title page preview and save.
  await page.locator("#titlePageButton").click();
  await page.waitForTimeout(300);
  assert.equal(await page.locator("#appDialog").evaluate((dialog) => dialog.open), true);
  assert.match(await page.locator("#titlePagePreview").innerText(), /THE LAST SIGNAL|The Last Signal/i);
  await page.locator("#tpContact").fill("room@example.test");
  await page.locator("#appDialog .btn--primary").click();
  await page.waitForTimeout(400);

  // SmartType completes an existing character.
  const character = page.locator('.para[data-type="Character"]').first();
  await character.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("MA");
  await page.waitForTimeout(220);
  assert.equal(await page.locator("#smartType").isVisible(), true);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  assert.equal((await character.innerText()).trim(), "MARA");

  // Find and replace.
  await page.locator("#findButton").click();
  await page.locator("#findInput").fill("OBSERVATORY");
  await page.waitForTimeout(250);
  assert.ok((await page.locator(".find-result").count()) >= 1);
  await page.locator("#replaceInput").fill("RIDGE");
  await page.locator("#findReplaceOne").click();
  await page.waitForTimeout(300);
  assert.match(await page.locator('.para[data-type="Scene Heading"]').first().innerText(), /RIDGE/);
  await page.locator("#findClose").click();

  // Revision marking, page view, and the revision legend.
  await page.locator("#revisionButton").click();
  await page.waitForTimeout(250);
  await page.locator("#appDialog .btn--primary").click();
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => document.body.classList.contains("revision-on")), true);
  const action = page.locator('.para[data-type="Action"]').first();
  await action.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" Marked for the next pass.");
  await page.waitForTimeout(350);
  assert.equal(await action.evaluate((el) => el.classList.contains("has-revision")), true);
  await page.locator("#viewSegmented [data-mode='page']").click();
  await page.waitForTimeout(700);
  assert.ok((await page.locator(".page-card").count()) >= 1);
  assert.ok((await page.locator(".page-card .has-revision").count()) >= 1);
  await page.locator("#viewSegmented [data-mode='write']").click();
  await page.waitForTimeout(300);

  // Scene card metadata, omission, and drag reorder.
  await page.locator('.rail__item[data-view="navigator"]').click();
  await page.waitForTimeout(400);
  const firstCard = page.locator(".scene-card").first();
  const firstHeading = await firstCard.locator("h3").innerText();
  await firstCard.locator('[data-card-action="details"]').click();
  await page.locator("#cardSynopsis").fill("A revised scene-card synopsis.");
  await page.locator("#appDialog .btn--primary").click();
  await page.waitForTimeout(400);
  assert.match(await page.locator(".scene-card__synopsis").first().innerText(), /revised scene-card/);
  await page.locator(".scene-card").first().dragTo(page.locator(".scene-card").nth(2));
  await page.waitForTimeout(500);
  assert.notEqual(await page.locator(".scene-card h3").first().innerText(), firstHeading);

  // Table read with deterministic speech synthesis.
  await page.locator('.rail__item[data-view="script"]').click();
  await page.waitForTimeout(300);
  /* Stub speech BEFORE the dock is opened. openReadDock() calls speakCurrent(),
   * so this keeps the suite silent on a developer's machine while still proving
   * the transport is driven (window.__spoken counts the calls).
   *
   * The stub has to synthesise onstart/onend because the read transport advances
   * on utterance.onend; a silent no-op would stall the read instead of testing
   * it. */
  await page.evaluate(() => {
    const speech = window.speechSynthesis;
    speech.getVoices = () => [];
    speech.cancel = () => {};
    speech.pause = () => {};
    speech.resume = () => {};
    speech.speak = (utterance) => {
      window.__spoken = (window.__spoken || 0) + 1;
      setTimeout(() => utterance.onstart && utterance.onstart(), 10);
      setTimeout(() => utterance.onend && utterance.onend(), 40);
    };
  });
  await page.locator("#readToggle").click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#readDock").evaluate((el) => el.classList.contains("is-open")), true);
  assert.ok((await page.evaluate(() => window.__spoken || 0)) >= 1);
  await page.locator("#readClose").click();

  // FDX round-trip through the real DOMParser.
  const roundTrip = await page.evaluate(() => {
    const doc = FDModel.sampleDocument();
    doc.titlePage.contact = "roundtrip@example.test";
    doc.revision.enabled = true;
    doc.revision.current = 2;
    doc.revision.history = [
      { id: 1, name: "Blue", hex: "#2b579a", pageColor: "#c6c6ed" },
      { id: 2, name: "Pink", hex: "#c2397a", pageColor: "#fdfdcc" },
    ];
    doc.paragraphs[1].revision = 2;
    const scene = FDModel.getScenes(doc)[1];
    scene.paragraph.scene = {
      ...scene.paragraph.scene,
      synopsis: "Round-trip synopsis",
      notes: "Round-trip note",
      number: "B2",
      omit: true,
    };
    const xml = FDX.serialize(doc);
    const parsed = FDX.parse(xml);
    return {
      hasTitlePage: /<TitlePage>/.test(xml),
      hasRevision: /RevisionMode="Yes"/.test(xml),
      parsedContact: parsed.titlePage.contact,
      /* Ids are rewritten to bare UUIDs on export, so match the scene by its
       * heading text rather than by the model's internal id. */
      parsedScene: parsed.paragraphs.find(
        (paragraph) => paragraph.type === "Scene Heading" && paragraph.scene?.number === "B2",
      )?.scene,
      parsedRevision: parsed.paragraphs[1].revision,
      parsedDual: parsed.meta.hasDualDialogue,
    };
  });
  assert.equal(roundTrip.hasTitlePage, true);
  assert.equal(roundTrip.hasRevision, true);
  assert.equal(roundTrip.parsedContact, "roundtrip@example.test");
  assert.equal(roundTrip.parsedScene.synopsis, "Round-trip synopsis");
  assert.equal(roundTrip.parsedScene.number, "B2");
  assert.equal(roundTrip.parsedScene.omit, true);
  assert.equal(roundTrip.parsedRevision, 2);
  assert.equal(roundTrip.parsedDual, true);

  /* Lossless round-trip: every app feature must survive serialize -> parse.
   * Azkript-only state (beats, cast, tags, alts, watermark, …) rides in the
   * <AzkriptData> side-channel; per-paragraph formatting uses native FDX
   * attributes. Nothing in the model may be dropped. */
  const lossless = await page.evaluate(() => {
    const doc = FDModel.sampleDocument();
    doc.paragraphs[1].pageBreakBefore = true;
    doc.paragraphs[1].alignment = "center";
    doc.paragraphs[1].spacing = "1.5";
    doc.paragraphs[1].spaceBefore = 6;
    doc.paragraphs[1].leading = "Loose";
    doc.paragraphs[3].changeType = "edit";
    doc.paragraphs[3].trackedOriginal = "<strong>before</strong>";
    doc.paragraphs[4].image = { caption: "Radio", url: "https://example.test/r.png" };
    doc.watermark = { enabled: true, text: "CONFIDENTIAL", opacity: 22, angle: -35 };
    doc.headerFooter = {
      headerText: "THE LAST SIGNAL", footerText: "DRAFT",
      showHeader: true, showFooter: true, showOnFirstPage: true, startingPage: 2,
    };
    doc.lockedPages = { locked: true, lockedAt: "2026-10-01T00:00:00Z", aPages: [2, 5] };
    doc.characterHighlights = { MARA: "#0f6cbd" };
    doc.nonSpeaking = ["MARA"];
    doc.smartType.locations = ["OBSERVATORY RIDGE"];
    doc.macros = [{ key: "Alt+9", name: "CUSTOM", text: "X ", element: "Action", nextElement: "Action" }];
    doc.settings = { ...doc.settings, showMore: false, targetPages: 99 };

    const before = FDModel.normalizeDocument(doc);
    const xml = FDX.serialize(before);
    const after = FDModel.normalizeDocument(FDX.parse(xml));

    const lost = [];
    const same = (label, a, b) => {
      if (JSON.stringify(a) !== JSON.stringify(b)) lost.push(label);
    };
    for (const field of ["beats", "bookmarks", "cast", "macros", "headerFooter",
      "moresContinueds", "watermark", "lockedPages", "characterHighlights",
      "nonSpeaking", "smartType", "titlePage", "settings"]) {
      same(field, before[field], after[field]);
    }
    same("alts", before.paragraphs[4].alts, after.paragraphs[4].alts);
    same("tags", before.paragraphs[1].tags, after.paragraphs[1].tags);
    // Attaching production tags adds native TagNumber run attributes. Compare
    // every text/style/other attribute while checking tag data independently.
    const comparableRuns = p => FDX.htmlToRuns(p.html).map(({ attrs, ...run }) => {
      const retained = Object.fromEntries(Object.entries(attrs || {}).filter(([key]) => key !== 'TagNumber'));
      return { ...run, ...(Object.keys(retained).length ? { attrs: retained } : {}) };
    });
    same("html", before.paragraphs.map(comparableRuns), after.paragraphs.map(comparableRuns));
    same("sceneProps", before.paragraphs.filter((p) => p.scene).map((p) => p.scene),
      after.paragraphs.filter((p) => p.scene).map((p) => p.scene));
    same("dualGroup", before.paragraphs.map((p) => p.dualGroup || null),
      after.paragraphs.map((p) => p.dualGroup || null));
    same("revision", before.revision, after.revision);

    const fmt = after.paragraphs[1];
    return {
      lost,
      hasAzkriptData: /<AzkriptData /.test(xml),
      pageBreak: fmt.pageBreakBefore === true,
      alignment: fmt.alignment === "center",
      spacing: fmt.spacing === "1.5",
      spaceBefore: fmt.spaceBefore === 6,
      leading: fmt.leading === "Loose",
      changeType: after.paragraphs[3].changeType === "edit",
      tracked: after.paragraphs[3].trackedOriginal === "<strong>before</strong>",
      image: JSON.stringify(after.paragraphs[4].image),
    };
  });
  assert.deepEqual(lossless.lost, [], `FDX round-trip lost: ${lossless.lost.join(", ")}`);
  assert.equal(lossless.hasAzkriptData, true);
  assert.equal(lossless.pageBreak, true);
  assert.equal(lossless.alignment, true);
  assert.equal(lossless.spacing, true);
  assert.equal(lossless.spaceBefore, true);
  assert.equal(lossless.leading, true);
  assert.equal(lossless.changeType, true);
  assert.equal(lossless.tracked, true);
  assert.match(lossless.image, /Radio/);

  /* Repeated saves must be byte-identical (no id/timestamp churn). */
  const idempotent = await page.evaluate(() => {
    const first = FDX.serialize(FDModel.normalizeDocument(FDModel.sampleDocument()));
    const second = FDX.serialize(FDModel.normalizeDocument(FDX.parse(first)));
    const third = FDX.serialize(FDModel.normalizeDocument(FDX.parse(second)));
    return { secondEqualsThird: second === third, firstEqualsSecond: first === second };
  });
  assert.equal(idempotent.secondEqualsThird, true, "Repeated saves must be stable");

  /* An FDX from another tool has no AzkriptData and must still open cleanly. */
  const external = await page.evaluate(() => {
    const parsed = FDX.parse(`<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<FinalDraft DocumentType="Script" Template="No" Version="6">
  <Content>
    <Paragraph Type="Scene Heading" id="p1"><SceneProperties Title="Roof" Summary="A roof" Length="1/8" Page="1"/><Text>EXT. ROOFTOP - DUSK</Text></Paragraph>
    <Paragraph Type="Action" id="p2"><Text>Wind.</Text></Paragraph>
  </Content>
</FinalDraft>`);
    return {
      studio: Boolean(parsed.meta && parsed.meta.azkriptData),
      paragraphs: parsed.paragraphs.length,
      heading: parsed.paragraphs[0].html,
      sceneTitle: parsed.paragraphs[0].scene && parsed.paragraphs[0].scene.title,
    };
  });
  assert.equal(external.studio, false);
  assert.equal(external.paragraphs, 2);
  assert.match(external.heading, /EXT\. ROOFTOP/);
  assert.equal(external.sceneTitle, "Roof");

  // Expanded Settings dialog choices + live studio updates.
  await page.locator("#settingsButton").click();
  assert.equal(await page.locator("#appDialog").evaluate((el) => el.open), true);
  assert.equal(await page.locator(".settings-nav__tab").count(), 5);
  await page.locator('[data-settings-tab="appearance"]').click();
  assert.equal(
    await page.locator('[data-settings-section="appearance"]').evaluate((el) => el.hidden),
    false,
  );
  assert.equal(
    await page.locator('[data-settings-section="editor"]').evaluate((el) => el.hidden),
    true,
  );
  await page.locator('[data-settings-tab="all"]').click();

  await page.locator('[data-accent-choice="violet"]').click();
  await page.locator("#settingsPaperTint").selectOption("sepia");
  await page.locator("#settingsDensity").selectOption("compact");
  await page.locator("#settingsLineSpacing").selectOption("relaxed");
  await page.locator("#settingsSceneNumberSide").selectOption("right");
  await page.locator('[data-setting="ambientGlow"]').click();
  await page.locator('[data-setting="pageNumbers"]').click();

  const settingsApplied = await page.evaluate(() => ({
    paperTint: document.body.dataset.paperTint,
    density: document.body.dataset.density,
    noAmbient: document.body.classList.contains("no-ambient"),
    brand: document.documentElement.style.getPropertyValue("--brand").trim(),
    paperPageText: document.getElementById("paperPage").textContent,
    sceneSide: document.getElementById("editor").dataset.sceneNumberSide,
  }));
  assert.equal(settingsApplied.paperTint, "sepia");
  assert.equal(settingsApplied.density, "compact");
  assert.equal(settingsApplied.noAmbient, true);
  assert.ok(settingsApplied.brand.length > 0);
  assert.equal(settingsApplied.paperPageText, "");
  assert.equal(settingsApplied.sceneSide, "right");

  await page.locator("#dialogActions .btn--primary").click();

  // Scene navigation shortcut (moveScene).
  await page.locator(".para").first().click();
  await page.keyboard.press("Control+Alt+ArrowDown");
  await page.waitForTimeout(150);
  const activeAfterMove = await page.locator(".para.is-active").innerText();
  assert.match(activeAfterMove, /INT\.|EXT\./);

  // Regression test: clicking Scene 6 / Scene 8 must scroll #paperScroll only,
  // with zero vertical displacement on the shell, titlebar, menubar, or commandbar.
  const beforeHeaderTop = await page.evaluate(() => ({
    titlebarTop: document.querySelector(".titlebar").getBoundingClientRect().top,
    menubarTop: document.querySelector(".menubar").getBoundingClientRect().top,
    commandbarTop: document.querySelector(".commandbar").getBoundingClientRect().top,
  }));
  for (let i = 0; i < 6; i += 1) {
    await page.locator("#addSceneButton").click();
    await page.waitForTimeout(60);
  }
  const sceneCount = await page.locator("#sceneList .scene-item").count();
  assert.ok(sceneCount >= 8, `Expected >= 8 scenes, got ${sceneCount}`);
  await page.locator("#sceneList .scene-item").nth(5).click();
  await page.waitForTimeout(350);
  await page.locator("#sceneList .scene-item").nth(7).click();
  await page.waitForTimeout(350);
  const afterJumpMetrics = await page.evaluate(() => ({
    windowScrollY: window.scrollY,
    docScrollTop: document.documentElement.scrollTop,
    bodyScrollTop: document.body.scrollTop,
    shellScrollTop: document.getElementById("appShell").scrollTop,
    mainScrollTop: document.getElementById("main").scrollTop,
    viewStackScrollTop: document.getElementById("viewStack").scrollTop,
    scriptViewScrollTop: document.getElementById("scriptView").scrollTop,
    paperScrollTop: document.getElementById("paperScroll").scrollTop,
    titlebarTop: document.querySelector(".titlebar").getBoundingClientRect().top,
    menubarTop: document.querySelector(".menubar").getBoundingClientRect().top,
    commandbarTop: document.querySelector(".commandbar").getBoundingClientRect().top,
  }));
  assert.equal(afterJumpMetrics.windowScrollY, 0);
  assert.equal(afterJumpMetrics.docScrollTop, 0);
  assert.equal(afterJumpMetrics.bodyScrollTop, 0);
  assert.equal(afterJumpMetrics.shellScrollTop, 0);
  assert.equal(afterJumpMetrics.mainScrollTop, 0);
  assert.equal(afterJumpMetrics.viewStackScrollTop, 0);
  assert.equal(afterJumpMetrics.scriptViewScrollTop, 0);
  assert.ok(afterJumpMetrics.paperScrollTop > 0, "Expected #paperScroll to scroll to lower scene");
  assert.equal(afterJumpMetrics.titlebarTop, beforeHeaderTop.titlebarTop);
  assert.equal(afterJumpMetrics.menubarTop, beforeHeaderTop.menubarTop);
  assert.equal(afterJumpMetrics.commandbarTop, beforeHeaderTop.commandbarTop);

  // Verify Outline Timeline, Ruler, Menu Bar, Split View, and ScriptNote.
  assert.ok((await page.locator("#outlineTrack .outline-segment").count()) >= 8);
  assert.ok((await page.locator("#rulerTicks .ruler-tick").count()) >= 8);
  await page.locator('.menubar__item[data-ribbon-tab="format"]').click();
  assert.equal(await page.locator('.ribbon-tab-panel[data-ribbon-panel="format"]').isVisible(), true);
  assert.equal(await page.locator('.ribbon-tab-panel[data-ribbon-panel="home"]').isVisible(), false);
  assert.equal(await page.locator("#menuFlyout").count(), 0, "Ribbon tabs must not open a flyout menu");
  await page.locator('.menubar__item[data-ribbon-tab="home"]').click();
  assert.equal(await page.locator('.ribbon-tab-panel[data-ribbon-panel="home"]').isVisible(), true);

  await page.locator("#splitViewButton").click();
  assert.equal(await page.locator("#splitPane").isVisible(), true);
  await page.locator("#splitViewButton").click();
  assert.equal(await page.locator("#splitPane").isVisible(), false);

  await page.locator('.ribbon-tab-panel[data-ribbon-panel="home"] [data-ribbon-command="insert-scriptnote"]').click();
  assert.equal(await page.locator("#appDialog").evaluate((el) => el.open), true);
  await page.locator("#scriptNoteInput").fill("Verify continuity on telescope dish.");
  await page.locator("#dialogActions .btn--primary").click();
  await page.waitForTimeout(150);
  assert.ok((await page.locator(".para.has-note").count()) >= 1);

  // Verify Top-Centric View Rail, Multi-Tab Contextual Ribbon, Scene View, Beat Board, Navigator Sub-Tabs, and Alt Dialogue.
  assert.equal(await page.locator("#rail .rail__item[data-view]").count(), 6);
  await page.locator('.menubar__item[data-ribbon-tab="tools"]').click();
  assert.equal(await page.locator('.ribbon-tab-panel[data-ribbon-panel="tools"]').isVisible(), true);
  await page.locator('.menubar__item[data-ribbon-tab="home"]').click();
  assert.equal(await page.locator('.ribbon-tab-panel[data-ribbon-panel="home"]').isVisible(), true);

  await page.locator('.rail__item[data-view="sceneview"]').click();
  await page.waitForTimeout(200);
  assert.ok((await page.locator("#sceneViewTable .sv-row").count()) >= 8);

  await page.locator('.rail__item[data-view="beatboard"]').click();
  await page.waitForTimeout(200);
  assert.ok((await page.locator("#beatBoardCanvas .beat-card").count()) >= 4);

  await page.locator('.navigator-tab[data-nav-tab="tags"]').click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator("#navTagsList").isVisible(), true);
  await page.locator('.navigator-tab[data-nav-tab="scenes"]').click();

  await page.locator('.rail__item[data-view="script"]').click();
  await page.waitForTimeout(200);
  assert.ok((await page.locator(".para.has-alts").count()) >= 1);

  assert.deepEqual(errors, []);
  console.log("PASS: feature smoke test");
  await browser.close();
})().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  process.exit(1);
});
