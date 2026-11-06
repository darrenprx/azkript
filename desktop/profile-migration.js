/* Azkript — one-time carry-over from the pre-rename profile folder.
 *
 * Electron derives `userData` from the application name, so renaming the app
 * means a returning user gets a brand-new, empty %APPDATA%\Azkript folder:
 * recent documents, window placement, the crash-recovery copy and the
 * renderer's Chromium-held document/prefs storage would all appear lost.
 *
 * This copies the old profile forward once. It never moves or deletes the old
 * folder, so rolling back to the previous build still finds its data, and it
 * leaves a marker so the copy cannot run twice or overwrite newer files.
 *
 * Kept free of Electron imports so the behaviour is unit-testable.
 */
"use strict";

const fsp = require("node:fs/promises");
const path = require("node:path");

const MARKER_NAME = ".migrated-from-final-draft-studio";

/* Entries that are pure per-machine caches. Copying them wastes time and can
 * fail on locked files, so they are skipped; everything user-meaningful
 * (Local Storage, Session Storage, IndexedDB, recent.json, window-state.json,
 * recovery/) is carried over. */
const SKIP_ENTRIES = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "ShaderCache",
  "GrShaderCache",
  "GraphiteDawnCache",
  "Crashpad",
  "blob_storage",
  "logs",
]);

async function copyEntry(from, to) {
  try {
    await fsp.cp(from, to, { recursive: true, force: false, errorOnExist: false });
    return true;
  } catch {
    /* A single locked or unreadable file must not abort the whole migration. */
    return false;
  }
}

/**
 * Copy `legacyDir` into `userDataDir` once.
 *
 * @param {object} options
 * @param {string} options.userDataDir  Current (new) profile directory.
 * @param {string} options.legacyDir    Pre-rename profile directory.
 * @returns {Promise<{migrated: boolean, reason: string, copied: string[]}>}
 */
async function migrateProfile({ userDataDir, legacyDir }) {
  const current = path.resolve(userDataDir);
  const legacy = path.resolve(legacyDir);
  if (current === legacy) return { migrated: false, reason: "same-directory", copied: [] };

  let legacyStat;
  try {
    legacyStat = await fsp.stat(legacy);
  } catch {
    return { migrated: false, reason: "no-legacy-profile", copied: [] };
  }
  if (!legacyStat.isDirectory()) {
    return { migrated: false, reason: "legacy-not-a-directory", copied: [] };
  }

  const existing = await fsp.readdir(current).catch(() => []);
  if (existing.includes(MARKER_NAME)) {
    return { migrated: false, reason: "already-migrated", copied: [] };
  }

  await fsp.mkdir(current, { recursive: true });
  const entries = await fsp.readdir(legacy).catch(() => []);
  const copied = [];
  for (const entry of entries) {
    if (SKIP_ENTRIES.has(entry)) continue;
    if (await copyEntry(path.join(legacy, entry), path.join(current, entry))) {
      copied.push(entry);
    }
  }

  try {
    await fsp.writeFile(
      path.join(current, MARKER_NAME),
      `Migrated from ${legacy} on ${new Date().toISOString()}\n`,
      "utf8",
    );
  } catch {
    /* The copy already happened; a missing marker only means a retry is cheap. */
  }
  return { migrated: true, reason: "copied", copied };
}

module.exports = { migrateProfile, MARKER_NAME, SKIP_ENTRIES };
