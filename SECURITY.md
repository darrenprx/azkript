# Security

Azkript is beta software. Use the latest maintained build and keep independent
backups of scripts. Automatic recovery and local version history are useful
safeguards, but share the same computer and profile as the editor.

Report vulnerabilities through GitHub's private vulnerability reporting feature
when it is available for this repository. If it is unavailable, open an issue
requesting a private contact channel without including exploit details. Do not
post private screenplays, recovery files, personal file paths, signing material
or credentials in public issues.

A useful report identifies the application version, Windows version, affected
feature, expected behavior and minimal reproduction steps. Use a synthetic
document. Wait for a private channel before sharing a proof of concept that
could affect other users.

The desktop renderer runs with context isolation and sandboxing. Native file
access is restricted to the editor's main frame through the desktop bridge.
Imported rich text is reduced to supported formatting. Embedded frames, plugins,
forms, additional windows and unrelated device permissions are blocked.
Microphone recording requires an audio-only request from the editor and a
confirmation prompt.

Offline review packets use bearer invitations and self-reported reviewer names.
They do not provide authenticated identity, encryption or a trusted remote audit
trail. Share packets only with intended recipients.

Signed update staging requires a configured publisher thumbprint and verifies
the staged installer, including its embedded product and version. It never
executes an installer automatically. Unsigned
beta builds cannot pass this gate. A release checksum establishes file integrity
only when obtained from a source you trust; it does not authenticate a publisher.
