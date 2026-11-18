# Using Azkript

[Back to the overview](README.md) · [Development](DEVELOPMENT.md) · [Privacy and local data](PRIVACY.md)

Azkript is beta software for Windows x64. Current builds are unsigned. Keep independent backups and work on copies of important drafts while assessing a build.

## First script

1. Run the portable app or install the per-user Windows build.
2. Open a copy of an `.fdx` script, choose a template, or start with the included sample.
3. Write using screenplay paragraph types, then save an FDX copy. Use PDF export for a reading copy.

The browser interface can be opened from `app/index.html`. Desktop builds provide native file dialogs, recovery and Windows speech export.

The desktop Start Center offers the latest crash-recovery copy. When a new
draft needs that recovery slot, Azkript archives the earlier copy first. Open
**File → Backup → Earlier recovery copies** to recover an archived draft and
save it under a filename of your choice.

## Feature reference

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

## Workspace and projects

The titlebar **Workspace** button and command palette open layouts, search,
scratchpad, projects, scene operations and milestones. `Ctrl+Shift+F` searches
scenes, notes, beats, characters and tags. Layouts and per-document positions
stay in the local profile; notes travel in the AzkriptData section of FDX files.
Other editors may discard those private notes. A project folder contains a
`project.azkproj` manifest, independent FDX scripts, and a shared plain-text bible.
Adding a script creates a copy. Named milestones remain in local version history
and are kept when automatic snapshots rotate.

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

## Story studio

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

## Compatibility and limits

FDX/FDXT compatibility and pagination are implemented independently. Exact
page/line parity with other editors is not guaranteed. Some native metadata can
be preserved or edited without reproducing every originating-editor feature.
Table read depends on the voices installed on the computer.

Design documents, plans, research material, local reports, machine-specific
operations, dependencies and generated builds are kept outside version control.

