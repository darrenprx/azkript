/* Azkript — document model and screenplay heuristics.
 * UMD so the same functions run in the browser and in Node tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FDModel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const VERSION = 3;

  const ELEMENTS = {
    "Scene Heading": {
      label: "Scene Heading",
      shortcut: "1",
      align: "left",
      left: 1.5,
      right: 7.5,
      first: 0,
      before: 24,
      style: "AllCaps",
      placeholder: "INT. LOCATION — DAY",
      next: "Action",
      tab: "Action",
    },
    Action: {
      label: "Action",
      shortcut: "2",
      align: "left",
      left: 1.5,
      right: 7.5,
      first: 0,
      before: 12,
      style: "",
      placeholder: "Describe what happens…",
      next: "Action",
      tab: "Character",
    },
    Character: {
      label: "Character",
      shortcut: "3",
      align: "left",
      left: 3.5,
      right: 7.25,
      first: 0,
      before: 12,
      style: "AllCaps",
      placeholder: "CHARACTER",
      next: "Dialogue",
      tab: "Transition",
    },
    Parenthetical: {
      label: "Parenthetical",
      shortcut: "4",
      align: "left",
      left: 3.0,
      right: 5.5,
      first: -0.1,
      before: 0,
      style: "",
      placeholder: "(beat)",
      next: "Dialogue",
      tab: "Dialogue",
    },
    Dialogue: {
      label: "Dialogue",
      shortcut: "5",
      align: "left",
      left: 2.5,
      right: 6.0,
      first: 0,
      before: 0,
      style: "",
      placeholder: "Say it…",
      next: "Action",
      tab: "Parenthetical",
    },
    Transition: {
      label: "Transition",
      shortcut: "6",
      align: "right",
      left: 5.5,
      right: 7.1,
      first: 0,
      before: 12,
      style: "AllCaps",
      placeholder: "CUT TO:",
      next: "Scene Heading",
      tab: "Scene Heading",
    },
    General: {
      label: "General",
      shortcut: "0",
      align: "left",
      left: 1.5,
      right: 7.5,
      first: 0,
      before: 0,
      style: "",
      placeholder: "Note…",
      next: "General",
      tab: "Action",
    },
    Shot: {
      label: "Shot",
      shortcut: "7",
      align: "left",
      left: 1.5,
      right: 7.5,
      first: 0,
      before: 12,
      style: "AllCaps",
      placeholder: "CLOSE ON —",
      next: "Action",
      tab: "Action",
    },
    "Cast List": {
      label: "Cast List",
      shortcut: "8",
      align: "left",
      left: 1.5,
      right: 7.5,
      first: 0,
      before: 0,
      style: "AllCaps",
      placeholder: "CAST MEMBER",
      next: "Action",
      tab: "Action",
    },
    "New Act": {
      label: "New Act",
      shortcut: "9",
      align: "center",
      left: 1.5,
      right: 7.5,
      first: 0,
      before: 24,
      style: "AllCaps+Underline",
      placeholder: "ACT ONE",
      next: "Scene Heading",
      tab: "Scene Heading",
    },
    "End of Act": {
      label: "End of Act",
      shortcut: "E",
      align: "center",
      left: 1.5,
      right: 7.5,
      first: 0,
      before: 24,
      style: "AllCaps+Underline",
      placeholder: "END OF ACT ONE",
      next: "New Act",
      tab: "New Act",
    },
    Summary: {
      label: "Summary",
      shortcut: "S",
      align: "left",
      left: 1.5,
      right: 7.5,
      first: 0,
      before: 6,
      style: "Italic",
      placeholder: "Scene summary…",
      next: "Action",
      tab: "Action",
    },
    "Outline 1": {
      label: "Outline 1",
      shortcut: "O",
      align: "left",
      left: 1.25,
      right: 7.5,
      first: 0,
      before: 12,
      style: "Bold+AllCaps",
      placeholder: "ACT / SEQUENCE OUTLINE",
      next: "Outline 2",
      tab: "Outline 2",
    },
    "Outline 2": {
      label: "Outline 2",
      shortcut: "L",
      align: "left",
      left: 1.5,
      right: 7.5,
      first: 0,
      before: 6,
      style: "Bold",
      placeholder: "SCENE / BEAT OUTLINE",
      next: "Scene Heading",
      tab: "Scene Heading",
    },
  };

  const DEFAULT_MACROS = [
    { key: "Alt+1", name: "INT.", text: "INT. ", element: "Scene Heading" },
    { key: "Alt+2", name: "EXT.", text: "EXT. ", element: "Scene Heading" },
    { key: "Alt+3", name: "I/E.", text: "I/E. ", element: "Scene Heading" },
    { key: "Alt+4", name: "DAY", text: " - DAY", nextElement: "Action" },
    { key: "Alt+5", name: "NIGHT", text: " - NIGHT", nextElement: "Action" },
    { key: "Alt+6", name: "CONTINUOUS", text: " - CONTINUOUS", nextElement: "Action" },
    { key: "Alt+7", name: "CUT TO:", text: "CUT TO:", element: "Transition", nextElement: "Scene Heading" },
    { key: "Alt+8", name: "FADE IN:", text: "FADE IN:", element: "Transition", nextElement: "Scene Heading" },
  ];

  const TAG_CATEGORIES = [
    { id: "cast", label: "Cast Members", color: "#0f6cbd" },
    { id: "extras", label: "Background Actors", color: "#038387" },
    { id: "stunts", label: "Stunts", color: "#d13438" },
    { id: "vehicles", label: "Vehicles", color: "#ca5010" },
    { id: "props", label: "Props", color: "#8764b8" },
    { id: "camera", label: "Camera", color: "#498205" },
    { id: "sfx", label: "Special Effects", color: "#986f0b" },
    { id: "vfx", label: "Visual Effects", color: "#c239b3" },
    { id: "wardrobe", label: "Wardrobe", color: "#2b579a" },
    { id: "makeup", label: "Makeup / Hair", color: "#c2397a" },
    { id: "sound", label: "Sound / Music", color: "#3d7a35" },
    { id: "set", label: "Set Dressing", color: "#a36a00" },
  ];

  const PALETTE = [
    "#0f6cbd",
    "#8764b8",
    "#038387",
    "#ca5010",
    "#c239b3",
    "#498205",
    "#986f0b",
    "#d13438",
  ];

  const REVISION_COLORS = [
    { name: "Blue", hex: "#2b579a", pageColor: "#c6c6ed" },
    { name: "Pink", hex: "#c2397a", pageColor: "#fdfdcc" },
    { name: "Yellow", hex: "#b58b00", pageColor: "#fdfdff" },
    { name: "Green", hex: "#3d7a35", pageColor: "#d1fed0" },
    { name: "Goldenrod", hex: "#a36a00", pageColor: "#facd39" },
    { name: "Buff", hex: "#a68b4b", pageColor: "#fced9d" },
    { name: "Salmon", hex: "#c56b51", pageColor: "#f8ae8e" },
    { name: "Cherry", hex: "#b52f45", pageColor: "#fba4b4" },
    { name: "Tan", hex: "#a98c5b", pageColor: "#fdf1c7" },
    { name: "White", hex: "#6f6c68", pageColor: "#ffffff" },
  ];

  const DEFAULT_SETTINGS = {
    sceneNumbers: true,
    sceneNumberSide: "both",
    pageNumbers: true,
    showMore: true,
    targetPages: 120,
    smartQuotes: true,
  };

  const DEFAULT_TITLE_PAGE = {
    enabled: true,
    title: "",
    credit: "Written by",
    author: "",
    source: "",
    draftDate: "",
    contact: "",
    notes: "",
  };

  const DEFAULT_SCENE = {
    title: "",
    synopsis: "",
    notes: "",
    color: "",
    omit: false,
    number: "",
  };

  const uid = (prefix) => {
    const random =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
    return `${prefix || "id"}-${random}`;
  };

  /* Deterministic 32-bit string hash. Used where an id must be stable across
   * repeated saves (an FDX DocumentRef), so serialization is idempotent. */
  const hash32 = (value) => {
    let hash = 2166136261;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  };

  /* The FDX format requires bare RFC-4122 UUIDs for DocumentRef/Paragraph ids.
   * The app's internal ids are prefixed ("para-<uuid>"), so FDX export maps
   * them deterministically to a valid UUID rather than rewriting the model. */
  const toUuid = (value) => {
    const text = String(value || "");
    const found = text.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    );
    if (found) return found[0].toLowerCase();
    /* Derive a stable UUID-shaped id from hashes of the input.
     * Layout: 8-4-4-4-12 hex digits with version/variant nibbles. */
    const a = hash32(text);
    const b = hash32(`a:${text}`);
    const c = hash32(`b:${text}`);
    const d = hash32(`c:${text}`);
    return [
      a,
      b.slice(0, 4),
      `4${b.slice(4, 7)}`,
      `a${c.slice(0, 3)}`,
      `${c.slice(3, 8)}${d.slice(0, 7)}`,
    ].join("-");
  };

  const escapeHtml = (value) =>
    String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const entityCodePoint = (number) => Number.isInteger(number) && number > 0 && number <= 0x10ffff &&
    (number < 0xd800 || number > 0xdfff) ? String.fromCodePoint(number) : '\ufffd';
  const decodeEntities = (value) =>
    String(value)
      .replace(/&#(\d+);/g, (_, code) => entityCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) =>
        entityCodePoint(parseInt(code, 16)),
      )
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'");

  // Recovery, review packets and story branches can contain HTML directly.
  // Rebuild only screenplay formatting; never retain elements that load files,
  // create frames, submit forms or change the editor's surrounding UI.
  const INLINE_TAGS = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'span', 'font', 'br', 'div', 'p', 'li', 'sub', 'sup']);
  const INLINE_STYLES = {
    color: /^(?:#[\da-f]{3,8}|[a-z]{1,24}|rgba?\([\d.,%\s]+\))$/i,
    'background-color': /^(?:#[\da-f]{3,8}|[a-z]{1,24}|rgba?\([\d.,%\s]+\))$/i,
    'font-weight': /^(?:normal|bold|[1-9]00)$/i,
    'font-style': /^(?:normal|italic|oblique)$/i,
    'font-family': /^[\p{L}\p{N} _,'".\-]{1,160}$/u,
    'font-size': /^(?:\d{1,3}(?:\.\d+)?)(?:pt|px)$/i,
    'text-decoration': /^(?:none|underline|line-through|overline)(?:\s+(?:underline|line-through|overline))*$/i,
    'text-decoration-line': /^(?:none|underline|line-through|overline)(?:\s+(?:underline|line-through|overline))*$/i,
    'text-transform': /^(?:none|uppercase|lowercase|capitalize)$/i,
    'vertical-align': /^(?:baseline|super|sub)$/i,
    'text-align': /^(?:left|right|center|justify|start|end)$/i,
  };
  function sanitizeHtml(value) {
    const source = String(value || '');
    if (!source.includes('<')) return source;
    return (source.match(/<(?:"[^"]*"|'[^']*'|[^'">])*>|[^<]+|</g) || []).map(token => {
      if (!token.startsWith('<')) return token;
      const tag = token.match(/^<\s*(\/?)\s*([a-z][a-z0-9]*)\b([\s\S]*?)\/?\s*>$/i);
      if (!tag || !INLINE_TAGS.has(tag[2].toLowerCase())) return token === '<' ? '&lt;' : '';
      const name = tag[2].toLowerCase();
      if (tag[1]) return name === 'br' ? '' : `</${name}>`;
      const attrs = [], seen = new Set();
      for (const match of tag[3].matchAll(/([^\s=/'"<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
        const key = match[1].toLowerCase(), text = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
        if (seen.has(key)) continue;
        seen.add(key);
        let safe;
        if (key === 'style') {
          safe = text.split(';').filter(part => {
            const colon = part.indexOf(':'), property = part.slice(0, colon).trim().toLowerCase();
            return colon > 0 && Object.hasOwn(INLINE_STYLES, property) && INLINE_STYLES[property].test(part.slice(colon + 1).trim());
          }).join(';');
        } else if (key === 'data-fdx' && name === 'span') {
          try { const data = JSON.parse(text); if (data && typeof data === 'object' && !Array.isArray(data)) safe = text; } catch { /* Drop damaged annotations. */ }
        } else if (key === 'data-fdx-node' && name === 'span' && text === 'DynamicLabel') safe = text;
        else if (key === 'contenteditable' && name === 'span' && text === 'false') safe = text;
        else if (key === 'color' && name === 'font' && INLINE_STYLES.color.test(text)) safe = text;
        if (safe) attrs.push(` ${key}="${escapeHtml(safe)}"`);
      }
      return `<${name}${attrs.join('')}>`;
    }).join('');
  }

  const stripHtml = (html) =>
    decodeEntities(
      String(html || "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/(p|div|li)>/gi, "\n")
        .replace(/<[^>]*>/g, ""),
    ).replace(/\u00a0/g, " ");

  const wordCount = (text) => {
    const matches = String(text || "").match(/[\p{L}\p{N}'’\-]+/gu);
    return matches ? matches.length : 0;
  };

  const normalizeSettings = (settings) => {
    const source = settings && typeof settings === "object" ? settings : {};
    const side = ["both", "left", "right"].includes(source.sceneNumberSide)
      ? source.sceneNumberSide
      : DEFAULT_SETTINGS.sceneNumberSide;
    return {
      ...DEFAULT_SETTINGS,
      ...source,
      sceneNumbers: source.sceneNumbers !== false,
      sceneNumberSide: side,
      pageNumbers: source.pageNumbers !== false,
      showMore: source.showMore !== false,
      smartQuotes: source.smartQuotes !== false,
      targetPages: Math.max(1, Math.min(999, Number(source.targetPages) || DEFAULT_SETTINGS.targetPages)),
    };
  };

  const normalizeTitlePage = (titlePage, doc) => {
    const source = titlePage && typeof titlePage === "object" ? titlePage : {};
    const title = String(source.title || (doc && doc.title) || "").trim();
    return {
      ...DEFAULT_TITLE_PAGE,
      ...source,
      enabled: source.enabled !== false,
      title,
      credit: String(source.credit == null ? DEFAULT_TITLE_PAGE.credit : source.credit),
      author: String(source.author || (doc && doc.author) || ""),
      source: String(source.source || ""),
      draftDate: String(source.draftDate || ""),
      contact: String(source.contact || ""),
      notes: String(source.notes || ""),
    };
  };

  const normalizeScene = (scene) => {
    const source = scene && typeof scene === "object" ? scene : {};
    return {
      ...DEFAULT_SCENE,
      ...source,
      title: String(source.title || ""),
      synopsis: String(source.synopsis || ""),
      notes: String(source.notes || ""),
      color: String(source.color || ""),
      omit: Boolean(source.omit),
      number: String(source.number == null ? "" : source.number),
    };
  };

  const normalizeRevision = (revision) => {
    const source = revision && typeof revision === "object" ? revision : {};
    const historySource = Array.isArray(source.history) ? source.history : [];
    const history = historySource
      .map((entry, index) => {
        if (!entry || typeof entry !== "object") return null;
        const id = Math.max(1, Math.floor(Number(entry.id) || index + 1));
        const fallback = REVISION_COLORS[(id - 1) % REVISION_COLORS.length];
        return {
          id,
          name: String(entry.name || fallback.name),
          hex: /^#[0-9a-f]{6}$/i.test(entry.hex || "") ? entry.hex : fallback.hex,
          pageColor: /^#[0-9a-f]{6}$/i.test(entry.pageColor || "")
            ? entry.pageColor
            : fallback.pageColor,
          createdAt: entry.createdAt == null ? new Date().toISOString() : String(entry.createdAt),
        };
      })
      .filter(Boolean);
    if (!history.length) {
      history.push({
        id: 1,
        name: REVISION_COLORS[0].name,
        hex: REVISION_COLORS[0].hex,
        pageColor: REVISION_COLORS[0].pageColor,
        createdAt: new Date().toISOString(),
      });
    }
    const current = Math.max(1, Math.floor(Number(source.current) || history[history.length - 1].id));
    return {
      enabled: Boolean(source.enabled),
      current,
      history,
    };
  };

  const normalizeCast = (cast) => {
    const source = cast && typeof cast === "object" ? cast : {};
    const output = {};
    for (const [key, value] of Object.entries(source)) {
      const name = String(key || "").trim().toUpperCase();
      if (!name || !value || typeof value !== "object") continue;
      output[name] = {
        actor: String(value.actor || ""),
        notes: String(value.notes || ""),
        voiceURI: String(value.voiceURI || ""),
        color: /^#[0-9a-f]{6}$/i.test(value.color || "")
          ? value.color
          : PALETTE[Object.keys(output).length % PALETTE.length],
      };
    }
    return output;
  };

  function makeParagraph(type, text, extra) {
    const normalized = typeof type === "string" && type.trim() && type.length <= 100 ? type : "Action";
    const paragraph = Object.assign(
      {
        id: uid("para"),
        type: normalized,
        html: text ? escapeHtml(text) : "",
        revision: null,
      },
      extra || {},
    );
    if (normalized === "Scene Heading") paragraph.scene = normalizeScene(paragraph.scene);
    return paragraph;
  }

  function blankDocument() {
    return normalizeDocument({
      version: VERSION,
      documentId: uid("document"),
      title: "Untitled Screenplay",
      author: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      titlePage: {
        enabled: true,
        title: "Untitled Screenplay",
        credit: "Written by",
        author: "",
        draftDate: "",
        contact: "",
      },
      page: { width: 8.5, height: 11, top: 1, bottom: 1, left: 1, right: 1 },
      settings: DEFAULT_SETTINGS,
      revision: { enabled: false, current: 1, history: [] },
      cast: {},
      paragraphs: [
        makeParagraph("Scene Heading", "INT. WRITER'S ROOM - DAY"),
        makeParagraph("Action", "A blank page. A cursor blinking."),
      ],
    });
  }

  function sampleDocument() {
    const script = [
      ["Scene Heading", "EXT. OBSERVATORY RIDGE - NIGHT"],
      [
        "Action",
        "A storm leans against the mountain. At the edge of the ridge, a radio telescope turns its face to the clouds.",
      ],
      ["Character", "MARA"],
      ["Parenthetical", "(into a field radio)"],
      ["Dialogue", "Station seven, this is Mara. Do you read?"],
      ["Action", "Static. Then a thin signal threads through the noise."],
      ["Character", "VOICE (V.O.)"],
      ["Dialogue", "I read you. You're early."],
      ["Character", "MARA"],
      ["Dialogue", "Who is this?"],
      ["Transition", "CUT TO:"],
      ["Scene Heading", "INT. CONTROL ROOM - CONTINUOUS"],
      ["Action", "Banks of monitors. Elias watches a waveform climb."],
      ["Character", "ELIAS"],
      ["Dialogue", "That isn't weather."],
      ["Character", "MARA"],
      ["Dialogue", "Then what is it?"],
      [
        "Action",
        "On the main screen, a map draws a line from the ridge to the sea.",
      ],
      ["Transition", "SMASH CUT TO:"],
      ["Scene Heading", "EXT. CLIFFSIDE - DAWN"],
      [
        "Action",
        "Mara runs along the cliff path, radio in hand. Far below, the ocean is starting to glow.",
      ],
      ["Character", "MARA"],
      ["Parenthetical", "(breathless)"],
      ["Dialogue", "Elias, tell me you see this."],
      ["Character", "ELIAS (V.O.)"],
      ["Dialogue", "I see it. Keep moving."],
      ["Action", "The glow rises. A shape moves beneath the water."],
      ["Transition", "CUT TO BLACK."],
    ];
    const paragraphs = script.map(([type, text]) => makeParagraph(type, text));
    // The sample deliberately includes one dual-dialogue exchange so the
    // editor and FDX round-trip exercise the two-column layout.
    [6, 7, 8, 9].forEach((index) => {
      if (!paragraphs[index]) return;
      paragraphs[index].dualGroup = "sample-dual";
      paragraphs[index].dualSide = index < 8 ? 0 : 1;
    });
    const headings = paragraphs.filter((paragraph) => paragraph.type === "Scene Heading");
    if (headings[0]) {
      headings[0].scene = normalizeScene({
        title: "The Ridge Signal",
        synopsis: "A storm, a radio telescope, and a voice that answers back.",
        notes: "Open wide. Hold the ridge until the signal arrives.",
        color: "#0f6cbd",
      });
    }
    if (headings[1]) {
      headings[1].scene = normalizeScene({
        title: "Waveform Anomaly",
        synopsis: "Elias sees a waveform that does not belong to the weather.",
        notes: "Push in on the monitors.",
        color: "#8764b8",
      });
    }
    if (headings[2]) {
      headings[2].scene = normalizeScene({
        title: "Bioluminescent Tide",
        synopsis: "Mara reaches the cliffs as something rises from the sea.",
        notes: "End on the shape. Cut to black.",
        color: "#038387",
      });
    }
    if (paragraphs[4]) {
      paragraphs[4].alts = [
        "Station seven, this is Mara. Anyone copy on channel four?",
        "Control, pick up—the dish is locking onto something.",
      ];
      paragraphs[4].activeAlt = 0;
    }
    if (paragraphs[1]) {
      paragraphs[1].tags = [
        { id: "tag-prop-1", category: "props", label: "Radio Telescope", color: "#8764b8" },
      ];
    }
    if (paragraphs[3]) {
      paragraphs[3].tags = [
        { id: "tag-prop-2", category: "props", label: "Field Radio", color: "#8764b8" },
      ];
    }
    if (paragraphs[20]) {
      paragraphs[20].tags = [
        { id: "tag-vfx-1", category: "vfx", label: "Glowing Ocean", color: "#c239b3" },
      ];
    }
    const beats = [
      {
        id: "beat-1",
        title: "ACT I — INCITING INCIDENT",
        body: "Mara intercepts an impossible low-frequency transmission on Observatory Ridge during a coastal storm.",
        category: "Structure Point",
        color: "#0f6cbd",
        x: 48,
        y: 48,
        width: 248,
        targetId: "beat-2",
        connectorStyle: "arrow",
      },
      {
        id: "beat-2",
        title: "FIRST CONTACT",
        body: "A disembodied voice answers Mara on a closed band: 'You're early.'",
        category: "Beat",
        color: "#ca5010",
        x: 348,
        y: 48,
        width: 248,
        targetId: "beat-3",
        connectorStyle: "arrow",
      },
      {
        id: "beat-3",
        title: "MIDPOINT — THE TRIANGULATION",
        body: "Elias traces the waveform in the Control Room; the vector points straight into the deep trench off the cliffs.",
        category: "Structure Point",
        color: "#8764b8",
        x: 648,
        y: 48,
        width: 248,
        targetId: "beat-4",
        connectorStyle: "double",
      },
      {
        id: "beat-4",
        title: "CLIMAX — THE ASCENT",
        body: "At dawn on the cliffside, the ocean begins to glow as a vast geometry surfaces beneath the tide.",
        category: "Beat",
        color: "#038387",
        x: 348,
        y: 256,
        width: 248,
        targetId: "",
        connectorStyle: "arrow",
      },
    ];
    const bookmarks = [
      { id: "bm-1", name: "First Transmission", paragraphId: paragraphs[0].id },
      { id: "bm-2", name: "Cliffside Arrival", paragraphId: headings[2] ? headings[2].id : paragraphs[0].id },
    ];
    return normalizeDocument({
      version: VERSION,
      title: "The Last Signal",
      author: "Azkript",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      titlePage: {
        enabled: true,
        title: "The Last Signal",
        credit: "Written by",
        author: "Azkript",
        source: "An original screenplay",
        draftDate: "First Draft · October 2026",
        contact: "azkript@example.com",
        notes: "",
      },
      page: { width: 8.5, height: 11, top: 1, bottom: 1, left: 1, right: 1 },
      settings: { ...DEFAULT_SETTINGS, targetPages: 110 },
      revision: { enabled: false, current: 1, history: [] },
      cast: {
        MARA: {
          actor: "Lead",
          notes: "Radio astronomer. Runs toward the unknown, even when she shouldn't.",
          color: "#0f6cbd",
        },
        ELIAS: {
          actor: "Support",
          notes: "Control-room anchor. Says less than he knows.",
          color: "#8764b8",
        },
        VOICE: {
          actor: "Mystery",
          notes: "Never seen. Always listening.",
          color: "#ca5010",
        },
      },
      beats,
      bookmarks,
      paragraphs,
    });
  }

  function templateDocument(kind) {
    const templates = {
      feature: {
        title: "Untitled Feature",
        heading: "INT. A ROOM SOMEWHERE - DAY",
        action: "A first image. A first breath.",
        targetPages: 110,
        note: "Feature screenplay",
      },
      short: {
        title: "Untitled Short",
        heading: "EXT. A SMALL WORLD - MORNING",
        action: "One place. One moment. No wasted cut.",
        targetPages: 15,
        note: "Short film",
      },
      tv: {
        title: "Untitled TV Pilot",
        heading: "INT. SERIES OPENING - DAY",
        action: "A world, a tone, and the promise of more.",
        targetPages: 55,
        note: "TV pilot",
      },
      stage: {
        title: "Untitled Stage Play",
        heading: "ACT ONE",
        action: "Before the lights come up.",
        targetPages: 90,
        note: "Stage play",
      },
      outline: {
        title: "Untitled Outline",
        heading: "LOGLINE",
        action: "One sentence that makes the whole story inevitable.",
        targetPages: 12,
        note: "Outline",
      },
    };
    const template = templates[kind] || templates.feature;
    const doc = blankDocument();
    doc.title = template.title;
    doc.author = "";
    doc.titlePage = normalizeTitlePage(
      {
        enabled: true,
        title: template.title,
        credit: "Written by",
        author: "",
        notes: template.note,
      },
      doc,
    );
    doc.settings = normalizeSettings({ ...DEFAULT_SETTINGS, targetPages: template.targetPages });
    doc.paragraphs = [
      makeParagraph(kind === "stage" || kind === "outline" ? "General" : "Scene Heading", template.heading),
      makeParagraph("Action", template.action),
      makeParagraph("Action", ""),
    ];
    doc.updatedAt = new Date().toISOString();
    return normalizeDocument(doc);
  }

  function normalizeDocument(input) {
    if (!input || typeof input !== "object") return blankDocument();
    const elements = Object.create(null);
    for (const [name, spec] of Object.entries(input.elements || {})) {
      if (!name || name.length > 100 || !spec || typeof spec !== "object" || ["__proto__", "constructor", "prototype"].includes(name)) continue;
      const base = ELEMENTS[name] || ELEMENTS.Action;
      elements[name] = { ...base, ...spec, label: String(spec.label || name),
        next: String(spec.next || base.next), tab: String(spec.tab || base.tab) };
      for (const key of ["left", "right", "first", "before", "fontSize", "spacing"]) {
        if (elements[name][key] != null && !Number.isFinite(Number(elements[name][key]))) elements[name][key] = base[key];
      }
    }
    const paragraphs = Array.isArray(input.paragraphs)
      ? input.paragraphs
          .filter(Boolean)
          .map((paragraph) => {
            const type = Object.prototype.hasOwnProperty.call(ELEMENTS, paragraph.type) || Object.prototype.hasOwnProperty.call(elements, paragraph.type) ? paragraph.type : "Action";
            const normalized = {
              id: paragraph.id || uid("para"),
              type,
              html:
                typeof paragraph.html === "string"
                  ? sanitizeHtml(paragraph.html)
                  : escapeHtml(paragraph.text || ""),
              dualGroup: paragraph.dualGroup || null,
              dualSide:
                paragraph.dualSide === 1 || paragraph.dualSide === 0
                  ? paragraph.dualSide
                  : null,
              revision:
                Number.isFinite(Number(paragraph.revision)) && Number(paragraph.revision) > 0
                  ? Math.floor(Number(paragraph.revision))
                  : null,
            };
            if (type === "Scene Heading") {
              normalized.scene = normalizeScene(paragraph.scene);
            }
            if (paragraph.note && String(paragraph.note).trim()) {
              normalized.note = String(paragraph.note).trim();
            }
            if (Array.isArray(paragraph.alts) && paragraph.alts.length) {
              normalized.alts = paragraph.alts.map(String).filter(Boolean);
              normalized.activeAlt = Number.isFinite(Number(paragraph.activeAlt))
                ? Math.max(0, Math.floor(Number(paragraph.activeAlt)))
                : 0;
            }
            if (Array.isArray(paragraph.tags) && paragraph.tags.length) {
              normalized.tags = paragraph.tags
                .filter((tag) => tag && tag.label)
                .map((tag) => ({
                  id: String(tag.id || uid("tag")),
                  category: String(tag.category || "props"),
                  label: String(tag.label).trim(),
                  color: String(tag.color || "#0f6cbd"),
                }));
            }
            if (paragraph.pageBreakBefore) normalized.pageBreakBefore = true;
            if (paragraph.alignment) normalized.alignment = String(paragraph.alignment);
            if (paragraph.spacing) normalized.spacing = String(paragraph.spacing);
            if (paragraph.spaceBefore !== undefined && paragraph.spaceBefore !== "") {
              normalized.spaceBefore = Number(paragraph.spaceBefore);
            }
            if (paragraph.leading) normalized.leading = String(paragraph.leading);
            if (paragraph.image) normalized.image = String(paragraph.image);
            if (paragraph.changeType) normalized.changeType = String(paragraph.changeType);
            if (typeof paragraph.trackedOriginal === "string") {
              normalized.trackedOriginal = sanitizeHtml(paragraph.trackedOriginal);
            }
            if (paragraph.image && typeof paragraph.image === "object") {
              normalized.image = {
                caption: String(paragraph.image.caption || ""),
                url: String(paragraph.image.url || ""),
              };
            } else if (paragraph.image) {
              normalized.image = String(paragraph.image);
            }
            return normalized;
          })
      : [];
    const title = String(input.title || "Untitled Screenplay");
    const author = String(input.author || "");
    const beats = Array.isArray(input.beats)
      ? input.beats
          .filter((beat) => beat && typeof beat === "object")
          .map((beat, idx) => ({
            id: String(beat.id || uid("beat")),
            title: String(beat.title || `Beat ${idx + 1}`),
            body: String(beat.body || ""),
            category: String(
              beat.category ||
                (beat.type === "structure" ? "Structure Point" : "Beat"),
            ),
            color: String(beat.color || PALETTE[idx % PALETTE.length]),
            x: Number.isFinite(Number(beat.x)) ? Number(beat.x) : 48 + (idx % 3) * 280,
            y: Number.isFinite(Number(beat.y)) ? Number(beat.y) : 48 + Math.floor(idx / 3) * 200,
            width: Number.isFinite(Number(beat.width)) ? Number(beat.width) : 248,
            targetId: String(
              beat.targetId ||
                (Array.isArray(beat.connectedTo) && beat.connectedTo.length
                  ? beat.connectedTo[0]
                  : ""),
            ),
            goalPage: String(beat.goalPage || ""),
            connectorStyle: String(beat.connectorStyle || "arrow"),
            image: String(beat.image || ""),
          }))
      : [];
    const bookmarks = Array.isArray(input.bookmarks)
      ? input.bookmarks
          .filter((bm) => bm && typeof bm === "object")
          .map((bm, idx) => ({
            id: String(bm.id || uid("bm")),
            /* `label` was dropped by this normaliser while `openBookmarksDialog`
             * writes new bookmarks as `{ id, paragraphId, label }`. Reloading a
             * saved document therefore lost every bookmark's text and the toolbar
             * rendered the literal string "undefined" for each row. Keep both
             * spellings; `name` stays the canonical field (the seed data and the
             * inline `.has-bookmark` marker both read it). */
            name: String(bm.name || bm.label || `Bookmark ${idx + 1}`),
            paragraphId: String(bm.paragraphId || ""),
          }))
      : [];
    const macros =
      Array.isArray(input.macros) && input.macros.length
        ? input.macros.filter(m => m && typeof m === 'object').map((m) => ({
            key: String(m.key || ""),
            name: String(m.name || ""),
            text: String(m.text || ""),
            element: String(m.element || ""),
            nextElement: String(m.nextElement || ""),
          }))
        : DEFAULT_MACROS.slice();
    return {
      version: VERSION,
      formatVersion: Math.max(1, Math.floor(Number(input.formatVersion) || 1)),
      documentId: toUuid(input.documentId || `legacy:${input.title || ""}:${input.createdAt || ""}:${(Array.isArray(input.paragraphs) ? input.paragraphs : []).map(p => p && p.id || "").join("|")}`),
      sourceFingerprint: String(input.sourceFingerprint || ""),
      production: input.production && typeof input.production === 'object' ? JSON.parse(JSON.stringify(input.production)) : {},
      story: input.story && typeof input.story === 'object' ? JSON.parse(JSON.stringify(input.story)) : {},
      elements,
      sourceFDX: input.sourceFDX && typeof input.sourceFDX.xml === "string" ? input.sourceFDX : null,
      // Editable native production sections are separate from the immutable
      // imported source, so ordinary undo/redo and recovery include these edits.
      nativeMetadata: Array.isArray(input.nativeMetadata) ? input.nativeMetadata
        .filter(entry => entry && typeof entry.name === "string" && typeof entry.xml === "string")
        .map(entry => ({ name: entry.name, xml: entry.xml })) : [],
      workspaceNotes: Array.isArray(input.workspaceNotes) ? input.workspaceNotes.filter(n => n && typeof n === 'object').map(n => ({
        id: String(n.id || uid('note')), title: String(n.title || 'Untitled note').slice(0, 200),
        text: String(n.text || ''), paragraphId: String(n.paragraphId || ''), quote: String(n.quote || '').slice(0, 1000),
      })) : [],
      title,
      author,
      createdAt: input.createdAt || new Date().toISOString(),
      updatedAt: input.updatedAt || new Date().toISOString(),
      titlePage: normalizeTitlePage(input.titlePage, { title, author }),
      page: Object.assign(
        { width: 8.5, height: 11, top: 1, bottom: 1, left: 1, right: 1 },
        input.page || {},
      ),
      settings: normalizeSettings(input.settings),
      revision: normalizeRevision(input.revision),
      cast: normalizeCast(input.cast),
      beats,
      bookmarks,
      macros,
      headerFooter: Object.assign(
        {
          headerText: "",
          footerText: "",
          showHeader: true,
          showFooter: false,
          showOnFirstPage: false,
          startingPage: 1,
        },
        input.headerFooter || {},
      ),
      moresContinueds: Object.assign(
        {
          dialogueMore: "(MORE)",
          dialogueCont: "(CONT'D)",
          sceneContTop: "CONTINUED:",
          sceneContBottom: "(CONTINUED)",
          autoCharacterCont: true,
          includeSceneNumber: true,
        },
        input.moresContinueds || {},
      ),
      watermark: (() => {
        const wm = Object.assign(
          { enabled: false, text: "CONFIDENTIAL", opacity: 14, angle: -35 },
          input.watermark || {},
        );
        if (Number(wm.opacity) > 0 && Number(wm.opacity) <= 1) {
          wm.opacity = Math.round(Number(wm.opacity) * 100);
        }
        wm.opacity = Math.max(2, Math.min(60, Number(wm.opacity) || 14));
        return wm;
      })(),
      lockedPages: Object.assign(
        { locked: false, lockedAt: "", aPages: [] },
        input.lockedPages || {},
      ),
      characterHighlights: Object.assign({}, input.characterHighlights || {}),
      nonSpeaking: Array.isArray(input.nonSpeaking) ? input.nonSpeaking : [],
      smartType: Object.assign(
        {
          characters: [],
          locations: [],
          times: ["DAY", "NIGHT", "DAWN", "DUSK", "CONTINUOUS", "LATER", "MOMENTS LATER", "SAME TIME"],
          extensions: ["(V.O.)", "(O.S.)", "(O.C.)", "(CONT'D)", "(SUBTITLE)"],
          transitions: ["CUT TO:", "SMASH CUT TO:", "DISSOLVE TO:", "MATCH CUT TO:", "FADE IN:", "FADE OUT.", "CUT TO BLACK."],
        },
        input.smartType || {},
      ),
      paragraphs: paragraphs.length
        ? paragraphs
        : [makeParagraph("Action", "")],
    };
  }

  function cloneDocument(doc) {
    const normalized = normalizeDocument(doc);
    const sourceFDX = normalized.sourceFDX;
    const copy = JSON.parse(JSON.stringify(normalized, (key, value) => key === "sourceFDX" ? undefined : value));
    copy.sourceFDX = sourceFDX;
    return copy;
  }

  function paragraphText(paragraph) {
    return stripHtml(paragraph.html).replace(/\r/g, "");
  }

  function documentText(doc) {
    return (doc.paragraphs || []).map(paragraphText).join("\n");
  }

  function elementSpec(type, doc) {
    if (doc && doc.elements && Object.prototype.hasOwnProperty.call(doc.elements, type)) return doc.elements[type];
    return Object.prototype.hasOwnProperty.call(ELEMENTS, type) ? ELEMENTS[type] : ELEMENTS.Action;
  }

  function nextType(type, doc) {
    return elementSpec(type, doc).next;
  }

  function tabType(type, shift, doc) {
    if (shift) {
      if (type === "Action") return "Scene Heading";
      if (type === "Character") return "Action";
      if (type === "Dialogue") return "Character";
      if (type === "Parenthetical") return "Dialogue";
      if (type === "Transition") return "Action";
      if (type === "Scene Heading") return "General";
      return "Action";
    }
    return elementSpec(type, doc).tab;
  }

  function parseSceneHeading(value) {
    const raw = String(value || "").trim();
    const match = raw.match(
      /^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|INT\.?|EXT\.?|I\/E\.?|EST\.?)\s*(.*)$/i,
    );
    if (!match) return { prefix: "", location: raw, timeOfDay: "" };
    const rest = match[2].trim();
    const pieces = rest.split(/\s+[-–—]\s+/);
    return {
      prefix: match[1].replace(/\.$/, "").toUpperCase(),
      location: (pieces[0] || rest).trim(),
      timeOfDay: pieces.slice(1).join(" - ").trim(),
    };
  }

  function getScenes(doc) {
    const scenes = [];
    const issuedNumbers = doc.production?.sceneNumbers || {};
    const hasIssuedNumbers = Object.keys(issuedNumbers).length > 0;
    const usedNumbers = new Set(Object.values(issuedNumbers));
    for (const paragraph of doc.paragraphs) {
      if (paragraph.type === "Scene Heading" && paragraph.scene?.number) {
        usedNumbers.add(paragraph.scene.number);
      }
    }
    let current = null;
    let cumulativeWords = 0;
    doc.paragraphs.forEach((paragraph, index) => {
      const text = paragraphText(paragraph).trim();
      if (paragraph.type === "Scene Heading") {
        if (current) current.endIndex = index;
        const geo = parseSceneHeading(text);
        const override = paragraph.scene?.number;
        const issuedNumber = hasIssuedNumbers ? issuedNumbers[toUuid(paragraph.id)] : "";
        let automaticNumber = issuedNumber || String(scenes.length + 1);
        if (hasIssuedNumbers && !issuedNumber) {
          const base = scenes.at(-1)?.number.match(/^\d+/)?.[0] || "0";
          automaticNumber = base + "A";
          // Only reserve a generated label if this scene actually uses it.
          for (let n = 2; usedNumbers.has(automaticNumber); n++) {
            let suffix = "";
            for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) {
              suffix = String.fromCharCode(65 + (i - 1) % 26) + suffix;
            }
            automaticNumber = base + suffix;
          }
          if (!override) usedNumbers.add(automaticNumber);
        }
        current = {
          id: paragraph.id,
          index: scenes.length + 1,
          heading: text || "Untitled scene",
          headingRaw: text,
          location: geo.location || "Unknown",
          prefix: geo.prefix,
          timeOfDay: geo.timeOfDay,
          paragraph,
          startIndex: index,
          endIndex: index + 1,
          startPage: 1,
          endPage: 1,
          wordCount: 0,
          paragraphs: 0,
          revisionCount: 0,
          title: paragraph.scene ? paragraph.scene.title || "" : "",
          synopsis: paragraph.scene ? paragraph.scene.synopsis : "",
          notes: paragraph.scene ? paragraph.scene.notes : "",
          color: paragraph.scene && paragraph.scene.color
            ? paragraph.scene.color
            : PALETTE[(scenes.length) % PALETTE.length],
          omit: Boolean(paragraph.scene && paragraph.scene.omit),
          automaticNumber,
          number: override || automaticNumber,
        };
        scenes.push(current);
      }
      if (current) {
        current.wordCount += wordCount(text);
        current.paragraphs += text ? 1 : 0;
        cumulativeWords += wordCount(text);
        if (paragraph.revision) current.revisionCount += 1;
      }
    });
    if (current) current.endIndex = doc.paragraphs.length;
    let total = 0;
    for (const scene of scenes) {
      scene.startPage = Math.max(1, Math.floor(total / 180) + 1);
      total += scene.wordCount;
      scene.endPage = Math.max(scene.startPage, Math.floor(total / 180) + 1);
      scene.pageCount = Math.max(1, scene.endPage - scene.startPage + 1);
    }
    return scenes;
  }

  function getSceneForParagraph(doc, paragraphId) {
    return getScenes(doc).find(
      (scene) =>
        paragraphId &&
        scene.startIndex <= doc.paragraphs.findIndex((item) => item.id === paragraphId) &&
        doc.paragraphs.findIndex((item) => item.id === paragraphId) < scene.endIndex,
    );
  }

  function getLocations(doc) {
    const map = new Map();
    for (const scene of getScenes(doc)) {
      if (scene.omit) continue;
      const key = scene.location || "Unknown";
      if (!map.has(key)) {
        map.set(key, {
          name: key,
          scenes: 0,
          words: 0,
          interiors: 0,
          exteriors: 0,
          sceneIds: [],
          color: PALETTE[map.size % PALETTE.length],
        });
      }
      const entry = map.get(key);
      entry.scenes += 1;
      entry.words += scene.wordCount;
      entry.sceneIds.push(scene.id);
      if (scene.prefix.startsWith("INT")) entry.interiors += 1;
      if (scene.prefix.startsWith("EXT") || scene.prefix === "EST") entry.exteriors += 1;
    }
    return Array.from(map.values()).sort(
      (a, b) => b.scenes - a.scenes || a.name.localeCompare(b.name),
    );
  }

  function characterKey(name) {
    return String(name || "")
      .replace(/\s*\([^)]*\)\s*$/, "")
      .trim()
      .toUpperCase();
  }

  function getCharacters(doc) {
    const map = new Map();
    let current = null;
    let currentScene = null;
    for (const paragraph of doc.paragraphs) {
      const text = paragraphText(paragraph).trim();
      if (paragraph.type === "Scene Heading") currentScene = paragraph.id;
      if (paragraph.type === "Character") {
        const key = characterKey(text);
        if (!key) {
          current = null;
          continue;
        }
        if (!map.has(key)) {
          const meta = doc.cast ? doc.cast[key] : null;
          map.set(key, {
            id: key,
            name: key,
            displayName: text || key,
            speeches: 0,
            dialogueWords: 0,
            directions: 0,
            scenes: new Set(),
            actor: meta ? meta.actor : "",
            notes: meta ? meta.notes : "",
            voiceURI: meta ? meta.voiceURI : "",
            color: meta && meta.color ? meta.color : PALETTE[map.size % PALETTE.length],
          });
        }
        current = map.get(key);
        current.speeches += 1;
        if (currentScene) current.scenes.add(currentScene);
      } else if (current && paragraph.type === "Dialogue") {
        current.dialogueWords += wordCount(text);
        if (currentScene) current.scenes.add(currentScene);
      } else if (current && paragraph.type === "Parenthetical") {
        current.directions += 1;
      } else if (paragraph.type === "Scene Heading" || paragraph.type === "Action") {
        current = null;
      }
    }
    return Array.from(map.values())
      .map((character) => ({
        ...character,
        scenes: Array.from(character.scenes),
        sceneCount: character.scenes.size,
      }))
      .sort(
        (a, b) => b.dialogueWords - a.dialogueWords || a.name.localeCompare(b.name),
      );
  }

  function getStats(doc) {
    let words = 0;
    let dialogueWords = 0;
    let actionWords = 0;
    let sceneCount = 0;
    let revised = 0;
    let omittedScenes = 0;
    let longestScene = null;
    const scenes = getScenes(doc);
    for (const paragraph of doc.paragraphs) {
      const count = wordCount(paragraphText(paragraph));
      words += count;
      if (paragraph.type === "Scene Heading") sceneCount += 1;
      if (paragraph.type === "Dialogue") dialogueWords += count;
      if (paragraph.type === "Action") actionWords += count;
      if (paragraph.revision) revised += 1;
    }
    for (const scene of scenes) {
      if (scene.omit) omittedScenes += 1;
      if (!longestScene || scene.wordCount > longestScene.wordCount) longestScene = scene;
    }
    const speakers = getCharacters(doc);
    const charactersWithDialogue = speakers.filter((speaker) => speaker.dialogueWords > 0).length;
    // Screenplay pages contain a lot of intentional whitespace: scene breaks,
    // character cues, parentheticals and transitions. Counting words alone
    // underestimates the page count, especially in dialogue-heavy scenes.
    const pages = Math.max(1, Math.ceil((words + sceneCount * 18) / 190));
    return {
      words,
      pages,
      scenes: sceneCount,
      activeScenes: sceneCount - omittedScenes,
      omittedScenes,
      characters: charactersWithDialogue,
      dialogueWords,
      actionWords,
      dialogueRatio: words ? Math.round((dialogueWords / words) * 100) : 0,
      readingMinutes: Math.max(1, Math.round(words / 220)),
      longestScene,
      locations: getLocations(doc).length,
      revised,
      targetPages: doc.settings ? doc.settings.targetPages : DEFAULT_SETTINGS.targetPages,
      revision: doc.revision || normalizeRevision(),
    };
  }

  function revisionEntry(doc, revisionId) {
    const id = Math.max(1, Math.floor(Number(revisionId) || 1));
    const revision = doc && doc.revision ? doc.revision : normalizeRevision();
    const found = revision.history.find((entry) => entry.id === id);
    if (found) return found;
    const color = REVISION_COLORS[(id - 1) % REVISION_COLORS.length];
    return {
      id,
      name: color.name,
      hex: color.hex,
      pageColor: color.pageColor,
      createdAt: new Date().toISOString(),
    };
  }

  function nextRevision(doc) {
    const revision = normalizeRevision(doc.revision);
    const id = Math.max(revision.current + 1, revision.history.length + 1);
    const color = REVISION_COLORS[(id - 1) % REVISION_COLORS.length];
    const entry = {
      id,
      name: `${color.name}`,
      hex: color.hex,
      pageColor: color.pageColor,
      createdAt: new Date().toISOString(),
    };
    doc.revision = {
      enabled: true,
      current: id,
      history: [...revision.history.filter((item) => item.id !== id), entry],
    };
    return entry;
  }

  function markRevision(doc, paragraph) {
    if (!doc.revision || !doc.revision.enabled || !paragraph) return;
    const id = Math.max(1, doc.revision.current || 1);
    if (!doc.revision.history.some((entry) => entry.id === id)) {
      const color = REVISION_COLORS[(id - 1) % REVISION_COLORS.length];
      doc.revision.history.push({
        id,
        name: color.name,
        hex: color.hex,
        pageColor: color.pageColor,
        createdAt: new Date().toISOString(),
      });
    }
    paragraph.revision = id;
  }

  function validateDocument(doc) {
    const issues = [];
    if (!doc || typeof doc !== "object") {
      return [{ severity: "error", code: "not-a-document", message: "Document is missing." }];
    }
    if (!Array.isArray(doc.paragraphs) || doc.paragraphs.length === 0) {
      issues.push({
        severity: "error",
        code: "empty-document",
        message: "A screenplay needs at least one paragraph.",
      });
    }
    const ids = new Set();
    let sceneHeadings = 0;
    const paragraphs = doc.paragraphs || [];
    for (let index = 0; index < paragraphs.length; index += 1) {
      const paragraph = paragraphs[index];
      if (!paragraph.id) {
        issues.push({
          severity: "warning",
          code: "missing-id",
          message: "A paragraph has no stable id.",
        });
      } else if (ids.has(paragraph.id)) {
        issues.push({
          severity: "warning",
          code: "duplicate-id",
          message: `Duplicate paragraph id: ${paragraph.id}`,
        });
      } else {
        ids.add(paragraph.id);
      }
      if (!Object.prototype.hasOwnProperty.call(ELEMENTS, paragraph.type) && !(doc.elements && Object.prototype.hasOwnProperty.call(doc.elements, paragraph.type))) {
        issues.push({
          severity: "warning",
          code: "unknown-type",
          message: `Unknown element type: ${paragraph.type}`,
        });
      }
      if (paragraph.type === "Scene Heading") {
        sceneHeadings += 1;
        const next = paragraphs[index + 1];
        if (next && next.type === "Scene Heading") {
          issues.push({
            severity: "info",
            code: "empty-scene",
            message: `Scene ${sceneHeadings} has no action or dialogue before the next scene.`,
          });
        }
      }
      if (paragraph.type === "Character") {
        const next = paragraphs[index + 1];
        if (!next || !["Dialogue", "Parenthetical"].includes(next.type)) {
          issues.push({
            severity: "warning",
            code: "orphan-character",
            message: `Character cue “${paragraphText(paragraph).trim() || "Untitled"}” has no dialogue.`,
          });
        }
      }
      if (paragraph.type === "Dialogue") {
        const previous = paragraphs[index - 1];
        if (!previous || !["Character", "Parenthetical"].includes(previous.type)) {
          issues.push({
            severity: "warning",
            code: "orphan-dialogue",
            message: "Dialogue appears without a character cue above it.",
          });
        }
      }
      if (paragraph.type === "Scene Heading" && paragraph.scene && paragraph.scene.omit && !paragraph.scene.notes) {
        issues.push({
          severity: "info",
          code: "omitted-scene",
          message: `Scene ${sceneHeadings} is omitted but has no production note.`,
        });
      }
    }
    if (sceneHeadings === 0 && paragraphs.length > 1) {
      issues.push({
        severity: "info",
        code: "no-scenes",
        message: "No scene headings yet; the navigator will be empty.",
      });
    }
    if (doc.titlePage && doc.titlePage.enabled && !String(doc.titlePage.author || "").trim()) {
      issues.push({
        severity: "info",
        code: "title-page-author",
        message: "The title page has no author credit.",
      });
    }
    return issues;
  }

  function plainTextToHtml(text) {
    return String(text || "")
      .split(/\n{2,}/)
      .map((block) => escapeHtml(block).replace(/\n/g, "<br>"))
      .join("<br><br>");
  }

  function formatDuration(minutes) {
    if (!minutes) return "0 min";
    return `${minutes} min`;
  }

  return {
    VERSION,
    ELEMENTS,
    DEFAULT_MACROS,
    TAG_CATEGORIES,
    PALETTE,
    REVISION_COLORS,
    DEFAULT_SETTINGS,
    DEFAULT_TITLE_PAGE,
    DEFAULT_SCENE,
    uid,
    hash32,
    toUuid,
    escapeHtml,
    decodeEntities,
    sanitizeHtml,
    stripHtml,
    wordCount,
    makeParagraph,
    blankDocument,
    sampleDocument,
    templateDocument,
    normalizeDocument,
    cloneDocument,
    paragraphText,
    documentText,
    elementSpec,
    nextType,
    tabType,
    parseSceneHeading,
    getScenes,
    getSceneForParagraph,
    getLocations,
    characterKey,
    getCharacters,
    getStats,
    revisionEntry,
    nextRevision,
    markRevision,
    validateDocument,
    plainTextToHtml,
    formatDuration,
  };
});
