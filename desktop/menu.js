/* Native application menu for Azkript.
 * Menu commands are intentionally thin: the renderer owns document state and
 * exposes one command vocabulary for both keyboard and menu paths.
 */
const { app, Menu, shell } = require("electron");
const path = require("node:path");

function buildApplicationMenu({
  send,
  recent,
  clearRecent,
  openRecent,
  openDocs,
  showStartCenter,
  isDev,
}) {
  const recentItems =
    recent && recent.length
      ? recent.map((item) => ({
          label: item.name || path.basename(item.path),
          sublabel: item.path,
          toolTip: item.path,
          click: () => openRecent(item.path),
        }))
      : [{ label: "No recent screenplays", enabled: false }];

  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "New Screenplay",
          accelerator: "CmdOrCtrl+N",
          click: () => send("new"),
        },
        {
          label: "Open…",
          accelerator: "CmdOrCtrl+O",
          click: () => send("open"),
        },
        {
          label: "Open Recent",
          submenu: [
            ...recentItems,
            { type: "separator" },
            {
              label: "Clear Recent",
              enabled: Boolean(recent && recent.length),
              click: clearRecent,
            },
          ],
        },
        { type: "separator" },
        {
          label: "Save",
          accelerator: "CmdOrCtrl+S",
          click: () => send("save"),
        },
        {
          label: "Save As…",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => send("save-as"),
        },
        { type: "separator" },
        {
          label: "Export PDF…",
          accelerator: "CmdOrCtrl+Shift+E",
          click: () => send("export-pdf"),
        },
        {
          label: "Export FDX…",
          click: () => send("export-fdx"),
        },
        {
          label: "Print…",
          accelerator: "CmdOrCtrl+P",
          click: () => send("print"),
        },
        { type: "separator" },
        {
          label: "Start Center",
          accelerator: "CmdOrCtrl+Shift+O",
          click: showStartCenter,
        },
        { type: "separator" },
        { role: "close", label: "Close Window" },
        { role: "quit", label: "Exit Azkript" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        {
          label: "Undo",
          accelerator: "CmdOrCtrl+Z",
          click: () => send("undo"),
        },
        {
          label: "Redo",
          accelerator: process.platform === "win32" ? "Ctrl+Y" : "CmdOrCtrl+Shift+Z",
          click: () => send("redo"),
        },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { type: "separator" },
        {
          label: "Find…",
          accelerator: "CmdOrCtrl+F",
          click: () => send("find"),
        },
        {
          label: "Find and Replace…",
          accelerator: "CmdOrCtrl+H",
          click: () => send("replace"),
        },
        { type: "separator" },
        { role: "selectAll" },
      ],
    },
    {
      label: "Format",
      submenu: [
        {
          label: "Bold",
          accelerator: "CmdOrCtrl+B",
          click: () => send("format:bold"),
        },
        {
          label: "Italic",
          accelerator: "CmdOrCtrl+I",
          click: () => send("format:italic"),
        },
        {
          label: "Underline",
          accelerator: "CmdOrCtrl+U",
          click: () => send("format:underline"),
        },
        { type: "separator" },
        {
          label: "Element",
          submenu: [
            ["Scene Heading", "1"],
            ["Action", "2"],
            ["Character", "3"],
            ["Parenthetical", "4"],
            ["Dialogue", "5"],
            ["Transition", "6"],
            ["Shot", "7"],
            ["General", "0"],
          ].map(([label, key]) => ({
            label: `${label}\t${key}`,
            click: () => send("element", { type: label }),
          })),
        },
        { type: "separator" },
        {
          label: "Title Page…",
          click: () => send("title-page"),
        },
        {
          label: "Page Setup…",
          click: () => send("page-setup"),
        },
        {
          label: "Scene Details…",
          accelerator: "CmdOrCtrl+Shift+D",
          click: () => send("scene-details"),
        },
        { type: "separator" },
        {
          label: "Revision Mode",
          accelerator: "CmdOrCtrl+Alt+V",
          click: () => send("revision:toggle"),
        },
        {
          label: "Start Next Revision",
          accelerator: "CmdOrCtrl+Alt+N",
          click: () => send("revision:next"),
        },
        {
          label: "Revision Manager…",
          click: () => send("revision"),
        },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Script",
          accelerator: "CmdOrCtrl+1",
          click: () => send("view", { view: "script" }),
        },
        {
          label: "Index Cards",
          accelerator: "CmdOrCtrl+2",
          click: () => send("view", { view: "navigator" }),
        },
        {
          label: "Characters",
          accelerator: "CmdOrCtrl+3",
          click: () => send("view", { view: "characters" }),
        },
        {
          label: "Reports",
          accelerator: "CmdOrCtrl+4",
          click: () => send("view", { view: "reports" }),
        },
        { type: "separator" },
        {
          label: "Write View",
          click: () => send("mode", { mode: "write" }),
        },
        {
          label: "Page View",
          accelerator: "CmdOrCtrl+Alt+P",
          click: () => send("mode", { mode: "page" }),
        },
        { type: "separator" },
        {
          label: "Focus Mode",
          accelerator: "CmdOrCtrl+Shift+F",
          click: () => send("focus"),
        },
        {
          label: "Toggle Inspector",
          accelerator: "CmdOrCtrl+Alt+I",
          click: () => send("inspector"),
        },
        {
          label: "Toggle Navigation",
          accelerator: "CmdOrCtrl+Alt+B",
          click: () => send("rail"),
        },
        { type: "separator" },
        {
          label: "Zoom In",
          accelerator: "CmdOrCtrl+=",
          click: () => send("zoom", { delta: 0.1 }),
        },
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+-",
          click: () => send("zoom", { delta: -0.1 }),
        },
        {
          label: "Reset Zoom",
          accelerator: "CmdOrCtrl+0",
          click: () => send("zoom", { reset: true }),
        },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(isDev
          ? [
              { type: "separator" },
              { role: "reload" },
              { role: "toggleDevTools" },
            ]
          : []),
      ],
    },
    {
      label: "Scene",
      submenu: [
        {
          label: "New Scene",
          accelerator: "CmdOrCtrl+Enter",
          click: () => send("scene:new"),
        },
        {
          label: "Scene Details…",
          click: () => send("scene-details"),
        },
        { type: "separator" },
        {
          label: "Previous Scene",
          accelerator: "CmdOrCtrl+Alt+Up",
          click: () => send("scene:previous"),
        },
        {
          label: "Next Scene",
          accelerator: "CmdOrCtrl+Alt+Down",
          click: () => send("scene:next"),
        },
        { type: "separator" },
        {
          label: "Table Read",
          accelerator: "CmdOrCtrl+Alt+R",
          click: () => send("table-read"),
        },
        {
          label: "Read From Here",
          click: () => send("table-read:here"),
        },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Keyboard Shortcuts",
          accelerator: "F1",
          click: () => send("help"),
        },
        {
          label: "Open Documentation",
          click: () => openDocs(),
        },
        {
          label: "Show Project Folder",
          click: () => shell.showItemInFolder(app.getAppPath()),
        },
        { type: "separator" },
        {
          label: "About Azkript",
          click: () => {
            app.setAboutPanelOptions({
              applicationName: "Azkript",
              applicationVersion: app.getVersion(),
              version: app.getVersion(),
              copyright: "Independent screenplay editor. Not affiliated with any third-party vendor.",
              credits:
                "A Fluent-designed screenplay editor built from public format research and clean-room interoperability work.",
            });
            app.showAboutPanel();
          },
        },
      ],
    },
  ];

  if (process.platform === "darwin") {
    template.unshift({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  }

  return Menu.buildFromTemplate(template);
}

module.exports = { buildApplicationMenu };
