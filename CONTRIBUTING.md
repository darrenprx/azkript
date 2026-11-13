# Development and feedback

Azkript is currently marked `UNLICENSED`, rather than offered under an open-source
license. Discuss substantial code contributions with the maintainer before
starting them. Bug reports and reproducible compatibility feedback are welcome.

Use the setup and test commands in [README.md](README.md). Run `npm ci` from a
clean checkout; tests use the pinned project dependencies directly. Browser
checks require Chrome, and desktop checks require Windows. Set `CHROME_PATH`
when Chrome is installed in a different location.

Before proposing a change:

1. Run `npm run test:public`, `npm test` and the Python format tests.
2. Run the browser or desktop suites for the affected feature.
3. Include the behavior changed, its reason, checks run and any remaining limits.

Use synthetic documents for examples, fixtures and screenshots. Do not commit
private drafts, personal plans, local research, vendor applications, generated
builds, reports, credentials or signing certificates. The repository content
check scans new files, staged blobs and locally available history; it is a
pattern-based safeguard and still needs human review.

Security reports follow [SECURITY.md](SECURITY.md). Ordinary bug reports should
include the Azkript and Windows versions, concise reproduction steps, expected
and actual behavior, and a small synthetic file when needed. Redact file paths,
names and document text from logs and screenshots.

Dependency updates must retain exact top-level versions and a matching lockfile.
The minimatch override selects a patched release for affected build-tool versions
while retaining the older API required by legacy glob consumers; validate
packaging when changing or removing it. `npm audit` checks the complete dependency
tree, including development tools, and needs access to the npm registry.
