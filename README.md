# Azkript

Azkript is a Windows desktop screenplay editor with a browser interface and
FDX/FDXT file support. It is an independent application and is not affiliated
with Final Draft or its publisher.

Azkript is beta software for Windows x64. Builds are currently unsigned. Keep
independent backups and use copies of important scripts while assessing a build.
Exact pagination parity with other editors has not been certified.

![Azkript workspace](app/preview.png)

## Features

- Screenplay editing with paragraph types, keyboard shortcuts and SmartType.
- Page view, scene navigation, index cards and a beat board.
- Native Open, Save and Save As, recent documents and recovery drafts.
- Title pages, revision marks, Find and Replace, reports and PDF export.
- FDX/FDXT import/export, including supported production metadata.
- Light and dark themes, configurable appearance and OS speech voices.
- Portable Windows app and a per-user installer.
- Writing/Production workspaces, saved layouts and configurable quick access.
- Unified scene/note/beat/cast/tag search and a linked notes scratchpad.
- Multi-script project folders with a shared cast/location bible.
- Previewed scene restructuring, named draft milestones and scene/dialogue comparisons.
- Issued production pagination with A/B overflow pages, omitted-page notices and stable scene numbers.
- Revision PDF packets, changed-page lists, breakdown CSV and rehearsal/department reports.
- PDF preflight, previewed Fountain/structured-text exchange, table-read timing and WAV export.
- Scoped comments, offline review permissions, draft approvals and clean review copies.
- Scene-linked story timelines, continuity evidence, character arcs and alternate story branches.
- Writer-assigned pacing, embedded storyboards/animatics, rehearsal recordings and production dependency graphs.

## Development

Use Node.js 22.12 or newer and npm 10 or newer. Windows is the primary desktop target.

```powershell
npm ci
npm start
```

The browser interface can also be opened from `app/index.html`.

`npm ci` installs the pinned Electron and Playwright runtimes. Tests use the
project's dependencies directly; no research checkout or filesystem links are
required.

## Tests

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

## Windows builds

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

The titlebar **Workspace** button and command palette open layouts, search,
scratchpad, projects, scene operations and milestones. `Ctrl+Shift+F` searches
scenes, notes, beats, characters and tags. Layouts and per-document positions
stay in the local profile; notes travel in the AzkriptData section of FDX files.
Other editors may discard those private notes. A project folder contains a
`project.azkproj` manifest, independent FDX scripts, and a shared plain-text bible.
Adding a script creates a copy. Named milestones remain in local version history
and are kept when automatic snapshots rotate.

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

## Production and handoff

The titlebar **Production and handoff** button and command palette open the
production tools. Issue and lock a baseline before editing an issued script. Expansion
creates insertion pages such as 12A/12B; removing an issued page's content keeps
an OMITTED sheet. Scene numbers remain stable, including inserted scenes. Page
geometry changes and moving issued paragraphs require unlocking and reissuing.
Azkript stores its issued boundaries in AzkriptData; native vendor locking is
not inferred or certified. Stable scene numbers and breakdown tags also export
as native FDX data.

Revision packets compare the current draft with that baseline, export complete
changed pages, and list changed or withdrawn insertion pages with scene
references. Record the next revision baseline after issuing a packet to compare
successive revisions without losing insertion-page labels. Breakdown exports cover cast, props, costume, locations, vehicles
and effects. Character sides retain complete scenes for cue context; dialogue,
location and shot reports have separate text exports. PDF export runs preflight
for text coverage, rendered overflow, geometry, requested fonts and revision
colors. Font substitution is reported as a warning.

Fountain import shows inferred elements and warnings before replacing the
draft. Its supported screenplay subset includes forced elements, scene numbers,
parentheticals and dual dialogue. Emphasis remains literal; outline/boneyard
content is omitted with preview warnings. Structured text preserves element
types and paragraph text, including custom types, but carries no production
metadata or rich formatting.

Table-read settings include pronunciation replacements, per-speaker voice,
rate/pitch and estimated scene duration. Desktop WAV export uses installed
Windows speech voices without playing audio. Browser and Windows voice names
may differ; unavailable requested Windows voices stop export with an error.

Review packets (`.azkreview`) contain a read-only clean screenplay and one
invitation granting read, comment or approval permissions. The owner imports a
single response (`.azkresponse`); it must match the invitation and unchanged
draft. Open comments prevent approval, edits invalidate approval, and invitation
responses cannot replace screenplay content. These are offline bearer
permissions with self-reported names, not authenticated collaboration. Clean
review FDX exports remove comments, approval data, scratchpad notes, scene notes,
tags and alternate lines; review history remains in the owner's draft.

## Story studio (1.2.0)

The titlebar **Story studio** button and command palette open these tools:

| Tool | Behavior |
| --- | --- |
| Timeline | Resizable timeline lanes, draggable/resizable page spans, scene-page links and beat goals. Overlapping events stack inside a scrollable lane. |
| Continuity | A cast/location/prop scene map and explicit continuity facts. Establish, require and clear checks follow scene order and exclude omitted evidence. Knowledge facts can coexist. |
| Character arcs | Character-state and relationship values with scene-linked evidence, an arc sequence and relationship graph. Values come from the writer. |
| Story branches | Saved alternate scene orders, omissions and endings. Merge previews show before/after scene text; applying is undoable and creates a return branch. Stale drafts and issued/native production references block unsafe merging. |
| Pacing | Writer-assigned scene/beat intensity, dialogue density and estimated duration. A scene can inherit the mean intensity of its linked beats; export the pacing map as CSV. |
| Storyboards | Storyboard lanes with user-supplied images and credits, shot timing/order, scene links and timed animatic playback. |
| Rehearsal | Role-specific hidden lines, partner cues, adjustable silence, reveal/next/previous controls, microphone takes and imported actor recordings. Takes retain their original line text so later edits are visible. |
| Dependencies | A graph joining scenes, storyboard shots, production assets, scheduled work and revision references. Trace transitive dependencies, flag rewritten source scenes and mark production items reviewed. |

All tools work locally and use document undo/history. Planning data, branches,
images and audio are embedded in AzkriptData when saving FDX. Clean review copies
remove this material. Embedded media has a combined 2 MB encoded budget per draft;
individual uploads must be under 1 MB and microphone takes stop after 45 seconds.
Microphone permission and installed speech voices depend on the system. Leaving
rehearsal stops recording and cues; an unfinished take is discarded.

Continuity uses explicit writer evidence rather than automatic story inference.
Timing is an estimate, intensity is subjective, and production schedules are local
references rather than calendar synchronization. Branch endings support action
paragraphs or the existing Fountain dialogue/action subset inside the final scene.
Other editors may discard AzkriptData and its embedded media.

Scene View now scrolls in both directions, retains its position after edits and
keeps optional columns aligned. Double-clicking empty Beat Board space creates a
beat at the pointer, including after scrolling or interface scaling. Card clicks
no longer create drag-history entries. Planning-only edits avoid rebuilding the
editor or invalidating pagination; paragraph decoration uses one node map, list
updates are batched, and renderer/worker font measurements reuse fonts and caches.
Icons use vector sprites with consistent view boxes and keyboard-inert SVGs.

## File-format tools

The optional `fdformat` Python package provides dependency-free inspection and
conversion utilities for FDX/FDXT and `.fddat` files:

```powershell
python -m fdformat --help
```

## Scope

FDX/FDXT compatibility and pagination are implemented independently. Exact
page/line parity with other editors is not guaranteed. Some native metadata can
be preserved or edited without reproducing every originating-editor feature.
Table read depends on the voices installed on the computer.

Design documents, plans, research material, local reports, machine-specific
operations, dependencies and generated builds are kept outside version control.
The application is not currently offered under an open-source license.

For bug reports and development checks, see [CONTRIBUTING.md](CONTRIBUTING.md).
Report vulnerabilities using the process in [SECURITY.md](SECURITY.md).
