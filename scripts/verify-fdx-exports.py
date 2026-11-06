"""Independent XML/typed-reader validation of browser compatibility exports."""
from __future__ import annotations
from collections import Counter
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from fdformat.fdx import FDXDocument

folder = ROOT / "reports/fdx-compatibility-2026-11-05"
audit = json.loads((folder / "audit.json").read_text(encoding="utf-8"))
results = []
for file in sorted((folder / "exports").glob("*.fdx")) + [folder / "feature-fixture.fdx", folder / "feature-fixture-native-only.fdx"]:
    tree = ET.parse(file)
    root = tree.getroot()
    assert root.tag == "FinalDraft" and root.get("Version") == "6"
    assert root.find("Content") is not None
    doc = FDXDocument.from_path(file)
    errors = [issue.to_dict() for issue in doc.validate() if issue.severity == "error"]
    results.append({"file": file.name, "paragraphs": len(doc.paragraphs), "errors": errors})
native = ET.parse(folder / "feature-fixture-native-only.fdx").getroot()
assert native.find("AzkriptData") is None
assert len(native.findall("Revisions/Revision")) == 19
assert native.find("PageLayout/PageSize").get("Width") == "8.27"
assert any("中文" in (text.text or "") for text in native.findall("Content/Paragraph/Text"))
assert any(text.get("RevisionID") == "13" for text in native.findall("Content/Paragraph/Text"))
assert native.find("Content/Paragraph/DualDialogue") is not None
assert len(results) == 57
assert not any(result["errors"] for result in results), results
summary = {
    "independentlyValidatedXmlFiles": len(results), "validationErrors": 0,
    "sectionsDroppedOnSave": dict(Counter(section for row in audit["files"] for section in row["droppedSections"])),
    "unknownBodyElementTypes": sorted(set(t for row in audit["files"] for t in row["unknownBodyTypes"])),
    "files": results,
}
(folder / "independent-validation.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
print(json.dumps({key: value for key, value in summary.items() if key != "files"}, indent=2))
print("PASS: 57 generated FDX documents independently parsed and validated")
