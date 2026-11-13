# Local data and privacy

Azkript has no account system, cloud synchronization or application telemetry.
Drafts, preferences, recent-file lists, recovery copies, version history and
staged updates are stored locally. These files are not encrypted by Azkript.

The installed and portable apps use the local Azkript profile by default.
"Portable" describes the executable packaging; it does not mean all user data
stays beside that executable. `AZKRIPT_USER_DATA` can select a different profile
directory before launch.

An FDX file can contain more than its visible screenplay. AzkriptData can embed
notes, review history, story branches, planning data, images and recordings.
Clean review exports remove Azkript's private planning and review material.
Inspect any draft before sharing, especially documents originally created by
other editors, whose additional native metadata may be preserved.

Microphone recording starts from the rehearsal controls after permission is
granted. It stops on leaving rehearsal or after 45 seconds. Saved takes are
embedded in the draft; an unfinished take is discarded. WAV export uses local
Windows speech synthesis.

Browser speech playback and Electron/Chromium features can depend on system or
browser services, including selected speech voices and spelling dictionaries.
Those services may have their own network behavior and privacy policies.
Opening an external link uses the default browser or mail application.

Uninstall keeps the local profile. Deleting the app or an FDX file therefore
does not remove its recovery copies or version history. After making independent
backups, close Azkript before deleting a profile you no longer need. A browser
build uses that browser's local storage and IndexedDB for drafts, preferences
and version history.
