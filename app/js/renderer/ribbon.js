"use strict";

window.AzkriptRenderer.ribbonActions = function ({
  desktopActions,
  documentSession,
  editorActions,
  editorState,
  fileActions,
  findActions,
  formatActions,
  interfaceState,
  modalActions,
  pageActions,
  planningViews,
  preferences,
  productionActions,
  ribbonState,
  settingsActions,
  shared,
  speechActions,
  workspaceLayout,
  workspaceState,
  writingTools,
}) {
  const { $, $$, ELEMENTS, SCRIPT_FONT_CHOICES, clamp, els, escapeHtml, icon, normalizeScriptFont, scriptFontLabel } = shared;

  /* ================================================================== */
  /* Fluent ribbon — data-driven tab deck                                */
  /* ================================================================== */
  const RIBBON_TAB_DEFS = [
    { id: "home", label: "Home" },
    { id: "file", label: "File" },
    { id: "edit", label: "Edit" },
    { id: "view", label: "View" },
    { id: "format", label: "Format" },
    { id: "insert", label: "Insert" },
    { id: "document", label: "Document" },
    { id: "tools", label: "Tools" },
    { id: "production", label: "Production" },
    { id: "help", label: "Help" },
  ];
  const RIBBON_FONTS = SCRIPT_FONT_CHOICES.map((choice) => choice.value);  const RIBBON_FONT_LABELS = Object.fromEntries(    SCRIPT_FONT_CHOICES.map((choice) => [choice.value, choice.label]),  );  const RIBBON_FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20, 24];
  const RIBBON_TEXT_COLORS = [
    { label: "Ink", value: "#171614" },
    { label: "Graphite", value: "#3d3d3a" },
    { label: "Slate", value: "#5c6670" },
    { label: "Cobalt", value: "#0f6cbd" },
    { label: "Violet", value: "#6b48a8" },
    { label: "Teal", value: "#03787c" },
    { label: "Forest", value: "#2f7426" },
    { label: "Amber", value: "#c2500e" },
    { label: "Crimson", value: "#b8252a" },
    { label: "Rose", value: "#c30f6b" },
    { label: "Default", value: "" },
  ];
  const RIBBON_HIGHLIGHTS = [
    { label: "Butter", value: "#ffe9a3" },
    { label: "Azkript yellow", value: "#ffd400" },
    { label: "Mint", value: "#c8f7c5" },
    { label: "Sky", value: "#cfe6ff" },
    { label: "Lavender", value: "#e4d6ff" },
    { label: "Rose", value: "#ffd3df" },
    { label: "Peach", value: "#ffdfc4" },
    { label: "Clear", value: "" },
  ];
  const RIBBON_COLORS = {
    connection: [
      { label: "Cobalt", value: "#0f6cbd" },
      { label: "Violet", value: "#6b48a8" },
      { label: "Teal", value: "#03787c" },
      { label: "Amber", value: "#c2500e" },
      { label: "Crimson", value: "#b8252a" },
      { label: "Charcoal", value: "#4b4c50" },
    ],
  };
  /* Item factories keep the model compact and consistent. */
  const rb = {
    large: (command, label, iconName, extra = {}) => ({
      kind: "large",
      command,
      label,
      icon: iconName,
      tip: extra.tip || label,
      ...extra,
    }),
    small: (command, label, iconName, extra = {}) => ({
      kind: "small",
      command,
      label,
      icon: iconName,
      tip: extra.tip || label,
      ...extra,
    }),
    icon: (command, label, iconName, extra = {}) => ({
      kind: "icon",
      command,
      label,
      icon: iconName,
      tip: extra.tip || label,
      ...extra,
    }),
    toggle: (command, label, iconName, extra = {}) => ({
      kind: "small",
      command,
      label,
      icon: iconName,
      tip: extra.tip || label,
      toggle: true,
      ...extra,
    }),
    iconToggle: (command, label, iconName, extra = {}) => ({
      kind: "icon",
      command,
      label,
      icon: iconName,
      tip: extra.tip || label,
      toggle: true,
      ...extra,
    }),
    combo: (combo, extra = {}) => ({ kind: "combo", combo, ...extra }),
    split: (command, label, iconName, menu, extra = {}) => ({
      kind: "split",
      command,
      label,
      icon: iconName,
      menu,
      tip: extra.tip || label,
      ...extra,
    }),
    iconSplit: (command, label, iconName, menu, extra = {}) => ({
      kind: "split",
      command,
      label,
      icon: iconName,
      menu,
      iconOnly: true,
      tip: extra.tip || label,
      ...extra,
    }),
    col: (...items) => ({ kind: "col", items }),
    sep: () => ({ kind: "sep" }),
  };
  const RIBBON_MODEL = {
    home: [
      {
        label: "Proofing",
        rows: [
          [
            rb.col(
              rb.small("tools-spelling", "Spelling", "check-circle", { tip: "Check spelling of the document (F7)" }),
              rb.small("tools-thesaurus", "Thesaurus", "book", { tip: "Look up synonyms (Shift+F7)" }),
            ),
          ],
        ],
      },
      {
        label: "Clipboard",
        rows: [
          [
            rb.large("edit-paste", "Paste", "clipboard", { split: "paste", tip: "Paste from the clipboard" }),
            rb.col(
              rb.small("edit-cut", "Cut", "scissors", { tip: "Cut the selection (Ctrl+X)" }),
              rb.small("edit-copy", "Copy", "copy", { tip: "Copy the selection (Ctrl+C)" }),
            ),
          ],
        ],
      },
      {
        label: "Font",
        rows: [
          [
            rb.icon("format-bold", "Bold", "bold", { format: "bold", cls: "format-btn", tip: "Bold (Ctrl+B)" }),
            rb.icon("format-italic", "Italic", "italic", { format: "italic", cls: "format-btn", tip: "Italic (Ctrl+I)" }),
            rb.icon("format-underline", "Underline", "underline", { format: "underline", cls: "format-btn", tip: "Underline (Ctrl+U)" }),
            rb.icon("format-strike", "Strike Out", "strike", { format: "strikeThrough", cls: "format-btn", tip: "Strike out the selection (Ctrl+Shift+X)" }),
            rb.iconToggle("format-allcaps", "ALL CAPS", "case", { tip: "Set or unset the all-capitals style" }),
            rb.sep(),
            rb.iconSplit("format-highlight", "Highlighter", "highlight", "highlight", { tip: "Highlight the selected text" }),
            rb.iconSplit("format-text-color", "Text Color", "text-color", "text-color", { tip: "Change the color of the selected text" }),
          ],
        ],
      },
      {
        label: "Insert",
        rows: [
          [
            rb.large("insert-scriptnote", "ScriptNote", "note", { tip: "Insert a ScriptNote (Ctrl+Shift+N)" }),
            rb.col(
              rb.small("insert-bookmark", "Bookmark", "bookmark", { tip: "Insert a bookmark" }),
              rb.small("insert-image", "Image", "image", { tip: "Insert a storyboard / reference image" }),
              rb.small("insert-pagebreak", "Page break", "page-break", { tip: "Toggle a page break before this paragraph" }),
              rb.small("insert-emoji", "Emoji", "emoji", { tip: "Insert emoji & symbols" }),
            ),
          ],
        ],
      },
      {
        label: "Script Elements",
        rows: [
          [rb.combo("element", { tip: "Change the element of the current paragraph" })],
          [
            rb.small("format-element-settings", "Elements Settings", "sliders", { tip: "Edit element indents, spacing and styles" }),
            rb.small("format-dual", "Dual Dialogue", "dual", { tip: "Toggle dual dialogue (Ctrl+D)" }),
          ],
        ],
      },
      {
        label: "Title Page",
        rows: [[rb.large("doc-title-page", "Open", "title", { tip: "Show or hide the title page" })]],
      },
      {
        label: "Views",
        rows: [
          [
            rb.small("view-normal", "Script", "script", { tip: "Switch to the continuous script view" }),
            rb.small("view-scene", "Scene View", "table", { tip: "Open the scene table" }),
            rb.small("view-cards-summary", "Index Cards", "grid", { tip: "Open Index Cards" }),
            rb.small("view-beatboard", "Beat Board", "board", { tip: "Open the Beat Board" }),
          ],
          [
            rb.iconToggle("view-toggle-outline", "Hide Outline Editor", "scene", { tip: "Show or hide the Outline Editor" }),
            rb.iconToggle("view-toggle-outline-script", "Hide Outline in Script", "structure", { tip: "Show or hide the outline inside the script" }),
            rb.iconToggle("view-toggle-navigator", "Show Navigator", "panel", { tip: "Show or hide the navigator panel" }),
          ],
        ],
      },
      {
        label: "Split",
        rows: [
          [
            rb.icon("view-split-off", "Unsplit", "unsplit", { tip: "Close the split view" }),
            rb.icon("view-split-v", "Vertically", "split", { tip: "Split vertically" }),
            rb.icon("view-split-h", "Horizontally", "split-h", { tip: "Split horizontally" }),
            rb.icon("view-split-swap", "Swap", "replace", { tip: "Swap the split panes" }),
          ],
        ],
      },
    ],
    file: [
      {
        label: "Document safety",
        rows: [[rb.small("file-compatibility", "Compatibility", "check-circle", { tip: "Review file preservation and exchange limitations" }),
          rb.small("file-history", "Version history", "backup", { tip: "Compare and restore earlier versions" }),
          rb.small("file-disk-status", "File status", "folder", { tip: "Compare changes made outside this editor" })]],
      },
      {
        label: "File",
        rows: [
          [
            rb.large("file-new", "New", "plus", { tip: "New screenplay (Ctrl+N)" }),
            rb.large("file-new-template", "New from Template", "template", { tip: "Start from a template in the Start Center" }),
            rb.large("file-open", "Open", "folder", { tip: "Open an FDX screenplay (Ctrl+O)" }),
            rb.large("file-close", "Close", "close", { tip: "Close this document" }),
          ],
        ],
      },
      {
        label: "Saving",
        rows: [
          [
            rb.large("file-save", "Save", "save", { tip: "Save (Ctrl+S)" }),
            rb.large("file-save-as", "Save As", "save", { tip: "Save with a new name (Ctrl+Shift+S)" }),
            rb.large("file-save-pdf", "Save as PDF", "pdf", { tip: "Save a paginated PDF" }),
            rb.large("file-save-template", "Save as Template", "template", { tip: "Save this document as an FDXT template" }),
            rb.split("file-export", "Export", "download", "file-export", { large: true, tip: "Export FDX, PDF, Fountain or Beat Board" }),
            rb.col(
              rb.small("file-revert", "Revert", "revert", { tip: "Revert to the last saved version" }),
              rb.small("file-backup", "Backup", "backup", { tip: "Create a backup copy" }),
            ),
          ],
        ],
      },
      {
        label: "Printing",
        rows: [
          [
            rb.large("file-print-preview", "Print Preview", "print", { tip: "Preview printable pages" }),
            rb.large("file-print", "Print", "print", { tip: "Print (Ctrl+P)" }),
          ],
        ],
      },
      {
        label: "Register",
        rows: [[rb.large("file-wga", "Register WGA", "register", { tip: "Prepare WGA registration details" })]],
      },
    ],
    edit: [
      {
        label: "Undo",
        rows: [
          [
            rb.large("edit-undo", "Undo", "undo", { tip: "Undo (Ctrl+Z)" }),
            rb.large("edit-redo", "Redo", "redo", { tip: "Redo (Ctrl+Y)" }),
          ],
        ],
      },
      {
        label: "Clipboard",
        rows: [
          [
            rb.large("edit-paste", "Paste", "clipboard", { split: "paste", tip: "Paste from the clipboard" }),
            rb.col(
              rb.small("edit-cut", "Cut", "scissors", { tip: "Cut (Ctrl+X)" }),
              rb.small("edit-copy", "Copy", "copy", { tip: "Copy (Ctrl+C)" }),
            ),
          ],
        ],
      },
      {
        label: "Editing",
        rows: [
          [
            rb.large("edit-delete", "Delete", "trash", { tip: "Delete the selection or paragraph" }),
            rb.col(
              rb.small("edit-select-all", "Select all", "select-all", { tip: "Select the whole scene (Ctrl+A)" }),
              rb.small("edit-select-scene", "Select scene", "scene", { tip: "Select the current scene" }),
              rb.small("edit-rename-character", "Rename character", "rename", { tip: "Rename a character everywhere" }),
              rb.small("edit-nonspeaking", "Non-speaking", "nonspeaking", { tip: "Manage non-speaking characters" }),
            ),
          ],
        ],
      },
      {
        label: "Find",
        rows: [
          [
            rb.large("edit-find", "Find & Replace", "search", { tip: "Find and replace (Ctrl+F)" }),
            rb.col(
              rb.small("edit-find-selection", "Find selection", "find-selection", { tip: "Find the selected text" }),
              rb.small("edit-goto", "Go to…", "target", { tip: "Go to a page, scene or bookmark (Ctrl+G)" }),
            ),
          ],
        ],
      },
      {
        label: "Tracking",
        rows: [
          [
            rb.toggle("edit-track-changes", "Track Changes", "track", { tip: "Track edits so they can be accepted or rejected" }),
            rb.col(
              rb.small("edit-accept-change", "Accept change", "check-circle", { tip: "Accept the tracked change in this paragraph" }),
              rb.small("edit-reject-change", "Reject change", "reject", { tip: "Reject the tracked change in this paragraph" }),
            ),
            rb.col(
              rb.icon("edit-prev-change", "Previous change", "prev", { tip: "Previous tracked change" }),
              rb.icon("edit-next-change", "Next change", "next", { tip: "Next tracked change" }),
            ),
          ],
        ],
      },
      {
        label: "Emoji",
        rows: [[rb.large("edit-emoji", "Emoji & Symbols", "emoji", { tip: "Insert emoji and symbols" })]],
      },
    ],
    view: [
      { label: "Writing environment", rows: [[rb.small("view-writing-reliability", "Typography & access", "sliders", { tip: "Font availability, document typography and interface scaling" })]] },
      {
        label: "Views",
        rows: [
          [
            rb.large("view-normal", "Normal", "script", { tip: "Continuous script view" }),
            rb.large("view-page", "Page", "page", { tip: "Paginated page view" }),
            rb.large("view-speed", "Speed", "eye", { tip: "Compact speed view" }),
            rb.col(
              rb.small("view-scene", "Scene view", "table", { tip: "Scene table" }),
              rb.small("view-cards-summary", "Index cards", "grid", { tip: "Index cards" }),
              rb.small("view-beatboard", "Beat board", "board", { tip: "Beat board" }),
            ),
          ],
        ],
      },
      {
        label: "Show / Hide",
        rows: [
          [
            rb.iconToggle("view-toggle-outline", "Outline editor", "scene", { tip: "Show / hide the Outline Editor timeline" }),
            rb.iconToggle("view-toggle-outline-script", "Outline in script", "script", { tip: "Show / hide the outline inside the script view" }),
            rb.iconToggle("view-toggle-structure", "Structure lines", "structure", { tip: "Show / hide structure metadata under scene headings" }),
            rb.iconToggle("view-toggle-alts", "Alternate dialogue", "dual", { tip: "Show / hide alternate dialogue badges" }),
          ],
          [
            rb.iconToggle("view-toggle-scriptnotes", "ScriptNotes", "note", { tip: "Show / hide ScriptNote badges" }),
            rb.iconToggle("view-toggle-ruler", "Ruler", "ruler", { tip: "Show / hide the horizontal ruler" }),
            rb.iconToggle("view-toggle-invisibles", "Invisibles", "eye", { tip: "Show / hide invisible characters" }),
            rb.iconToggle("view-toggle-navigator", "Navigator", "panel", { tip: "Show / hide the navigator panel" }),
          ],
        ],
      },
      {
        label: "Split",
        rows: [
          [
            rb.icon("view-split-off", "Unsplit", "unsplit", { tip: "Close the split view" }),
            rb.icon("view-split-v", "Split vertically", "split", { tip: "Split the editor vertically" }),
            rb.icon("view-split-h", "Split horizontally", "split-h", { tip: "Split the editor horizontally" }),
            rb.icon("view-split-swap", "Swap panes", "replace", { tip: "Swap the split panes" }),
          ],
        ],
      },
      {
        label: "Window",
        rows: [
          [
            rb.col(
              rb.small("view-arrange-docs", "Arrange documents", "window", { tip: "Arrange the workspace for reference" }),
              rb.small("view-open-docs", "Open documents", "folder", { tip: "Open a recent document" }),
              rb.small("view-classic", "Classic view", "classic", { tip: "Collapse the ribbon to a classic workspace" }),
            ),
          ],
        ],
      },
      {
        label: "Zoom",
        rows: [
          [rb.combo("zoom", { className: "rb-combo--narrow", tip: "Editor zoom" }), rb.icon("view-zoom-out", "Zoom out", "zoom-out", { tip: "Zoom out" }), rb.icon("view-zoom-in", "Zoom in", "zoom-in", { tip: "Zoom in" })],
          [rb.small("view-zoom-outline", "Zoom Outline", "target", { tip: "Fit the outline editor to the workspace" })],
        ],
      },
      {
        label: "Typewriter Mode",
        rows: [[rb.combo("typewriter", { className: "rb-combo--wide", tip: "Keep the active line centered" })]],
      },
      {
        label: "Appearance",
        rows: [
          [
            rb.col(
              rb.toggle("view-appearance-day", "Day", "sun", { tip: "Day mode" }),
              rb.toggle("view-appearance-night", "Night", "moon", { tip: "Night mode" }),
              rb.toggle("view-appearance-midnight", "Midnight", "midnight", { tip: "Midnight mode" }),
            ),
          ],
        ],
      },
    ],
    format: [
      {
        label: "Elements",
        rows: [
          [rb.combo("element", { tip: "Current script element" })],
          [
            rb.small("format-element-settings", "Elements Settings", "sliders", { tip: "Indents, spacing and styles" }),
            rb.small("format-dual", "Dual Dialogue", "dual", { tip: "Toggle dual dialogue" }),
            rb.small("format-cast-list", "Cast List Options", "users", { tip: "Manage the cast list and actor fields" }),
          ],
        ],
      },
      {
        label: "Characters",
        rows: [[rb.large("format-highlight-characters", "Highlight Characters", "highlight", { tip: "Assign a color to each speaking character" })]],
      },
      {
        label: "Text",
        rows: [
          [rb.combo("font", { className: "rb-combo--wide", tip: "Script font" }), rb.combo("size", { className: "rb-combo--size", tip: "Font size" })],
          [
            rb.icon("format-bold", "Bold", "bold", { format: "bold", cls: "format-btn", tip: "Bold (Ctrl+B)" }),
            rb.icon("format-italic", "Italic", "italic", { format: "italic", cls: "format-btn", tip: "Italic (Ctrl+I)" }),
            rb.icon("format-underline", "Underline", "underline", { format: "underline", cls: "format-btn", tip: "Underline (Ctrl+U)" }),
            rb.icon("format-strike", "Strikethrough", "strike", { format: "strikeThrough", cls: "format-btn", tip: "Strikethrough" }),
            rb.icon("format-case", "Toggle CASE", "case", { tip: "Cycle UPPER / lower / Title case" }),
            rb.iconToggle("format-allcaps", "ALL CAPS", "case", { tip: "Set or unset the all-capitals style" }),
            rb.iconSplit("format-text-color", "Text color", "text-color", "text-color", { tip: "Text color" }),
            rb.iconSplit("format-highlight", "Highlighter", "highlight", "highlight", { tip: "Highlighter color" }),
          ],
        ],
      },
      {
        label: "Paragraph",
        rows: [
          [rb.combo("align", { tip: "Alignment" }), rb.combo("spacing", { tip: "Line spacing" })],
          [rb.combo("space-before", { className: "rb-combo--narrow", tip: "Space before" }), rb.combo("leading", { className: "rb-combo--narrow", tip: "Leading" })],
          [rb.small("format-revert-paragraph", "Revert paragraph", "revert", { tip: "Revert to the element defaults" }), rb.small("format-page-break", "Page break", "page-break", { tip: "Force a page break before the paragraph" })],
        ],
      },
      {
        label: "Beat Board",
        rows: [
          [
            rb.split("format-beat-align", "Align", "align", "beat-align", { tip: "Align beats on the board" }),
            rb.toggle("format-beat-connect", "Connect", "connect", { tip: "Connect beats with story arrows" }),
            rb.toggle("format-beat-disconnect", "Disconnect", "disconnect", { tip: "Remove the selected connection" }),
          ],
          [
            rb.toggle("format-beat-snap", "Grid snap", "grid-snap", { tip: "Snap beats to the 24px grid" }),
            rb.iconSplit("format-beat-connection-color", "Connection color", "connection-color", "connection-color", { tip: "Connection color" }),
            rb.combo("beat-selected", { className: "rb-combo--wide", tip: "Select a beat" }),
          ],
        ],
      },
    ],
    insert: [
      {
        label: "Insert",
        rows: [
          [
            rb.large("insert-scriptnote", "ScriptNote", "note", { tip: "Insert a ScriptNote (Ctrl+Shift+N)" }),
            rb.large("insert-bookmark", "Bookmark", "bookmark", { tip: "Insert a bookmark" }),
            rb.large("insert-label", "Label", "tag", { tip: "Insert a production label" }),
            rb.large("insert-image", "Image", "image", { tip: "Insert a storyboard / reference image" }),
            rb.large("insert-pagebreak", "Page Break", "page-break", { tip: "Toggle a page break before this paragraph" }),
            rb.large("insert-nonspeaking", "Non-Speaking", "nonspeaking", { tip: "Manage non-speaking characters" }),
            rb.large("insert-alt-add", "Add Alt", "plus", { tip: "Add an alternate dialogue take" }),
            rb.large("insert-alt-remove", "Remove Alt", "minus", { tip: "Remove the active alternate take" }),
            rb.large("insert-beat", "New Beat", "board", { tip: "Add a beat on the Beat Board" }),
          ],
        ],
      },
      {
        label: "Scenes",
        rows: [
          [
            rb.large("insert-scene", "New Scene", "scene", { tip: "Insert a new scene (Ctrl+Enter)" }),
            rb.large("insert-send-to-script", "Send to Script", "script", { tip: "Send cards or beats into the script" }),
          ],
        ],
      },
    ],
    document: [
      {
        label: "Page Setup",
        rows: [
          [
            rb.large("doc-title-page", "Title Page", "title", { tip: "Edit the title page" }),
            rb.large("doc-header-footer", "Header & Footer", "page", { tip: "Header and footer text" }),
            rb.large("doc-page-layout", "Page Layout", "sliders", { tip: "Page size, margins and numbering" }),
            rb.large("doc-mores", "Mores and Continueds", "align", { tip: "Customize (MORE), (CONT'D) and continued lines" }),
            rb.large("doc-watermark", "Watermark", "water", { tip: "Add a page watermark" }),
          ],
        ],
      },
      {
        label: "Extras",
        rows: [
          [
            rb.large("doc-smarttype", "SmartType", "sparkle", { tip: "SmartType completion lists" }),
            rb.large("doc-macros", "Macros", "macros", { tip: "Manage text macros" }),
            rb.large("doc-bookmarks", "Bookmarks", "bookmark", { tip: "Jump to or manage bookmarks" }),
          ],
        ],
      },
      {
        label: "Length",
        rows: [
          [
            rb.large("doc-target-length", "Target Script Length", "target", { tip: "Set the page goal for this draft" }),
            rb.small("doc-details", "Document details", "info", { tip: "Document details and metadata" }),
          ],
        ],
      },
    ],
    tools: [
      {
        label: "Proofing",
        rows: [
          [
            rb.large("tools-spelling", "Spelling", "check-circle", { tip: "Spelling and proofing (F7)" }),
            rb.large("tools-thesaurus", "Thesaurus", "book", { tip: "Thesaurus (Shift+F7)" }),
          ],
        ],
      },
      {
        label: "Speech Control",
        rows: [
          [
            rb.large("tools-play", "Play", "play", { tip: "Start the table read" }),
            rb.large("tools-stop", "Stop", "stop", { tip: "Stop the table read" }),
            rb.large("tools-assign-voices", "Assign Voices", "users", { tip: "Assign a voice to each character" }),
            rb.col(
              rb.icon("tools-rewind", "Rewind", "rewind", { tip: "Previous speech block" }),
              rb.icon("tools-forward", "Fast forward", "forward", { tip: "Next speech block" }),
            ),
          ],
        ],
      },
      {
        label: "Tools",
        rows: [
          [
            rb.large("tools-collaboration", "Collaboration Files", "collab", { tip: "Share and merge screenplay files" }),
            rb.split("tools-combine-reports", "Combine Reports", "combine", "combine-reports", { large: true, tip: "Combine script reports" }),
            rb.large("tools-format-assistant", "Format Assistant", "check-circle", { tip: "Check screenplay formatting" }),
            rb.large("tools-script-compare", "Script Compare", "compare", { tip: "Compare two drafts" }),
            rb.large("tools-reformat", "Reformat", "refresh", { tip: "Reformat the current element" }),
            rb.large("tools-writing-stats", "Writing Stats", "chart", { tip: "Writing statistics and tracker" }),
            /* These five secondary tools used to be a SECOND ROW under the six large
             * buttons. That stack needs 66 + 3 + 23 = 92px, but the body only gets
             * 81px inside the ribbon's fixed 104px track, so it overflowed and the
             * bottom row's labels sat on the "TOOLS" caption (measured: content 91px
             * in an 81px box, deepest control 3px past the caption's top edge).
             * As a `.ribbon-col` beside the large buttons it costs one row of height
             * instead of two: five 23px buttons in a 2-column grid are 3 rows = 73px,
             * which fits, and the group keeps its place on a single ribbon row. */
            rb.col(
              rb.small("tools-names", "Names Database", "names", { tip: "Browse the character name database" }),
              rb.small("tools-show-navigator", "Show Navigator", "panel", { tip: "Show the navigator" }),
              rb.small("tools-sprint", "Sprint Timer", "timer", { tip: "Start the sprint timer" }),
              rb.small("tools-options", "Options", "settings", { tip: "Azkript settings" }),
              rb.small("tools-ask", "Ask Azkript", "sparkle", { tip: "Ask the writing assistant" }),
            ),
          ],
        ],
      },
    ],
    production: [
      {
        label: "Scenes",
        rows: [
          [
            rb.large("prod-scene-numbers", "Scene Numbers", "scene-number", { toggle: true, tip: "Show or hide scene numbers" }),
            rb.large("prod-edit-scene-number", "Edit Scene Number", "pencil", { tip: "Override the current scene number" }),
            rb.large("prod-reset-scene-numbers", "Reset Scene Numbers", "scene-number", { tip: "Restore sequential scene numbering" }),
            rb.large("prod-omit-scene", "Omit Scene", "eye-off", { tip: "Omit or restore the current scene" }),
          ],
        ],
      },
      {
        label: "Revisions",
        rows: [
          [
            rb.large("prod-revisions-setup", "Revisions Setup", "revision", { tip: "Open the revision manager" }),
            rb.large("prod-revision-mode", "Revision Mode", "revision", { toggle: true, tip: "Toggle revision marking" }),
            rb.large("prod-mark-revised", "Mark Revised", "pencil", { tip: "Mark the current paragraph in the revision color" }),
            rb.large("prod-clear-revised", "Clear Revised", "close", { tip: "Clear the revision mark on the current paragraph" }),
            rb.col(
              rb.small("prod-prev-revision", "Previous revision", "prev", { tip: "Go to the previous revision set" }),
              rb.small("prod-next-revision", "Next revision", "next", { tip: "Start the next revision set" }),
            ),
          ],
        ],
      },
      {
        label: "Locked Pages",
        rows: [
          [
            rb.large("prod-lock-pages", "Lock Pages", "lock", { tip: "Lock pages for production" }),
            rb.col(
              rb.small("prod-unlock-a-pages", "Unlock A pages", "unlock", { tip: "Unlock all A-pages" }),
              rb.small("prod-unlock-all-pages", "Unlock all pages", "unlock", { tip: "Remove every page lock" }),
            ),
            rb.split("prod-locking-tools", "Locking Tools", "lock", "locking-tools", { tip: "Page locking tools" }),
          ],
        ],
      },
      {
        label: "Tags",
        rows: [
          [
            rb.large("prod-tags-mode", "Tags Mode", "tag", { toggle: true, tip: "Show production tags in the script" }),
            rb.large("prod-tag-all", "Tag All Characters", "users", { tip: "Tag every speaking character" }),
          ],
        ],
      },
    ],
    help: [
      {
        label: "Help",
        rows: [
          [
            rb.large("help-guide", "User Guide", "book", { tip: "Keyboard shortcuts and workflow guide" }),
            rb.large("help-welcome", "Welcome", "welcome", { tip: "Welcome to Azkript" }),
            rb.large("help-whats-new", "What's New", "sparkle", { tip: "What's new in this build" }),
            rb.large("help-get-help", "Get Help", "help", { tip: "Open the help guide" }),
          ],
        ],
      },
      {
        label: "Learn",
        rows: [
          [
            rb.split("help-tutorials", "Idea to Draft", "book", "tutorials", { large: true, tip: "Tutorials from idea to draft" }),
            rb.split("help-samples", "Sample Scripts", "script", "samples", { large: true, tip: "Sample scripts and templates" }),
          ],
        ],
      },
      {
        label: "Online",
        rows: [
          [
            rb.large("help-updates", "Release and Updates", "updates", { tip: "Review local update options" }),
            rb.large("help-feedback", "Submit Feedback", "feedback", { tip: "Report a problem or idea" }),
          ],
        ],
      },
      {
        label: "Account",
        rows: [
          [
            rb.large("help-account", "Manage Account", "account", { tip: "Local profile" }),
            rb.large("help-signout", "Sign Out", "signout", { tip: "Sign out of the local profile" }),
          ],
        ],
      },
      {
        label: "About",
        rows: [[rb.large("help-about", "About", "info", { tip: "About Azkript" })]],
      },
    ],
  };
  // Combo + menu definitions
  function ribbonActiveParagraph() {
    return editorActions.activeParagraph();
  }
  function ribbonParagraphValue(key, fallback) {
    const paragraph = ribbonActiveParagraph();
    if (!paragraph) return fallback;
    const value = paragraph[key];
    return value === undefined || value === null || value === "" ? fallback : String(value);
  }
  const RIBBON_COMBOS = {
    element: {
      label: "Element",
      value: () => {
        const paragraph = ribbonActiveParagraph();
        return paragraph ? paragraph.type : "Action";
      },
      options: () => {
        const paragraph = ribbonActiveParagraph();
        const current = paragraph ? paragraph.type : "Action";
        return Object.keys(ELEMENTS).map((type) => ({
          value: type,
          label: type,
          checked: current === type,
          hint: ELEMENTS[type].shortcut ? `Alt+${ELEMENTS[type].shortcut}` : "",
        }));
      },
      select: (value) => editorActions.changeElementType(value),
    },
    font: {
      label: "Font",
      value: () => pageActions.currentTypography().family,      options: () =>
        RIBBON_FONTS.map((font) => ({
          value: font,
          label: RIBBON_FONT_LABELS[font] || font,
          checked: pageActions.currentTypography().family === font,
        })),
      select: (value) => {
        preferences.font = normalizeScriptFont(value);        workspaceLayout.applyStudioAppearance();
        pageActions.useWorkspaceTypography();
        workspaceLayout.applyPageMetrics();
        fileActions.persistPrefs();
        workspaceLayout.renderAll();
        modalActions.toast("Workspace font", `${scriptFontLabel(preferences.font)} is active for the editor and PDF. FDX retains document font requests.`, "info", 4000);
      },
    },
    size: {
      label: "Size",
      value: () => `${pageActions.currentTypography().size} pt`,
      options: () =>
        RIBBON_FONT_SIZES.map((size) => ({
          value: String(size),
          label: `${size} pt`,
          checked: pageActions.currentTypography().size === size,
        })),
      select: (value) => {
        preferences.fontSize = clamp(Number(value) || 12, 8, 24);
        pageActions.useWorkspaceTypography();
        workspaceLayout.applyPageMetrics();
        pageActions.invalidateLayout();
        fileActions.persistPrefs();
        workspaceLayout.renderAll();
      },
    },
    align: {
      label: "Alignment",
      value: () => {
        const value = ribbonParagraphValue("alignment", "");
        return value ? value[0].toUpperCase() + value.slice(1) : "Default";
      },
      options: () => [
        { value: "", label: "Element default", checked: !ribbonParagraphValue("alignment", "") },
        { value: "left", label: "Left", checked: ribbonParagraphValue("alignment", "") === "left" },
        { value: "center", label: "Center", checked: ribbonParagraphValue("alignment", "") === "center" },
        { value: "right", label: "Right", checked: ribbonParagraphValue("alignment", "") === "right" },
      ],
      select: (value) => formatActions.applyParagraphAlignment(value),
    },
    spacing: {
      label: "Spacing",
      value: () => {
        const value = ribbonParagraphValue("spacing", "");
        return value === "1.5" ? "1.5 lines" : value === "2" ? "Double" : "Single";
      },
      options: () => [
        { value: "", label: "Single (1.0)", checked: !ribbonParagraphValue("spacing", "") },
        { value: "1.5", label: "1.5 lines", checked: ribbonParagraphValue("spacing", "") === "1.5" },
        { value: "2", label: "Double (2.0)", checked: ribbonParagraphValue("spacing", "") === "2" },
      ],
      select: (value) => formatActions.applyParagraphSpacing(value),
    },
    "space-before": {
      label: "Space before",
      value: () => {
        const value = Number(ribbonParagraphValue("spaceBefore", 0));
        return `${Number.isFinite(value) ? value : 0} pt`;
      },
      options: () =>
        [0, 6, 12, 18, 24].map((value) => ({
          value: String(value),
          label: `${value} pt`,
          checked: Number(ribbonParagraphValue("spaceBefore", 0)) === value,
        })),
      select: (value) => formatActions.applyParagraphSpaceBefore(Number(value) || 0),
    },
    leading: {
      label: "Leading",
      value: () => {
        const value = ribbonParagraphValue("leading", "Regular");
        return value[0].toUpperCase() + value.slice(1);
      },
      options: () => [
        { value: "Regular", label: "Regular", checked: ribbonParagraphValue("leading", "Regular") === "Regular" },
        { value: "Tight", label: "Tight", checked: ribbonParagraphValue("leading", "Regular") === "Tight" },
        { value: "Loose", label: "Loose", checked: ribbonParagraphValue("leading", "Regular") === "Loose" },
      ],
      select: (value) => formatActions.applyParagraphLeading(value),
    },
    cards: {
      label: "Cards",
      value: () => (workspaceState.cardMode === "script" ? "Script cards" : "Summary cards"),
      options: () => [
        { value: "summary", label: "Summary cards", checked: workspaceState.cardMode !== "script" },
        { value: "script", label: "Script cards", checked: workspaceState.cardMode === "script" },
      ],
      select: (value) => {
        workspaceState.cardMode = value === "script" ? "script" : "summary";
        workspaceLayout.setView("navigator");
        planningViews.renderNavigator();
        syncRibbon();
      },
    },
    zoom: {
      label: "Zoom",
      value: () => `${Math.round(preferences.zoom * 100)}%`,
      options: () =>
        [50, 75, 90, 100, 110, 125, 150, 200].map((value) => ({
          value: String(value),
          label: `${value}%`,
          checked: Math.round(preferences.zoom * 100) === value,
        })),
      select: (value) => {
        preferences.zoom = clamp(Number(value) / 100, 0.5, 2.4);
        workspaceLayout.applyZoom();
        fileActions.persistPrefs();
        syncRibbon();
      },
    },
    typewriter: {
      label: "Typewriter",
      value: () => {
        const mode = preferences.typewriterMode || (preferences.typewriterScroll ? "line" : "off");
        return mode === "frame" ? "Frame guide" : mode === "line" ? "Line guide" : "Off";
      },
      options: () => {
        const mode = preferences.typewriterMode || (preferences.typewriterScroll ? "line" : "off");
        return [
          { value: "off", label: "Off — free scroll", checked: mode === "off" },
          { value: "frame", label: "Frame guide", checked: mode === "frame" },
          { value: "line", label: "Line guide", checked: mode === "line" },
        ];
      },
      select: (value) => workspaceLayout.setTypewriterMode(value),
    },
    "beat-selected": {
      label: "Beat",
      value: () => {
        const beat = (documentSession.doc.beats || []).find((entry) => entry.id === workspaceState.selectedBeatId);
        return beat ? beat.title : "Select beat";
      },
      options: () =>
        (documentSession.doc.beats || []).length
          ? (documentSession.doc.beats || []).map((beat) => ({
              value: beat.id,
              label: beat.title || "Untitled beat",
              checked: beat.id === workspaceState.selectedBeatId,
            }))
          : [{ value: "", label: "No beats on this board", disabled: true }],
      select: (value) => planningViews.focusBeat(value),
    },
  };
  const RIBBON_MENUS = {
    paste: {
      items: [
        { label: "Paste", icon: "clipboard", command: "edit-paste", shortcut: "Ctrl+V" },
        { label: "Paste as plain text", icon: "script", command: "edit-paste-plain" },
      ],
    },
    "file-export": {
      items: [
        { label: "FDX document (.fdx)", icon: "download", command: "file-export-fdx", shortcut: "Ctrl+Shift+S" },
        { label: "PDF document…", icon: "pdf", command: "file-export-pdf", shortcut: "Ctrl+Shift+E" },
        { label: "Fountain / plain text…", icon: "file", command: "file-export-text" },
        { label: "Beat Board text…", icon: "board", command: "file-export-beatboard" },
      ],
    },
    "text-color": {
      type: "swatch",
      items: () =>
        RIBBON_TEXT_COLORS.map((color) => ({
          label: color.label,
          swatch: color.value || "none",
          checked: preferences.textColor === color.value,
          run: () => formatActions.applyTextColor(color.value),
        })),
    },
    highlight: {
      type: "swatch",
      items: () =>
        RIBBON_HIGHLIGHTS.map((color) => ({
          label: color.label,
          swatch: color.value || "none",
          checked: preferences.highlightColor === color.value,
          run: () => formatActions.applyHighlighter(color.value),
        })),
    },
    "beat-align": {
      items: [
        { label: "Arrange in a row", icon: "align", run: () => planningViews.alignBeats("row") },
        { label: "Arrange in a column", icon: "align", run: () => planningViews.alignBeats("column") },
        { label: "Cascade", icon: "board", run: () => planningViews.alignBeats("cascade") },
        { label: "Grid", icon: "grid", run: () => planningViews.alignBeats("grid") },
      ],
    },
    "connection-color": {
      type: "swatch",
      items: () =>
        RIBBON_COLORS.connection.map((color) => ({
          label: color.label,
          swatch: color.value,
          checked: preferences.beatConnectionColor === color.value,
          run: () => planningViews.setBeatConnectionColor(color.value),
        })),
    },
    split: {
      items: [
        { label: "Unsplit view", icon: "unsplit", run: () => editorActions.toggleSplitView(false) },
        { label: "Split vertically", icon: "split", run: () => editorActions.toggleSplitView(true, "vertical") },
        { label: "Split horizontally", icon: "split-h", run: () => editorActions.toggleSplitView(true, "horizontal") },
        { label: "Swap panes", icon: "replace", run: () => editorActions.swapSplitPanes() },
      ],
    },
    "locking-tools": {
      items: [
        { label: "Relock Pages", icon: "lock", run: () => productionActions.lockAllPages() },
        { label: "Adjust Locked Page…", icon: "settings", run: () => productionActions.openLockPagesDialog() },
        { label: "Edit Locked Page Number…", icon: "scene-number", run: () => productionActions.openLockedPageNumberDialog() },
        { label: "Lock New Page", icon: "lock", run: () => productionActions.lockAllPages() },
        { label: "Unlock Page", icon: "unlock", run: () => productionActions.unlockAPages() },
      ],
    },
    "combine-reports": {
      items: [
        { label: "Combine all reports…", icon: "combine", run: () => planningViews.openCombineReportsDialog() },
        { label: "Copy statistics report", icon: "chart", run: () => planningViews.copyReport() },
        { label: "Open reports workspace", icon: "chart", run: () => workspaceLayout.setView("reports") },
      ],
    },
    tutorials: {
      items: [
        { label: "Open the tutorial library", icon: "book", run: () => settingsActions.openTutorialsDialog() },
        { label: "Start with a sample scene", icon: "script", run: () => settingsActions.loadSample() },
        { label: "Open the user guide", icon: "help", run: () => settingsActions.openUserGuide() },
      ],
    },
    samples: {
      items: [
        { label: "Load the sample screenplay", icon: "script", run: () => settingsActions.loadSample() },
        { label: "Browse templates", icon: "template", run: () => desktopActions.showStartCenter() },
        { label: "Open an FDX file…", icon: "folder", run: () => fileActions.openFilePicker() },
      ],
    },
  };
  // Ribbon rendering
  function ribbonEsc(value) {
    return escapeHtml(String(value == null ? "" : value));
  }
  function ribbonComboValue(combo) {
    const config = RIBBON_COMBOS[combo];
    if (!config) return "";
    try {
      return String(config.value() || "");
    } catch {
      return "";
    }
  }
  function renderRibbonCombo(item) {
    const config = RIBBON_COMBOS[item.combo];
    if (!config) return "";
    const value = ribbonComboValue(item.combo);
    return `<button type="button" class="rb-combo${item.className ? ` ${item.className}` : ""}" data-ribbon-combo="${ribbonEsc(item.combo)}" aria-haspopup="menu" aria-expanded="false" data-tooltip="${ribbonEsc(item.tip || config.label)}"><span class="rb-combo__value" data-combo-value="${ribbonEsc(item.combo)}">${ribbonEsc(value)}</span>${icon("chevron")}</button>`;
  }
  function renderRibbonItem(item) {
    if (!item) return "";
    if (item.kind === "sep") return `<span class="rb-sep" aria-hidden="true"></span>`;
    if (item.kind === "col") {
      return `<span class="ribbon-col">${item.items.map((entry) => renderRibbonItem(entry)).join("")}</span>`;
    }
    if (item.kind === "combo") return renderRibbonCombo(item);
    const idAttr = item.id ? ` id="${ribbonEsc(item.id)}"` : "";
    const formatAttr = item.format ? ` data-format="${ribbonEsc(item.format)}"` : "";
    const toggleAttr = item.toggle ? ` data-ribbon-toggle="1" aria-pressed="false"` : "";
    const tip = ribbonEsc(item.tip || item.label);
    const labelSpan = (cls) => `<span class="${cls}">${ribbonEsc(item.label)}</span>`;
    if (item.kind === "split") {
      const large = Boolean(item.large);
      const body = large
        ? `<button type="button" class="rb-btn rb-btn--large" data-ribbon-command="${ribbonEsc(item.command)}" data-tooltip="${tip}">${icon(item.icon)}${labelSpan("rb-btn__label")}</button>`
        : item.iconOnly
          ? `<button type="button" class="rb-btn rb-btn--icon" data-ribbon-command="${ribbonEsc(item.command)}" data-tooltip="${tip}" aria-label="${ribbonEsc(item.label)}">${icon(item.icon)}</button>`
          : `<button type="button" class="rb-btn rb-btn--small" data-ribbon-command="${ribbonEsc(item.command)}" data-tooltip="${tip}">${icon(item.icon)}${labelSpan("rb-btn__label")}</button>`;
      return `<span class="rb-split${large ? " rb-split--large" : ""}">${body}<button type="button" class="rb-split__arrow" data-ribbon-menu="${ribbonEsc(item.menu)}" aria-label="${ribbonEsc(`${item.label} options`)}" data-tooltip="${ribbonEsc(`${item.label} options`)}">${icon("chevron")}</button></span>`;
    }
    if (item.kind === "large") {
      const splitClass = item.split ? " rb-split--large" : "";
      const inner = `<button type="button" class="rb-btn rb-btn--large${item.accent ? " rb-btn--accent" : ""}"${idAttr}${formatAttr} data-ribbon-command="${ribbonEsc(item.command)}" ${toggleAttr} data-tooltip="${tip}">${icon(item.icon)}${labelSpan("rb-btn__label")}</button>`;
      if (!item.split) return inner;
      return `<span class="rb-split rb-split--large">${inner}<button type="button" class="rb-split__arrow" data-ribbon-menu="${ribbonEsc(item.split)}" aria-label="${ribbonEsc(`${item.label} options`)}" data-tooltip="${ribbonEsc(`${item.label} options`)}">${icon("chevron")}</button></span>`;
    }
    if (item.kind === "icon") {
      return `<button type="button" class="rb-btn rb-btn--icon ${item.cls || ""}"${idAttr}${formatAttr} data-ribbon-command="${ribbonEsc(item.command)}" ${toggleAttr} data-tooltip="${tip}" aria-label="${ribbonEsc(item.label)}">${icon(item.icon)}</button>`;
    }
    return `<button type="button" class="rb-btn rb-btn--small ${item.cls || ""}"${idAttr}${formatAttr} data-ribbon-command="${ribbonEsc(item.command)}" ${toggleAttr} data-tooltip="${tip}">${icon(item.icon)}${labelSpan("rb-btn__label")}</button>`;
  }
  function renderRibbonGroup(group) {
    return `<div class="ribbon-group" role="group" aria-label="${ribbonEsc(group.label)}">
      <div class="ribbon-group__body">${group.rows
        .map((row) => `<div class="ribbon-row">${row.map((item) => renderRibbonItem(item)).join("")}</div>`)
        .join("")}</div>
      <span class="ribbon-group__label">${ribbonEsc(group.label)}</span>
    </div>`;
  }
  function renderRibbon() {
    if (!els.ribbonDeck) return;
    els.ribbonDeck.innerHTML = RIBBON_TAB_DEFS.map((tab) => {
      const active = tab.id === ribbonState.ribbonTab;
      return `<section class="ribbon-tab-panel${active ? " is-active" : ""}" data-ribbon-panel="${tab.id}" id="ribbon-${tab.id}" role="tabpanel" aria-labelledby="ribbonTab-${tab.id}"${active ? "" : " hidden"}>${(RIBBON_MODEL[tab.id] || [])
        .map((group) => renderRibbonGroup(group))
        .join("")}</section>`;
    }).join("");
    syncRibbon();
  }
  // Ribbon switching, popovers and state sync
  function switchRibbonTab(tabId) {
    const tab = RIBBON_TAB_DEFS.some((entry) => entry.id === tabId) ? tabId : "home";
    ribbonState.ribbonTab = tab;
    $$("[data-ribbon-tab]").forEach((button) => {
      const active = button.dataset.ribbonTab === tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.setAttribute("tabindex", active ? "0" : "-1");
    });
    $$(".ribbon-tab-panel").forEach((panel) => {
      const active = panel.dataset.ribbonPanel === tab;
      panel.hidden = !active;
      panel.classList.toggle("is-active", active);
      if (active) {
        panel.classList.remove("is-entering");
        void panel.offsetWidth;
        panel.classList.add("is-entering");
      }
    });
    closeRibbonPopover(true);
    if (els.appShell && els.appShell.classList.contains("ribbon-collapsed")) {
      toggleRibbonCollapsed(false);
    }
    syncRibbon();
    requestAnimationFrame(updateRibbonScrollHint);
  }
  function updateRibbonScrollHint() {
    if (!els.ribbonBar || !els.ribbonScroller) return;
    const scroller = els.ribbonScroller;
    const overflow = scroller.scrollWidth > scroller.clientWidth + 2;
    els.ribbonBar.classList.toggle("is-scrollable", overflow);
    els.ribbonBar.classList.toggle(
      "is-scroll-end",
      scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 2,
    );
  }
  function toggleRibbonCollapsed(force) {
    if (!els.appShell) return;
    const collapsed =
      typeof force === "boolean"
        ? force
        : !els.appShell.classList.contains("ribbon-collapsed");
    els.appShell.classList.toggle("ribbon-collapsed", collapsed);
    document.body.classList.toggle("mode-classic", collapsed);
    if (els.ribbonPinButton) {
      els.ribbonPinButton.setAttribute("aria-pressed", String(collapsed));
      els.ribbonPinButton.dataset.tooltip = collapsed ? "Show the ribbon" : "Collapse ribbon (Classic View)";
      els.ribbonPinButton.setAttribute("aria-label", collapsed ? "Show ribbon" : "Collapse ribbon");
    }
    requestAnimationFrame(() => workspaceLayout.fitPaper());
    if (!collapsed) requestAnimationFrame(updateRibbonScrollHint);
    syncRibbon();
  }
  function closeRibbonPopover(immediate = false) {
    if (!els.ribbonPopover) return;
    els.ribbonPopover.hidden = true;
    els.ribbonPopover.innerHTML = "";
    $$("[data-ribbon-menu][aria-expanded='true'], [data-ribbon-combo][aria-expanded='true']").forEach((control) => {
      control.setAttribute("aria-expanded", "false");
    });
    if (immediate) return;
  }
  function positionRibbonPopover(anchor) {
    const popover = els.ribbonPopover;
    const bar = els.ribbonBar;
    if (!popover || !bar) return;
    const anchorRect = anchor.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    popover.style.visibility = "hidden";
    popover.hidden = false;
    const width = popover.offsetWidth || 220;
    const height = popover.offsetHeight || 200;
    const left = clamp(anchorRect.left - barRect.left, 6, Math.max(6, barRect.width - width - 8));
    const spaceBelow = window.innerHeight - anchorRect.bottom - 12;
    const spaceAbove = anchorRect.top - 12;
    let top = anchorRect.bottom - barRect.top + 3;
    if (spaceBelow >= 170 || spaceBelow >= spaceAbove) {
      popover.style.maxHeight = `${clamp(spaceBelow - 6, 170, 340)}px`;
    } else {
      top = Math.max(4, anchorRect.top - barRect.top - height - 3);
      popover.style.maxHeight = `${clamp(spaceAbove - 6, 170, 340)}px`;
    }
    popover.style.left = `${left}px`;
    popover.style.top = `${top}px`;
    popover.style.visibility = "";
  }
  function openRibbonMenu(anchor, menuId) {
    const menu = RIBBON_MENUS[menuId];
    if (!menu || !els.ribbonPopover) return;
    closeRibbonPopover(true);
    const items = typeof menu.items === "function" ? menu.items() : menu.items;
    els.ribbonPopover.classList.toggle("ribbon__popover--palette", menu.type === "swatch");
    els.ribbonPopover.innerHTML = items
      .map((item, index) => {
        if (!item) return "";
        if (item.sep) return `<div class="rb-menu__sep" role="separator"></div>`;
        if (item.header) return `<div class="rb-menu__header">${ribbonEsc(item.header)}</div>`;
        const checkIcon = item.checked
          ? `<span class="rb-menu__check">${icon("check")}</span>`
          : `<span class="rb-menu__check"></span>`;
        const swatch = menu.type === "swatch"
          ? `<span class="rb-swatch${item.swatch === "none" ? " rb-swatch--none" : ""}${item.checked ? " is-selected" : ""}" style="--swatch:${ribbonEsc(item.swatch || "transparent")}"></span>`
          : "";
        return `<button type="button" class="rb-menu__item${item.checked ? " is-checked" : ""}" role="menuitem" data-ribbon-menu-index="${index}"${item.disabled ? " disabled" : ""}>${swatch}${!swatch ? checkIcon : checkIcon}${item.icon ? icon(item.icon) : ""}<span>${ribbonEsc(item.label)}</span>${item.shortcut ? `<span class="rb-menu__shortcut">${ribbonEsc(item.shortcut)}</span>` : ""}</button>`;
      })
      .join("");
    $$("[data-ribbon-menu-index]", els.ribbonPopover).forEach((button) => {
      button.addEventListener("click", () => {
        const item = items[Number(button.dataset.ribbonMenuIndex)];
        closeRibbonPopover();
        if (!item || item.disabled) return;
        if (item.command) runRibbonCommand(item.command);
        else if (item.run) item.run();
      });
    });
    anchor.setAttribute("aria-expanded", "true");
    positionRibbonPopover(anchor);
    const first = els.ribbonPopover.querySelector(".rb-menu__item:not([disabled])");
    if (first) first.focus({ preventScroll: true });
  }
  function openRibbonCombo(anchor, comboId) {
    const config = RIBBON_COMBOS[comboId];
    if (!config || !els.ribbonPopover) return;
    closeRibbonPopover(true);
    const options = config.options();
    els.ribbonPopover.classList.remove("ribbon__popover--palette");
    els.ribbonPopover.innerHTML = [
      `<div class="rb-menu__header">${ribbonEsc(config.label)}</div>`,
      ...options.map(
        (option, index) =>
          `<button type="button" class="rb-menu__item${option.checked ? " is-checked" : ""}" role="menuitemradio" aria-checked="${Boolean(option.checked)}" data-ribbon-option-index="${index}"${option.disabled ? " disabled" : ""}><span class="rb-menu__check">${option.checked ? icon("check") : ""}</span><span>${ribbonEsc(option.label)}</span>${option.hint ? `<span class="rb-menu__shortcut">${ribbonEsc(option.hint)}</span>` : ""}</button>`,
      ),
    ].join("");
    $$("[data-ribbon-option-index]", els.ribbonPopover).forEach((button) => {
      button.addEventListener("click", () => {
        const option = options[Number(button.dataset.ribbonOptionIndex)];
        closeRibbonPopover();
        if (!option || option.disabled) return;
        config.select(option.value);
        syncRibbon();
      });
    });
    anchor.setAttribute("aria-expanded", "true");
    positionRibbonPopover(anchor);
    const active = els.ribbonPopover.querySelector(".rb-menu__item.is-checked") || els.ribbonPopover.querySelector(".rb-menu__item:not([disabled])");
    if (active) active.focus({ preventScroll: true });
  }
  function toggleRibbonMenu(anchor, menuId) {
    const open = anchor.getAttribute("aria-expanded") === "true" && !els.ribbonPopover.hidden;
    closeRibbonPopover(true);
    if (!open) {
      saveRibbonSelection();
      openRibbonMenu(anchor, menuId);
    }
  }
  function toggleRibbonCombo(anchor, comboId) {
    const open = anchor.getAttribute("aria-expanded") === "true" && !els.ribbonPopover.hidden;
    closeRibbonPopover(true);
    if (!open) {
      saveRibbonSelection();
      openRibbonCombo(anchor, comboId);
    }
  }
  let ribbonSelectionRange = null;
  function clearDocumentSelection() {
    ribbonSelectionRange = null;
    closeRibbonPopover(true);
  }
  function saveRibbonSelection() {
    const selection = window.getSelection();
    if (!selection || !selection.rangeCount) return;
    if (!els.editor || !els.editor.contains(selection.anchorNode)) return;
    ribbonSelectionRange = selection.getRangeAt(0).cloneRange();
  }
  function restoreRibbonSelection() {
    if (!ribbonSelectionRange) return false;
    const selection = window.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(ribbonSelectionRange);
    return true;
  }
  function updateRailIndicator() {
    if (!els.railIndicator) return;
    const active = $(".rail__item[data-view].is-active");
    if (!active) return;
    els.railIndicator.style.transform = `translateY(${active.offsetTop - 8}px)`;
    els.railIndicator.style.height = `${active.offsetHeight}px`;
  }
  const RIBBON_TOGGLES = {
    "edit-track-changes": () => editorState.trackChanges,
    "format-allcaps": () => editorActions.selectionHasCapsStyle(),
    "view-toggle-outline": () => preferences.showOutline,
    "view-toggle-outline-script": () => preferences.showOutlineInScript !== false,
    "view-toggle-structure": () => preferences.showStructureLines,
    "view-toggle-alts": () => editorState.showAlts,
    "view-toggle-scriptnotes": () => !preferences.hideScriptNotes,
    "view-toggle-ruler": () => preferences.showRuler,
    "view-toggle-invisibles": () => preferences.showInvisibles,
    "view-toggle-navigator": () => preferences.navigatorVisible !== false,
    "view-split-v": () => workspaceState.splitView.enabled && workspaceState.splitView.orientation !== "horizontal",
    "view-split-h": () => workspaceState.splitView.enabled && workspaceState.splitView.orientation === "horizontal",
    "format-beat-connect": () => workspaceState.beatConnectMode,
    "format-beat-disconnect": () => false,
    "format-beat-snap": () => workspaceState.beatSnap,
    "prod-scene-numbers": () => documentSession.doc.settings.sceneNumbers,
    "prod-revision-mode": () => documentSession.doc.revision.enabled,
    "prod-tags-mode": () => Boolean(editorState.tagsMode),
    "view-appearance-day": () => workspaceLayout.resolveTheme(preferences.theme) === "light",
    "view-appearance-night": () => workspaceLayout.resolveTheme(preferences.theme) === "dark",
    "view-appearance-midnight": () => workspaceLayout.resolveTheme(preferences.theme) === "midnight",
    "view-classic": () => Boolean(els.appShell && els.appShell.classList.contains("ribbon-collapsed")),
  };
  const RIBBON_DISABLED = {
    "edit-undo": () => !documentSession.history || !documentSession.history.past.length,
    "edit-redo": () => !documentSession.history || !documentSession.history.future.length,
    "edit-paste": () => false,
    "prod-clear-revised": () => {
      const paragraph = editorActions.activeParagraph();
      return !paragraph || !paragraph.revision;
    },
    "prod-mark-revised": () => !editorActions.activeParagraph(),
    "edit-reject-change": () => {
      const paragraph = editorActions.activeParagraph();
      return !paragraph || !paragraph.changeType;
    },
    "edit-accept-change": () => {
      const paragraph = editorActions.activeParagraph();
      return !paragraph || !paragraph.changeType;
    },
  };
  function syncRibbon() {
    if (!els.ribbonDeck) return;
    document.body.classList.toggle("show-structure-lines", Boolean(preferences.showStructureLines));
    document.body.classList.toggle("hide-scriptnotes", Boolean(preferences.hideScriptNotes));
    for (const [command, getter] of Object.entries(RIBBON_TOGGLES)) {
      const active = Boolean(getter());
      $$(`[data-ribbon-command="${command}"]`).forEach((control) => {
        control.setAttribute("aria-pressed", String(active));
        control.classList.toggle("is-active", active);
      });
    }
    for (const [command, getter] of Object.entries(RIBBON_DISABLED)) {
      let disabled = false;
      try {
        disabled = Boolean(getter());
      } catch {
        disabled = true;
      }
      $$(`[data-ribbon-command="${command}"]`).forEach((control) => {
        control.disabled = disabled;
      });
    }
    for (const [combo, config] of Object.entries(RIBBON_COMBOS)) {
      const valueNodes = $$(`[data-combo-value="${combo}"]`);
      if (!valueNodes.length) continue;
      const value = ribbonComboValue(combo);
      const options = config.options();
      const placeholder = options.length && options[0] && options[0].disabled;
      valueNodes.forEach((valueNode) => {
        if (valueNode.textContent !== value) valueNode.textContent = value;
        valueNode.classList.toggle("is-placeholder", Boolean(placeholder));
      });
    }
    if (els.sprintQuickButton) {
      const active = Boolean(interfaceState.sprint.open || interfaceState.sprint.running);
      els.sprintQuickButton.classList.toggle("is-active", active);
      els.sprintQuickButton.setAttribute("aria-pressed", String(active));
      /* While a sprint runs with the panel hidden, the button means "sprint is
       * active"; say so instead of implying a plain open/close toggle. */
      const tip = interfaceState.sprint.running && !interfaceState.sprint.open
        ? "Sprint running — click to reopen"
        : interfaceState.sprint.open
          ? "Hide the writing sprint"
          : "Writing sprint";
      if (els.sprintQuickButton.dataset.tooltip !== tip) {
        els.sprintQuickButton.dataset.tooltip = tip;
        els.sprintQuickButton.setAttribute("aria-label", tip);
      }
    }
    if (els.splitViewButton) {
      els.splitViewButton.setAttribute("aria-pressed", String(workspaceState.splitView.enabled));
      els.splitViewButton.classList.toggle("is-active", workspaceState.splitView.enabled);
    }
    if (els.ribbonPinButton) {
      const collapsed = Boolean(els.appShell && els.appShell.classList.contains("ribbon-collapsed"));
      els.ribbonPinButton.setAttribute("aria-pressed", String(collapsed));
    }
    $$("#viewSegmented .segmented__item").forEach((button) => {
      const active = button.dataset.mode === workspaceState.mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    updateRailIndicator();
    updateRibbonScrollHint();
  }
  // Ribbon command dispatch
  const RIBBON_COMMANDS = {
    /* file */
    "file-new": () => fileActions.newDocument(),
    "file-new-template": () => desktopActions.showStartCenter(),
    "file-open": () => fileActions.openFilePicker(),
    "file-close": () => fileActions.closeDocument(),
    "file-save": () => fileActions.saveDocument(),
    "file-save-as": () => fileActions.saveDocument({ saveAs: true }),
    "file-save-pdf": () => pageActions.exportPDF(),
    "file-save-template": () => fileActions.saveAsTemplate(),
    "file-export": () => fileActions.exportFDX(),
    "file-export-fdx": () => fileActions.exportFDX(),
    "file-export-pdf": () => pageActions.exportPDF(),
    "file-export-text": () => writingTools.exportFountainOrText("txt"),
    "file-export-beatboard": () => fileActions.exportBeatBoard(),
    "file-revert": () => fileActions.revertDocument(),
    "file-backup": () => fileActions.backupVaultDialog(),
    "file-compatibility": () => fileActions.openCompatibilityInspector(),
    "file-history": () => fileActions.openVersionHistory(),
    "file-disk-status": () => fileActions.openFileStatus(),
    "view-writing-reliability": () => writingTools.openWritingReliability(),
    "file-print-preview": () => pageActions.openPrintPreviewDialog(),
    "file-print": () => pageActions.printDocument(),
    "file-wga": () => fileActions.openWgaDialog(),
    /* edit */
    "edit-undo": () => fileActions.undo(),
    "edit-redo": () => fileActions.redo(),
    "edit-cut": () => document.execCommand("cut"),
    "edit-copy": () => document.execCommand("copy"),
    "edit-paste": () => editorActions.pasteAsPlainText(),
    "edit-paste-plain": () => editorActions.pasteAsPlainText(),
    "edit-delete": () => editorActions.deleteSelectionAction(),
    "edit-select-all": () => {
      els.editor.focus();
      document.execCommand("selectAll");
    },
    "edit-select-scene": () => editorActions.selectCurrentScene(),
    "edit-rename-character": () => writingTools.openRenameCharacterDialog(),
    "edit-nonspeaking": () => writingTools.openNonSpeakingDialog(),
    "edit-find": () => findActions.openFind("find"),
    "edit-find-selection": () => findActions.findSelectionAction(),
    "edit-goto": () => writingTools.openGoToDialog(),
    "edit-track-changes": () => editorActions.toggleTrackChanges(),
    "edit-accept-change": () => editorActions.acceptCurrentChange(),
    "edit-reject-change": () => editorActions.rejectCurrentChange(),
    "edit-prev-change": () => editorActions.jumpToTrackedChange(-1),
    "edit-next-change": () => editorActions.jumpToTrackedChange(1),
    "edit-emoji": () => writingTools.openEmojiDialog(),
    /* view */
    "view-normal": () => workspaceLayout.setView("script", "write"),
    "view-page": () => workspaceLayout.setView("script", "page"),
    "view-speed": () => workspaceLayout.setView("script", "speed"),
    "view-scene": () => workspaceLayout.setView("sceneview"),
    "view-cards-summary": () => {
      workspaceState.cardMode = "summary";
      workspaceLayout.setView("navigator");
    },
    "view-cards-script": () => {
      workspaceState.cardMode = "script";
      workspaceLayout.setView("navigator");
    },
    "view-beatboard": () => workspaceLayout.setView("beatboard"),
    "view-toggle-outline": () => editorActions.toggleOutlineLayer(),
    "view-toggle-outline-script": () => workspaceLayout.toggleOutlineInScript(),
    "view-toggle-structure": () => workspaceLayout.toggleStructureLines(),
    "view-toggle-alts": () => workspaceLayout.toggleAltBadges(),
    "view-toggle-scriptnotes": () => workspaceLayout.toggleScriptNoteVisibility(),
    "view-toggle-ruler": () => editorActions.toggleRulerLayer(),
    "view-toggle-invisibles": () => workspaceLayout.toggleInvisibles(),
    "view-toggle-navigator": () => workspaceLayout.toggleNavigatorPanel(),
    "view-split-toggle": () => editorActions.toggleSplitView(),
    "view-split-off": () => editorActions.toggleSplitView(false),
    "view-split-v": () => editorActions.toggleSplitView(true, "vertical"),
    "view-split-h": () => editorActions.toggleSplitView(true, "horizontal"),
    "view-split-swap": () => editorActions.swapSplitPanes(),
    "view-arrange-docs": () => workspaceLayout.openArrangeDocumentsDialog(),
    "view-open-docs": () => workspaceLayout.openOpenDocumentsDialog(),
    "view-classic": () => toggleRibbonCollapsed(),
    "view-zoom-out": () => workspaceLayout.setZoom(-0.1),
    "view-zoom-in": () => workspaceLayout.setZoom(0.1),
    "view-zoom-outline": () => workspaceLayout.cycleOutlineZoom(),
    "view-appearance-day": () => workspaceLayout.applyTheme("light"),
    "view-appearance-night": () => workspaceLayout.applyTheme("dark"),
    "view-appearance-midnight": () => workspaceLayout.applyTheme("midnight"),
    /* format */
    "format-element-settings": () => editorActions.openElementSettings(),
    "format-element-options": () => editorActions.openElementSettings(),
    "format-cast-list": () => planningViews.openCastListOptions(),
    "format-dual": () => editorActions.toggleDualDialogue(),
    "format-highlight-characters": () => writingTools.openHighlightCharactersDialog(),
    "format-bold": () => editorActions.formatSelection("bold"),
    "format-italic": () => editorActions.formatSelection("italic"),
    "format-underline": () => editorActions.formatSelection("underline"),
    "format-strike": () => editorActions.formatSelection("strikeThrough"),
    "format-case": () => editorActions.cycleCase(),
    "format-allcaps": () => editorActions.applyAllCapsStyle(),
    "format-text-color": () => formatActions.applyTextColor(preferences.textColor || "#171614"),
    "format-highlight": () => formatActions.applyHighlighter(preferences.highlightColor || "#ffe9a3"),
    "format-page-break": () => writingTools.insertPageBreak(),
    "format-revert-paragraph": () => formatActions.revertParagraphFormatting(),
    "format-beat-align": () => planningViews.alignBeats("row"),
    "format-beat-connect": () => planningViews.toggleBeatConnectMode(),
    "format-beat-disconnect": () => planningViews.disconnectSelectedBeat(),
    "format-beat-snap": () => planningViews.toggleBeatSnap(),
    "format-beat-connection-color": () => planningViews.setBeatConnectionColor(preferences.beatConnectionColor || "#0f6cbd"),
    /* insert */
    "insert-scriptnote": () => editorActions.openScriptNote(),
    "insert-bookmark": () => writingTools.openBookmarksDialog(true),
    "insert-label": () => writingTools.insertLabelDialog(),
    "insert-image": () => writingTools.insertImageMarker(),
    "insert-pagebreak": () => writingTools.insertPageBreak(),
    "insert-nonspeaking": () => writingTools.openNonSpeakingDialog(),
    "insert-alt-add": () => writingTools.openAltDialogueDialog(),
    "insert-alt-remove": () => writingTools.removeAlternateTake(),
    "insert-beat": () => planningViews.addBeat("beat"),
    "insert-scene": () => editorActions.insertScene(),
    "insert-send-to-script": () => planningViews.sendToScriptAction(),
    "insert-emoji": () => writingTools.openEmojiDialog(),
    /* document */
    "doc-title-page": () => productionActions.openTitlePage(),
    "doc-header-footer": () => productionActions.openHeaderFooterDialog(),
    "doc-page-layout": () => settingsActions.openPageSetup(),
    "doc-mores": () => productionActions.openMoresDialog(),
    "doc-watermark": () => productionActions.openWatermarkDialog(),
    "doc-smarttype": () => writingTools.openSmartTypeDialog(),
    "doc-macros": () => writingTools.openMacrosDialog(),
    "doc-bookmarks": () => writingTools.openBookmarksDialog(false),
    "doc-target-length": () => productionActions.openTargetLengthDialog(),
    "doc-details": () => settingsActions.openDocumentDetails(),
    /* tools */
    "tools-spelling": () => editorActions.openSpellcheckDialog(),
    "tools-thesaurus": () => editorActions.openThesaurus(),
    "tools-play": () => speechActions.speechPlay(),
    "tools-stop": () => speechActions.speechStop(),
    "tools-assign-voices": () => speechActions.openAssignVoicesDialog(),
    "tools-rewind": () => speechActions.speechTransport(-1),
    "tools-forward": () => speechActions.speechTransport(1),
    "tools-collaboration": () => settingsActions.openCollaborationDialog(),
    "tools-combine-reports": () => planningViews.openCombineReportsDialog(),
    "tools-format-assistant": () => writingTools.openFormatAssistantDialog(),
    "tools-script-compare": () => writingTools.openScriptCompareDialog(),
    "tools-reformat": () => writingTools.openReformatDialog(),
    "tools-writing-stats": () => writingTools.openWritingStatsDialog(),
    "tools-names": () => writingTools.openNamesDatabaseDialog(),
    "tools-show-navigator": () => {
      if (preferences.navigatorVisible === false) workspaceLayout.toggleNavigatorPanel();
      else workspaceLayout.setView("script");
      syncRibbon();
    },
    "tools-sprint": () => writingTools.toggleSprintWidget(),
    "tools-options": () => settingsActions.openSettings(),
    "tools-ask": () => writingTools.openAskFdDialog(),
    /* production */
    "prod-scene-numbers": () => {
      documentSession.doc.settings.sceneNumbers = !documentSession.doc.settings.sceneNumbers;
      fileActions.markDirty();
      workspaceLayout.renderAll();
    },
    "prod-edit-scene-number": () => productionActions.editSceneNumberDialog(),
    "prod-reset-scene-numbers": () => productionActions.resetSceneNumbersDialog(),
    "prod-omit-scene": () => productionActions.omitCurrentScene(),
    "prod-revisions-setup": () => productionActions.openRevisionManager(),
    "prod-revision-mode": () => productionActions.toggleRevisionMode(),
    "prod-mark-revised": () => {
      const paragraph = editorActions.activeParagraph();
      if (!paragraph) {
        modalActions.toast("No paragraph selected", "Place the caret in the script first.", "info", 2000);
        return;
      }
      editorActions.markCurrentRevision(paragraph);
      workspaceLayout.renderAll();
      modalActions.toast("Marked revised", "The paragraph now carries the active revision color.", "success", 2000);
    },
    "prod-clear-revised": () => {
      const paragraph = editorActions.activeParagraph();
      if (!paragraph || !paragraph.revision) {
        modalActions.toast("Nothing to clear", "This paragraph has no revision mark.", "info", 2000);
        return;
      }
      paragraph.revision = null;
      fileActions.markDirty();
      documentSession.history.record();
      workspaceLayout.renderAll();
    },
    "prod-prev-revision": () => productionActions.goToPreviousRevision(),
    "prod-next-revision": () => productionActions.startNextRevision(),
    "prod-lock-pages": () => productionActions.openLockPagesDialog(),
    "prod-unlock-a-pages": () => productionActions.unlockAPages(),
    "prod-unlock-all-pages": () => productionActions.unlockAllPages(),
    "prod-locking-tools": () => productionActions.openLockPagesDialog(),
    "prod-tags-mode": () => productionActions.toggleTagsMode(),
    "prod-tag-all": () => writingTools.tagAllCharacters(),
    /* help */
    "help-guide": () => settingsActions.openHelp(),
    "help-welcome": () => settingsActions.openWelcomeDialog(),
    "help-whats-new": () => settingsActions.openWhatsNewDialog(),
    "help-get-help": () => settingsActions.openGetHelpDialog(),
    "help-tutorials": () => settingsActions.openTutorialsDialog(),
    "help-samples": () => settingsActions.openSamplesDialog(),
    "help-updates": () => settingsActions.openCheckUpdatesDialog(),
    "help-feedback": () => settingsActions.openFeedbackDialog(),
    "help-account": () => settingsActions.openAccountDialog(),
    "help-signout": () => settingsActions.signOutAction(),
    "help-about": () => settingsActions.openAboutDialog(),
  };
  function runRibbonCommand(command) {
    if (documentSession.history) documentSession.history.finishBurst();
    if (documentSession.history) documentSession.history.selectionCurrent = FDCoreWriting.captureSelection(els.editor) || documentSession.history.selectionCurrent;
    if (!command) return;
    saveRibbonSelection();
    const handler = RIBBON_COMMANDS[command];
    if (handler) {
      try {
        handler();
      } catch (error) {
        console.error(`[ribbon] ${command} failed`, error);
        modalActions.toast("Command failed", error && error.message ? error.message : String(error), "error", 5000);
      }
    } else {
      console.warn(`[ribbon] unknown command: ${command}`);
      modalActions.toast("Command unavailable", `The command “${command}” is not available in this build.`, "warning", 3200);
    }
    requestAnimationFrame(syncRibbon);
  }
  function bindRibbonEvents() {
    renderRibbon();
    $$("[data-ribbon-tab]").forEach((button) => {
      button.addEventListener("click", () => switchRibbonTab(button.dataset.ribbonTab));
      button.addEventListener("dblclick", () => {
        if (button.dataset.ribbonTab === ribbonState.ribbonTab) toggleRibbonCollapsed();
      });
      button.addEventListener("keydown", (event) => {
        if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const index = RIBBON_TAB_DEFS.findIndex((tab) => tab.id === button.dataset.ribbonTab);
        const delta = event.key === "ArrowRight" ? 1 : -1;
        const next = event.key === "Home" ? RIBBON_TAB_DEFS[0] : event.key === "End" ? RIBBON_TAB_DEFS[RIBBON_TAB_DEFS.length - 1]
          : RIBBON_TAB_DEFS[(index + delta + RIBBON_TAB_DEFS.length) % RIBBON_TAB_DEFS.length];
        switchRibbonTab(next.id);
        $(`#ribbonTab-${next.id}`).focus();
      });
    });
    if (els.ribbonPinButton) {
      els.ribbonPinButton.addEventListener("click", () => toggleRibbonCollapsed());
    }
    if (els.ribbonDeck) {
      els.ribbonDeck.addEventListener("mousedown", (event) => {
        if (event.target.closest("[data-format]")) event.preventDefault();
        saveRibbonSelection();
      });
      els.ribbonDeck.addEventListener("click", (event) => {
        if (event.target.closest(".format-btn")) return;
        const commandControl = event.target.closest("[data-ribbon-command]");
        if (commandControl && !event.target.closest(".rb-split__arrow")) {
          if (commandControl.disabled) return;
          runRibbonCommand(commandControl.dataset.ribbonCommand);
          return;
        }
        const menuControl = event.target.closest("[data-ribbon-menu]");
        if (menuControl) {
          toggleRibbonMenu(menuControl, menuControl.dataset.ribbonMenu);
          return;
        }
        const comboControl = event.target.closest("[data-ribbon-combo]");
        if (comboControl) {
          toggleRibbonCombo(comboControl, comboControl.dataset.ribbonCombo);
        }
      });
    }
    if (els.ribbonScroller) {
      els.ribbonScroller.addEventListener("scroll", () => {
        updateRibbonScrollHint();
        if (els.ribbonPopover && !els.ribbonPopover.hidden) {
          closeRibbonPopover(true);
        }
      }, { passive: true });
    }
    document.addEventListener("pointerdown", (event) => {
      if (!els.ribbonPopover || els.ribbonPopover.hidden) return;
      if (event.target.closest("#ribbonBar") || event.target.closest("#ribbonPopover")) return;
      closeRibbonPopover(true);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (els.ribbonPopover && !els.ribbonPopover.hidden) {
        closeRibbonPopover();
        event.stopPropagation();
      }
    });
    window.addEventListener("resize", updateRibbonScrollHint);
    requestAnimationFrame(updateRibbonScrollHint);
  }
  function ribbonToast(title, message, type = "info", duration = 2600) {
    modalActions.toast(title, message, type, duration);
  }
  function ribbonFileName(extension) {
    const base =
      String(documentSession.doc.title || "screenplay")
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
        .trim() || "screenplay";
    return `${base}.${extension}`;
  }
  /* Legacy action name compatibility for the command palette & old markup. */
  function handleRibbonAction(action) {
    const legacy = {
      "midnight-mode": () => workspaceLayout.applyTheme(workspaceLayout.resolveTheme(preferences.theme) === "midnight" ? "light" : "midnight"),
      "toggle-alts": () => workspaceLayout.toggleAltBadges(),
      "toggle-invisibles": () => workspaceLayout.toggleInvisibles(),
      "track-changes": () => editorActions.toggleTrackChanges(),
      "omit-scene": () => productionActions.omitCurrentScene(),
      "toggle-scene-nums": () => {
        documentSession.doc.settings.sceneNumbers = !documentSession.doc.settings.sceneNumbers;
        fileActions.markDirty();
        workspaceLayout.renderAll();
      },
      "sprint-timer": () => writingTools.toggleSprintWidget(),
      "start-center": () => desktopActions.showStartCenter(),
      "save-as": () => fileActions.saveDocument({ saveAs: true }),
      "export-txt": () => writingTools.exportFountainOrText("txt"),
      "print": () => pageActions.printDocument(),
      "spellcheck": () => editorActions.openSpellcheckDialog(),
      "names-db": () => writingTools.openNamesDatabaseDialog(),
      "assign-voices": () => speechActions.openAssignVoicesDialog(),
      "highlight-chars": () => writingTools.openHighlightCharactersDialog(),
      "rename-char": () => writingTools.openRenameCharacterDialog(),
      "reformat-tool": () => writingTools.openReformatDialog(),
      "script-compare": () => writingTools.openScriptCompareDialog(),
      "writing-stats": () => writingTools.openWritingStatsDialog(),
      "revision-toggle": () => productionActions.toggleRevisionMode(),
      "revision-next": () => productionActions.startNextRevision(),
      "lock-pages": () => productionActions.openLockPagesDialog(),
      "tags-mode": () => productionActions.toggleTagsMode(),
      "tag-all-chars": () => writingTools.tagAllCharacters(),
      "bookmarks": () => writingTools.openBookmarksDialog(false),
      "insert-bookmark": () => writingTools.openBookmarksDialog(true),
      "goto": () => writingTools.openGoToDialog(),
    };
    if (legacy[action]) {
      legacy[action]();
      return;
    }
    runRibbonCommand(action);
  }
  return {
    clearDocumentSelection,
    RIBBON_MODEL,
    RIBBON_TAB_DEFS,
    bindRibbonEvents,
    handleRibbonAction,
    restoreRibbonSelection,
    ribbonFileName,
    ribbonToast,
    runRibbonCommand,
    switchRibbonTab,
    syncRibbon,
    toggleRibbonCollapsed,
    updateRailIndicator
  };
};
