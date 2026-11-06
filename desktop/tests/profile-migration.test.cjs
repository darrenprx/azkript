/* Tests for the desktop profile carry-over from the pre-rename folder.
 *
 * The rename changes Electron's derived userData path, so this module is what
 * keeps an existing user's recent files, window state and recovery copy. The
 * behaviour worth protecting is: copy once, never clobber newer files, never
 * delete the old profile, and stay a no-op when there is nothing to carry.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { migrateProfile, MARKER_NAME } = require("../profile-migration.js");

async function makeTemp() {
  return fsp.mkdtemp(path.join(os.tmpdir(), "azkript-migration-"));
}

async function seedProfile(dir) {
  await fsp.mkdir(path.join(dir, "recovery"), { recursive: true });
  await fsp.mkdir(path.join(dir, "Local Storage"), { recursive: true });
  await fsp.mkdir(path.join(dir, "Cache"), { recursive: true });
  await fsp.writeFile(
    path.join(dir, "recent.json"),
    JSON.stringify({ version: 1, items: [{ path: "C:\\scripts\\a.fdx", name: "a.fdx" }] }),
  );
  await fsp.writeFile(path.join(dir, "window-state.json"), JSON.stringify({ width: 1200 }));
  await fsp.writeFile(path.join(dir, "recovery", "session.json"), JSON.stringify({ document: {} }));
  await fsp.writeFile(path.join(dir, "Local Storage", "leveldb.log"), "document-bytes");
  await fsp.writeFile(path.join(dir, "Cache", "cache-file"), "throwaway");
}

test("copies the pre-rename profile forward once and leaves the original", async () => {
  const temp = await makeTemp();
  try {
    const legacy = path.join(temp, "Final Draft Studio");
    const userData = path.join(temp, "Azkript");
    await seedProfile(legacy);

    const first = await migrateProfile({ userDataDir: userData, legacyDir: legacy });
    assert.equal(first.migrated, true);
    assert.equal(first.reason, "copied");

    assert.deepEqual(JSON.parse(await fsp.readFile(path.join(userData, "recent.json"), "utf8")), {
      version: 1,
      items: [{ path: "C:\\scripts\\a.fdx", name: "a.fdx" }],
    });
    assert.equal(fs.existsSync(path.join(userData, "window-state.json")), true);
    assert.equal(fs.existsSync(path.join(userData, "recovery", "session.json")), true);
    assert.equal(fs.existsSync(path.join(userData, "Local Storage", "leveldb.log")), true);
    /* Machine caches are skipped; copying them is slow and can hit locks. */
    assert.equal(fs.existsSync(path.join(userData, "Cache")), false);

    /* The old profile must survive so a rollback still works. */
    assert.equal(fs.existsSync(path.join(legacy, "recent.json")), true);

    const second = await migrateProfile({ userDataDir: userData, legacyDir: legacy });
    assert.equal(second.migrated, false);
    assert.equal(second.reason, "already-migrated");
    assert.equal(fs.existsSync(path.join(userData, MARKER_NAME)), true);
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
});

test("a repeat run never overwrites work done in the new profile", async () => {
  const temp = await makeTemp();
  try {
    const legacy = path.join(temp, "Final Draft Studio");
    const userData = path.join(temp, "Azkript");
    await seedProfile(legacy);
    await migrateProfile({ userDataDir: userData, legacyDir: legacy });

    await fsp.writeFile(path.join(userData, "recent.json"), JSON.stringify({ items: ["newer"] }));
    await migrateProfile({ userDataDir: userData, legacyDir: legacy });
    assert.deepEqual(JSON.parse(await fsp.readFile(path.join(userData, "recent.json"), "utf8")), {
      items: ["newer"],
    });

    /* Also prove the copy itself does not clobber, not just the marker: drop
     * the marker and re-run, simulating a partially restored profile. */
    await fsp.rm(path.join(userData, MARKER_NAME), { force: true });
    const forced = await migrateProfile({ userDataDir: userData, legacyDir: legacy });
    assert.equal(forced.migrated, true, "a missing marker allows a retry");
    assert.deepEqual(
      JSON.parse(await fsp.readFile(path.join(userData, "recent.json"), "utf8")),
      { items: ["newer"] },
      "existing files survive a retry",
    );
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
});

test("is a no-op without a legacy profile, or when both paths are the same", async () => {
  const temp = await makeTemp();
  try {
    const missing = await migrateProfile({
      userDataDir: path.join(temp, "Azkript"),
      legacyDir: path.join(temp, "Final Draft Studio"),
    });
    assert.deepEqual(missing, { migrated: false, reason: "no-legacy-profile", copied: [] });
    assert.equal(fs.existsSync(path.join(temp, "Azkript")), false);

    const same = path.join(temp, "one");
    await fsp.mkdir(same, { recursive: true });
    assert.equal((await migrateProfile({ userDataDir: same, legacyDir: same })).reason, "same-directory");

    const notDir = path.join(temp, "file-profile");
    await fsp.writeFile(notDir, "not a directory");
    assert.equal(
      (await migrateProfile({ userDataDir: path.join(temp, "Azkript2"), legacyDir: notDir })).reason,
      "legacy-not-a-directory",
    );
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
});

test("skips entries that cannot be copied without failing the migration", async () => {
  const temp = await makeTemp();
  try {
    const legacy = path.join(temp, "Final Draft Studio");
    const userData = path.join(temp, "Azkript");
    await seedProfile(legacy);
    /* A dangling junction/symlink or locked file must not abort the copy. */
    await fsp.symlink(path.join(legacy, "does-not-exist"), path.join(legacy, "broken-link")).catch(() => {});

    const result = await migrateProfile({ userDataDir: userData, legacyDir: legacy });
    assert.equal(result.migrated, true);
    assert.equal(fs.existsSync(path.join(userData, "recent.json")), true);
  } finally {
    await fsp.rm(temp, { recursive: true, force: true });
  }
});
