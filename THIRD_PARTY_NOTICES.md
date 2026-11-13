# Third-party notices

Azkript is an independent application. Final Draft and other product names refer
to their respective owners; no affiliation or endorsement is implied.

The application code is currently marked `UNLICENSED`. Public source visibility
does not change that licensing status. Third-party components retain their own
licenses.

Windows distributions include Electron and its Chromium, Node.js and other
components. Their notices are shipped alongside `Azkript.exe`:

- `LICENSE.electron.txt`
- `LICENSES.chromium.html`

Keep these files with the application when distributing an unpacked build.
The installer and portable wrapper include them in their application payloads.
The release verification checks that the unpacked notices are present.

Development tools, including electron-builder, Playwright and Pillow, have their
own licenses in their installed packages. They are development dependencies and
are excluded from Azkript's application archive. The dependency lockfiles record
the versions used to build and test the application.

Vendor applications, installers, fonts, name databases and proprietary templates
are not part of this source distribution. Optional interoperability tests can
use an existing local installation; synthetic fixtures run without one. Use of a
vendor's installed assets remains subject to that vendor's terms.
