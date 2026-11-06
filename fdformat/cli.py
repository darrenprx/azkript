"""Command line interface for the Final Draft format toolkit."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .fddat import NameDatabase
from .fdx import FDXDocument


def _json(value: object) -> str:
    return json.dumps(value, indent=2, ensure_ascii=False)


def _cmd_inspect(args: argparse.Namespace) -> int:
    document = FDXDocument.from_path(args.path)
    issues = document.validate()
    if args.json:
        value = document.to_dict()
        value["validation"] = [issue.to_dict() for issue in issues]
        print(_json(value))
        return 1 if any(issue.severity == "error" for issue in issues) else 0

    print(f"File:       {args.path}")
    print(f"Format:     FDX v{document.version} ({document.document_type})")
    print(f"Template:   {document.template}")
    print(f"Page:       {document.page_layout.width:g} x {document.page_layout.height:g} in")
    print(
        "Margins:    "
        f"top {document.page_layout.top_margin:g}pt, "
        f"bottom {document.page_layout.bottom_margin:g}pt"
    )
    print(f"Paragraphs: {len(document.paragraphs)} top-level, "
          f"{sum(1 for _ in document.iter_paragraphs())} total")
    print(f"Scenes:     {document.scene_count}")
    print(f"Words:      {document.word_count}")
    print(f"Elements:   {', '.join(sorted(document.element_settings)) or '(none)'}")
    if issues:
        print("\nValidation:")
        for issue in issues:
            location = f" [{issue.paragraph_id}]" if issue.paragraph_id else ""
            print(f"  {issue.severity.upper():7} {issue.code}{location}: {issue.message}")
    else:
        print("\nValidation: no issues")
    return 1 if any(issue.severity == "error" for issue in issues) else 0


def _cmd_text(args: argparse.Namespace) -> int:
    document = FDXDocument.from_path(args.path)
    sys.stdout.write(document.render_text(width=args.width))
    return 0


def _cmd_html(args: argparse.Namespace) -> int:
    document = FDXDocument.from_path(args.path)
    output = Path(args.output) if args.output else Path(args.path).with_suffix(".html")
    output.write_text(document.render_html(title=args.title), encoding="utf-8")
    print(output)
    return 0


def _cmd_validate(args: argparse.Namespace) -> int:
    document = FDXDocument.from_path(args.path)
    issues = document.validate()
    if args.json:
        print(_json([issue.to_dict() for issue in issues]))
    elif not issues:
        print("OK")
    else:
        for issue in issues:
            location = f" [{issue.paragraph_id}]" if issue.paragraph_id else ""
            print(f"{issue.severity}: {issue.code}{location}: {issue.message}")
    return 1 if any(issue.severity == "error" for issue in issues) else 0


def _cmd_names(args: argparse.Namespace) -> int:
    database = NameDatabase.from_path(args.path)
    if args.prefix or args.list:
        limit = args.limit
        names = database.search(args.prefix or "", limit=limit)
        if args.json:
            print(_json({"prefix": args.prefix or "", "limit": limit, "names": names}))
        else:
            print("\n".join(names))
        return 0
    print(_json(database.stats()))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="fdformat",
        description="Inspect and render Final Draft FDX/FDXT and .fddat files.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    inspect = subparsers.add_parser("inspect", help="summarize an FDX/FDXT file")
    inspect.add_argument("path")
    inspect.add_argument("--json", action="store_true")
    inspect.set_defaults(func=_cmd_inspect)

    text = subparsers.add_parser("text", help="render a plain-text screenplay view")
    text.add_argument("path")
    text.add_argument("--width", type=int, default=80)
    text.set_defaults(func=_cmd_text)

    html = subparsers.add_parser("html", help="render a self-contained HTML preview")
    html.add_argument("path")
    html.add_argument("-o", "--output")
    html.add_argument("--title")
    html.set_defaults(func=_cmd_html)

    validate = subparsers.add_parser("validate", help="validate FDX structure")
    validate.add_argument("path")
    validate.add_argument("--json", action="store_true")
    validate.set_defaults(func=_cmd_validate)

    names = subparsers.add_parser("names", help="inspect a Final Draft name database")
    names.add_argument("path")
    names.add_argument("--prefix", help="list names starting with this prefix")
    names.add_argument("--list", action="store_true", help="list names from the beginning")
    names.add_argument("--limit", type=int, default=20)
    names.add_argument("--json", action="store_true")
    names.set_defaults(func=_cmd_names)

    return parser


def main(argv: list[str] | None = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except (OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
