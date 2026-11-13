/* Azkript — monospaced screenplay pagination.
 *
 * The vendor page engine is not public. This is an independent approximation
 * built from the recovered screenplay geometry: Courier at 12 pt has a 0.6 em
 * advance, so a six-inch action column is 60 characters and a 3.5-inch
 * dialogue column is 35. Lines are wrapped at word boundaries, pages break on
 * a 12-point grid, scene headings and cues are kept with what follows, and
 * dialogue is continued with (MORE)/(CONT'D).
 *
 * The layout is deterministic and DOM-free so it can be tested in Node and
 * used unchanged for screen preview, print, and PDF.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./model.js"), require("./fdx.js"));
  } else {
    root.FDPagination = factory(root.FDModel, root.FDX);
  }
})(typeof self !== "undefined" ? self : this, function (FDModel, FDX) {
  "use strict";

  const DEFAULTS = {
    fontSize: 12,
    lineHeight: 12,
    charWidthRatio: 0.6,
    maxPages: 500,
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function plainText(html) {
    return (FDX.htmlToRuns(html) || []).map((run) => run.text).join("");
  }

  function sliceHtml(html, start, end) {
    const runs = FDX.htmlToRuns(html);
    if (!runs.length) return "";
    const text = runs.map((run) => run.text).join("");
    const from = clamp(Number(start) || 0, 0, text.length);
    const to = clamp(Number(end) || text.length, from, text.length);
    if (from === 0 && to >= text.length) return html;
    const output = [];
    let cursor = 0;
    for (const run of runs) {
      const runStart = cursor;
      const runEnd = cursor + run.text.length;
      cursor = runEnd;
      if (runEnd <= from || runStart >= to) continue;
      const part = run.text.slice(Math.max(from, runStart) - runStart, Math.min(to, runEnd) - runStart);
      if (!part) continue;
      output.push({ ...run, text: part });
    }
    return FDX.runsToHtml(output);
  }

  /** Greedy word wrap that preserves the original character offsets. */
  function wrapText(text, maxChars) {
    const source = String(text == null ? "" : text);
    const limit = Math.max(4, Math.floor(maxChars) || 60);
    const lines = [];
    let offset = 0;
    const hardLines = source.split("\n");
    for (let hardIndex = 0; hardIndex < hardLines.length; hardIndex += 1) {
      const segment = hardLines[hardIndex];
      const segmentStart = offset;
      if (!segment) {
        lines.push({ start: offset, end: offset, text: "" });
      } else {
        const words = [];
        const re = /\S+/g;
        let match;
        while ((match = re.exec(segment))) {
          words.push({
            start: segmentStart + match.index,
            end: segmentStart + match.index + match[0].length,
            text: match[0],
          });
        }
        if (!words.length) {
          lines.push({ start: offset, end: offset, text: "" });
        } else {
          let lineStart = words[0].start;
          let lineEnd = words[0].end;
          for (let index = 0; index < words.length; index += 1) {
            const word = words[index];
            if (index === 0) continue;
            if (word.end - lineStart <= limit) {
              lineEnd = word.end;
            } else {
              lines.push({
                start: lineStart,
                end: lineEnd,
                text: source.slice(lineStart, lineEnd),
              });
              lineStart = word.start;
              lineEnd = word.end;
            }
          }
          lines.push({
            start: lineStart,
            end: lineEnd,
            text: source.slice(lineStart, lineEnd),
          });
        }
      }
      offset += segment.length;
      if (hardIndex < hardLines.length - 1) offset += 1;
    }
    return lines;
  }

  function wrapMeasured(text, maxWidth, measureText, firstIndent = 0) {
    const source = String(text == null ? "" : text), lines = [];
    let offset = 0;
    const push = (start, end) => lines.push({ start, end, text: source.slice(start, end) });
    const limit = () => Math.max(1, maxWidth - (lines.length === 0 ? firstIndent : 0));
    for (const segment of source.split("\n")) {
      const words = Array.from(segment.matchAll(/\S+/gu), match => ({ start: offset + match.index, end: offset + match.index + match[0].length }));
      let start = null, end = null;
      const flush = () => { if (start !== null) push(start, end); start = end = null; };
      for (const word of words) {
        if (start !== null && measureText(source.slice(start, word.end), start, word.end) <= limit() + 0.01) { end = word.end; continue; }
        flush();
        let cursor = word.start;
        let boundaries = null, boundaryStart = 0;
        while (cursor < word.end && measureText(source.slice(cursor, word.end), cursor, word.end) > limit() + 0.01) {
          if (!boundaries) {
            const wordText = source.slice(word.start, word.end);
            boundaries = typeof Intl !== 'undefined' && Intl.Segmenter
              ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(wordText), s => word.start + s.index).slice(1).concat(word.end)
              : Array.from(wordText).reduce((result, point) => { result.push((result[result.length - 1] || word.start) + point.length); return result; }, []);
          }
          let low = boundaryStart, high = boundaries.length - 1, best = boundaryStart;
          while (low <= high) {
            const mid = (low + high) >> 1;
            if (measureText(source.slice(cursor, boundaries[mid]), cursor, boundaries[mid]) <= limit() + 0.01) { best = mid; low = mid + 1; }
            else high = mid - 1;
          }
          const stop = boundaries[best];
          push(cursor, stop); cursor = stop; boundaryStart = best + 1;
        }
        if (cursor < word.end) { start = cursor; end = word.end; }
      }
      flush();
      if (!words.length) push(offset, offset);
      offset += segment.length + 1;
    }
    return lines;
  }

  function specFor(type, options) {
    return FDModel.elementSpec(type, options && options.document);
  }

  function fontFor(type, options) {
    const spec = specFor(type, options);
    const useDocument = options.useDocumentTypography !== false;
    return { font: useDocument && spec.font ? spec.font : options.fontFamily || 'Courier New',
      size: useDocument && Number(spec.fontSize) > 0 ? Number(spec.fontSize) : options.fontSize,
      style: [/Bold/i.test(spec.style || '') ? 'bold' : '', /Italic/i.test(spec.style || '') ? 'italic' : ''].filter(Boolean).join(' ') };
  }

  function charsFor(type, options) {
    const spec = specFor(type, options);
    const width = options.columnWidthPoints ? options.columnWidthPoints / 72 : Math.max(0.6, Number(spec.right) - Number(spec.left));
    const charWidth = fontFor(type, options).size * options.charWidthRatio;
    return Math.max(8, Math.floor((width * 72) / charWidth));
  }

  function linesFor(type, html, options) {
    if (typeof options.measureText === 'function') {
      const spec = specFor(type, options), font = fontFor(type, options);
      const width = options.columnWidthPoints || Math.max(0.1, Number(spec.right) - Number(spec.left)) * 72;
      let cursor = 0;
      const runs = FDX.htmlToRuns(html).map(run => {
        const result = { ...run, start: cursor, end: cursor + run.text.length }; cursor = result.end; return result;
      });
      return wrapMeasured(plainText(html), width, (text, start, end) => {
        let measured = 0;
        for (const run of runs) {
          if (run.end <= start || run.start >= end) continue;
          const attrs = run.attrs || {};
          const part = run.text.slice(Math.max(0, start - run.start), Math.min(run.text.length, end - run.start));
          const effective = options.useDocumentTypography === false ? font : {
            font: attrs.Font || font.font,
            size: Number(attrs.Size) > 0 ? Number(attrs.Size) : font.size,
            style: [/Bold/i.test(run.style || font.style || '') ? 'bold' : '', /Italic/i.test(run.style || font.style || '') ? 'italic' : ''].filter(Boolean).join(' '),
          };
          measured += options.measureText(/AllCaps/i.test(spec.style || '') ? part.toUpperCase() : part, { ...effective, type });
        }
        return measured;
      }, options.ignoreFirstIndent ? 0 : Number(spec.first || 0) * 72);
    }
    return wrapText(plainText(html), charsFor(type, options));
  }

  function blockType(paragraph) {
    return paragraph.type || "Action";
  }

  function isOmittedSceneRange(scenes) {
    const omitted = new Set();
    for (const scene of scenes) {
      if (!scene.omit) continue;
      for (let index = scene.startIndex; index < scene.endIndex; index += 1) {
        omitted.add(index);
      }
    }
    return omitted;
  }

  function splitDualColumns(group) {
    const columns = [];
    let current = [];
    for (const paragraph of group) {
      if (paragraph.type === "Character" && current.length) {
        columns.push(current);
        current = [];
      }
      current.push(paragraph);
    }
    if (current.length) columns.push(current);
    return columns;
  }

  function dualBlock(group, options) {
    const geometry = dualGeometry(options.document, options);
    const columnOptions = { ...options, columnWidthPoints: geometry.columnWidthPoints, ignoreFirstIndent: true };
    const columns = splitDualColumns(group).slice(0, 2);
    const rendered = columns.map((column) => {
      const blocks = column.map((paragraph) => ({
        paragraph,
        type: blockType(paragraph),
        lines: linesFor(blockType(paragraph), paragraph.html, columnOptions),
        lineHeight: lineHeightFor(paragraph, options),
        font: fontFor(blockType(paragraph), options),
        before: Number(paragraph.spaceBefore ?? specFor(blockType(paragraph), options).before) || 0,
      }));
      const lineCount = blocks.reduce((sum, block) => sum + block.lines.length, 0);
      const height = blocks.reduce((sum, block, index) => sum + block.lines.length * block.lineHeight + (index ? block.before : 0), 0);
      return { blocks, lineCount, height };
    });
    const lineCount = rendered.reduce((max, column) => Math.max(max, column.lineCount), 0);
    return {
      kind: "dual",
      paragraphs: group,
      columns: rendered,
      lineCount,
      height: Math.max(...rendered.map(column => column.height), 0),
      geometry,
      type: "DualDialogue",
      before: 12,
      revision: group.reduce(
        (max, paragraph) => Math.max(max, Number(paragraph.revision) || 0),
        0,
      ) || null,
    };
  }

  function paragraphBlock(paragraph, scene, options) {
    const type = blockType(paragraph);
    const lines = linesFor(type, paragraph.html, options);
    const spec = specFor(type, options);
    return {
      kind: "paragraph",
      paragraph,
      type,
      lines,
      lineCount: lines.length,
      before: Number(paragraph.spaceBefore ?? spec.before) || 0,
      lineHeight: lineHeightFor(paragraph, options),
      font: fontFor(type, options),
      geometry: { left: Number(spec.left), right: Number(spec.right), first: Number(spec.first) || 0 },
      scene: scene || null,
      sceneNumber: type === "Scene Heading" && scene ? scene.number : "",
      revision: paragraph.revision || null,
    };
  }

  function lineHeightFor(paragraph, options) {
    const spec = specFor(blockType(paragraph), options);
    const font = fontFor(blockType(paragraph), options);
    const spacing = Math.max(0.5, Math.min(4, Number(paragraph.spacing ?? spec.spacing) || 1));
    const leading = paragraph.leading || spec.leading || 'Regular';
    const factor = leading === 'Tight' ? 0.9 : leading === 'Loose' ? 1.12 : 1;
    const largestRun = options.useDocumentTypography === false ? font.size : FDX.htmlToRuns(paragraph.html || '').reduce((largest, run) =>
      Math.max(largest, Number(run.attrs && run.attrs.Size) || 0), font.size);
    return Math.max(6, options.lineHeight * (largestRun / options.fontSize) * spacing * factor);
  }

  function paragraphTypography(doc, paragraph, options) {
    const opts = { ...DEFAULTS, ...(options || {}), document: doc };
    const spec = specFor(blockType(paragraph), opts), font = fontFor(blockType(paragraph), opts);
    return { ...font, lineHeight: lineHeightFor(paragraph, opts),
      before: Number(paragraph.spaceBefore ?? spec.before) || 0,
      widthPoints: Math.max(0.1, Number(spec.right) - Number(spec.left)) * 72,
      firstIndent: Number(spec.first || 0) * 72,
      leftInches: Number(spec.left), rightInches: Number(spec.right), firstIndentInches: Number(spec.first || 0) };
  }

  function dualGeometry(doc, options) {
    const spec = FDModel.elementSpec('Action', doc);
    const widthInches = Math.max(0.75, Number(spec.right) - Number(spec.left));
    const gapInches = Number(options && options.dualGapInches) || 0.35;
    const paddingInches = options && options.dualPaddingInches !== undefined ? Math.max(0, Number(options.dualPaddingInches) || 0) : 0.1;
    return { leftInches: Number(spec.left), widthInches, gapInches, paddingInches,
      columnWidthPoints: Math.max(18, ((widthInches - gapInches) / 2 - 2 * paddingInches) * 72) };
  }

  function blockHeight(block, options, atTop = false) {
    const before = atTop ? 0 : block.before || 0;
    return block.lineCount * (block.lineHeight || options.lineHeight) + before;
  }

  let activeContinueds = null;

  function continuationCue(name) {
    const clean = String(name || "CHARACTER").trim() || "CHARACTER";
    const contLabel = (activeContinueds && activeContinueds.dialogueCont) || "(CONT'D)";
    return {
      kind: "paragraph",
      paragraph: {
        id: `continuation-${clean}`,
        type: "Character",
        html: FDModel.escapeHtml(`${clean} ${contLabel}`),
        revision: null,
      },
      type: "Character",
      lines: [{ start: 0, end: 0, text: `${clean} ${contLabel}` }],
      lineCount: 1,
      before: 0,
      scene: null,
      sceneNumber: "",
      revision: null,
      continuation: true,
    };
  }

  function moreBlock() {
    return {
      kind: "more",
      type: "Dialogue",
      lineCount: 1,
      before: 0,
      revision: null,
      text: (activeContinueds && activeContinueds.dialogueMore) || "(MORE)",
    };
  }

  function blankPage(kind = "script") {
    return { kind, blocks: [], lineCount: 0 };
  }

  function layout(doc, options) {
    const normalized = FDModel.normalizeDocument(doc);
    if (normalized.production?.lock?.pages?.length && !options?.ignoreProduction) return lockedLayout(normalized, options);
    activeContinueds = normalized.moresContinueds || null;
    const opts = {
      ...DEFAULTS,
      ...(options || {}),
      fontSize: Math.max(8, Number((options && options.fontSize) || 12)),
      lineHeight: Math.max(8, Number((options && options.lineHeight) || 12)),
      document: normalized,
    };
    const page = normalized.page;
    const contentHeight = Math.max(
      opts.lineHeight * 4,
      (Number(page.height) - Number(page.top) - Number(page.bottom)) * 72,
    );
    const scenes = FDModel.getScenes(normalized);
    const sceneByParagraph = new Map(scenes.map((scene) => [scene.id, scene]));
    const sceneRange = new Map();
    for (const scene of scenes) {
      sceneRange.set(scene.startIndex, scene);
    }
    const omitted = isOmittedSceneRange(scenes);
    const pages = [];
    if (normalized.titlePage && normalized.titlePage.enabled) {
      pages.push({
        kind: "title",
        blocks: [],
        lineCount: 0,
        titlePage: normalized.titlePage,
      });
    }
    let scriptPageCount = 0;
    let current = null;
    let currentLines = 0;

    const newScriptPage = () => {
      if (scriptPageCount >= Math.max(1, Number(opts.maxPages) || DEFAULTS.maxPages)) {
        throw new RangeError(`Pagination exceeded the ${opts.maxPages || DEFAULTS.maxPages}-page limit. Content was not discarded.`);
      }
      current = blankPage("script");
      scriptPageCount += 1;
      current.number = scriptPageCount;
      currentLines = 0;
      pages.push(current);
      return current;
    };

    const add = (block, height) => {
      current.blocks.push(block);
      currentLines += height;
      current.lineCount = currentLines;
    };

    const remaining = () => contentHeight - currentLines;

    const ensureRoom = (needed, block) => {
      if (current && current.blocks.length && needed > remaining() + 0.01) {
        newScriptPage();
      }
      if (!current) newScriptPage();
      // If the block is taller than a whole page and it is a paragraph, the
      // caller will split it. A giant unbreakable dual block is allowed to
      // overflow rather than loop forever.
      if (block && block.kind === "dual" && remaining() < needed) {
        if (current.blocks.length) newScriptPage();
      }
      return remaining();
    };

    const addParagraph = (block, scene) => {
      const type = block.type;
      const lineHeight = block.lineHeight || opts.lineHeight;
      const fullHtml = block.paragraph ? block.paragraph.html : "";
      let text = block.lines;
      let remainingLines = block.lineCount;
      let firstPart = true;
      let baseOffset = 0;
      let guard = 0;
      while (remainingLines > 0) {
        guard += 1;
        const atTop = !current || current.blocks.length === 0;
        const before = atTop ? 0 : block.before || 0;
        const available = remaining();
        const capacityLines = Math.floor((available - before) / lineHeight);
        if (
          firstPart &&
          type === "Scene Heading" &&
          current &&
          current.blocks.length &&
          capacityLines < 3
        ) {
          newScriptPage();
          continue;
        }
        if (
          firstPart &&
          (type === "Character" || type === "Parenthetical" || type === "Transition") &&
          current &&
          current.blocks.length &&
          capacityLines < 2
        ) {
          newScriptPage();
          continue;
        }
        if (remainingLines * lineHeight + before <= available || (atTop && capacityLines < 1)) {
          add(
            {
              ...block,
              lines: text,
              lineCount: remainingLines,
              isContinuation: !firstPart,
              // A continuation must carry only its own slice. Without this the
              // block keeps the original paragraph HTML via ...block and every
              // page after the break reprints the whole speech.
              html: firstPart ? fullHtml : sliceHtml(fullHtml, baseOffset),
            },
            remainingLines * lineHeight + before,
          );
          break;
        }
        // Split dialogue/action at a line boundary.
        const canSplit = ["Dialogue", "Action", "General"].includes(type) || type === "Shot" || atTop;
        if (!canSplit || capacityLines < 1 || !current) {
          newScriptPage();
          continue;
        }
        /* A split dialogue ends with a (MORE) lead-out, which costs one line that
         * the fit calculation has to pay for. The old expression,
         * `Math.max(1, capacityLines - reserve)`, silently charged nothing when
         * capacityLines was 1: it forced one dialogue line onto the page and then
         * added the (MORE) block on top, so the page ended one line over
         * contentHeight and `.page-card__body { overflow: hidden }` clipped the
         * marker off the sheet entirely (and cut the line in half).
         *
         * Correct behaviour: reserve first, and if even one line plus the marker
         * will not fit, break *before* the dialogue instead of overflowing. */
        const needsMore = type === "Dialogue" && opts.showMore !== false;
        let fit = capacityLines - (needsMore ? 1 : 0);
        if (fit < 1) {
          if (current && current.blocks.length) {
            /* Breaking here leaves a character cue alone at the foot of the page,
             * which is a typesetting error, so carry it across with the speech. */
            const last = current.blocks[current.blocks.length - 1];
            const orphanCue =
              last && last.kind === "paragraph" && last.type === "Character" ? last : null;
            const carryCue = orphanCue && current.blocks.length > 1;
            if (carryCue) {
              current.blocks.pop();
              currentLines -= (orphanCue.lineCount || 1) * (orphanCue.lineHeight || opts.lineHeight) + (orphanCue.before || 0);
              current.lineCount = currentLines;
            }
            newScriptPage();
            if (carryCue) {
              // Re-place the cue at the top of the fresh page (no space-before).
              current.blocks.push({ ...orphanCue, before: 0 });
              currentLines = (orphanCue.lineCount || 1) * (orphanCue.lineHeight || opts.lineHeight);
              current.lineCount = currentLines;
            }
            continue;
          }
          // Nothing to break away from: place the line without a MORE marker
          // rather than looping on a fresh page forever.
          fit = 1;
        }
        if (fit >= remainingLines) {
          add(
            {
              ...block,
              lines: text,
              lineCount: remainingLines,
              isContinuation: !firstPart,
              html: firstPart ? fullHtml : sliceHtml(fullHtml, baseOffset),
            },
            remainingLines * lineHeight + before,
          );
          break;
        }
        const lineOffset = baseOffset + (text[0] ? text[0].start : 0);
        const splitAt = baseOffset + (text[fit] ? text[fit].start : text[text.length - 1].end);
        const partStart = lineOffset;
        const partEnd = splitAt;
        const partHtml = sliceHtml(fullHtml, partStart, partEnd);
        const usedLines = Math.min(fit, remainingLines);
        add(
          {
            ...block,
            lines: text.slice(0, usedLines),
            lineCount: usedLines,
            isContinuation: !firstPart,
            html: partHtml,
            more: needsMore,
          },
          usedLines * lineHeight + before,
        );
        /* Place the marker only if the page can still hold it. The fit above
         * reserved the line, so this is a belt-and-braces guard against any
         * future change to the reservation arithmetic: emitting a marker that
         * does not fit is worse than emitting none, because the clipping hides
         * it and the reader never learns the speech continues. */
        if (needsMore && remaining() >= lineHeight - 0.01) {
          add(moreBlock(), lineHeight);
        }
        const remainingHtml = sliceHtml(fullHtml, partEnd);
        const remainingText = plainText(remainingHtml);
        text = linesFor(type, remainingHtml, opts);
        remainingLines = text.length;
        baseOffset = partEnd;
        firstPart = false;
        newScriptPage();
        if (needsMore) {
          const cue = continuationCue(lastCharacterName);
          add(cue, lineHeight);
        }
        if (!remainingLines) break;
      }
    };

    const addDual = block => {
      const cursors = block.columns.map(() => ({ block: 0, line: 0 }));
      let firstPart = true;
      const unfinished = () => cursors.some((cursor, index) => cursor.block < block.columns[index].blocks.length);
      while (unfinished()) {
        if (!current) newScriptPage();
        const before = current.blocks.length && firstPart ? block.before : 0;
        const available = remaining() - before;
        const canPlace = cursors.some((cursor, index) => {
          const item = block.columns[index].blocks[cursor.block];
          return item && item.lineHeight <= available + 0.01;
        });
        if (!canPlace) {
          if (!current.blocks.length) throw new RangeError('A dual-dialogue line is taller than the printable page.');
          newScriptPage(); continue;
        }
        const rendered = block.columns.map((column, columnIndex) => {
          const cursor = cursors[columnIndex], blocks = [];
          let height = 0;
          while (cursor.block < column.blocks.length) {
            const item = column.blocks[cursor.block], leading = blocks.length && cursor.line === 0 ? item.before : 0;
            const capacity = Math.floor((available - height - leading + 0.01) / item.lineHeight);
            if (capacity < 1) break;
            const count = Math.min(capacity, item.lines.length - cursor.line);
            const lines = item.lines.slice(cursor.line, cursor.line + count);
            const from = cursor.line === 0 ? 0 : item.lines[cursor.line].start;
            const to = item.lines[cursor.line + count]?.start ?? plainText(item.paragraph.html).length;
            blocks.push({ ...item, lines, lineCount: count, before: leading,
              isContinuation: cursor.line > 0, html: sliceHtml(item.paragraph.html, from, to) });
            height += count * item.lineHeight + leading;
            cursor.line += count;
            if (cursor.line >= item.lines.length) { cursor.block++; cursor.line = 0; }
            else break;
          }
          return { blocks, lineCount: blocks.reduce((sum, item) => sum + item.lineCount, 0), height };
        });
        const height = Math.max(...rendered.map(column => column.height), 0);
        add({ ...block, columns: rendered, height, before, isContinuation: !firstPart,
          lineCount: Math.max(...rendered.map(column => column.lineCount), 0) }, height + before);
        firstPart = false;
        if (unfinished()) newScriptPage();
      }
    };

    let lastCharacterName = "";
    for (let index = 0; index < normalized.paragraphs.length; index += 1) {
      if (omitted.has(index)) continue;
      const paragraph = normalized.paragraphs[index];
      if (!current) newScriptPage();
      const scene = sceneByParagraph.get(paragraph.id) || null;
      if (paragraph.type === "Character") {
        lastCharacterName = FDModel.stripHtml(paragraph.html).trim();
      }
      if (paragraph.type === "Scene Heading") {
        lastCharacterName = "";
      }
      if (paragraph.dualGroup) {
        const group = [];
        let groupIndex = index;
        while (
          groupIndex < normalized.paragraphs.length &&
          normalized.paragraphs[groupIndex].dualGroup === paragraph.dualGroup
        ) {
          if (!omitted.has(groupIndex)) group.push(normalized.paragraphs[groupIndex]);
          groupIndex += 1;
        }
        index = groupIndex - 1;
        if (!group.length) continue;
        const block = dualBlock(group, opts);
        const height = block.height + (current.blocks.length ? block.before : 0);
        if (current.blocks.length && height > remaining()) newScriptPage();
        addDual(block);
        continue;
      }
      const block = paragraphBlock(paragraph, scene, opts);
      if ((paragraph.pageBreakBefore || specFor(paragraph.type, opts).startsNewPage) && current.blocks.length) newScriptPage();
      addParagraph(block, scene);
    }
    if (!pages.some((page) => page.kind === "script")) {
      newScriptPage();
    }
    for (const scriptPage of pages.filter((item) => item.kind === "script")) {
      scriptPage.sceneNumbers = scriptPage.blocks
        .filter((block) => block.type === "Scene Heading" || block.kind === "dual")
        .map((block) => block.sceneNumber)
        .filter(Boolean);
    }
    return {
      pages,
      scriptPageCount,
      totalPageCount: pages.length,
      contentHeight,
      lineHeight: opts.lineHeight,
      scenes,
      normalized,
    };
  }

  function pageParagraphs(page) {
    return page.blocks.flatMap(b => b.kind === 'dual' ? b.columns.flatMap(c => c.blocks) : [b]).filter(b => b.paragraph && !b.continuation);
  }
  function captureLock(doc, options) {
    const issued = layout(doc, { ...options, ignoreProduction: true });
    const consumed = new Map();
    const startPage=Math.max(1,Number(doc.headerFooter?.startingPageNumber||doc.headerFooter?.startingPage||1));
    const pages = issued.pages.filter(p => p.kind === 'script').map(page => ({ number: page.number+startPage-1,
      fragments: pageParagraphs(page).map(b => {
        const id = FDModel.toUuid(b.paragraph.id), original = plainText(b.paragraph.html);
        const part = plainText(b.html ?? b.paragraph.html), from = original.indexOf(part, consumed.get(id) || 0);
        const start = Math.max(0, from), end = start + part.length;
        consumed.set(id, end); return { id, start, end, text: original };
      }) }));
    return { version: 1, page: { ...doc.page }, pages, order: doc.paragraphs.map(p => FDModel.toUuid(p.id)) };
  }
  function mappedOffset(old, next, offset) {
    if (!offset) return 0;
    if (offset >= old.length) return next.length;
    let left = 0, right = 0;
    while (left < old.length && left < next.length && old[left] === next[left]) left++;
    while (right < old.length - left && right < next.length - left && old[old.length - right - 1] === next[next.length - right - 1]) right++;
    if (offset <= left) return offset;
    if (offset >= old.length - right) return next.length - (old.length - offset);
    return Math.min(next.length, left + Math.round((offset - left) * (next.length - left - right) / Math.max(1, old.length - left - right)));
  }
  function suffix(index) {
    let value = ''; for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) value = String.fromCharCode(65 + (n - 1) % 26) + value;
    return value;
  }
  function lockedLayout(doc, options) {
    for(const scene of FDModel.getScenes(doc)){
      doc.production.sceneNumbers||={};doc.production.sceneNumbers[FDModel.toUuid(scene.id)]=scene.number;
      scene.paragraph.scene.number=scene.number;
    }
    const lock = doc.production.lock, ids = doc.paragraphs.map(p => FDModel.toUuid(p.id));
    const oldOrder = new Map(lock.order.map((id, i) => [id, i]));
    let last = -1;
    for (const id of ids) if (oldOrder.has(id)) { if (oldOrder.get(id) < last) throw new Error('Issued paragraphs were reordered. Unlock and issue a new pagination baseline before exporting.'); last = oldOrder.get(id); }
    if (JSON.stringify(lock.page) !== JSON.stringify(doc.page)) throw new Error('Page geometry changed after locking. Restore it or unlock and reissue.');
    const groups = lock.pages.map(() => []), slots = new Map();
    lock.pages.forEach((page, index) => page.fragments.forEach(f => { if (!slots.has(f.id)) slots.set(f.id, []); slots.get(f.id).push({ ...f, index }); }));
    const omitted = isOmittedSceneRange(FDModel.getScenes(doc));
    let slot = 0;
    doc.paragraphs.forEach((p, index) => {
      const fragments = slots.get(ids[index]);
      if (fragments) slot = fragments[0].index;
      if (omitted.has(index)) return;
      if (!fragments) { groups[slot].push(p); return; }
      for (const f of fragments) {
        const value = plainText(p.html), from = mappedOffset(f.text, value, f.start), to = mappedOffset(f.text, value, f.end);
        if (to <= from && value) continue;
        if (!value && fragments.length > 1) continue;
        groups[f.index].push({ ...p, html: from === 0 && to === value.length ? p.html : sliceHtml(p.html, from, to), pageBreakBefore: false });
      }
      slot = fragments.at(-1).index;
    });
    const pages = doc.titlePage.enabled ? [{kind:'title',blocks:[],lineCount:0,titlePage:doc.titlePage}] : [];
    let measured;
    groups.forEach((paragraphs, i) => {
      const base = lock.pages[i].number;
      if (!paragraphs.length) { pages.push({ kind:'script', number:base, label:String(base), omitted:true, blocks:[], lineCount:0 }); return; }
      const first=paragraphs[0],last=paragraphs.at(-1),firstSlot=slots.get(FDModel.toUuid(first.id)),lastSlot=slots.get(FDModel.toUuid(last.id));
      const incoming=!first.dualGroup&&first.type==='Dialogue'&&firstSlot?.find(f=>f.index===i)?.start>0;
      const outgoing=!last.dualGroup&&last.type==='Dialogue'&&lastSlot?.some(f=>f.index>i)&&plainText(last.html).trim();
      let sectionParagraphs=paragraphs;
      if(incoming){const at=doc.paragraphs.findIndex(p=>p.id===first.id),cue=doc.paragraphs.slice(0,at).reverse().find(p=>p.type==='Character');
        const synthetic=FDModel.makeParagraph('Character',`${cue?plainText(cue.html):'CHARACTER'} ${doc.moresContinueds.dialogueCont||"(CONT'D)"}`,{id:'continuation-locked-'+i});sectionParagraphs=[synthetic,...paragraphs];}
      const lineHeight=options?.lineHeight||DEFAULTS.lineHeight;
      const section = layout({ ...doc, page:{...doc.page,bottom:Number(doc.page.bottom)+(outgoing&&options?.showMore!==false?lineHeight/72:0)}, titlePage:{...doc.titlePage,enabled:false}, paragraphs:sectionParagraphs }, { ...options, ignoreProduction:true }); measured = section;
      for(const pg of section.pages)for(const b of pg.blocks)if(b.paragraph?.id==='continuation-locked-'+i)b.continuation=true;
      if(outgoing&&options?.showMore!==false){section.pages.at(-1).blocks.push(moreBlock());section.pages.at(-1).lineCount+=lineHeight;}
      section.pages.forEach((p,j) => pages.push({ ...p, number:base, label:String(base) + suffix(j), locked:true }));
    });
    if (pages.length > (options?.maxPages || DEFAULTS.maxPages)) throw new RangeError('Locked pagination exceeded the page limit.');
    return { ...measured, contentHeight:(Number(doc.page.height)-Number(doc.page.top)-Number(doc.page.bottom))*72, lineHeight:options?.lineHeight||DEFAULTS.lineHeight, pages, scriptPageCount:pages.filter(p=>p.kind==='script').length, totalPageCount:pages.length, normalized:doc, scenes:FDModel.getScenes(doc) };
  }
  return {
    captureLock,
    pageParagraphs,
    DEFAULTS,
    plainText,
    sliceHtml,
    wrapText,
    wrapMeasured,
    paragraphTypography,
    dualGeometry,
    layout,
  };
});
