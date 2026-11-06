from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fdformat.fdx import FDXDocument

SYNTHETIC = """<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<FinalDraft DocumentType="Script" Template="No" Version="6">
  <Content>
    <Paragraph Type="Scene Heading" id="scene-1">
      <SceneProperties Length="1/8" Page="1" Title=""/>
      <Text>INT. ROOM - DAY</Text>
    </Paragraph>
    <Paragraph Type="Action" id="action-1">
      <Text>She opens the </Text>
      <Text Style="Italic">only</Text>
      <Text> door.</Text>
    </Paragraph>
    <Paragraph Type="DualDialogue" id="dual-1">
      <DualDialogue>
        <Paragraph Type="Character"><Text>ALICE</Text></Paragraph>
        <Paragraph Type="Dialogue"><Text>Left side.</Text></Paragraph>
        <Paragraph Type="Character"><Text>BOB</Text></Paragraph>
        <Paragraph Type="Dialogue"><Text>Right side.</Text></Paragraph>
      </DualDialogue>
    </Paragraph>
  </Content>
  <PageLayout BottomMargin="72" HeaderMargin="36" FooterMargin="36"
              TopMargin="72" UsesSmartQuotes="Yes">
    <PageSize Height="11.00" Width="8.50"/>
  </PageLayout>
  <ElementSettings Type="Action">
    <FontSpec Font="Courier Final Draft" Size="12" Style=""/>
    <ParagraphSpec Alignment="Left" FirstIndent="0.00" LeftIndent="1.50"
                    RightIndent="7.50" SpaceBefore="12" Spacing="1"
                    StartsNewPage="No" Type="Action"/>
    <Behavior ReturnKey="Action"/>
    <Outline Level="1"/>
  </ElementSettings>
  <ElementSettings Type="Scene Heading">
    <FontSpec Font="Courier Final Draft" Size="12" Style="AllCaps"/>
    <ParagraphSpec Alignment="Left" FirstIndent="0.00" LeftIndent="1.50"
                    RightIndent="7.50" SpaceBefore="24" Spacing="1"
                    StartsNewPage="No" Type="Scene Heading"/>
    <Behavior ReturnKey="Action"/>
    <Outline Level="2"/>
  </ElementSettings>
</FinalDraft>
"""


class FDXDocumentTests(unittest.TestCase):
    def setUp(self) -> None:
        self.document = FDXDocument.from_bytes(SYNTHETIC.encode("utf-8"))

    def test_core_model(self) -> None:
        self.assertEqual(self.document.version, "6")
        self.assertEqual(self.document.document_type, "Script")
        self.assertEqual(len(self.document.paragraphs), 3)
        self.assertEqual(self.document.scene_count, 1)
        self.assertEqual(self.document.word_count, 14)
        self.assertEqual(self.document.paragraphs[1].text, "She opens the only door.")
        self.assertEqual(len(self.document.paragraphs[1].inlines), 3)
        self.assertEqual(self.document.paragraphs[1].inlines[1].font.style, "Italic")

    def test_scene_settings(self) -> None:
        scene = self.document.paragraphs[0]
        self.assertIsNotNone(scene.scene)
        assert scene.scene is not None
        self.assertEqual(scene.scene.page, 1)
        settings = self.document.settings_for(scene)
        self.assertIsNotNone(settings)
        assert settings is not None
        self.assertEqual(settings.paragraph.space_before, 24)
        self.assertTrue(settings.font.style)

    def test_dual_dialogue(self) -> None:
        dual = self.document.paragraphs[2]
        self.assertEqual(len(dual.dual_dialogue), 4)
        text = self.document.render_text(width=80)
        self.assertIn("ALICE", text)
        self.assertIn("BOB", text)
        self.assertIn("Left side.", text)
        self.assertIn("Right side.", text)

    def test_render_html(self) -> None:
        rendered = self.document.render_html(title="Test")
        self.assertIn("width: 8.5in", rendered)
        self.assertIn("margin-left:1.500in", rendered)
        self.assertIn("Test", rendered)
        self.assertIn("Left side.", rendered)

    def test_validation_and_duplicate_ids(self) -> None:
        codes = [issue.code for issue in self.document.validate()]
        self.assertGreaterEqual(codes.count("unregistered-paragraph-type"), 2)
        broken = SYNTHETIC.replace('id="action-1"', 'id="scene-1"')
        issues = FDXDocument.from_bytes(broken.encode("utf-8")).validate()
        self.assertIn("duplicate-paragraph-id", {issue.code for issue in issues})

    def test_write_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "out.fdx"
            self.document.write(path)
            again = FDXDocument.from_path(path)
        self.assertEqual(again.word_count, self.document.word_count)
        self.assertEqual(again.scene_count, 1)
        self.assertEqual(len(again.paragraphs[2].dual_dialogue), 4)


class InstalledTemplateTests(unittest.TestCase):
    TEMPLATE_ROOT = Path(r"C:\Program Files (x86)\Final Draft 13\Templates")

    @unittest.skipUnless(TEMPLATE_ROOT.is_dir(), "Final Draft templates are not installed")
    def test_all_installed_templates_parse(self) -> None:
        templates = sorted(self.TEMPLATE_ROOT.rglob("*.fdxt"))
        self.assertGreaterEqual(len(templates), 50)
        for path in templates:
            with self.subTest(path=path.name):
                document = FDXDocument.from_path(path)
                self.assertEqual(document.version, "6")
                self.assertIsNotNone(document.page_layout)


if __name__ == "__main__":
    unittest.main()
