"""Read, inspect, and render Final Draft FDX documents.

The FDX container is XML.  This module deliberately keeps the original
``ElementTree`` nodes so callers can edit a document without losing sections
the typed model does not currently interpret.
"""

from __future__ import annotations

import html
import json
import re
import textwrap
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Iterator, Mapping, Sequence
import xml.etree.ElementTree as ET

FDX_VERSION = "6"

# Tokens observed in FontSpec/@Style across Final Draft 13 templates.
_STYLE_CSS = {
    "Bold": ("font-weight", "700"),
    "Italic": ("font-style", "italic"),
    "Underline": ("text-decoration", "underline"),
    "Strikethrough": ("text-decoration", "line-through"),
    "AllCaps": ("text-transform", "uppercase"),
    "HiddenText": ("display", "none"),
    "Superscript": ("vertical-align", "super"),
    "Subscript": ("vertical-align", "sub"),
}


def _float(value: str | None, default: float | None = None) -> float | None:
    if value is None or value == "":
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _int(value: str | None, default: int | None = None) -> int | None:
    if value is None or value == "":
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _bool(value: str | None) -> bool:
    return (value or "").strip().lower() in {"yes", "true", "1"}


def style_tokens(style: str | None) -> set[str]:
    """Return the individual ``+``-separated FontSpec style flags."""

    if not style:
        return set()
    return {token for token in style.split("+") if token}


@dataclass(frozen=True)
class FontSpec:
    font: str | None = None
    size: float | None = None
    style: str = ""
    color: str | None = None
    background: str | None = None
    revision_id: int | None = None
    adornment_style: int | None = None

    @classmethod
    def from_element(cls, element: ET.Element | None) -> "FontSpec":
        if element is None:
            return cls()
        return cls(
            font=element.get("Font"),
            size=_float(element.get("Size")),
            style=element.get("Style", ""),
            color=element.get("Color"),
            background=element.get("Background"),
            revision_id=_int(element.get("RevisionID")),
            adornment_style=_int(element.get("AdornmentStyle")),
        )

    def effect_css(self) -> str:
        declarations: list[str] = []
        if self.color:
            declarations.append(f"color: {self.color}")
        if self.background:
            declarations.append(f"background-color: {self.background}")
        for token in sorted(style_tokens(self.style)):
            declaration = _STYLE_CSS.get(token)
            if declaration:
                declarations.append(f"{declaration[0]}: {declaration[1]}")
        return "; ".join(declarations)

    def css(self) -> str:
        declarations: list[str] = []
        if self.font:
            declarations.append(f"font-family: {json.dumps(self.font)}, 'Courier New', monospace")
        if self.size:
            declarations.append(f"font-size: {self.size:g}pt")
        effects = self.effect_css()
        if effects:
            declarations.append(effects)
        return "; ".join(declarations)

    def to_dict(self) -> dict[str, object]:
        return {
            "font": self.font,
            "size": self.size,
            "style": self.style,
            "style_tokens": sorted(style_tokens(self.style)),
            "color": self.color,
            "background": self.background,
            "revision_id": self.revision_id,
            "adornment_style": self.adornment_style,
        }


@dataclass(frozen=True)
class ParagraphSettings:
    alignment: str = "Left"
    first_indent: float = 0.0
    left_indent: float = 0.0
    right_indent: float = 0.0
    space_before: float = 0.0
    spacing: float = 1.0
    leading: str = "Regular"
    starts_new_page: bool = False
    outline_level: int | None = None
    type: str | None = None

    @classmethod
    def from_element(cls, element: ET.Element | None) -> "ParagraphSettings":
        if element is None:
            return cls()
        return cls(
            alignment=element.get("Alignment", "Left"),
            first_indent=_float(element.get("FirstIndent"), 0.0) or 0.0,
            left_indent=_float(element.get("LeftIndent"), 0.0) or 0.0,
            right_indent=_float(element.get("RightIndent"), 0.0) or 0.0,
            space_before=_float(element.get("SpaceBefore"), 0.0) or 0.0,
            spacing=_float(element.get("Spacing"), 1.0) or 1.0,
            leading=element.get("Leading", "Regular"),
            starts_new_page=_bool(element.get("StartsNewPage")),
            outline_level=_int(element.get("OutlineLevel")),
            type=element.get("Type"),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "alignment": self.alignment,
            "first_indent": self.first_indent,
            "left_indent": self.left_indent,
            "right_indent": self.right_indent,
            "space_before": self.space_before,
            "spacing": self.spacing,
            "leading": self.leading,
            "starts_new_page": self.starts_new_page,
            "outline_level": self.outline_level,
            "type": self.type,
        }


@dataclass(frozen=True)
class SceneProperties:
    length: str | None = None
    page: int | None = None
    title: str | None = None
    number: str | None = None

    @classmethod
    def from_element(cls, element: ET.Element | None) -> "SceneProperties | None":
        if element is None:
            return None
        return cls(
            length=element.get("Length"),
            page=_int(element.get("Page")),
            title=element.get("Title"),
            number=element.get("Number"),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "length": self.length,
            "page": self.page,
            "title": self.title,
            "number": self.number,
        }


@dataclass
class Inline:
    """One visible run or dynamic label inside a paragraph."""

    kind: str
    text: str
    font: FontSpec
    element: ET.Element
    dynamic_type: str | None = None

    @classmethod
    def from_element(cls, element: ET.Element) -> "Inline":
        kind = {
            "Text": "text",
            "DynamicLabel": "dynamic-label",
            "Picture": "picture",
        }.get(element.tag, element.tag.lower())
        return cls(
            kind=kind,
            text=element.text or "",
            font=FontSpec.from_element(element),
            element=element,
            dynamic_type=element.get("Type"),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "kind": self.kind,
            "text": self.text,
            "font": self.font.to_dict(),
            "dynamic_type": self.dynamic_type,
        }


@dataclass
class ScriptNote:
    element: ET.Element
    id: str | None
    name: str | None
    color: str | None
    date_modified: str | None
    datetime: str | None
    range: str | None
    type: str | None
    writer_id: str | None
    writer_name: str | None
    paragraphs: list["Paragraph"] = field(default_factory=list)

    @classmethod
    def from_element(cls, element: ET.Element) -> "ScriptNote":
        note = cls(
            element=element,
            id=element.get("Id"),
            name=element.get("Name"),
            color=element.get("Color"),
            date_modified=element.get("DateModified"),
            datetime=element.get("DateTime"),
            range=element.get("Range"),
            type=element.get("Type"),
            writer_id=element.get("WriterID"),
            writer_name=element.get("WriterName"),
        )
        note.paragraphs = [
            Paragraph.from_element(child)
            for child in element
            if child.tag == "Paragraph"
        ]
        return note

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "name": self.name,
            "color": self.color,
            "datetime": self.datetime,
            "range": self.range,
            "type": self.type,
            "writer_id": self.writer_id,
            "writer_name": self.writer_name,
            "paragraphs": [p.to_dict() for p in self.paragraphs],
        }


@dataclass
class Paragraph:
    element: ET.Element
    type: str
    id: str | None
    number: str | None
    label: str | None
    inlines: list[Inline] = field(default_factory=list)
    scene: SceneProperties | None = None
    notes: list[ScriptNote] = field(default_factory=list)
    dual_dialogue: list["Paragraph"] = field(default_factory=list)
    unknown_children: list[ET.Element] = field(default_factory=list)

    @classmethod
    def from_element(cls, element: ET.Element) -> "Paragraph":
        paragraph = cls(
            element=element,
            type=element.get("Type", ""),
            id=element.get("id"),
            number=element.get("Number"),
            label=element.get("Label"),
        )
        for child in element:
            if child.tag in {"Text", "DynamicLabel", "Picture"}:
                paragraph.inlines.append(Inline.from_element(child))
            elif child.tag == "SceneProperties":
                paragraph.scene = SceneProperties.from_element(child)
            elif child.tag == "ScriptNote":
                paragraph.notes.append(ScriptNote.from_element(child))
            elif child.tag == "DualDialogue":
                paragraph.dual_dialogue = [
                    cls.from_element(p) for p in child if p.tag == "Paragraph"
                ]
            else:
                paragraph.unknown_children.append(child)
        return paragraph

    @property
    def text(self) -> str:
        """Visible authored text, excluding dynamic labels and pictures."""

        return "".join(inline.text for inline in self.inlines if inline.kind == "text")

    def runs(self) -> list[Inline]:
        return list(self.inlines)

    def to_dict(self) -> dict[str, object]:
        return {
            "type": self.type,
            "id": self.id,
            "number": self.number,
            "label": self.label,
            "text": self.text,
            "inlines": [inline.to_dict() for inline in self.inlines],
            "scene": self.scene.to_dict() if self.scene else None,
            "notes": [note.to_dict() for note in self.notes],
            "dual_dialogue": [p.to_dict() for p in self.dual_dialogue],
            "unknown_children": [child.tag for child in self.unknown_children],
        }


@dataclass(frozen=True)
class Revision:
    id: int
    name: str
    mark: str
    color: str | None
    page_color: str | None
    full_revision: bool

    @classmethod
    def from_element(cls, element: ET.Element) -> "Revision":
        return cls(
            id=_int(element.get("ID"), 0) or 0,
            name=element.get("Name", ""),
            mark=element.get("Mark", ""),
            color=element.get("Color"),
            page_color=element.get("PageColor"),
            full_revision=_bool(element.get("FullRevision")),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "name": self.name,
            "mark": self.mark,
            "color": self.color,
            "page_color": self.page_color,
            "full_revision": self.full_revision,
        }


@dataclass(frozen=True)
class ElementSettings:
    type: str
    font: FontSpec
    paragraph: ParagraphSettings
    behavior: Mapping[str, str] = field(default_factory=dict)
    outline: Mapping[str, str] = field(default_factory=dict)

    @classmethod
    def from_element(cls, element: ET.Element) -> "ElementSettings":
        return cls(
            type=element.get("Type", ""),
            font=FontSpec.from_element(element.find("FontSpec")),
            paragraph=ParagraphSettings.from_element(element.find("ParagraphSpec")),
            behavior=dict(element.find("Behavior").attrib)
            if element.find("Behavior") is not None
            else {},
            outline=dict(element.find("Outline").attrib)
            if element.find("Outline") is not None
            else {},
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "type": self.type,
            "font": self.font.to_dict(),
            "paragraph": self.paragraph.to_dict(),
            "behavior": dict(self.behavior),
            "outline": dict(self.outline),
        }


@dataclass(frozen=True)
class PageLayout:
    width: float = 8.5
    height: float = 11.0
    top_margin: float = 72.0
    bottom_margin: float = 72.0
    header_margin: float = 36.0
    footer_margin: float = 36.0
    uses_smart_quotes: bool = True
    break_dialogue_and_action_at_sentences: bool = True

    @classmethod
    def from_root(cls, root: ET.Element) -> "PageLayout":
        layout = root.find("PageLayout")
        if layout is None:
            return cls()
        page_size = layout.find("PageSize")
        width = _float(page_size.get("Width"), 8.5) if page_size is not None else 8.5
        height = _float(page_size.get("Height"), 11.0) if page_size is not None else 11.0
        return cls(
            width=width or 8.5,
            height=height or 11.0,
            top_margin=_float(layout.get("TopMargin"), 72.0) or 72.0,
            bottom_margin=_float(layout.get("BottomMargin"), 72.0) or 72.0,
            header_margin=_float(layout.get("HeaderMargin"), 36.0) or 36.0,
            footer_margin=_float(layout.get("FooterMargin"), 36.0) or 36.0,
            uses_smart_quotes=_bool(layout.get("UsesSmartQuotes")),
            break_dialogue_and_action_at_sentences=_bool(
                layout.get("BreakDialogueAndActionAtSentences")
            ),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "width_in": self.width,
            "height_in": self.height,
            "top_margin_pt": self.top_margin,
            "bottom_margin_pt": self.bottom_margin,
            "header_margin_pt": self.header_margin,
            "footer_margin_pt": self.footer_margin,
            "uses_smart_quotes": self.uses_smart_quotes,
            "break_dialogue_and_action_at_sentences": self.break_dialogue_and_action_at_sentences,
        }


@dataclass
class ValidationIssue:
    severity: str
    code: str
    message: str
    paragraph_id: str | None = None
    line: int | None = None

    def to_dict(self) -> dict[str, object]:
        return {
            "severity": self.severity,
            "code": self.code,
            "message": self.message,
            "paragraph_id": self.paragraph_id,
            "line": self.line,
        }


class FDXDocument:
    """A lossless FDX tree plus a typed read-only view."""

    def __init__(self, tree: ET.ElementTree, path: Path | None = None):
        self.tree = tree
        self.path = path
        self.root = tree.getroot()
        if self.root.tag != "FinalDraft":
            raise ValueError(f"not an FDX document: root element is {self.root.tag!r}")

        content = self.root.find("Content")
        self.paragraphs = [
            Paragraph.from_element(p) for p in (content if content is not None else [])
            if p.tag == "Paragraph"
        ]
        self.page_layout = PageLayout.from_root(self.root)
        self.element_settings = {
            settings.type: settings
            for settings in (
                ElementSettings.from_element(e)
                for e in self.root.findall("ElementSettings")
            )
        }
        revisions = self.root.find("Revisions")
        self.revisions = [
            Revision.from_element(e)
            for e in (revisions if revisions is not None else [])
            if e.tag == "Revision"
        ]
        self.document_type = self.root.get("DocumentType")
        self.template = self.root.get("Template")
        self.version = self.root.get("Version")

    @classmethod
    def from_path(cls, path: str | Path) -> "FDXDocument":
        path = Path(path)
        return cls(ET.parse(path), path)

    @classmethod
    def from_bytes(cls, data: bytes) -> "FDXDocument":
        return cls(ET.ElementTree(ET.fromstring(data)))

    def settings_for(self, paragraph: Paragraph) -> ElementSettings | None:
        return self.element_settings.get(paragraph.type)

    def iter_paragraphs(self) -> Iterator[Paragraph]:
        def walk(paragraphs: Iterable[Paragraph]) -> Iterator[Paragraph]:
            for paragraph in paragraphs:
                yield paragraph
                yield from walk(paragraph.dual_dialogue)
                for note in paragraph.notes:
                    yield from walk(note.paragraphs)

        yield from walk(self.paragraphs)

    @property
    def word_count(self) -> int:
        return sum(len(re.findall(r"\b[\w'’-]+\b", p.text)) for p in self.iter_paragraphs())

    @property
    def scene_count(self) -> int:
        return sum(1 for p in self.iter_paragraphs() if p.type == "Scene Heading")

    def validate(self) -> list[ValidationIssue]:
        issues: list[ValidationIssue] = []
        if self.root.get("Version") != FDX_VERSION:
            issues.append(
                ValidationIssue(
                    "warning",
                    "unsupported-version",
                    f"FDX version is {self.root.get('Version')!r}; this reader targets {FDX_VERSION!r}",
                )
            )
        if not self.paragraphs:
            issues.append(ValidationIssue("warning", "empty-content", "Content has no paragraphs"))

        seen_ids: dict[str, int] = {}
        for paragraph in self.iter_paragraphs():
            if not paragraph.type:
                issues.append(
                    ValidationIssue(
                        "warning",
                        "missing-paragraph-type",
                        "Paragraph has no Type attribute",
                        paragraph.id,
                    )
                )
            elif (
                paragraph.type not in {"DualDialogue"}
                and self.element_settings
                and paragraph.type not in self.element_settings
            ):
                issues.append(
                    ValidationIssue(
                        "info",
                        "unregistered-paragraph-type",
                        f"Paragraph type {paragraph.type!r} has no ElementSettings in this document",
                        paragraph.id,
                    )
                )
            if paragraph.id:
                seen_ids[paragraph.id] = seen_ids.get(paragraph.id, 0) + 1
            for inline in paragraph.inlines:
                if inline.font.size is not None and inline.font.size <= 0:
                    issues.append(
                        ValidationIssue(
                            "error",
                            "invalid-font-size",
                            f"Text run has non-positive Size={inline.font.size!r}",
                            paragraph.id,
                        )
                    )
            if paragraph.type == "DualDialogue" and len(paragraph.dual_dialogue) < 2:
                issues.append(
                    ValidationIssue(
                        "warning",
                        "short-dual-dialogue",
                        "DualDialogue contains fewer than two Paragraph children",
                        paragraph.id,
                    )
                )

        for paragraph_id, count in seen_ids.items():
            if count > 1:
                issues.append(
                    ValidationIssue(
                        "warning",
                        "duplicate-paragraph-id",
                        f"Paragraph id appears {count} times",
                        paragraph_id,
                    )
                )
        if not self.element_settings:
            issues.append(
                ValidationIssue(
                    "info",
                    "missing-element-settings",
                    "No ElementSettings were found; rendering falls back to generic metrics",
                )
            )
        return issues

    def to_dict(self) -> dict[str, object]:
        return {
            "format": "fdx",
            "version": self.version,
            "document_type": self.document_type,
            "template": self.template,
            "source": str(self.path) if self.path else None,
            "page_layout": self.page_layout.to_dict(),
            "element_settings": {
                name: settings.to_dict() for name, settings in sorted(self.element_settings.items())
            },
            "revisions": [revision.to_dict() for revision in self.revisions],
            "statistics": {
                "paragraphs": len(self.paragraphs),
                "all_paragraphs": sum(1 for _ in self.iter_paragraphs()),
                "scenes": self.scene_count,
                "words": self.word_count,
                "dual_dialogue_blocks": sum(
                    1 for p in self.iter_paragraphs() if p.dual_dialogue
                ),
                "script_notes": sum(
                    len(p.notes) for p in self.iter_paragraphs()
                ),
            },
            "paragraphs": [paragraph.to_dict() for paragraph in self.paragraphs],
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)

    def _metrics(self, paragraph: Paragraph) -> tuple[ParagraphSettings, FontSpec]:
        settings = self.settings_for(paragraph)
        if settings is None:
            return ParagraphSettings(type=paragraph.type), FontSpec()
        return settings.paragraph, settings.font

    def render_text(self, width: int = 80) -> str:
        """Render a readable plain-text screenplay approximation.

        This is a text projection, not Final Draft pagination.  It intentionally
        does not claim page numbers, scene numbers, or production pagination.
        """

        lines: list[str] = []
        previous_type: str | None = None
        for paragraph in self.paragraphs:
            block = self._text_block(paragraph, width)
            if not block:
                continue
            if lines:
                tight = (
                    previous_type == "Scene Heading"
                    and paragraph.type in {"Action", "General", "Shot"}
                ) or (
                    previous_type == "Character"
                    and paragraph.type in {"Parenthetical", "Dialogue"}
                ) or (
                    previous_type == "Parenthetical" and paragraph.type == "Dialogue"
                )
                if not tight and lines[-1] != "":
                    lines.append("")
            lines.extend(block)
            previous_type = paragraph.type
        return "\n".join(lines).rstrip() + "\n"

    def _text_block(self, paragraph: Paragraph, width: int) -> list[str]:
        if paragraph.dual_dialogue:
            columns = self._dual_columns(paragraph.dual_dialogue)
            rendered = [
                self._flatten_dual(column, max(10, width // 2 - 2))
                for column in columns[:2]
            ]
            while len(rendered) < 2:
                rendered.append([])
            rows = []
            for index in range(max(len(rendered[0]), len(rendered[1]))):
                left_line = rendered[0][index] if index < len(rendered[0]) else ""
                right_line = rendered[1][index] if index < len(rendered[1]) else ""
                rows.append(f"{left_line:<{width // 2}}  {right_line}")
            return rows

        text = paragraph.text.strip()
        if not text:
            return []
        paragraph_type = paragraph.type
        if paragraph_type == "Scene Heading":
            return [text.upper()]
        if paragraph_type == "Character":
            return [text.upper()]
        if paragraph_type == "Transition":
            return [text.upper().rjust(min(width, 60))]
        if paragraph_type == "Parenthetical":
            return ["  " + line for line in textwrap.wrap(text, max(10, width - 2))]
        if paragraph_type == "Dialogue":
            return ["  " + line for line in textwrap.wrap(text, max(10, width - 2))]
        return textwrap.wrap(text, width) or [text]

    @staticmethod
    def _dual_columns(paragraphs: Sequence[Paragraph]) -> list[list[Paragraph]]:
        """Split FDX dual-dialogue order into left and right speaking columns."""

        columns: list[list[Paragraph]] = []
        current: list[Paragraph] = []
        for paragraph in paragraphs:
            if paragraph.type == "Character" and current:
                columns.append(current)
                current = []
            current.append(paragraph)
        if current:
            columns.append(current)
        return columns

    @staticmethod
    def _flatten_dual(paragraphs: Sequence[Paragraph], width: int) -> list[str]:
        lines: list[str] = []
        for paragraph in paragraphs:
            text = paragraph.text.strip()
            if not text:
                continue
            if paragraph.type == "Character":
                if lines:
                    lines.append("")
                lines.append(text.upper())
            elif paragraph.type == "Parenthetical":
                lines.extend(textwrap.wrap(text, max(8, width)))
            else:
                lines.extend(textwrap.wrap(text, max(8, width)))
        return lines

    def render_html(self, title: str | None = None) -> str:
        """Render a self-contained HTML preview using FDX page metrics."""

        page = self.page_layout
        title_text = title or (self.path.stem if self.path else "FDX document")
        blocks: list[str] = []
        for paragraph in self.paragraphs:
            blocks.append(self._html_paragraph(paragraph))
        css = f"""
:root {{ color-scheme: light; }}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: #e8e8e8; color: #111; }}
.page {{
  width: {page.width}in; min-height: {page.height}in; margin: 24px auto;
  background: #fff; padding: {page.top_margin / 72:.4f}in 0 {page.bottom_margin / 72:.4f}in;
  box-shadow: 0 2px 16px #0003; position: relative;
}}
.page p {{
  margin: 0; white-space: pre-wrap; overflow-wrap: break-word;
  font-family: 'Courier Final Draft', 'Courier New', monospace;
}}
.scene-number {{ position: absolute; font-size: 10pt; }}
@media print {{ body {{ background: #fff; }} .page {{ margin: 0; box-shadow: none; }} }}
""".strip()
        return (
            "<!doctype html>\n<html><head><meta charset=\"utf-8\">"
            f"<title>{html.escape(title_text)}</title><style>{css}</style></head>"
            f"<body><main class=\"page\">{''.join(blocks)}</main></body></html>\n"
        )

    def _html_paragraph(
        self, paragraph: Paragraph, compact: bool = False, dual_column: int | None = None
    ) -> str:
        if paragraph.dual_dialogue:
            columns = self._dual_columns(paragraph.dual_dialogue)
            cells = []
            for index, column in enumerate(columns[:2]):
                inner = "".join(
                    self._html_paragraph(child, compact=True, dual_column=index)
                    for child in column
                )
                cells.append(
                    f"<td style=\"width:50%;vertical-align:top\">{inner}</td>"
                )
            return (
                "<table style=\"width:6.50in;margin-left:1.00in;"
                "table-layout:fixed;border-collapse:collapse\"><tr>"
                + "".join(cells)
                + "</tr></table>"
            )
        settings, base_font = self._metrics(paragraph)
        if compact:
            styles = ["margin:0", "white-space:pre-wrap"]
            if base_font.size:
                styles.append(f"font-size:{base_font.size:g}pt")
            if paragraph.type == "Character":
                styles.append("font-weight:700")
            if dual_column is not None:
                offsets = (
                    {"Character": 2.00, "Parenthetical": 1.25, "Dialogue": 0.75}
                    if dual_column == 0
                    else {"Character": 0.75, "Parenthetical": 0.75, "Dialogue": 0.50}
                )
                styles.append(f"margin-left:{offsets.get(paragraph.type, 0.50):.2f}in")
            compact_effects = base_font.effect_css()
            if compact_effects:
                styles.append(compact_effects)
        else:
            left = settings.left_indent
            right = self.page_layout.width - (settings.right_indent or self.page_layout.width)
            styles = [
                f"margin-left:{left:.3f}in",
                f"margin-right:{max(0.0, right):.3f}in",
                f"margin-top:{settings.space_before:g}pt",
                f"text-indent:{settings.first_indent:.3f}in",
                f"text-align:{settings.alignment.lower() if settings.alignment.lower() in {'left', 'right', 'center', 'justify', 'start', 'end'} else 'left'}",
                f"line-height:{settings.spacing:g}",
            ]
            if base_font.size:
                styles.append(f"font-size:{base_font.size:g}pt")
            if base_font.font:
                styles.append(f"font-family:{json.dumps(base_font.font)}, 'Courier New', monospace")
        extra_font_css = base_font.effect_css()
        if extra_font_css:
            styles.append(extra_font_css)
        styles = [style for style in styles if style]
        content: list[str] = []
        for inline in paragraph.inlines:
            if inline.kind == "dynamic-label":
                label = html.escape(f"[{inline.dynamic_type or 'dynamic'}]")
                content.append(f"<span class=\"dynamic\">{label}</span>")
            elif inline.kind == "picture":
                content.append("<span class=\"picture\">[image]</span>")
            else:
                escaped = html.escape(inline.text)
                run_style = inline.font.css()
                if run_style:
                    content.append(f"<span style=\"{html.escape(run_style, quote=True)}\">{escaped}</span>")
                else:
                    content.append(escaped)
        return f"<p style=\"{html.escape(';'.join(styles), quote=True)}\">{''.join(content)}</p>"

    def write(self, path: str | Path) -> Path:
        """Write the current XML tree, preserving unmodified FDX sections."""

        path = Path(path)
        ET.indent(self.tree, space="  ")
        self.tree.write(path, encoding="utf-8", xml_declaration=True)
        return path
