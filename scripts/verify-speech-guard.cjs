/* Guard: no automation that loads the app may trigger table-read speech without
 * silencing it first.
 *
 * Reported defect: "when you run it always pops the read aloud thing, so it
 * always play the read on my computer".
 *
 * Cause: `openReadDock()` ends with `speakCurrent()`. Any script that opens the
 * read dock — to measure it, screenshot it, or audit its selects — therefore
 * starts real speech synthesis. Headless browsers have no audio device, but
 * Playwright inherits the OS audio on a developer's machine, so running the test
 * suite narrated the screenplay out loud. Five scripts did this.
 *
 * This is a source-level guard, deliberately: it costs no browser launch, so it
 * can sit in front of the expensive suites. It finds every script that mentions a
 * read-dock trigger and requires one of:
 *   - it calls `silenceSpeech(...)` from scripts/lib/silence-speech.cjs, or
 *   - it stubs `speechSynthesis.speak` itself before the click.
 *
 * Usage: node scripts/verify-speech-guard.cjs
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

/* Directories that hold executable automation. `reports/` is excluded on purpose:
 * it holds the historical investigation scripts from the 2026-10-22/23 sessions,
 * which are records rather than things the suite runs. */
const DIRS = ["scripts", path.join("app", "tests"), path.join("desktop", "tests")];

/* Anything that can open the read dock or start a read. */
const TRIGGER = /\b(readToggle|readRailButton|tableReadButton|startTableRead|table-read|table-read:here|openReadDock)\b/;

/* Ways of being safe. */
const GUARDED = /silenceSpeech\s*\(|speechSynthesis\.speak\s*=|speak\s*=\s*\(utterance\)|speak\s*=\s*\(/;

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".cjs") || entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

const files = DIRS.flatMap((d) => walk(path.join(root, d)));
const offenders = [];
const guarded = [];

for (const file of files) {
  const rel = path.relative(root, file);
  // The helper itself and this guard are not automation surfaces.
  if (rel.includes("silence-speech") || rel.includes("verify-speech-guard")) continue;
  const src = fs.readFileSync(file, "utf8");
  if (!TRIGGER.test(src)) continue;
  if (GUARDED.test(src)) {
    guarded.push(rel);
  } else {
    offenders.push(rel);
  }
}

console.log(`scripts that touch the read dock: ${guarded.length + offenders.length}`);
for (const g of guarded) console.log(`  ok    ${g}`);
for (const o of offenders) console.log(`  UNSAFE ${o}`);

if (guarded.length === 0) {
  console.error(
    "\nFAIL: no script was found touching the read dock at all — this guard is measuring nothing\n" +
      "(the trigger list or the directories are wrong)."
  );
  process.exitCode = 1;
} else if (offenders.length) {
  console.error(
    `\nFAIL: ${offenders.length} script(s) can start table-read speech without silencing it.\n` +
      "Opening the read dock calls speakCurrent(), which narrates the screenplay on a\n" +
      "developer's machine. Add, before any page.goto():\n\n" +
      "    const { silenceSpeech } = require('<relative>/scripts/lib/silence-speech.cjs');\n" +
      "    await silenceSpeech(page);\n"
  );
  process.exitCode = 1;
} else {
  console.log(
    `\nPASS: all ${guarded.length} read-dock script(s) silence speech before opening the dock.`
  );
}
