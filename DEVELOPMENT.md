# Developing Azkript

[Back to the overview](README.md) · [User guide](USER_GUIDE.md) · [Release procedure](RELEASING.md)

## Setup

Use Node.js 22.12 or newer and npm 10 or newer. Windows is the primary desktop target.

```powershell
npm ci
npm start
```

The browser interface can also be opened from `app/index.html`.

`npm ci` installs the pinned Electron and Playwright runtimes. Tests use the
project's dependencies directly; no research checkout or filesystem links are
required.

## Checks and brand assets

The rounded ribbon uses original, font-free SVG geometry. To change its palette
or geometry, regenerate the shared app symbols and Windows icons together:

```powershell
npm run brand:build
npm run brand:sync
npm run brand:icons
npm run brand:check
```

Windows frames are rendered at their native sizes; 16–32 px use the small optical
variant. Packaging rejects stale SVGs, sprites or icon assets using their source
hashes. The retired page-and-letter artwork is absent from the current build;
review historical revisions separately before making the repository public.

Python 3.11 or newer is required for development checks and the pinned Pillow
image tools. The optional dependency-free file-format utilities support Python 3.10.
Browser checks require Chrome; set `CHROME_PATH` when it is installed elsewhere.

```powershell
python -m pip install -r requirements-dev.txt
python -m pip_audit --strict -r requirements-dev.txt
npm test
npm run test:public
python -m unittest discover -s tests -v
npm run test:ui
npm run test:security
npm run test:workspace
npm run test:production
npm run test:story
```

GitHub Actions runs publication checks, dependency auditing, JavaScript and
Python tests, browser smoke tests and hidden desktop security tests on Windows.
Automated accessibility checks inspect Chromium's accessibility backend;
physical input methods and real screen-reader behavior require separate
interactive acceptance tests.

## Windows builds and signing

```powershell
npm run package:win
npm run verify:release
```

Build outputs are written to `dist/`:

- `Azkript-1.2.0-portable.exe`
- `Azkript-Setup-1.2.0.exe`
- `win-unpacked/Azkript.exe`

The installer registers Azkript under Open With while preserving existing file
defaults. Uninstall keeps user data. Builds are currently unsigned.

The portable executable uses the local Azkript profile by default. Set
`AZKRIPT_USER_DATA` before launch to select a different profile directory.
See [local data and privacy](PRIVACY.md), [third-party notices](THIRD_PARTY_NOTICES.md)
and the [release procedure](RELEASING.md) before distributing a build.

`npm run release:build` builds, verifies packaged source freshness, and writes
`dist/release.json` plus `SHA256SUMS.txt`. The manifest records artifact hashes,
source revision, dirty state and pinned dependency versions. The manual Windows
beta workflow runs source/workspace tests and retains those exact artifacts.
This provides a repeatable build procedure and deterministic manifests; signed
EXE bytes are not claimed to be reproducible across machines or timestamp runs.

When a signing certificate is available, install it in the Windows certificate
store and use `npm run release:sign -- -CertificateThumbprint THUMBPRINT`.
The script requires the Windows signing tools, rebuilds with mandatory signing,
checks the inner EXE and both wrappers, verifies the package, and regenerates
hashes after signing. Signing has not been exercised with a real identity yet.

Set `AZKRIPT_TRUSTED_SIGNER` to the publisher certificate thumbprint before
launching the app to enable local update/rollback staging. Choose a release
manifest beside its installer; the app verifies version direction, size, hash,
Authenticode validity, the pinned publisher and the installer's embedded product
and version before staging a private copy.
It never runs an installer automatically. Keep the earlier installer and a draft
backup for rollback, close the app and run the staged installer explicitly.
Update/rollback validation has automated synthetic coverage; a real signed
cross-version installation/rollback acceptance run remains pending.

## File-format tools

The optional `fdformat` Python package provides dependency-free inspection and
conversion utilities for FDX/FDXT and `.fddat` files:

```powershell
python -m fdformat --help
```

