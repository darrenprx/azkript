"""Final Draft FDX/FDXT and binary name-database tooling."""

from .fddat import NameDatabase, NameDatabaseError
from .fdx import (
    ElementSettings,
    FDXDocument,
    FontSpec,
    PageLayout,
    Paragraph,
    ParagraphSettings,
    ValidationIssue,
)

__all__ = [
    "ElementSettings",
    "FDXDocument",
    "FontSpec",
    "NameDatabase",
    "NameDatabaseError",
    "PageLayout",
    "Paragraph",
    "ParagraphSettings",
    "ValidationIssue",
]

__version__ = "0.1.0"
