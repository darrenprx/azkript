/* Mutation-check the storage migration test.
 *
 * Proves the regression suite actually fails when each protected behaviour is
 * reverted. A test that passes against a broken build is worse than no test,
 * so every mutation below is expected to make `app/tests/storage-migration.cjs`
 * exit non-zero.
 *
 * Only `app/` and `package.json` are copied; `rea/node_modules` is reached via a
 * junction so the sweep does not duplicate hundreds of megabytes per mutant.
 *
 *   node scripts/mutation-check.cjs
 */
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const run = promisify(execFile);
const root = path.resolve(__dirname, "..");

/* Each mutant reverts exactly one protection in app/js/app.js. */
const MUTANTS = [
  {
    name: "baseline (no mutation)",
    expectCaught: false,
  },
  {
    name: "clear-local-data stops removing legacy doc keys",
    expectCaught: true,
    from: "for (const key of RENAMED_DOC_KEYS) localStorage.removeItem(key);",
    to: "/* reverted */",
  },
  {
    name: "prune list omits the azkript.document.v2 spelling",
    expectCaught: true,
    from: "dropRenamedKeys([LEGACY_DOC_KEY, ...RENAMED_DOC_KEYS], DOC_KEY);",
    to: "dropRenamedKeys(RENAMED_DOC_KEYS, DOC_KEY);",
  },
  {
    name: "prune list omits the fdstudio.document.v2 spelling",
    expectCaught: true,
    from: '  const RENAMED_DOC_KEYS = ["fdstudio.document.v3", "fdstudio.document.v2"];',
    to: '  const RENAMED_DOC_KEYS = ["fdstudio.document.v3"];',
  },
  {
    name: "prune runs even when the current write failed",
    expectCaught: true,
    from: "    if (winnerPersisted) {\n      dropRenamedKeys([LEGACY_DOC_KEY, ...RENAMED_DOC_KEYS], DOC_KEY);\n    }",
    to: "    dropRenamedKeys([LEGACY_DOC_KEY, ...RENAMED_DOC_KEYS], DOC_KEY);",
  },
  {
    name: "newest-wins is reverted to plain read order (A1 data-loss bug)",
    expectCaught: true,
    from: "(candidate.stamp > best.stamp ? candidate : best)",
    to: "best",
  },
  {
    name: "prefs prune runs without a readable current key",
    expectCaught: true,
    from: "    if (safeParse(storageGet(PREFS_KEY))) {\n      dropRenamedKeys([LEGACY_PREFS_KEY, ...RENAMED_PREFS_KEYS], PREFS_KEY);\n    }",
    to: "    dropRenamedKeys([LEGACY_PREFS_KEY, ...RENAMED_PREFS_KEYS], PREFS_KEY);",
  },
];

async function prepare(tempDir) {
  await fsp.cp(path.join(root, "app"), path.join(tempDir, "app"), { recursive: true });
  await fsp.cp(path.join(root, "package.json"), path.join(tempDir, "package.json"));
  await fsp.mkdir(path.join(tempDir, "rea"), { recursive: true });
  const target = path.join(tempDir, "rea", "node_modules");
  const source = path.join(root, "rea", "node_modules");
  try {
    await fsp.symlink(source, target, "junction");
  } catch {
    await fsp.cp(source, target, { recursive: true });
  }
}

async function main() {
  const results = [];
  for (const mutant of MUTANTS) {
    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "azkript-mut-"));
    let caught = false;
    let note = "";
    try {
      await prepare(tempDir);
      const appJs = path.join(tempDir, "app", "js", "app.js");
      if (mutant.from) {
        const text = await fsp.readFile(appJs, "utf8");
        if (!text.includes(mutant.from)) {
          note = "PATTERN NOT FOUND — mutant is stale, update it";
        } else {
          await fsp.writeFile(appJs, text.replace(mutant.from, mutant.to), "utf8");
        }
      }
      const testFile = path.join(tempDir, "app", "tests", "storage-migration.cjs");
      try {
        await run(process.execPath, [testFile], { cwd: tempDir, timeout: 300000 });
        caught = false;
      } catch {
        caught = true;
      }
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }

    const expected = mutant.expectCaught;
    const ok = note ? false : caught === expected;
    results.push({ name: mutant.name, caught, expected, ok, note });
    console.log(
      `${ok ? "PASS" : "FAIL"}  ${mutant.name} — ` +
        (note || (expected ? (caught ? "test caught it" : "TEST DID NOT CATCH IT") : caught ? "baseline failed" : "baseline green")),
    );
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.error(`\n${failed.length} mutation check(s) failed`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll ${results.length} mutation checks behave as expected`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
