# Windows beta releases

The supported release target is Windows x64. Keep installer-wizard, physical
input-method, screen-reader and signed cross-version acceptance separate from
automated source checks. Do not describe synthetic signing tests as signed
installation acceptance.

## Verify a clean checkout

Use the pinned dependencies and an installed Chrome. Run these commands from
PowerShell, stopping on any failure:

```powershell
npm ci
python -m pip install -r requirements-dev.txt
npm run test:public
npm audit --audit-level=moderate
npm test
python -m unittest discover -s tests -v
npm run test:ui
npm run test:security
npm run test:workspace
npm run test:production
npm run test:story
npm run test:polish
```

`test:public` examines the working tree, index and every locally reachable commit.
Fetch the complete history before using that result to assess a repository
visibility change. Inspect screenshots and example files for private content as
well; text-pattern scanning cannot assess everything inside an image.

## Build and inspect artifacts

```powershell
npm run release:build
npm run test:desktop
```

`release:build` creates both Windows wrappers, compares every included runtime
file with the source, checks the pinned Electron runtime and its notices,
verifies the rendered package and icons, compares wrapper payloads and generates
`dist/release.json` and `dist/SHA256SUMS.txt`. A nonzero exit means the artifacts
must not be distributed. The manifest records whether the source is dirty;
publish a normal release from a reviewed, committed revision.

The manual GitHub Actions workflow builds an unsigned beta and stores artifacts.
It does not publish a GitHub Release or change repository visibility. Its
packaged security and desktop smoke checks use the generated executable.

Distribute the versioned artifacts listed in the current manifest. A local
`dist/` can also contain older builds, debug configuration and historical QA
receipts; do not publish that directory wholesale. Bind any QA receipt to the
current artifact hashes, and retain older evidence separately.

For a signed release, configure a Windows signing identity and use the signing
command in the README. Do not store certificates or private keys in Git. Verify
the inner executable, both wrappers and final hashes after signing. Exercise a
real signed upgrade and rollback before describing that path as accepted.

## Manual acceptance

- Install using the visible wizard on a supported Windows machine.
- Open, edit, save and reopen a copy of a representative script.
- Exercise a physical IME, keyboard navigation and a real screen reader.
- Check PDF output, installed speech voices and rehearsal microphone controls.
- Verify file defaults, existing drafts and profile data survive upgrade.
- Uninstall, confirm intended data retention, and test reinstall.
- Review licensing, third-party notices, privacy information and known limits.

Keep the previous installer and independent draft backups when testing version
changes. Record the artifact hashes, Windows version, results and outstanding
limits alongside the release evidence.
