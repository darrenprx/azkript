/* Azkript — FDX browser reader/writer.
 * Pure string serialization is Node-testable; parsing uses DOMParser.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./model.js"));
  } else {
    root.FDX = factory(root.FDModel);
  }
})(typeof self !== "undefined" ? self : this, function (FDModel) {
  "use strict";

  const FDX_VERSION = "6";

  const tagName = (node) => (node.localName || node.nodeName || "").toLowerCase();

  const escapeXml = (value) =>
    String(value == null ? "" : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      /* &#39; rather than &apos; so a save/load cycle returns byte-identical
       * HTML (escapeHtml in model.js uses the numeric form). */
      .replace(/'/g, "&#39;");

  const attr = (value) => escapeXml(value);
  const textNode = (value) => escapeXml(value).replace(/\n/g, "&#10;");
  const attributesOf = (node) => Object.fromEntries(Array.from(node && node.attributes || []).map(a => [a.name, a.value]));
  const directChildren = (node, name) => Array.from(node && node.children || []).filter(child => tagName(child) === name.toLowerCase());
  const firstChild = (node, name) => directChildren(node, name)[0] || null;
  const xmlAttrs = (attrs) => Object.entries(attrs || {}).filter(([key, value]) => /^[A-Za-z_][\w:.-]*$/.test(key) && value != null)
    .map(([key, value]) => ` ${key}="${attr(value)}"`).join("");
  const knownRunStyles = new Set(["Bold", "Italic", "Underline", "Strikethrough"]);
  const NATIVE_SECTION_MAP = { elements: "ElementSettings", headerFooter: "HeaderAndFooter", moresContinueds: "MoresAndContinueds", smartType: "SmartType", settings: "SceneNumberOptions|HeaderAndFooter|PageLayout|TargetScriptLength|MoresAndContinueds", revision: "Revisions", titlePage: "TitlePage", cast: "Cast|Actors", beats: "ListItems|DisplayBoards", paragraphTags: "TagData", characterHighlights: "CharacterHighlighting" };
  function nativeFieldSignatures(root) {
    if (typeof XMLSerializer === "undefined") return {};
    const serializer = new XMLSerializer();
    return Object.fromEntries(Object.entries(NATIVE_SECTION_MAP).map(([field, names]) => {
      let source = names.split("|").flatMap(name => directChildren(root, name)).map(node => serializer.serializeToString(node)).join("");
      if (field === "revision") {
        source += JSON.stringify(Array.from(firstChild(root, "content")?.querySelectorAll("Paragraph[RevisionID], Text[RevisionID]") || []).map(node => {
          const paragraph = tagName(node) === "paragraph" ? node : node.closest("Paragraph");
          return [node.nodeName, paragraph?.getAttribute("id") || "", tagName(node) === "text" ? directChildren(paragraph, "text").indexOf(node) : -1, node.getAttribute("RevisionID")];
        }));
      }
      if (field === "paragraphTags") source += JSON.stringify(Array.from(firstChild(root, "content")?.querySelectorAll("Text[TagNumber]") || []).map(node => [node.closest("Paragraph")?.getAttribute("id") || "", node.getAttribute("TagNumber"), node.textContent]));
      return [field, FDModel.hash32(source)];
    }));
  }

  function cssColor(value) {
    const literal = parseColor(value);
    if (literal) return literal;
    const match = String(value || "").match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/i);
    return match ? `#${match.slice(1, 4).map(n => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, "0")).join("")}` : "";
  }
  function attrsFromStyle(styleText, token) {
    let attrs = {};
    const data = token.match(/\bdata-fdx\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (data) {
      try { const parsed = JSON.parse(FDModel.decodeEntities(data[2] || data[3] || "")); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) attrs = { ...parsed }; } catch { /* A damaged annotation is ignored. */ }
    }
    const declarations = Object.fromEntries(String(styleText || "").split(";").map(entry => {
      const colon = entry.indexOf(":"); return colon < 0 ? [] : [entry.slice(0, colon).trim().toLowerCase(), entry.slice(colon + 1).trim()];
    }).filter(entry => entry.length === 2));
    for (const [css, native] of [["color", "Color"], ["background-color", "Background"]]) {
      const color = cssColor(declarations[css]); if (color && parseColor(attrs[native]) !== color) attrs[native] = fdxColor(color);
    }
    const font = declarations["font-family"];
    if (font && /^[\p{L}\p{N} _,'".\-]{1,160}$/u.test(font)) attrs.Font = font.replace(/^['"]|['"]$/g, "");
    const size = String(declarations["font-size"] || "").match(/^([\d.]+)(pt|px)$/);
    if (size && Number(size[1]) > 0 && Number(size[1]) <= 200) {
      const points = Number(size[1]) * (size[2] === "px" ? .75 : 1);
      if (Number(attrs.Size) !== points) attrs.Size = String(points);
    }
    const fontColor = token.match(/\bcolor\s*=\s*["']([^"']+)["']/i);
    if (fontColor && cssColor(fontColor[1])) attrs.Color = fdxColor(cssColor(fontColor[1]));
    return attrs;
  }

  function styleFlags(tag, styleText) {
    const flags = new Set();
    const name = String(tag || "").toLowerCase();
    if (name === "b" || name === "strong") flags.add("Bold");
    if (name === "i" || name === "em") flags.add("Italic");
    if (name === "u") flags.add("Underline");
    if (name === "s" || name === "strike" || name === "del") flags.add("Strikethrough");
    const style = String(styleText || "").toLowerCase();
    if (/font-weight\s*:\s*(bold|[6-9]00)/.test(style)) flags.add("Bold");
    if (/font-style\s*:\s*italic/.test(style)) flags.add("Italic");
    if (/text-decoration[^;]*underline/.test(style)) flags.add("Underline");
    if (/text-decoration[^;]*line-through/.test(style)) flags.add("Strikethrough");
    return flags;
  }

  function mergeRuns(runs) {
    const merged = [];
    for (const run of runs) {
      if (!run.text) continue;
      const previous = merged[merged.length - 1];
      const style = Array.from(run.flags).sort().join("+");
      const attrs = run.attrs || {};
      if (previous && previous.style === style && previous.nodeType === run.nodeType && JSON.stringify(previous.attrs || {}) === JSON.stringify(attrs)) previous.text += run.text;
      else merged.push({ text: run.text, style, ...(Object.keys(attrs).length ? { attrs } : {}), ...(run.nodeType ? { nodeType: run.nodeType } : {}), flags: new Set(run.flags) });
    }
    return merged.map((run) => ({ text: run.text, style: run.style, ...(run.attrs ? { attrs: run.attrs } : {}), ...(run.nodeType ? { nodeType: run.nodeType } : {}) }));
  }

  /** Convert the app's limited contenteditable HTML into FDX-style runs. */
  function htmlToRuns(html) {
    const source = String(html || "");
    const tokens = source.match(/<[^>]*>|[^<]+/g) || [];
    const stack = [];
    const runs = [];
    let blockDepth = 0;

    const pushText = (text) => {
      const decoded = FDModel.decodeEntities(text).replace(/\u00a0/g, " ");
      if (!decoded) return;
      const flags = new Set();
      for (const frame of stack) for (const flag of frame.flags) flags.add(flag);
      const attrs = Object.assign({}, ...stack.map(frame => frame.attrs || {}));
      for (const flag of String(attrs.Style || "").split("+").filter(Boolean)) flags.add(flag);
      delete attrs.Style;
      const nodeType = stack.findLast(frame => frame.nodeType)?.nodeType;
      runs.push({ text: decoded, flags, attrs, ...(nodeType ? { nodeType } : {}) });
    };

    for (const token of tokens) {
      if (token.startsWith("</")) {
        const name = token.slice(2, -1).trim().toLowerCase();
        if (["div", "p", "li"].includes(name) && blockDepth > 0) {
          blockDepth -= 1;
          if (runs.length) runs.push({ text: "\n", flags: new Set() });
        }
        for (let index = stack.length - 1; index >= 0; index -= 1) {
          if (stack[index].name === name) {
            stack.splice(index);
            break;
          }
        }
        continue;
      }
      if (token.startsWith("<")) {
        const match = token.match(/^<\s*([a-zA-Z0-9-]+)/);
        if (!match) continue;
        const name = match[1].toLowerCase();
        if (name === "br") {
          runs.push({ text: "\n", flags: new Set() });
          continue;
        }
        const styleMatch = token.match(/\bstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
        const styleText = styleMatch ? styleMatch[2] || styleMatch[3] || "" : "";
        const flags = styleFlags(name, styleText);
        if (["div", "p", "li"].includes(name)) blockDepth += 1;
        if (!token.endsWith("/>")) {
          stack.push({ name, flags, attrs: attrsFromStyle(styleText, token), nodeType: /\bdata-fdx-node=["']DynamicLabel["']/.test(token) ? "DynamicLabel" : null });
        }
        continue;
      }
      pushText(token);
    }
    return mergeRuns(runs);
  }

  function runsToHtml(runs) {
    return (runs || [])
      .map((run) => {
        const flags = new Set(String(run.style || "").split("+").filter(Boolean));
        let content = escapeXml(run.text || "").replace(/\n/g, "<br>");
        if (flags.has("Strikethrough")) content = `<s>${content}</s>`;
        if (flags.has("Underline")) content = `<u>${content}</u>`;
        if (flags.has("Italic")) content = `<em>${content}</em>`;
        if (flags.has("Bold")) content = `<strong>${content}</strong>`;
        const native = { ...(run.attrs || {}) };
        const extraStyles = [...flags].filter(flag => !knownRunStyles.has(flag));
        if (extraStyles.length) native.Style = extraStyles.join("+");
        if (Object.keys(native).length || run.nodeType) {
          const css = [];
          if (parseColor(native.Color)) css.push(`color:${parseColor(native.Color)}`);
          if (parseColor(native.Background)) css.push(`background-color:${parseColor(native.Background)}`);
          if (native.Font && /^[\p{L}\p{N} _,'".\-]{1,160}$/u.test(native.Font)) css.push(`font-family:${native.Font}`);
          if (Number(native.Size) > 0 && Number(native.Size) <= 200) css.push(`font-size:${Number(native.Size)}pt`);
          if (flags.has("AllCaps")) css.push("text-transform:uppercase");
          if (flags.has("Superscript")) css.push("vertical-align:super");
          if (flags.has("Subscript")) css.push("vertical-align:sub");
          content = `<span data-fdx="${attr(JSON.stringify(native))}"${run.nodeType === "DynamicLabel" ? ' data-fdx-node="DynamicLabel" contenteditable="false"' : ""}${css.length ? ` style="${attr(css.join(";"))}"` : ""}>${content}</span>`;
        }
        return content;
      })
      .join("");
  }

  function parseColor(value) {
    const text = String(value || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
    const long = text.match(/^#([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})$/i);
    if (long) {
      return `#${long[1].slice(0, 2)}${long[2].slice(0, 2)}${long[3].slice(0, 2)}`.toLowerCase();
    }
    return "";
  }

  function fdxColor(value) {
    const hex = parseColor(value);
    if (!hex) return "";
    const r = hex.slice(1, 3);
    const g = hex.slice(3, 5);
    const b = hex.slice(5, 7);
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  function revisionName(value) {
    return String(value || "")
      .replace(/\s*Rev\.?.*$/i, "")
      .replace(/\s*\(.*?\)\s*/g, "")
      .trim();
  }

  /* ------------------------------------------------------------------ */
  /* AzkriptData: lossless side-channel for app-only document state       */
  /* ------------------------------------------------------------------ */

  const AZKRIPT_TAG = "azkriptdata";
  /* Pre-rename files carry the same JSON under <StudioData>. It is still read
   * so an older document keeps its beats, cast, tags and revision history. */
  const LEGACY_TAG = "studiodata";

  /* Everything the app models that plain FDX content cannot express. Kept in
   * one JSON block so a round-trip is exact, while the FDX-visible parts
   * (paragraphs, scenes, revisions, page layout) stay readable by other tools. */
  const AZKRIPT_FIELDS = [
    "story",
    "production",
    "documentId",
    "workspaceNotes",
    "sourceFingerprint",
    "formatVersion",
    "elements",
    "beats",
    "bookmarks",
    "cast",
    "macros",
    "headerFooter",
    "moresContinueds",
    "watermark",
    "lockedPages",
    "characterHighlights",
    "nonSpeaking",
    "smartType",
    "settings",
  ];

  function azkriptExtras(doc) {
    const payload = { version: 1 };
    const retainedIds = new Set(doc.sourceFDX?.paragraphBindings);
    for (const field of AZKRIPT_FIELDS) {
      const value = doc[field];
      if (value === undefined || value === null) continue;
      if (Array.isArray(value) && !value.length) continue;
      if (typeof value === "object" && !Array.isArray(value) && !Object.keys(value).length) continue;
      payload[field] = field === 'workspaceNotes' ? value.map(note => ({ ...note,
        paragraphId: note.paragraphId && !retainedIds.has(note.paragraphId) ? FDModel.toUuid(note.paragraphId) : note.paragraphId,
      })) : value;
    }
    /* Per-paragraph state that has no FDX representation. Keyed by paragraph id
     * so it survives alongside the Content section. */
    const paragraphExtras = {};
    for (const paragraph of doc.paragraphs || []) {
      const extra = {};
      if (paragraph.dualGroup) extra.dualGroup = String(paragraph.dualGroup);
      if (paragraph.dualSide === 0 || paragraph.dualSide === 1) {
        extra.dualSide = paragraph.dualSide;
      }
      if (Array.isArray(paragraph.alts) && paragraph.alts.length) {
        extra.alts = paragraph.alts.map(String);
        extra.activeAlt = Math.max(0, Math.floor(Number(paragraph.activeAlt) || 0));
      }
      if (Array.isArray(paragraph.tags) && paragraph.tags.length) extra.tags = paragraph.tags;
      if (paragraph.image) extra.image = paragraph.image;
      if (paragraph.changeType) extra.changeType = String(paragraph.changeType);
      if (typeof paragraph.trackedOriginal === "string") {
        extra.trackedOriginal = paragraph.trackedOriginal;
      }
      if (Object.keys(extra).length) {
        /* Keyed by the same UUID written to the Paragraph's id attribute, so a
         * reparse can match by id directly. */
        paragraphExtras[retainedIds.has(paragraph.id) ? paragraph.id : FDModel.toUuid(paragraph.id)] = extra;
      }
    }
    if (Object.keys(paragraphExtras).length) payload.paragraphExtras = paragraphExtras;
    /* Title-page fields the human-readable title page cannot disambiguate. */
    if (doc.titlePage) payload.titlePage = doc.titlePage;
    /* Revision history carries ids/colors/page colors that FDX stores only as
     * an ordered palette; keeping the model keeps ids stable across saves. */
    if (doc.revision) payload.revision = doc.revision;
    return payload;
  }

  function serializeAzkriptData(doc) {
    const payload = azkriptExtras(doc);
    if (Object.keys(payload).length <= 1) return [];
    const json = JSON.stringify(payload);
    return [
      `  <AzkriptData Format="azkript">${textNode(json)}</AzkriptData>`,
    ];
  }

  function parseAzkriptData(root) {
    const children = Array.from(root.children);
    const node =
      children.find((child) => tagName(child) === AZKRIPT_TAG) ||
      children.find((child) => tagName(child) === LEGACY_TAG);
    if (!node) return null;
    try {
      const parsed = JSON.parse(node.textContent || "");
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function parseTitlePage(root, warnings) {
    const titlePageNode = Array.from(root.children).find(
      (child) => tagName(child) === "titlepage",
    );
    if (!titlePageNode) {
      return { enabled: false };
    }
    const content = Array.from(titlePageNode.children).find(
      (child) => tagName(child) === "content",
    );
    if (!content) return { enabled: false };
    const values = [];
    for (const paragraph of Array.from(content.children)) {
      if (tagName(paragraph) !== "paragraph") continue;
      let text = "";
      for (const child of Array.from(paragraph.children)) {
        if (tagName(child) === "text") text += child.textContent || "";
      }
      const trimmed = text.replace(/\u00a0/g, " ").trim();
      if (trimmed) values.push(trimmed);
    }
    if (!values.length) return { enabled: false, rawParagraphs: [] };
    const title = values[0] || "";
    const creditIndex = values.findIndex((value) => /^(written by|by)$/i.test(value));
    const credit = creditIndex >= 0 ? values[creditIndex] : "Written by";
    const author =
      creditIndex >= 0 && values[creditIndex + 1] ? values[creditIndex + 1] : "";
    const rest = values.filter(
      (value) => ![title, credit, author].includes(value) && value,
    );
    const source =
      rest.find((value) => /^(based on|an original|from|adapted from)\b/i.test(value)) || "";
    const draftDate =
      rest.find(
        (value) =>
          /\b(first|second|third|final|revised|revision|shooting)\s+draft\b/i.test(value) ||
          /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(value) ||
          /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(value),
      ) || "";
    const contact =
      rest.find((value) => /@|https?:\/\/|\+?\d[\d ()-]{7,}\d/.test(value)) || "";
    const used = new Set([title, credit, author, source, draftDate, contact].filter(Boolean));
    const notes = values.filter((value) => !used.has(value)).join("\n");
    if (values.length > 1) {
      warnings.push("Title page text was mapped into the studio's title-page fields.");
    }
    return {
      enabled: true,
      title,
      credit,
      author,
      source,
      draftDate,
      contact,
      notes,
      rawParagraphs: values,
    };
  }

  function parseSceneProperties(node, hasStudioData) {
    const sceneNode = Array.from(node.children).find(
      (child) => tagName(child) === "sceneproperties",
    );
    const paragraphNumber = node.getAttribute("Number") || "";
    if (!sceneNode) {
      /* No SceneProperties: report only the genuinely stored number so an
       * auto-numbered scene does not gain a value across a round-trip. */
      return paragraphNumber ? { number: paragraphNumber } : null;
    }
    const omit = String(sceneNode.getAttribute("Omit") || "").toLowerCase();
    // Azkript writes the resolved label on Paragraph and the override on
    // SceneProperties. Native FDX can store a number on Paragraph alone.
    const explicitNumber =
      sceneNode.getAttribute("Number") || sceneNode.getAttribute("SceneNumber") ||
      (hasStudioData ? "" : paragraphNumber);
    return {
      title: sceneNode.getAttribute("Title") || "",
      synopsis:
        sceneNode.getAttribute("Summary") ||
        sceneNode.getAttribute("Synopsis") ||
        "",
      notes: sceneNode.getAttribute("Notes") || "",
      color: parseColor(sceneNode.getAttribute("Color") || sceneNode.getAttribute("PageColor")),
      omit: omit === "yes" || omit === "true" || omit === "1",
      number: explicitNumber,
    };
  }

  function parseParagraphRevision(node) {
    let revision = Math.max(0, Math.floor(Number(node.getAttribute("RevisionID")) || 0));
    for (const child of Array.from(node.children)) {
      if (tagName(child) !== "text") continue;
      revision = Math.max(revision, Math.floor(Number(child.getAttribute("RevisionID")) || 0));
    }
    return revision || null;
  }

  function parseElementDefinitions(root) {
    const result = Object.create(null);
    for (const node of directChildren(root, "elementsettings")) {
      const name = node.getAttribute("Type");
      if (!name || ["__proto__", "constructor", "prototype"].includes(name)) continue;
      const base = FDModel.ELEMENTS[name] || FDModel.ELEMENTS.Action;
      const font = attributesOf(firstChild(node, "fontspec"));
      const paragraph = attributesOf(firstChild(node, "paragraphspec"));
      const behavior = attributesOf(firstChild(node, "behavior"));
      const outline = attributesOf(firstChild(node, "outline"));
      const numeric = (value, fallback) => Number.isFinite(Number(value)) && value !== "" && value != null ? Number(value) : fallback;
      result[name] = { ...base, label: name, approximate: false, font: font.Font || "Courier Final Draft", fontSize: numeric(font.Size, 12),
        style: font.Style || "", align: (paragraph.Alignment || base.align).toLowerCase(),
        left: numeric(paragraph.LeftIndent, base.left), right: numeric(paragraph.RightIndent, base.right),
        first: numeric(paragraph.FirstIndent, base.first), before: numeric(paragraph.SpaceBefore, base.before),
        spacing: numeric(paragraph.Spacing, 1), leading: paragraph.Leading || "Regular",
        startsNewPage: /^yes$/i.test(paragraph.StartsNewPage || ""),
        next: behavior.ReturnKey || base.next, tab: behavior.TabKey || base.tab,
        shortcut: behavior.WinShortcut || behavior.Shortcut || base.shortcut,
        native: { font, paragraph, behavior, outline } };
    }
    return result;
  }

  function nativeHeaderFooter(root) {
    const node = firstChild(root, "headerandfooter");
    if (!node) return undefined;
    const text = name => directChildren(firstChild(node, name), "paragraph").map(p => Array.from(p.children)
      .map(child => tagName(child) === "text" ? child.textContent : tagName(child) === "dynamiclabel" && /page/i.test(child.getAttribute("Type") || "") ? "{PAGE}" : "").join("")).join("\n");
    return { headerText: text("header"), footerText: text("footer"),
      showHeader: !/^no$/i.test(node.getAttribute("HeaderVisible") || "Yes"),
      showFooter: /^yes$/i.test(node.getAttribute("FooterVisible") || "No"),
      showOnFirstPage: /^yes$/i.test(node.getAttribute("HeaderFirstPage") || "No"),
      startingPage: Math.max(1, Number(node.getAttribute("StartingPage")) || 1) };
  }

  function nativeSmartType(root) {
    const node = firstChild(root, "smarttype");
    if (!node) return undefined;
    const lists = { characters: "Characters", extensions: "Extensions", locations: "Locations", times: "TimesOfDay", transitions: "Transitions", intros: "SceneIntros" };
    return Object.fromEntries(Object.entries(lists).map(([key, name]) => [key,
      Array.from(firstChild(node, name)?.children || []).map(child => child.textContent || "").filter(Boolean)]));
  }

  function nativeMores(root) {
    const node = firstChild(root, "moresandcontinueds");
    if (!node) return undefined;
    const dialogue = firstChild(node, "dialoguebreaks"), scene = firstChild(node, "scenebreaks");
    return { dialogueMore: dialogue?.getAttribute("DialogueBottom") || "(MORE)", dialogueCont: dialogue?.getAttribute("DialogueTop") || "(CONT'D)",
      sceneContTop: scene?.getAttribute("SceneTop") || "CONTINUED:", sceneContBottom: scene?.getAttribute("SceneBottom") || "(CONTINUED)",
      autoCharacterCont: !/^no$/i.test(dialogue?.getAttribute("AutomaticCharacterContinueds") || "Yes"),
      includeSceneNumber: /^yes$/i.test(scene?.getAttribute("ContinuedNumber") || "No") };
  }

  const nativeCharacterKey = value => String(value || "").replace(/\s*\([^)]*\)\s*$/, "").trim().toUpperCase();
  // toUuid intentionally extracts an embedded UUID. Hash compound identity
  // seeds first so different categories in one document cannot collapse to the
  // document UUID itself.
  const derivedNativeId = value => FDModel.toUuid(`native:${FDModel.hash32(value)}:${FDModel.hash32(`2:${value}`)}:${FDModel.hash32(`3:${value}`)}:${FDModel.hash32(`4:${value}`)}`);

  function nativeCast(root) {
    const cast = Object.create(null);
    for (const member of directChildren(firstChild(root, "cast"), "member")) {
      const name = nativeCharacterKey(member.getAttribute("Character"));
      if (name && !["__proto__", "constructor", "prototype"].includes(name.toLowerCase())) cast[name] = { actor: member.getAttribute("Actor") || "" };
    }
    return cast;
  }

  function nativeBeats(root) {
    const boards = directChildren(firstChild(root, "displayboards"), "displayboard").filter(node => node.getAttribute("Type") === "Beat");
    const items = new Map(boards.flatMap(board => directChildren(board, "item")).map(item => [item.getAttribute("Id"), item]));
    return directChildren(firstChild(root, "listitems"), "listitem").filter(node => node.getAttribute("Type") === "Beat").map((node, index) => {
      const id = node.getAttribute("Id"), item = items.get(id), content = firstChild(node, "content"), goal = firstChild(node, "subordinateto");
      return { id, title: node.getAttribute("Title") || `Beat ${index + 1}`, body: directChildren(content, "paragraph").map(p => directChildren(p, "text").map(t => t.textContent).join("")).join("\n"),
        category: "Beat", color: parseColor(node.getAttribute("Color")) || FDModel.PALETTE[index % FDModel.PALETTE.length],
        x: item ? Number(item.getAttribute("Left")) : 48 + index % 3 * 280,
        y: item ? Number(item.getAttribute("Top")) : 48 + Math.floor(index / 3) * 200,
        width: item ? Number(item.getAttribute("Width")) : 248,
        goalPage: goal?.getAttribute("Type") === "PageGoal" ? goal.getAttribute("Number") || "" : "" };
    });
  }

  function nativeHighlights(root) {
    return Object.fromEntries(directChildren(firstChild(root, "characterhighlighting"), "character").filter(node => node.getAttribute("Visible") === "Yes" && parseColor(node.getAttribute("Color"))).map(node => [node.getAttribute("Name"), parseColor(node.getAttribute("Color"))]));
  }

  function nativeTagDefinitions(root) {
    const data = firstChild(root, "tagdata");
    const categories = new Map(directChildren(firstChild(data, "tagcategories"), "tagcategory").map(node => [node.getAttribute("Id"), node]));
    const definitions = new Map(directChildren(firstChild(data, "tagdefinitions"), "tagdefinition").map(node => {
      const category = categories.get(node.getAttribute("CatId")), name = category?.getAttribute("Name") || "props";
      const standard = FDModel.TAG_CATEGORIES.find(cat => cat.label.replace(/[\s/]/g, "").toLowerCase() === name.replace(/[\s/]/g, "").toLowerCase());
      return [node.getAttribute("Id"), { id: node.getAttribute("Id"), label: node.getAttribute("Label") || "", category: standard?.id || name, color: parseColor(category?.getAttribute("Color")) || "#0f6cbd" }];
    }));
    const tags = new Map(directChildren(firstChild(data, "tags"), "tag").map(node => [node.getAttribute("Number"), directChildren(node, "defid").map(def => def.textContent.trim())]));
    return { definitions, tags };
  }

  function paragraphNativeTags(node, graph) {
    const ids = new Set(directChildren(node, "text").flatMap(text => graph.tags.get(text.getAttribute("TagNumber")) || []));
    return [...ids].map(id => graph.definitions.get(id)).filter(tag => tag?.label);
  }

  function paragraphProjection(p) {
    const result = {};
    for (const key of ["id", "type", "html", "revision", "scene", "note", "tags", "alignment", "spacing", "spaceBefore", "leading", "pageBreakBefore", "dualGroup", "dualSide"]) {
      if (p[key] !== undefined) result[key] = p[key];
    }
    return result;
  }
  function documentProjection(doc) {
    const fields = ["title", "titlePage", "page", "settings", "revision", "elements", "headerFooter", "moresContinueds", "smartType", "cast", "beats", "lockedPages", "watermark", "characterHighlights"];
    return Object.fromEntries(fields.map(key => [key, doc[key]]));
  }

  function parse(xmlText) {
    if (typeof DOMParser === "undefined") {
      throw new Error("FDX parsing needs a browser DOMParser.");
    }
    const parser = new DOMParser();
    const xml = parser.parseFromString(String(xmlText || ""), "application/xml");
    const error = xml.getElementsByTagName("parsererror")[0];
    if (error) {
      throw new Error(`Invalid FDX XML: ${error.textContent.trim().slice(0, 180)}`);
    }
    const root = xml.documentElement;
    if (tagName(root) !== "finaldraft") {
      throw new Error("Not an FDX document: root element is not FinalDraft.");
    }

    const warnings = [];
    const studio = parseAzkriptData(root);
    const paragraphs = [];
    const elements = parseElementDefinitions(root);
    const fingerprint = `fnv1a:${FDModel.hash32(String(xmlText || ""))}:${String(xmlText || "").length}`;
    const documentId = FDModel.toUuid(firstChild(root, "documentref")?.getAttribute("id") || studio?.documentId || fingerprint);
    const importedId = index => FDModel.toUuid(`${documentId.replace(/-/g, "")}:paragraph:${index}`);
    const paragraphBindings = [];
    const tagGraph = nativeTagDefinitions(root);
    const content = Array.from(root.children).find((child) => tagName(child) === "content");
    if (!content) throw new Error("FDX has no Content section.");

    const parseParagraph = (node, dual) => {
      const type = node.getAttribute("Type") || "Action";
      if (!FDModel.ELEMENTS[type] && !elements[type]) elements[type] = { ...FDModel.ELEMENTS.Action, label: type, approximate: true };
      let html = "";
      let noteText = "";
      for (const child of Array.from(node.children)) {
        if (tagName(child) === "text") {
          const flags = String(child.getAttribute("Style") || "")
            .split("+")
            .filter(Boolean);
          html += runsToHtml([
            { text: child.textContent || "", style: flags.join("+"), attrs: Object.fromEntries(Object.entries(attributesOf(child)).filter(([key]) => key !== "Style")) },
          ]);
        } else if (tagName(child) === "dynamiclabel") {
          html += runsToHtml([{ text: `[${child.getAttribute("Type") || "dynamic"}]`, style: "", attrs: attributesOf(child), nodeType: "DynamicLabel" }]);
        } else if (tagName(child) === "scriptnotes" || tagName(child) === "scriptnote") {
          const t = (child.textContent || "").trim();
          if (t) noteText = noteText ? `${noteText}\n${t}` : t;
        }
      }
      const paragraph = {
        id: node.getAttribute("id") || importedId(paragraphs.length),
        type,
        html,
        revision: parseParagraphRevision(node),
      };
      const tags = paragraphNativeTags(node, tagGraph);
      if (tags.length) paragraph.tags = tags;
      /* Restore native per-paragraph formatting attributes. */
      const alignment = node.getAttribute("Alignment");
      if (alignment && /^(left|center|right)$/i.test(alignment)) {
        paragraph.alignment = alignment.toLowerCase();
      }
      const spacing = node.getAttribute("Spacing");
      if (spacing) paragraph.spacing = String(spacing);
      const spaceBefore = node.getAttribute("SpaceBefore");
      if (spaceBefore !== null && spaceBefore !== "" && Number.isFinite(Number(spaceBefore))) {
        paragraph.spaceBefore = Number(spaceBefore);
      }
      const leading = node.getAttribute("Leading");
      if (leading && leading !== "Regular") paragraph.leading = String(leading);
      const startsNew = String(node.getAttribute("StartsNewPage") || "").toLowerCase();
      if (startsNew === "yes" || startsNew === "true" || startsNew === "1") {
        paragraph.pageBreakBefore = true;
      }
      if (noteText) paragraph.note = noteText;
      if (type === "Scene Heading") {
        paragraph.scene = parseSceneProperties(node, Boolean(studio)) || undefined;
      }
      if (dual) {
        paragraph.dualGroup = dual.group;
        paragraph.dualSide = dual.side;
      }
      paragraphs.push(paragraph);
      paragraphBindings.push(paragraph.id);
    };

    for (const node of Array.from(content.children)) {
      if (tagName(node) !== "paragraph") continue;
      if (node.getAttribute("Type") === "DualDialogue") {
        let side = 0;
        let seenCharacter = false;
        const dualNode = Array.from(node.children).find(
          (child) => tagName(child) === "dualdialogue",
        );
        const children = directChildren(dualNode, "paragraph");
        const firstId = children[0]?.getAttribute("id") || importedId(paragraphs.length);
        const group = `dual-${firstId}`;
        for (const child of children) {
          if (child.getAttribute("Type") === "Character" && seenCharacter) side = 1;
          if (child.getAttribute("Type") === "Character") seenCharacter = true;
          parseParagraph(child, { group, side });
        }
        warnings.push("Dual dialogue was imported into the two-column layout.");
      } else {
        parseParagraph(node);
      }
    }

    const pageLayout = Array.from(root.children).find(
      (child) => tagName(child) === "pagelayout",
    );
    const pageSize = pageLayout
      ? Array.from(pageLayout.children).find((child) => tagName(child) === "pagesize")
      : null;
    const pointsToInches = (value, fallback) => {
      const number = Number.parseFloat(value);
      return Number.isFinite(number) ? number / 72 : fallback;
    };
    const page = {
      width: Number.parseFloat(pageSize && pageSize.getAttribute("Width")) || 8.5,
      height: Number.parseFloat(pageSize && pageSize.getAttribute("Height")) || 11,
      top: pageLayout ? pointsToInches(pageLayout.getAttribute("TopMargin"), 1) : 1,
      bottom: pageLayout ? pointsToInches(pageLayout.getAttribute("BottomMargin"), 1) : 1,
      left: 1,
      right: 1,
    };

    const titlePage = parseTitlePage(root, warnings);
    const title = root.getAttribute("Title") || titlePage.title || "Imported Screenplay";
    const author = titlePage.author || "";

    const revisionNode = Array.from(root.children).find(
      (child) => tagName(child) === "revisions",
    );
    const revisionHistory = [];
    if (revisionNode) {
      for (const revision of Array.from(revisionNode.children)) {
        if (tagName(revision) !== "revision") continue;
        const id = Math.max(1, Math.floor(Number(revision.getAttribute("ID")) || revisionHistory.length + 1));
        const name = revisionName(revision.getAttribute("Name")) || `Revision ${id}`;
        const palette =
          FDModel.REVISION_COLORS.find(
            (entry) => entry.name.toLowerCase() === name.toLowerCase(),
          ) || FDModel.REVISION_COLORS[(id - 1) % FDModel.REVISION_COLORS.length];
        revisionHistory.push({
          id,
          name: name === "White" ? "White" : name,
          hex: parseColor(revision.getAttribute("Color")) || parseColor(firstChild(revision, "fontspec")?.getAttribute("Color")) || palette.hex,
          pageColor: parseColor(revision.getAttribute("PageColor")) || palette.pageColor,
          /* Stable placeholder: real createdAt comes from AzkriptData when
           * present; otherwise this must not vary between saves. */
          createdAt: "",
        });
      }
    }
    const hasRevisionMarks = paragraphs.some((paragraph) => paragraph.revision);
    const revision = {
      enabled:
        (revisionNode &&
          String(revisionNode.getAttribute("RevisionMode") || "").toLowerCase() === "yes") ||
        hasRevisionMarks,
      current: Math.max(
        1,
        Math.floor(Number(revisionNode && revisionNode.getAttribute("ActiveSet")) || 1),
      ),
      history: revisionHistory,
    };

    const headerNode = Array.from(root.children).find(
      (child) => tagName(child) === "headerandfooter",
    );
    const sceneNumberNode = Array.from(root.children).find(
      (child) => tagName(child) === "scenenumberoptions",
    );
    const targetNode = Array.from(root.children).find(
      (child) => tagName(child) === "targetscriptlength",
    );
    const leftNum = sceneNumberNode
      ? String(sceneNumberNode.getAttribute("ShowNumbersOnLeft") || "").toLowerCase() === "yes"
      : true;
    const rightNum = sceneNumberNode
      ? String(sceneNumberNode.getAttribute("ShowNumbersOnRight") || "").toLowerCase() === "yes"
      : true;
    const sceneNumberSide =
      leftNum && !rightNum ? "left" : !leftNum && rightNum ? "right" : "both";
    const settings = {
      sceneNumbers: sceneNumberNode ? leftNum || rightNum : true,
      sceneNumberSide,
      pageNumbers:
        !headerNode ||
        String(headerNode.getAttribute("HeaderVisible") || "yes").toLowerCase() !== "no",
      showMore: !/^no$/i.test(firstChild(firstChild(root, "moresandcontinueds"), "dialoguebreaks")?.getAttribute("BottomOfPage") || "Yes"),
      targetPages: targetNode ? Math.max(1, Number(targetNode.textContent) || 120) : 120,
      smartQuotes:
        !pageLayout ||
        String(pageLayout.getAttribute("UsesSmartQuotes") || "yes").toLowerCase() !== "no",
    };

    /* Apply the AzkriptData side-channel: app-only state that FDX content cannot
     * express. Files without it (any other tool's FDX) parse exactly as before. */
    const nativeSignatures = nativeFieldSignatures(root);
    const privateCurrent = (field) => Boolean(studio && (!studio.nativeSignatures || !studio.nativeSignatures[field] || studio.nativeSignatures[field] === nativeSignatures[field]));
    const chooseNative = (field, value) => privateCurrent(field) && studio[field] != null ? studio[field] : value;
    if (studio) {
      const paragraphById = new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph]));
      if (studio.paragraphExtras && typeof studio.paragraphExtras === "object") {
        for (const [id, extra] of Object.entries(studio.paragraphExtras)) {
          const target = paragraphById.get(id);
          if (!target || !extra || typeof extra !== "object") continue;
          if (Array.isArray(extra.alts) && extra.alts.length) {
            target.alts = extra.alts.map(String).filter(Boolean);
            target.activeAlt = Math.max(0, Math.floor(Number(extra.activeAlt) || 0));
          }
          if (privateCurrent("paragraphTags") && Array.isArray(extra.tags) && extra.tags.length) target.tags = extra.tags;
          if (extra.image) target.image = extra.image;
          if (extra.changeType) target.changeType = String(extra.changeType);
          if (typeof extra.trackedOriginal === "string") {
            target.trackedOriginal = extra.trackedOriginal;
          }
          /* Dual-dialogue grouping is re-derived from FDX nesting with fresh
           * ids; restore the model's ids so links between saves stay stable. */
          if (extra.dualGroup) target.dualGroup = String(extra.dualGroup);
          if (extra.dualSide === 0 || extra.dualSide === 1) target.dualSide = extra.dualSide;
        }
      }
    }

    const imported = Object.assign(
      FDModel.normalizeDocument({
        version: FDModel.VERSION,
        documentId,
        sourceFingerprint: (studio && studio.sourceFingerprint) || fingerprint,
        formatVersion: 1,
        elements: studio && studio.elements ? { ...studio.elements, ...elements } : elements,
        title,
        author,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        titlePage: chooseNative("titlePage", titlePage),
        page,
        settings: studio && studio.settings ? (privateCurrent("settings") ? { ...settings, ...studio.settings } : { ...studio.settings, ...settings }) : settings,
        revision: chooseNative("revision", revision),
        cast: chooseNative("cast", nativeCast(root)),
        beats: chooseNative("beats", nativeBeats(root)),
        bookmarks: (studio && studio.bookmarks) || [],
        workspaceNotes: (studio && studio.workspaceNotes) || [],
        production: (studio && studio.production) || {},
        story: (studio && studio.story) || {},
        macros: (studio && studio.macros) || undefined,
        headerFooter: chooseNative("headerFooter", nativeHeaderFooter(root)),
        moresContinueds: chooseNative("moresContinueds", nativeMores(root)),
        watermark: studio && studio.watermark,
        lockedPages: studio && studio.lockedPages,
        characterHighlights: chooseNative("characterHighlights", nativeHighlights(root)),
        nonSpeaking: (studio && studio.nonSpeaking) || [],
        smartType: chooseNative("smartType", nativeSmartType(root)),
        paragraphs: paragraphs.length
          ? paragraphs
          : [FDModel.makeParagraph("Action", "")],
      }),
      {
        warnings,
        meta: {
          template: String(root.getAttribute("Template") || "").toLowerCase() === "yes",
          hasDualDialogue: warnings.some((warning) => warning.includes("Dual dialogue")),
          titlePage: Boolean(titlePage.enabled),
          revision: revision.enabled,
          /* `azkriptData` is current; `studioData` is the pre-rename name kept
           * for callers that have not migrated yet. */
          azkriptData: Boolean(studio),
          studioData: Boolean(studio),
        },
      },
    );
    imported.sourceFDX = { xml: String(xmlText || ""), fingerprint, paragraphBindings,
      baseline: JSON.parse(JSON.stringify(documentProjection(imported))),
      paragraphs: JSON.parse(JSON.stringify(imported.paragraphs.map(paragraphProjection))),
      sections: Array.from(root.children).map(child => child.nodeName) };
    return imported;
  }

  function sceneLength(scene) {
    const pages = Math.max(1, Number(scene && scene.pageCount) || 1);
    return pages > 1 ? `${pages}` : "1/8";
  }

  /* FDX stores these on the Paragraph element; the app models them per
   * paragraph, so they round-trip natively rather than via AzkriptData. */
  const PARAGRAPH_FORMAT_ATTRS = {
    alignment: "Alignment",
    spacing: "Spacing",
    spaceBefore: "SpaceBefore",
    leading: "Leading",
    pageBreakBefore: "StartsNewPage",
  };

  function serializeParagraph(paragraph, indent, scene) {
    const pad = " ".repeat(indent);
    const type = paragraph.type || "Action";
    const revision = paragraph.revision ? ` RevisionID="${paragraph.revision}"` : "";
    /* The FDX format expects a bare UUID here; a derived one keeps saves stable. */
    const attrs = [
      `Type="${attr(type)}"`,
      `id="${attr(FDModel.toUuid(paragraph.id))}"`,
    ];
    if (scene && scene.number) attrs.push(`Number="${attr(scene.number)}"`);
    for (const [field, attribute] of Object.entries(PARAGRAPH_FORMAT_ATTRS)) {
      const value = paragraph[field];
      if (value === undefined || value === null || value === "") continue;
      if (field === "pageBreakBefore") {
        if (value) attrs.push(`${attribute}="Yes"`);
        continue;
      }
      const text = field === "alignment" ? String(value) : String(value);
      if (field === "alignment") {
        /* FDX uses Capitalized alignment names. */
        attrs.push(`${attribute}="${attr(text.charAt(0).toUpperCase() + text.slice(1))}"`);
      } else {
        attrs.push(`${attribute}="${attr(text)}"`);
      }
    }
    const lines = [`${pad}<Paragraph ${attrs.join(" ")}>`];
    if (type === "Scene Heading") {
      /* Use the paragraph's OWN stored scene number. `scene` here comes from
       * getScenes(), which derives a display number ("1", "2", …) for
       * auto-numbered scenes — writing that would turn "" into a real value on
       * every save. */
      const storedNumber = (paragraph.scene && paragraph.scene.number) || "";
      const sceneAttrs = [
        `Length="${attr(sceneLength(scene))}"`,
        `Page="${Math.max(1, Number(scene && scene.startPage) || 1)}"`,
        `Title="${attr((scene && scene.title) || "")}"`,
      ];
      if (paragraph.scene && paragraph.scene.number) {
        sceneAttrs.push(`Number="${attr(storedNumber)}"`);
      }
      if (scene && scene.color) sceneAttrs.push(`Color="${fdxColor(scene.color)}"`);
      if (scene && scene.synopsis) sceneAttrs.push(`Summary="${attr(scene.synopsis)}"`);
      if (scene && scene.notes) sceneAttrs.push(`Notes="${attr(scene.notes)}"`);
      if (scene && scene.omit) sceneAttrs.push('Omit="Yes"');
      lines.push(`${pad}  <SceneProperties ${sceneAttrs.join(" ")}/>`);
    }
    if (paragraph.note && String(paragraph.note).trim()) {
      lines.push(
        `${pad}  <ScriptNotes><ScriptNote><Paragraph><Text>${textNode(String(paragraph.note).trim())}</Text></Paragraph></ScriptNote></ScriptNotes>`,
      );
    }
    const runs = htmlToRuns(paragraph.html);
    if (!runs.length) {
      lines.push(`${pad}  <Text${revision}/>`);
    } else {
      for (const run of runs) {
        const attrs = { ...(run.attrs || {}) };
        const nodeType = run.nodeType;
        if (run.style) attrs.Style = run.style;
        else delete attrs.Style;
        if (paragraph.revision) attrs.RevisionID = String(paragraph.revision);
        lines.push(nodeType === "DynamicLabel" ? `${pad}  <DynamicLabel${xmlAttrs(attrs)}/>` : `${pad}  <Text${xmlAttrs(attrs)}>${textNode(run.text)}</Text>`);
      }
    }
    lines.push(`${pad}</Paragraph>`);
    return lines.join("\n");
  }

  function serializeTitlePage(titlePage) {
    if (!titlePage || !titlePage.enabled) return [];
    const blank = '      <Paragraph Alignment="Center" FirstIndent="0.00" Leading="Regular" LeftIndent="1.00" OutlineLevel="1" RightIndent="7.50" SpaceBefore="0" Spacing="1" StartsNewPage="No"/>';
    const text = (value, style = "") => {
      if (!value) return "";
      return [
        '      <Paragraph Alignment="Center" FirstIndent="0.00" Leading="Regular" LeftIndent="1.00" OutlineLevel="1" RightIndent="7.50" SpaceBefore="0" Spacing="1" StartsNewPage="No">',
        `        <Text AdornmentStyle="0" Font="Courier Final Draft" RevisionID="0" Size="12" Style="${style}">${textNode(value)}</Text>`,
        "      </Paragraph>",
      ].join("\n");
    };
    const blocks = [];
    blocks.push(...Array.from({ length: 15 }, () => blank));
    blocks.push(text(titlePage.title, "Underline+AllCaps"));
    blocks.push(blank);
    blocks.push(text(titlePage.credit || "Written by"));
    blocks.push(blank);
    blocks.push(text(titlePage.author));
    if (titlePage.source) {
      blocks.push(blank);
      blocks.push(text(titlePage.source));
    }
    if (titlePage.draftDate) {
      blocks.push(blank);
      blocks.push(text(titlePage.draftDate));
    }
    if (titlePage.contact || titlePage.notes) {
      blocks.push(...Array.from({ length: 7 }, () => blank));
      if (titlePage.contact) blocks.push(text(titlePage.contact));
      if (titlePage.notes) blocks.push(text(titlePage.notes));
    }
    return [
      "  <TitlePage>",
      "    <Content>",
      ...blocks.filter(Boolean),
      "    </Content>",
      "  </TitlePage>",
    ];
  }

  function serializeRevisions(revision) {
    const current = revision && revision.current ? revision.current : 1;
    const max = Math.max(10, current, ...((revision && revision.history) || []).map((entry) => entry.id));
    const entries = [];
    for (let id = 1; id <= max; id += 1) {
      const found =
        revision && revision.history
          ? revision.history.find((entry) => entry.id === id)
          : null;
      const palette = FDModel.REVISION_COLORS[(id - 1) % FDModel.REVISION_COLORS.length];
      const name = found ? found.name : palette.name;
      const pageColor = found ? found.pageColor : palette.pageColor;
      entries.push(
        `    <Revision FullRevision="No" ID="${id}" Mark="*" Name="${attr(name)} Rev." PageColor="${fdxColor(pageColor)}" Style=""/>`,
      );
    }
    return [
      `  <Revisions ActiveSet="${current}" Location="7.75" RevisionMode="${revision && revision.enabled ? "Yes" : "No"}" RevisionsShown="Active" ShowPageColor="No">`,
      ...entries,
      "  </Revisions>",
    ];
  }

  function serializeGenerated(doc, options = {}) {
    const templateFlag = options && options.template ? "Yes" : "No";
    const normalized = FDModel.normalizeDocument(doc);
    const scenes = FDModel.getScenes(normalized);
    const sceneByParagraph = new Map(scenes.map((scene) => [scene.id, scene]));
    const paragraphs = [];
    let index = 0;
    while (index < normalized.paragraphs.length) {
      const paragraph = normalized.paragraphs[index];
      if (paragraph.dualGroup) {
        const group = paragraph.dualGroup;
        const children = [];
        while (
          index < normalized.paragraphs.length &&
          normalized.paragraphs[index].dualGroup === group
        ) {
          children.push(normalized.paragraphs[index]);
          index += 1;
        }
        paragraphs.push(
          [
            '    <Paragraph Type="DualDialogue">',
            "      <DualDialogue>",
            ...children.map((child) =>
              serializeParagraph(child, 8, sceneByParagraph.get(child.id)),
            ),
            "      </DualDialogue>",
            "    </Paragraph>",
          ].join("\n"),
        );
      } else {
        paragraphs.push(
          serializeParagraph(paragraph, 4, sceneByParagraph.get(paragraph.id)),
        );
        index += 1;
      }
    }

    const elementSettings = Object.entries({ ...FDModel.ELEMENTS, ...normalized.elements })
      .map(([type, spec]) => {
        const fontStyle = spec.style || "";
        const font = { ...spec.native?.font, AdornmentStyle: spec.native?.font?.AdornmentStyle || "0", Font: spec.font || spec.native?.font?.Font || "Courier Final Draft", RevisionID: "0", Size: String(spec.fontSize || 12), Style: fontStyle };
        const paragraph = { ...spec.native?.paragraph, Alignment: spec.align[0].toUpperCase() + spec.align.slice(1), FirstIndent: Number(spec.first).toFixed(2), Leading: spec.leading || "Regular", LeftIndent: Number(spec.left).toFixed(2), RightIndent: Number(spec.right).toFixed(2), SpaceBefore: String(spec.before), Spacing: String(spec.spacing || 1), StartsNewPage: spec.startsNewPage ? "Yes" : "No", Type: type };
        const behavior = { ...spec.native?.behavior, PaginateAs: spec.native?.behavior?.PaginateAs || (type === "Shot" ? "Scene Heading" : type), ReturnKey: spec.next, TabKey: spec.tab, Shortcut: spec.shortcut || "", WinShortcut: spec.shortcut || "" };
        return [
          `  <ElementSettings Type="${attr(type)}">`,
          `    <FontSpec${xmlAttrs(font)}/>`,
          `    <ParagraphSpec${xmlAttrs(paragraph)}/>`,
          `    <Behavior${xmlAttrs(behavior)}/>`,
          `    <Outline${xmlAttrs({ CanHide: "No", Level: type === "Scene Heading" ? "2" : "1", ...spec.native?.outline })}/>`,
          "  </ElementSettings>",
        ].join("\n");
      })
      .join("\n");

    const page = normalized.page;
    const titlePage = serializeTitlePage(normalized.titlePage);
    const revisions = serializeRevisions(normalized.revision);
    const side = normalized.settings.sceneNumberSide || "both";
    const showLeft = normalized.settings.sceneNumbers && (side === "both" || side === "left");
    const showRight = normalized.settings.sceneNumbers && (side === "both" || side === "right");
    const sceneNumberOptions = [
      `  <SceneNumberOptions LeftLocation="0.75" NumberScheme="1A" RightLocation="7.38" ShowNumbersOnLeft="${showLeft ? "Yes" : "No"}" ShowNumbersOnRight="${showRight ? "Yes" : "No"}">`,
      '    <FontSpec AdornmentStyle="0" Font="Courier Final Draft" RevisionID="0" Size="12" Style=""/>',
      "  </SceneNumberOptions>",
    ];
    return [
      '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
      `<FinalDraft DocumentType="Script" Template="${templateFlag}" Version="6" Title="${attr(normalized.title)}">`,
      /* Stable, RFC-4122-shaped id so repeated saves are identical and Final
       * Draft accepts the reference. */
      `  <DocumentRef id="${attr(normalized.documentId)}"/>`,
      ...titlePage,
      "  <Content>",
      ...paragraphs,
      "  </Content>",
      `  <HeaderAndFooter FooterFirstPage="Yes" FooterVisible="No" HeaderFirstPage="No" HeaderVisible="${normalized.settings.pageNumbers !== false ? "Yes" : "No"}" StartingPage="1">`,
      "    <Header>",
      '      <Paragraph Alignment="Right" FirstIndent="0.00" Leading="Regular" LeftIndent="1.25" OutlineLevel="1" RightIndent="-1.25" SpaceBefore="0" Spacing="1" StartsNewPage="No">',
      '        <DynamicLabel AdornmentStyle="0" Font="Courier Final Draft" RevisionID="0" Size="12" Style="" Type="Page #"/>',
      '        <Text AdornmentStyle="0" Font="Courier Final Draft" RevisionID="0" Size="12" Style="">.</Text>',
      "      </Paragraph>",
      "    </Header>",
      "  </HeaderAndFooter>",
      ...revisions,
      `  <PageLayout BottomMargin="${Math.round(page.bottom * 72)}" BreakDialogueAndActionAtSentences="Yes" DocumentLeading="Normal" FooterMargin="36" HeaderMargin="36" TopMargin="${Math.round(page.top * 72)}" UsesSmartQuotes="${normalized.settings.smartQuotes ? "Yes" : "No"}">`,
      `    <PageSize Height="${Number(page.height).toFixed(2)}" Width="${Number(page.width).toFixed(2)}"/>`,
      "  </PageLayout>",
      ...sceneNumberOptions,
      `  <TargetScriptLength>${Math.max(1, Number(normalized.settings.targetPages) || 120)}</TargetScriptLength>`,
      '  <TextState Scaling="100" Selection="0,0" ShowInvisibles="No"/>',
      ...serializeAzkriptData(normalized),
      elementSettings,
      "</FinalDraft>",
      "",
    ].join("\n");
  }

  const sameValue = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const flatBody = content => directChildren(content, "paragraph").flatMap(node =>
    node.getAttribute("Type") === "DualDialogue" ? directChildren(firstChild(node, "dualdialogue"), "paragraph") : [node]);

  function replaceKnownChildren(target, fresh, names) {
    const known = new Set(names.map(name => name.toLowerCase()));
    const previous = Array.from(target.children).filter(child => known.has(tagName(child)));
    const anchor = previous[0] || null;
    for (const child of Array.from(fresh.children).filter(child => known.has(tagName(child)))) {
      target.insertBefore(target.ownerDocument.importNode(child, true), anchor);
    }
    for (const child of previous) child.remove();
  }
  function patchAttrs(target, fresh, names) {
    for (const name of names) {
      if (fresh && fresh.hasAttribute(name)) target.setAttribute(name, fresh.getAttribute(name));
      else target.removeAttribute(name);
    }
  }
  function replaceSection(root, freshRoot, name) {
    const original = firstChild(root, name), generated = firstChild(freshRoot, name);
    if (!generated) { if (original) original.remove(); return; }
    if (!original) { root.appendChild(root.ownerDocument.importNode(generated, true)); return; }
    patchAttrs(original, generated, Array.from(generated.attributes).map(a => a.name));
    replaceKnownChildren(original, generated, [...new Set(Array.from(generated.children).map(child => tagName(child)))]);
  }
  function headerMarkup(hf) {
    const content = value => String(value || "").split(/(\{PAGE\})/g).filter(Boolean).map(part => part === "{PAGE}" ? '<DynamicLabel Type="Page #"/>' : `<Text>${textNode(part)}</Text>`).join("");
    const paragraphs = value => String(value || "").split("\n").map(line => `<Paragraph>${content(line)}</Paragraph>`).join("");
    return `<HeaderAndFooter${xmlAttrs({ HeaderVisible: hf.showHeader !== false ? "Yes" : "No", FooterVisible: hf.showFooter ? "Yes" : "No", HeaderFirstPage: hf.showOnFirstPage ? "Yes" : "No", FooterFirstPage: hf.showOnFirstPage ? "Yes" : "No", StartingPage: hf.startingPage || 1 })}><Header>${paragraphs(hf.headerText || [hf.headerLeft, hf.headerRight].filter(Boolean).join("    "))}</Header><Footer>${paragraphs(hf.footerText || [hf.footerLeft, hf.footerRight].filter(Boolean).join("    "))}</Footer></HeaderAndFooter>`;
  }
  function smartTypeMarkup(smart) {
    const groups = { characters: ["Characters", "Character"], extensions: ["Extensions", "Extension"], locations: ["Locations", "Location"], times: ["TimesOfDay", "TimeOfDay"], transitions: ["Transitions", "Transition"], intros: ["SceneIntros", "SceneIntro"] };
    return `<SmartType>${Object.entries(groups).map(([key, [group, item]]) => `<${group}>${(smart[key] || []).map(value => `<${item}>${textNode(value)}</${item}>`).join("")}</${group}>`).join("")}</SmartType>`;
  }
  function moresMarkup(mores, settings) {
    return `<MoresAndContinueds><DialogueBreaks${xmlAttrs({ AutomaticCharacterContinueds: mores.autoCharacterCont ? "Yes" : "No", BottomOfPage: settings.showMore !== false ? "Yes" : "No", TopOfNext: "Yes", DialogueBottom: mores.dialogueMore || "(MORE)", DialogueTop: mores.dialogueCont || "(CONT'D)" })}/><SceneBreaks${xmlAttrs({ ContinuedNumber: mores.includeSceneNumber ? "Yes" : "No", SceneBottom: mores.sceneContBottom || "(CONTINUED)", SceneTop: mores.sceneContTop || "CONTINUED:" })}/></MoresAndContinueds>`;
  }
  function appendNativeGeneratedSections(xml, doc) {
    const additions = [];
    const hf = doc.headerFooter || {};
    const hasCustomHeader = Boolean(hf.headerText || hf.headerLeft || hf.headerRight);
    const nativeHeader = { ...hf,
      headerText: hasCustomHeader ? hf.headerText || [hf.headerLeft, hf.headerRight].filter(Boolean).join("    ") : doc.settings?.pageNumbers !== false ? "{PAGE}." : "",
      showHeader: hf.showHeader !== false && (hasCustomHeader || doc.settings?.pageNumbers !== false) };
    xml = xml.replace(/  <HeaderAndFooter\b[\s\S]*?<\/HeaderAndFooter>/, `  ${headerMarkup(nativeHeader)}`);
    if (doc.smartType) additions.push(smartTypeMarkup(doc.smartType));
    if (doc.moresContinueds) additions.push(moresMarkup(doc.moresContinueds, doc.settings || {}));
    return xml.replace(/<\/FinalDraft>\s*$/, `${additions.join("\n")}\n</FinalDraft>\n`);
  }

  function patchSourceDocument(doc, generated, options) {
    if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
      throw new Error("Preserving imported FDX needs the browser XML engine. Open this document in Azkript to save it safely.");
    }
    if (!doc.sourceFDX.baseline || !Array.isArray(doc.sourceFDX.paragraphs) || !Array.isArray(doc.sourceFDX.paragraphBindings)) {
      throw new Error("Retained FDX metadata is incomplete. Save was stopped; reopen the source file or explicitly export a clean copy.");
    }
    const parser = new DOMParser();
    const source = parser.parseFromString(doc.sourceFDX.xml, "application/xml");
    if (source.getElementsByTagName("parsererror").length) throw new Error("The retained FDX source is invalid. Save was stopped to protect its metadata.");
    const namespaces = Object.fromEntries(Object.entries(attributesOf(source.documentElement)).filter(([name]) => name === "xmlns" || name.startsWith("xmlns:")));
    const fresh = parser.parseFromString(generated.replace(/<FinalDraft\b/, match => match + xmlAttrs(namespaces)), "application/xml");
    if (fresh.getElementsByTagName("parsererror").length) throw new Error("The edited FDX could not be represented as valid XML. Save was stopped before changing the file.");
    const root = source.documentElement, freshRoot = fresh.documentElement;
    const baseline = doc.sourceFDX.baseline || {};
    root.setAttribute("Template", options.template ? "Yes" : "No");
    if (doc.title !== baseline.title || root.hasAttribute("Title")) root.setAttribute("Title", doc.title);
    let reference = firstChild(root, "documentref");
    if (!reference) { reference = source.createElement("DocumentRef"); root.insertBefore(reference, root.firstChild); }
    reference.setAttribute("id", doc.documentId);

    const oldContent = firstChild(root, "content"), newContent = firstChild(freshRoot, "content");
    const sourceParagraphs = flatBody(oldContent);
    if (sourceParagraphs.length !== doc.sourceFDX.paragraphBindings.length) throw new Error("The retained FDX source no longer matches its paragraph bindings. Save was stopped to protect native metadata.");
    const originals = new Map((doc.sourceFDX.paragraphBindings || []).map((id, index) => [id, sourceParagraphs[index]]));
    const oldModels = new Map((doc.sourceFDX.paragraphs || []).map(p => [p.id, p]));
    const byId = new Map(doc.paragraphs.map(p => [FDModel.toUuid(p.id), p]));
    const headingIds = paragraphs => paragraphs.filter(p => p.type === "Scene Heading").map(p => p.id);
    const changedSceneOrder = !sameValue(headingIds(doc.paragraphs), headingIds(doc.sourceFDX.paragraphs));
    const hasIssuedNumbers = Object.keys(doc.production?.sceneNumbers || {}).length > 0;
    const sourceStudio = parseAzkriptData(root);
    const hadIssuedNumbers = Object.keys(sourceStudio?.production?.sceneNumbers || {}).length > 0;
    const refreshSceneNumbers = changedSceneOrder || hasIssuedNumbers || hadIssuedNumbers;
    const changedIssuedNumbers = (hasIssuedNumbers || hadIssuedNumbers) &&
      FDModel.getScenes(doc).some(scene => originals.get(scene.id)?.getAttribute("Number") !== scene.number);
    const nativeOverrides = new Set();
    if (!sourceStudio) {
      for (const previous of oldModels.values()) {
        const properties = firstChild(originals.get(previous.id), "sceneproperties");
        if (previous.scene?.number && properties &&
          !properties.hasAttribute("Number") && !properties.hasAttribute("SceneNumber")) {
          nativeOverrides.add(previous.id);
        }
      }
    }
    const changedBody = changedIssuedNumbers || nativeOverrides.size ||
      !sameValue(doc.paragraphs.map(paragraphProjection), doc.sourceFDX.paragraphs);
    if (changedBody) {
      for (const generatedParagraph of flatBody(newContent)) {
        const model = byId.get(generatedParagraph.getAttribute("id"));
        const original = model && originals.get(model.id), previous = model && oldModels.get(model.id);
        if (!model || !original || !previous) continue;
        const updated = source.importNode(original, true);
        if (!sameValue(paragraphProjection(model), previous)) {
          if (model.type !== previous.type) updated.setAttribute("Type", model.type);
          for (const [field, name] of Object.entries(PARAGRAPH_FORMAT_ATTRS)) if (!sameValue(model[field], previous[field])) patchAttrs(updated, generatedParagraph, [name]);
          if (model.html !== previous.html) replaceKnownChildren(updated, generatedParagraph, ["Text", "DynamicLabel"]);
          if (!sameValue(model.revision, previous.revision)) {
            if (model.revision) updated.setAttribute("RevisionID", String(model.revision));
            else updated.removeAttribute("RevisionID");
            for (const run of directChildren(updated, "text")) run.setAttribute("RevisionID", String(model.revision || 0));
          }
          if (!sameValue(model.note, previous.note)) replaceKnownChildren(updated, generatedParagraph, ["ScriptNotes", "ScriptNote"]);
          if (!sameValue(model.scene, previous.scene)) {
            const scene = firstChild(updated, "sceneproperties"), freshScene = firstChild(generatedParagraph, "sceneproperties");
            if (scene && freshScene) {
              for (const [field, names] of Object.entries({ title: ["Title"], number: ["Number", "SceneNumber"], synopsis: ["Summary", "Synopsis"], notes: ["Notes"], color: ["Color"], omit: ["Omit"] })) {
                if (sameValue(model.scene?.[field], previous.scene?.[field])) continue;
                const nativeName = names.find(name => freshScene.hasAttribute(name));
                const value = nativeName ? freshScene.getAttribute(nativeName) : null;
                const attributes = names.filter(name => scene.hasAttribute(name));
                for (const name of attributes.length ? attributes : [names[0]]) {
                  if (value == null) scene.removeAttribute(name); else scene.setAttribute(name, value);
                }
              }
            }
            else replaceKnownChildren(updated, generatedParagraph, ["SceneProperties"]);
          }
        }
        if (nativeOverrides.has(model.id) && model.scene?.number && model.type === "Scene Heading") {
          firstChild(updated, "sceneproperties").setAttribute("Number", model.scene.number);
        }
        if (model.scene?.number !== previous.scene?.number ||
          model.type !== previous.type ||
          (model.type === "Scene Heading" && refreshSceneNumbers)) {
          patchAttrs(updated, generatedParagraph, ["Number"]);
          if (model.type === "Scene Heading" && !model.scene?.number && !firstChild(updated, "sceneproperties")) {
            replaceKnownChildren(updated, generatedParagraph, ["SceneProperties"]);
          }
        }
        // Keep imported ids, including legacy non-UUID ids, so retained metadata
        // references remain attached to the same native paragraphs.
        if (!updated.getAttribute("id")) updated.setAttribute("id", model.id);
        generatedParagraph.replaceWith(fresh.importNode(updated, true));
      }
      // Dual-dialogue wrappers carry their own vendor metadata. Reusing only
      // their child paragraphs would discard it whenever an unrelated edit
      // caused Content to be rebuilt.
      for (const wrapper of directChildren(newContent, "paragraph").filter(p => p.getAttribute("Type") === "DualDialogue")) {
        const dual = firstChild(wrapper, "dualdialogue"), child = firstChild(dual, "paragraph");
        const childId = child?.getAttribute("id");
        const model = childId && byId.get(FDModel.toUuid(childId));
        const original = model && originals.get(model.id);
        const oldDual = original && tagName(original.parentNode) === "dualdialogue" ? original.parentNode : null;
        const oldWrapper = oldDual && oldDual.parentNode;
        if (!oldWrapper || !sameValue(model.dualGroup, oldModels.get(model.id)?.dualGroup)) continue;
        const retained = source.importNode(oldWrapper, true), retainedDual = firstChild(retained, "dualdialogue");
        replaceKnownChildren(retainedDual, dual, ["Paragraph"]);
        wrapper.replaceWith(fresh.importNode(retained, true));
      }
      replaceKnownChildren(oldContent, newContent, ["Paragraph"]);
    }

    if (!sameValue(doc.titlePage, baseline.titlePage)) replaceSection(root, freshRoot, "titlepage");
    if (!sameValue(doc.page, baseline.page) || doc.settings.smartQuotes !== baseline.settings?.smartQuotes) {
      const target = firstChild(root, "pagelayout"), next = firstChild(freshRoot, "pagelayout");
      if (target && next) {
        if (doc.page.top !== baseline.page?.top) patchAttrs(target, next, ["TopMargin"]);
        if (doc.page.bottom !== baseline.page?.bottom) patchAttrs(target, next, ["BottomMargin"]);
        if (doc.settings.smartQuotes !== baseline.settings?.smartQuotes) patchAttrs(target, next, ["UsesSmartQuotes"]);
        const size = firstChild(target, "pagesize"), freshSize = firstChild(next, "pagesize");
        if (size && freshSize) {
          if (doc.page.width !== baseline.page?.width) patchAttrs(size, freshSize, ["Width"]);
          if (doc.page.height !== baseline.page?.height) patchAttrs(size, freshSize, ["Height"]);
        }
        else replaceKnownChildren(target, next, ["PageSize"]);
      } else replaceSection(root, freshRoot, "pagelayout");
    }
    if (!sameValue(doc.revision, baseline.revision)) {
      const original = firstChild(root, "revisions"), next = firstChild(freshRoot, "revisions");
      if (!original) replaceSection(root, freshRoot, "revisions");
      else {
        patchAttrs(original, next, ["ActiveSet", "RevisionMode"]);
        const oldEntries = new Map(directChildren(original, "revision").map(node => [Number(node.getAttribute("ID")), node]));
        for (const entry of directChildren(next, "revision")) {
          const id = Number(entry.getAttribute("ID")), old = oldEntries.get(id);
          const a = (doc.revision.history || []).find(r => r.id === id), b = (baseline.revision?.history || []).find(r => r.id === id);
          if (!old) original.appendChild(source.importNode(entry, true));
          else if (!sameValue(a, b)) patchAttrs(old, entry, ["Name", "PageColor"]);
        }
      }
    }
    if (!sameValue(doc.elements, baseline.elements)) {
      for (const entry of directChildren(freshRoot, "elementsettings")) {
        const type = entry.getAttribute("Type");
        if (sameValue(doc.elements[type], baseline.elements?.[type])) continue;
        const old = directChildren(root, "elementsettings").find(e => e.getAttribute("Type") === type);
        if (!old) { root.appendChild(source.importNode(entry, true)); continue; }
        const definition = doc.elements[type] || FDModel.ELEMENTS[type], previousDefinition = baseline.elements?.[type] || {};
        const groups = {
          FontSpec: { font: ["Font"], fontSize: ["Size"], style: ["Style"] },
          ParagraphSpec: { align: ["Alignment"], left: ["LeftIndent"], right: ["RightIndent"], first: ["FirstIndent"], before: ["SpaceBefore"], spacing: ["Spacing"], leading: ["Leading"], startsNewPage: ["StartsNewPage"] },
          Behavior: { next: ["ReturnKey"], tab: ["TabKey"], shortcut: ["Shortcut", "WinShortcut"] }, Outline: {},
        };
        const nativeKeys = { FontSpec: "font", ParagraphSpec: "paragraph", Behavior: "behavior", Outline: "outline" };
        for (const name of ["FontSpec", "ParagraphSpec", "Behavior", "Outline"]) {
          const previous = firstChild(old, name), next = firstChild(entry, name);
          if (previous && next) {
            const changed = Object.entries(groups[name]).filter(([field]) => !sameValue(definition[field], previousDefinition[field])).flatMap(([, attrs]) => attrs);
            const nativeKey = nativeKeys[name];
            for (const [key, value] of Object.entries(definition.native?.[nativeKey] || {})) if (value !== previousDefinition.native?.[nativeKey]?.[key]) changed.push(key);
            patchAttrs(previous, next, [...new Set(changed)]);
          }
          else replaceKnownChildren(old, entry, [name]);
        }
      }
    }
    if (!sameValue(doc.headerFooter, baseline.headerFooter) || doc.settings.pageNumbers !== baseline.settings?.pageNumbers) {
      let hf = firstChild(root, "headerandfooter"), next = firstChild(freshRoot, "headerandfooter");
      if (!hf) { replaceSection(root, freshRoot, "headerandfooter"); hf = firstChild(root, "headerandfooter"); }
      else {
        for (const [field, names] of Object.entries({ showHeader: ["HeaderVisible"], showFooter: ["FooterVisible"], showOnFirstPage: ["HeaderFirstPage", "FooterFirstPage"], startingPage: ["StartingPage"] })) {
          if (!sameValue(doc.headerFooter[field], baseline.headerFooter?.[field])) patchAttrs(hf, next, names);
        }
        for (const [name, fields] of [["Header", ["headerText", "headerLeft", "headerRight"]], ["Footer", ["footerText", "footerLeft", "footerRight"]]]) {
          if (!fields.some(field => !sameValue(doc.headerFooter[field], baseline.headerFooter?.[field]))) continue;
          const previousSection = firstChild(hf, name), nextSection = firstChild(next, name);
          if (!previousSection || !nextSection) { replaceKnownChildren(hf, next, [name]); continue; }
          const previousParagraphs = directChildren(previousSection, "paragraph");
          const updatedSection = source.importNode(nextSection, true);
          directChildren(updatedSection, "paragraph").forEach((paragraph, index) => {
            const original = previousParagraphs[index]; if (!original) return;
            const retained = source.importNode(original, true);
            for (const run of Array.from(paragraph.children)) {
              const native = firstChild(original, run.nodeName);
              if (native) for (const [key, value] of Object.entries(attributesOf(native))) run.setAttribute(key, value);
            }
            replaceKnownChildren(retained, paragraph, ["Text", "DynamicLabel"]);
            paragraph.replaceWith(retained);
          });
          replaceKnownChildren(previousSection, updatedSection, ["Paragraph"]);
        }
      }
      if (hf && doc.settings.pageNumbers !== baseline.settings?.pageNumbers && next) patchAttrs(hf, next, ["HeaderVisible"]);
    }
    if (!sameValue(doc.smartType, baseline.smartType)) {
      const target = firstChild(root, "smarttype"), next = firstChild(freshRoot, "smarttype");
      if (!target) replaceSection(root, freshRoot, "smarttype");
      else for (const list of Array.from(next?.children || [])) {
        const previous = firstChild(target, list.nodeName);
        if (previous) { previous.replaceChildren(...Array.from(list.childNodes).map(node => source.importNode(node, true))); }
        else target.appendChild(source.importNode(list, true));
      }
    }
    if (!sameValue(doc.moresContinueds, baseline.moresContinueds) || doc.settings.showMore !== baseline.settings?.showMore) {
      const target = firstChild(root, "moresandcontinueds"), next = firstChild(freshRoot, "moresandcontinueds");
      if (!target) replaceSection(root, freshRoot, "moresandcontinueds");
      else for (const name of ["DialogueBreaks", "SceneBreaks"]) {
        const old = firstChild(target, name), replacement = firstChild(next, name);
        if (old && replacement) patchAttrs(old, replacement, Object.keys(attributesOf(replacement)));
        else replaceKnownChildren(target, next, [name]);
      }
    }
    if (doc.settings.sceneNumbers !== baseline.settings?.sceneNumbers || doc.settings.sceneNumberSide !== baseline.settings?.sceneNumberSide) {
      const target = firstChild(root, "scenenumberoptions"), next = firstChild(freshRoot, "scenenumberoptions");
      if (target && next) patchAttrs(target, next, ["ShowNumbersOnLeft", "ShowNumbersOnRight"]);
      else replaceSection(root, freshRoot, "scenenumberoptions");
    }
    if (doc.settings.targetPages !== baseline.settings?.targetPages) {
      const target = firstChild(root, "targetscriptlength"), next = firstChild(freshRoot, "targetscriptlength");
      if (target && next) target.textContent = next.textContent;
      else if (next) root.appendChild(source.importNode(next, true));
    }
    for (const node of [...directChildren(root, AZKRIPT_TAG), ...directChildren(root, LEGACY_TAG)]) node.remove();
    const extras = firstChild(freshRoot, AZKRIPT_TAG);
    if (extras) root.appendChild(source.importNode(extras, true));
    const output = new XMLSerializer().serializeToString(source);
    return /^<\?xml/.test(output) ? output : `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${output}\n`;
  }

  function compatibility(doc) {
    const normalized = FDModel.normalizeDocument(doc);
    const source = normalized.sourceFDX;
    const preserved = (Array.isArray(source?.sections) ? source.sections : []).filter(name => !["content", "azkriptdata", "studiodata"].includes(name.toLowerCase()))
      .map(name => ({ name, label: name, detail: "Original XML is retained; unchanged native fields are preserved." }));
    const mapped = ["Screenplay paragraphs", "Element definitions and geometry", "Native text styles, font, size and colors", "Header and footer", "SmartType lists", "Dialogue continuations", "Revision sets", "Page layout", "Scene numbers", "Cast actor assignments", "Beat titles, text, colors and board positions", "Native production metadata fields"]
      .map(name => ({ name, label: name, detail: "Mapped to the editor and written to native FDX fields." }));
    const risks = [];
    if (source && (!source.baseline || !Array.isArray(source.paragraphs) || !Array.isArray(source.paragraphBindings))) risks.push({ code: "incomplete-source", severity: "warning", message: "Retained source metadata is incomplete. Reopen the source or explicitly export a clean copy before saving." });
    for (const [name, spec] of Object.entries(normalized.elements)) if (spec.approximate) risks.push({ code: "missing-element-definition", severity: "warning", message: `${name} has no source element definition; its original type is retained with approximate display geometry.` });
    const displayStyles = new Set(["Bold", "Italic", "Underline", "Strikethrough", "AllCaps", "Superscript", "Subscript"]);
    const otherStyles = new Set(normalized.paragraphs.flatMap(p => htmlToRuns(p.html).flatMap(run => String(run.style || "").split("+").filter(style => style && !displayStyles.has(style)))));
    if (otherStyles.size) risks.push({ code: "native-style-preview", severity: "info", message: `Native styles ${[...otherStyles].join(", ")} are retained, but their display is not fully modeled.` });
    const nativeOnlyFields = ["lockedPages", "watermark"];
    for (const field of nativeOnlyFields) {
      if (source && !sameValue(normalized[field], source.baseline?.[field])) risks.push({ code: "app-metadata-change", severity: "warning", message: `${field} edits are saved in AzkriptData; the retained vendor section is not rewritten from an inferred schema.` });
    }
    const privateCast = value => Object.fromEntries(Object.entries(value || {}).map(([name, cast]) => [name, { notes: cast.notes || "", voiceURI: cast.voiceURI || "", color: cast.color || "" }]));
    const privateBeats = value => (value || []).map(beat => ({ id: beat.id, category: beat.category, targetId: beat.targetId, connectorStyle: beat.connectorStyle, image: beat.image }));
    if (source && !sameValue(privateCast(normalized.cast), privateCast(source.baseline?.cast))) risks.push({ code: "app-cast-annotations", severity: "warning", message: "Cast notes, speech-provider voice choices and workspace colors remain Azkript annotations. Actor assignments are written natively." });
    if (source && !sameValue(privateBeats(normalized.beats), privateBeats(source.baseline?.beats))) risks.push({ code: "app-beat-annotations", severity: "warning", message: "App-specific beat categories, script links, connectors and images remain Azkript annotations. Native beat text and layout are written to the source graph." });
    if (source) {
      const remaining = new Set(normalized.paragraphs.map(p => p.id));
      if ((Array.isArray(source.paragraphs) ? source.paragraphs : []).some(p => !remaining.has(p.id)) && (source.sections || []).some(name => /tagdata|lockedpages|displayboards|writer/i.test(name))) {
        risks.push({ code: "retained-references", severity: "warning", message: "Deleted paragraphs may still be referenced by retained production metadata. Save a copy and review in the originating editor." });
      }
    }
    risks.push({ code: "vendor-runtime-unverified", severity: "info", message: "Final Draft application open/save behavior and matching pagination need a trusted vendor-runtime check." });
    return { mode: source ? "preserve-source" : "new-document", documentId: normalized.documentId,
      sourceFingerprint: normalized.sourceFingerprint, formatVersion: normalized.formatVersion,
      summary: source ? "Original FDX XML is retained; edits patch the modeled fields." : "New FDX with native screenplay fields and an app-only metadata section.",
      preserved, mapped, risks, recommendSaveCopy: risks.some(risk => risk.severity === "warning"), vendorVerified: false };
  }

  // These field names and relationships are observed in the shipped FDXT
  // tutorial corpus. Unknown fields are never reconstructed or discarded.
  const METADATA_SECTIONS = {
    Cast: "Cast assignments", Actors: "Voice actors", CastList: "Cast list", Characters: "Character traits",
    CharacterHighlighting: "Character highlighting", TagData: "Production tags", ListItems: "Beat text",
    DisplayBoards: "Board layout", LockedPages: "Locked pages", Watermarking: "Watermark",
  };
  const METADATA_ATTRIBUTES = {
    Member: ["Character", "Actor"], Narrator: ["Actor"], Actor: ["Name", "MacVoice", "WinVoice", "Pitch", "Speed"],
    CastList: ["SortOption"], Character: ["Name", "Color", "Visible"],
    TagCategory: ["Name", "Color", "Style"], TagDefinition: ["Label", "CatId"],
    ListItem: ["Title", "Color"], Item: ["Left", "Top", "Width", "Height", "Visible"],
    DisplayBoard: ["Width", "Height", "ZoomLevel", "ScrollOrigin"], Lane: ["Label", "Level"],
    SubordinateTo: ["Number", "Length", "Order", "Level"],
    LockedPage: ["PageNumber", "Number", "Position", "Deleted", "LockLevel", "LevelIndex"],
    Text: ["Font", "Size", "Style", "Color", "Background"],
    Paragraph: ["Alignment", "LeftIndent", "RightIndent", "FirstIndent", "SpaceBefore", "Spacing", "Leading"],
  };
  const METADATA_TEXT = new Set(["Text", "DefId", "LinkedTo", "Notes", "Description"]);
  const METADATA_ROWS = new Set(["Member", "Actor", "ListItem", "TagCategory", "TagDefinition", "Tag", "LockedPage"]);
  const metadataSectionNodes = root => Array.from(root.children).filter(node => Object.hasOwn(METADATA_SECTIONS, node.nodeName));
  const metadataString = root => metadataSectionNodes(root).map(node => new XMLSerializer().serializeToString(node)).join("");

  function metadataErrors(root) {
    const errors = [];
    const all = Array.from(root.getElementsByTagName("*"));
    const nodes = name => all.filter(node => node.nodeName === name);
    const unique = (name, attr) => {
      const seen = new Set();
      for (const node of nodes(name)) {
        const value = node.getAttribute(attr);
        if (value && seen.has(value)) errors.push(`Duplicate ${name} ${attr}: ${value}`);
        seen.add(value);
      }
      return seen;
    };
    const categories = unique("TagCategory", "Id"), definitions = unique("TagDefinition", "Id"), tags = unique("Tag", "Number");
    const beats = unique("ListItem", "Id"), actors = unique("Actor", "Name");
    unique("Member", "Character"); unique("LockedPage", "PageNumber"); unique("LockedPage", "LevelIndex");
    for (const node of nodes("TagDefinition")) if (node.hasAttribute("CatId") && !categories.has(node.getAttribute("CatId"))) errors.push(`TagDefinition ${node.getAttribute("Id")} refers to missing category ${node.getAttribute("CatId")}`);
    for (const name of ["DefId", "LinkedTo"]) for (const node of nodes(name)) if (!definitions.has(node.textContent.trim())) errors.push(`${name} refers to missing tag definition ${node.textContent.trim()}`);
    for (const board of nodes("DisplayBoard").filter(node => node.getAttribute("Type") === "Beat")) for (const node of directChildren(board, "item")) if (!beats.has(node.getAttribute("Id"))) errors.push(`Board item refers to missing beat ${node.getAttribute("Id")}`);
    for (const name of ["Member", "Narrator"]) for (const node of nodes(name)) if (node.getAttribute("Actor") && !actors.has(node.getAttribute("Actor"))) errors.push(`Cast ${name} ${node.getAttribute("Character") || ""} refers to missing actor ${node.getAttribute("Actor")}`);
    for (const node of nodes("Text")) if (node.hasAttribute("TagNumber") && !tags.has(node.getAttribute("TagNumber"))) errors.push(`Text refers to missing tag number ${node.getAttribute("TagNumber")}`);
    for (const node of nodes("LockedPage")) {
      for (const name of ["Position", "LevelIndex", "LockLevel"]) if (node.hasAttribute(name) && (!/^\d+$/.test(node.getAttribute(name)))) errors.push(`LockedPage ${node.getAttribute("PageNumber")} has invalid ${name}`);
      if (node.hasAttribute("ParagraphId") && !nodes("Paragraph").some(p => p.getAttribute("id") === node.getAttribute("ParagraphId"))) errors.push(`LockedPage refers to missing paragraph ${node.getAttribute("ParagraphId")}`);
    }
    return errors;
  }

  function ensureNativeSection(root, name) {
    let node = firstChild(root, name);
    if (!node) { node = root.ownerDocument.createElement(name); root.appendChild(node); }
    return node;
  }

  function removedReferenceErrors(before, after) {
    const identities = root => Array.from(root.getElementsByTagName("*")).filter(node => ["TagCategory", "TagDefinition", "ListItem", "Actor", "Paragraph"].includes(node.nodeName)).map(node => [node.nodeName, node.getAttribute(node.nodeName === "Actor" ? "Name" : node.nodeName === "Paragraph" ? "id" : "Id")]).filter(([, id]) => id);
    const remaining = new Set(identities(after).map(([name, id]) => `${name}:${id}`));
    const removed = identities(before).filter(([name, id]) => !remaining.has(`${name}:${id}`));
    const nodes = Array.from(after.getElementsByTagName("*"));
    return removed.flatMap(([name, id]) => nodes.some(node => Array.from(node.attributes).some(a => a.value === id) || (!node.children.length && node.textContent.trim() === id)) ? [`Removed ${name} ${id} is still referenced by native metadata`] : []);
  }

  function patchProductionModels(root, doc) {
    const baseline = doc.sourceFDX?.baseline || {};
    const xml = root.ownerDocument;
    const sourceCast = nativeCast(root);
    if (!sameValue(doc.cast, baseline.cast || {}) || Object.entries(doc.cast).some(([name, value]) => !sourceCast[name] && value.actor)) {
      const cast = ensureNativeSection(root, "Cast"), actors = ensureNativeSection(root, "Actors");
      const members = directChildren(cast, "member");
      const oldMembers = new Map(members.map(node => [nativeCharacterKey(node.getAttribute("Character")), node]));
      for (const [name, value] of Object.entries(doc.cast)) {
        const previous = baseline.cast?.[name];
        let member = oldMembers.get(name);
        if (sourceCast[name]?.actor === value.actor) continue;
        if (members.filter(node => nativeCharacterKey(node.getAttribute("Character")) === name).length > 1) throw new Error(`Multiple native cast entries match ${name}. Use the native metadata editor to change the individual assignment.`);
        if (member && previous && value.actor === previous.actor) continue;
        if (!member) { member = xml.createElement("Member"); member.setAttribute("Character", name); cast.appendChild(member); }
        member.setAttribute("Actor", value.actor || "");
        if (value.actor && !directChildren(actors, "actor").some(node => node.getAttribute("Name") === value.actor)) {
          const actor = xml.createElement("Actor");
          for (const [key, val] of Object.entries({ Name: value.actor, MacVoice: "", WinVoice: "", Pitch: "Normal", Speed: "Medium" })) actor.setAttribute(key, val);
          actors.appendChild(actor);
        }
      }
      for (const [name, node] of oldMembers) if (!Object.hasOwn(doc.cast, name) && Object.hasOwn(baseline.cast || {}, name)) node.remove();
    }
    const nativeBeatIds = new Set(directChildren(firstChild(root, "listitems"), "listitem").map(n => n.getAttribute("Id")));
    if (!sameValue(doc.beats, baseline.beats || []) || doc.beats.some(beat => !nativeBeatIds.has(beat.id) && !nativeBeatIds.has(FDModel.toUuid(beat.id)))) {
      const list = ensureNativeSection(root, "ListItems"), boards = ensureNativeSection(root, "DisplayBoards");
      let board = directChildren(boards, "displayboard").find(node => node.getAttribute("Type") === "Beat");
      if (!board && doc.beats.length) {
        board = xml.createElement("DisplayBoard");
        for (const [key, value] of Object.entries({ Id: derivedNativeId(`${doc.documentId}:beat-board`), Type: "Beat", Height: "10000", Width: "24000", ZoomLevel: "100.000", ScrollOrigin: "0,0" })) board.setAttribute(key, value);
        boards.appendChild(board);
      }
      const original = new Map(directChildren(list, "listitem").filter(n => n.getAttribute("Type") === "Beat").map(node => [node.getAttribute("Id"), node]));
      const previous = new Map((baseline.beats || []).map(beat => [beat.id, beat]));
      for (const beat of doc.beats) {
        const old = previous.get(beat.id);
        let node = original.get(beat.id) || original.get(FDModel.toUuid(beat.id));
        if (node && old && sameValue(beat, old)) continue;
        const creating = !node;
        if (!node) { node = xml.createElement("ListItem"); node.setAttribute("Id", FDModel.toUuid(beat.id)); node.setAttribute("Type", "Beat"); list.appendChild(node); }
        if (creating || !old || beat.title !== old.title) node.setAttribute("Title", beat.title);
        if (creating || !old || beat.color !== old.color) node.setAttribute("Color", fdxColor(beat.color));
        const currentBody = directChildren(firstChild(node, "content"), "paragraph").map(p => directChildren(p, "text").map(t => t.textContent).join("")).join("\n");
        if ((creating || !old || beat.body !== old.body) && currentBody !== String(beat.body || "")) {
          const content = ensureNativeSection(node, "Content");
          const oldParagraphs = directChildren(content, "paragraph");
          const fragment = xml.createElement("Content");
          for (const [index, line] of String(beat.body || "").split("\n").entries()) {
            const oldParagraph = oldParagraphs[index], oldText = firstChild(oldParagraph, "text");
            const p = oldParagraph ? oldParagraph.cloneNode(true) : xml.createElement("Paragraph");
            const text = oldText ? oldText.cloneNode(false) : xml.createElement("Text");
            const known = xml.createElement("Paragraph"); text.textContent = line; known.appendChild(text);
            replaceKnownChildren(p, known, ["Text", "DynamicLabel"]); fragment.appendChild(p);
          }
          replaceKnownChildren(content, fragment, ["Paragraph"]);
        }
        let item = board && directChildren(board, "item").find(n => n.getAttribute("Id") === node.getAttribute("Id"));
        if (!item && board) { item = xml.createElement("Item"); item.setAttribute("Id", node.getAttribute("Id")); item.setAttribute("Height", "160"); board.appendChild(item); }
        if (item) for (const [field, native] of [["x", "Left"], ["y", "Top"], ["width", "Width"]]) if (creating || !old || beat[field] !== old[field]) item.setAttribute(native, String(beat[field]));
        if (old && beat.goalPage !== old.goalPage) {
          const goal = firstChild(node, "subordinateto");
          if (goal?.getAttribute("Type") === "PageGoal") goal.setAttribute("Number", String(beat.goalPage));
        }
        if (creating && beat.goalPage) {
          const goal = xml.createElement("SubordinateTo");
          for (const [key, value] of Object.entries({ Type: "PageGoal", Number: String(beat.goalPage), Length: "1.000", Level: "Outline 3", Order: "0" })) goal.setAttribute(key, value);
          node.insertBefore(goal, node.firstChild);
        }
      }
      const remaining = new Set(doc.beats.flatMap(b => [b.id, FDModel.toUuid(b.id)]));
      const oldIds = new Set((baseline.beats || []).flatMap(b => [b.id, FDModel.toUuid(b.id)]));
      for (const [id, node] of original) if (oldIds.has(id) && !remaining.has(id)) {
        node.remove();
        for (const b of directChildren(boards, "displayboard")) for (const item of directChildren(b, "item")) if (item.getAttribute("Id") === id) item.remove();
      }
    }
    if (!sameValue(doc.characterHighlights, baseline.characterHighlights || {}) || !sameValue(doc.characterHighlights, nativeHighlights(root))) {
      const section = ensureNativeSection(root, "CharacterHighlighting");
      for (const entry of directChildren(section, "character")) if (!Object.hasOwn(doc.characterHighlights, entry.getAttribute("Name"))) entry.setAttribute("Visible", "No");
      for (const [name, color] of Object.entries(doc.characterHighlights)) {
        let entry = directChildren(section, "character").find(n => n.getAttribute("Name") === name);
        if (!entry) { entry = xml.createElement("Character"); entry.setAttribute("Name", name); section.appendChild(entry); }
        entry.setAttribute("Color", fdxColor(color)); entry.setAttribute("Visible", "Yes");
      }
    }
    const oldParagraphs = new Map((doc.sourceFDX?.paragraphs || []).map(p => [p.id, p]));
    const nativeParagraphs = new Map(flatBody(firstChild(root, "content")).map(node => [node.getAttribute("id"), node]));
    for (const p of doc.paragraphs) {
      const before = oldParagraphs.get(p.id)?.tags || [], after = p.tags || [];
      const paragraph = nativeParagraphs.get(p.id) || nativeParagraphs.get(FDModel.toUuid(p.id));
      if (!paragraph) continue;
      const existing = paragraphNativeTags(paragraph, nativeTagDefinitions(root));
      const isAttached = tag => existing.some(e => FDModel.toUuid(e.id) === FDModel.toUuid(tag.id));
      if (sameValue(before, after) && after.every(isAttached)) continue;
      const data = ensureNativeSection(root, "TagData"), categories = ensureNativeSection(data, "TagCategories"), definitions = ensureNativeSection(data, "TagDefinitions"), tags = ensureNativeSection(data, "Tags");
      const canonical = tag => FDModel.toUuid(tag.id);
      const removed = new Set(before.filter(tag => !after.some(a => canonical(a) === canonical(tag))).flatMap(tag => [tag.id, canonical(tag)]));
      const added = after.filter(tag => !before.some(b => canonical(b) === canonical(tag)) || !isAttached(tag));
      for (const tag of after) {
        const standard = FDModel.TAG_CATEGORIES.find(c => c.id === tag.category);
        const categoryName = standard?.label || tag.category || "Props";
        let category = directChildren(categories, "tagcategory").find(n => n.getAttribute("Name").replace(/[\s/]/g, "").toLowerCase() === categoryName.replace(/[\s/]/g, "").toLowerCase());
        if (!category) {
          category = xml.createElement("TagCategory");
          const number = Math.max(0, ...directChildren(categories, "tagcategory").map(n => Number(n.getAttribute("Number")) || 0)) + 1;
          for (const [key, value] of Object.entries({ Id: derivedNativeId(`${doc.documentId}:category:${categoryName}`), Name: categoryName, Number: String(number), Color: fdxColor(tag.color || standard?.color), Style: "Bold" })) category.setAttribute(key, value);
          categories.appendChild(category);
        }
        let definition = directChildren(definitions, "tagdefinition").find(n => n.getAttribute("Id") === tag.id || n.getAttribute("Id") === canonical(tag));
        if (!definition) {
          definition = xml.createElement("TagDefinition"); definition.setAttribute("Id", canonical(tag));
          definition.setAttribute("Number", String(Math.max(0, ...directChildren(definitions, "tagdefinition").map(n => Number(n.getAttribute("Number")) || 0)) + 1));
          definitions.appendChild(definition);
        }
        definition.setAttribute("Label", tag.label); definition.setAttribute("CatId", category.getAttribute("Id"));
      }
      const graph = nativeTagDefinitions(root);
      const defsFor = tag => directChildren(definitions, "tagdefinition").find(n => n.getAttribute("Id") === tag.id || n.getAttribute("Id") === canonical(tag))?.getAttribute("Id");
      for (const run of directChildren(paragraph, "text")) {
        const previous = graph.tags.get(run.getAttribute("TagNumber")) || [];
        const next = [...new Set([...previous.filter(id => !removed.has(id)), ...added.map(defsFor).filter(Boolean)])];
        if (sameValue(previous, next)) continue;
        if (!next.length) { run.removeAttribute("TagNumber"); continue; }
        let entry = directChildren(tags, "tag").find(n => sameValue(directChildren(n, "defid").map(d => d.textContent.trim()).sort(), [...next].sort()));
        if (!entry) {
          entry = xml.createElement("Tag"); entry.setAttribute("Number", String(Math.max(0, ...directChildren(tags, "tag").map(n => Number(n.getAttribute("Number")) || 0)) + 1));
          for (const id of next) { const def = xml.createElement("DefId"); def.textContent = id; entry.appendChild(def); }
          tags.appendChild(entry);
        }
        run.setAttribute("TagNumber", entry.getAttribute("Number"));
      }
    }
  }

  function applyProductionMetadata(root, doc) {
    for (const entry of doc.nativeMetadata || []) {
      if (!Object.hasOwn(METADATA_SECTIONS, entry.name)) throw new Error(`Unsupported native metadata section: ${entry.name}`);
      const parsed = new DOMParser().parseFromString(entry.xml, "application/xml");
      if (parsed.getElementsByTagName("parsererror").length || parsed.documentElement.nodeName !== entry.name) throw new Error(`Invalid ${entry.name} metadata. Save was stopped.`);
      const old = firstChild(root, entry.name), replacement = root.ownerDocument.importNode(parsed.documentElement, true);
      if (old) old.replaceWith(replacement); else root.appendChild(replacement);
    }
    patchProductionModels(root, doc);
  }

  function nativeMetadata(doc) {
    const xml = new DOMParser().parseFromString(serialize(doc), "application/xml"), root = xml.documentElement;
    const describe = (node, path) => ({ path, name: node.nodeName,
      label: node.getAttribute("Title") || node.getAttribute("Label") || node.getAttribute("Character") || node.getAttribute("Name") || node.getAttribute("PageNumber") || node.getAttribute("Id") || node.nodeName,
      attributes: Array.from(node.attributes).map(a => ({ name: a.name, value: a.value, editable: (METADATA_ATTRIBUTES[node.nodeName] || []).includes(a.name) })),
      text: node.children.length ? null : node.textContent,
      editableText: !node.children.length && METADATA_TEXT.has(node.nodeName),
      canDuplicate: METADATA_ROWS.has(node.nodeName), canDelete: METADATA_ROWS.has(node.nodeName),
      actions: METADATA_ROWS.has(node.nodeName) ? ["duplicate", "delete"] : [],
      children: Array.from(node.children).map((child, index) => describe(child, [...path, index])) });
    return { signature: FDModel.hash32(metadataString(root)), sections: metadataSectionNodes(root).map(node => ({ name: node.nodeName, label: METADATA_SECTIONS[node.nodeName], nodes: [describe(node, [])] })), warnings: metadataErrors(root) };
  }

  function updateNativeMetadata(doc, request) {
    const normalized = FDModel.normalizeDocument(doc), source = serialize(normalized);
    const xml = new DOMParser().parseFromString(source, "application/xml"), root = xml.documentElement;
    if (!request || request.signature !== FDModel.hash32(metadataString(root))) throw new Error("Native metadata changed while this editor was open. Reopen it before applying changes.");
    if (!Array.isArray(request.edits) || request.edits.length > 1000) throw new Error("Invalid metadata edit batch.");
    const previousErrors = new Set(metadataErrors(root));
    // Resolve all paths before structural changes so a batch cannot silently
    // edit the wrong sibling after a delete or duplicate.
    const resolved = request.edits.map(edit => {
      if (!Object.hasOwn(METADATA_SECTIONS, edit.section) || !Array.isArray(edit.path)) throw new Error("Invalid metadata section or path.");
      if (directChildren(root, edit.section).length !== 1) throw new Error("This source has ambiguous duplicate native sections; edit it in the originating editor.");
      let node = firstChild(root, edit.section);
      for (const index of edit.path) {
        if (!Number.isInteger(index) || index < 0) throw new Error("Invalid metadata node path.");
        node = node?.children[index];
      }
      if (!node) throw new Error("The native metadata field no longer exists.");
      return { edit, node };
    });
    for (const { edit, node } of resolved) {
      if (edit.action === "delete" || edit.action === "duplicate") {
        if (!METADATA_ROWS.has(node.nodeName)) throw new Error("This native structure cannot be added or removed safely.");
        if (edit.action === "delete") {
          if (node.nodeName === "ListItem") for (const board of Array.from(root.getElementsByTagName("DisplayBoard"))) for (const item of directChildren(board, "item")) if (item.getAttribute("Id") === node.getAttribute("Id")) item.remove();
          node.remove(); continue;
        }
        const copy = node.cloneNode(true);
        const id = copy.getAttribute("Id");
        if (id) copy.setAttribute("Id", FDModel.toUuid(FDModel.uid("native")));
        for (const child of Array.from(copy.getElementsByTagName("*"))) {
          if (child.nodeName === "Paragraph" && child.hasAttribute("id")) child.setAttribute("id", FDModel.toUuid(FDModel.uid("native-paragraph")));
          else if (child.hasAttribute("Id") || child.hasAttribute("id")) throw new Error("This row contains an unfamiliar nested identity graph and cannot be duplicated safely.");
        }
        if (["TagCategory", "TagDefinition", "Tag"].includes(copy.nodeName) && copy.hasAttribute("Number")) copy.setAttribute("Number", String(Math.max(0, ...Array.from(root.getElementsByTagName(copy.nodeName)).map(n => Number(n.getAttribute("Number")) || 0)) + 1));
        if (copy.nodeName === "Actor") copy.setAttribute("Name", `${copy.getAttribute("Name")} Copy ${FDModel.uid("actor").slice(-5)}`);
        if (copy.nodeName === "Member") copy.setAttribute("Character", `${copy.getAttribute("Character")} COPY ${FDModel.uid("cast").slice(-5)}`);
        if (copy.nodeName === "LockedPage") {
          const names = new Set(Array.from(root.getElementsByTagName("LockedPage")).map(n => n.getAttribute("PageNumber")));
          let name = `${copy.getAttribute("PageNumber") || "1"}A`;
          while (names.has(name)) name += "A";
          copy.setAttribute("PageNumber", name);
          if (copy.hasAttribute("LevelIndex")) copy.setAttribute("LevelIndex", String(Math.max(0, ...Array.from(root.getElementsByTagName("LockedPage")).map(n => Number(n.getAttribute("LevelIndex")) || 0)) + 1));
        }
        node.parentNode.insertBefore(copy, node.nextSibling);
        if (copy.nodeName === "ListItem") for (const board of Array.from(root.getElementsByTagName("DisplayBoard"))) {
          const item = directChildren(board, "item").find(n => n.getAttribute("Id") === id);
          if (item) {
            if (Array.from(item.getElementsByTagName("*")).some(child => child.hasAttribute("Id") || child.hasAttribute("id"))) throw new Error("This board placement contains an unfamiliar nested identity graph and cannot be duplicated safely.");
            const view = item.cloneNode(true); view.setAttribute("Id", copy.getAttribute("Id")); view.setAttribute("Left", String((Number(view.getAttribute("Left")) || 0) + 24)); board.appendChild(view);
          }
        }
        continue;
      }
      if (Object.hasOwn(edit, "attribute")) {
        if (!(METADATA_ATTRIBUTES[node.nodeName] || []).includes(edit.attribute)) throw new Error(`The native identity or unsupported field ${edit.attribute} is read-only.`);
        const value = String(edit.value == null ? "" : edit.value);
        if (value.length > 100000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error("Invalid native field value.");
        if (["Color", "Background"].includes(edit.attribute) && !parseColor(value)) throw new Error(`${edit.attribute} must be a six- or twelve-digit hexadecimal color.`);
        if (edit.attribute === "Visible" && !["Yes", "No"].includes(value)) throw new Error("Visibility must be Yes or No.");
        if (edit.attribute === "Deleted" && !["0", "1"].includes(value)) throw new Error("Deleted must be 0 or 1.");
        if (edit.attribute === "PageNumber" && !value.trim()) throw new Error("A locked page number cannot be empty.");
        if (["LeftIndent", "RightIndent", "FirstIndent", "SpaceBefore", "Spacing"].includes(edit.attribute) && (!value.trim() || !Number.isFinite(Number(value)) || (edit.attribute === "Spacing" && Number(value) <= 0))) throw new Error(`${edit.attribute} must be a valid numeric value.`);
        if (edit.attribute === "Number" && node.nodeName === "SubordinateTo" && node.getAttribute("Type") === "PageGoal" && (!value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0)) throw new Error("The native page goal must be a non-negative number.");
        if (["Left", "Top", "Width", "Height", "ZoomLevel", "Position", "LockLevel", "LevelIndex", "Size", "Length", "Order"].includes(edit.attribute) && (!value.trim() || !Number.isFinite(Number(value)) || (!["Left", "Top"].includes(edit.attribute) && Number(value) < 0))) throw new Error(`${edit.attribute} must be a valid number in its supported range.`);
        if (["Width", "Height", "ZoomLevel", "Size"].includes(edit.attribute) && Number(value) <= 0) throw new Error(`${edit.attribute} must be greater than zero.`);
        node.setAttribute(edit.attribute, ["Color", "Background"].includes(edit.attribute) && /^#[0-9a-f]{6}$/i.test(value) ? fdxColor(value) : value);
      } else if (Object.hasOwn(edit, "text")) {
        if (node.children.length || !METADATA_TEXT.has(node.nodeName)) throw new Error("Only supported native text leaves can be edited.");
        const value = String(edit.text);
        if (value.length > 100000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error("Invalid native text value.");
        node.textContent = value;
      } else throw new Error("Invalid native metadata edit.");
    }
    const before = new DOMParser().parseFromString(source, "application/xml");
    const errors = [...metadataErrors(root).filter(error => !previousErrors.has(error)), ...removedReferenceErrors(before.documentElement, root)];
    if (errors.length) throw new Error(`Native metadata references would be invalid: ${errors.slice(0, 5).join("; ")}`);
    normalized.nativeMetadata = metadataSectionNodes(root).map(node => ({ name: node.nodeName, xml: new XMLSerializer().serializeToString(node) }));
    // Synchronize the regular cast and beat tools with native edits. Retain
    // private-only annotations while taking native mapped fields from XML.
    const cast = nativeCast(root);
    normalized.cast = Object.fromEntries(Object.entries(cast).map(([name, value]) => [name, { ...normalized.cast[name], ...value }]));
    const beats = new Map(normalized.beats.map(beat => [beat.id, beat]));
    normalized.beats = nativeBeats(root).map(beat => ({ ...beats.get(beat.id), ...beat }));
    normalized.characterHighlights = nativeHighlights(root);
    const graph = nativeTagDefinitions(root);
    const byId = new Map(flatBody(firstChild(root, "content")).map(node => [node.getAttribute("id"), node]));
    for (const p of normalized.paragraphs) {
      const node = byId.get(p.id) || byId.get(FDModel.toUuid(p.id));
      if (node) p.tags = paragraphNativeTags(node, graph);
    }
    return FDModel.normalizeDocument(normalized);
  }

  function serialize(doc, options = {}) {
    const normalized = FDModel.normalizeDocument(doc);
    if(Object.keys(normalized.production?.sceneNumbers||{}).length){
      for(const scene of FDModel.getScenes(normalized)){
        if (!scene.paragraph.scene?.number) {
          normalized.production.sceneNumbers[FDModel.toUuid(scene.id)] ||= scene.number;
        }
      }
    }
    const generated = appendNativeGeneratedSections(serializeGenerated(normalized, options), normalized);
    const output = normalized.sourceFDX ? patchSourceDocument(normalized, generated, options) : generated;
    if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") return output;
    const xml = new DOMParser().parseFromString(output, "application/xml");
    if (xml.getElementsByTagName("parsererror").length) throw new Error("The generated FDX is not valid XML. Save was stopped before changing the file.");
    const previous = xml.documentElement.cloneNode(true), previousErrors = new Set(metadataErrors(previous));
    applyProductionMetadata(xml.documentElement, normalized);
    const newErrors = [...metadataErrors(xml.documentElement).filter(error => !previousErrors.has(error)), ...removedReferenceErrors(previous, xml.documentElement)];
    if (newErrors.length) throw new Error(`Save stopped because native metadata references would be invalid: ${newErrors.slice(0, 5).join("; ")}`);
    const extra = firstChild(xml.documentElement, AZKRIPT_TAG);
    if (extra) {
      const payload = JSON.parse(extra.textContent);
      const serializer = new XMLSerializer();
      payload.nativeSignatures = nativeFieldSignatures(xml.documentElement);
      extra.textContent = JSON.stringify(payload);
      const serialized = serializer.serializeToString(xml);
      return /^<\?xml/.test(serialized) ? serialized : `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${serialized}\n`;
    }
    return output;
  }

  function download(filename, contents, mime) {
    const blob = new Blob([contents], { type: mime || "application/xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return {
    FDX_VERSION,
    escapeXml,
    parseColor,
    fdxColor,
    htmlToRuns,
    runsToHtml,
    parse,
    serialize,
    compatibility,
    nativeMetadata,
    updateNativeMetadata,
    download,
  };
});
