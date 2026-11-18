"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function withAppCopy(root, extraFiles, run) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "azkript-style-mutation-"));
  try {
    for (const relative of ["app", ...extraFiles]) {
      const target = path.join(copy, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.cpSync(path.join(root, relative), target, { recursive: true });
    }
    return run(copy);
  } finally {
    fs.rmSync(copy, { force: true, recursive: true, maxRetries: 3 });
  }
}

module.exports = { withAppCopy };
