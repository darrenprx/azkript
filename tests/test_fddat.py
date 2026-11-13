from __future__ import annotations

import struct
import unittest
from pathlib import Path

from fdformat.fddat import (
    HEADER_FIRST_RECORD,
    HEADER_WORD0,
    XOR_KEY,
    NameDatabase,
)


def encode_database(names: list[str]) -> bytes:
    records = bytearray()
    offsets: list[int] = []
    for name in names:
        offsets.append(HEADER_FIRST_RECORD + len(records))
        raw = bytes(ord(character) ^ XOR_KEY for character in name)
        records += struct.pack(">I", len(raw)) + raw
    # A small fixture only has A names.  The observed header still contains 25
    # bucket offsets (B..Z); keep them valid and inside the file.
    buckets = [HEADER_FIRST_RECORD] * 25
    header = struct.pack(">II", HEADER_WORD0, HEADER_FIRST_RECORD)
    header += struct.pack(">25I", *buckets)
    return header + records


class NameDatabaseTests(unittest.TestCase):
    def test_round_trip_and_search(self) -> None:
        database = NameDatabase.from_bytes(
            encode_database(["aaberg", "aaron", "abigail"])
        )
        self.assertEqual(database.count, 3)
        self.assertEqual(database.first, "aaberg")
        self.assertEqual(database.last, "abigail")
        self.assertEqual(database.search("aa"), ["aaberg", "aaron"])
        self.assertIn("aaron", database)
        self.assertEqual(database.stats()["encoding"]["character_xor"], "0x85")

    def test_rejects_invalid_header(self) -> None:
        with self.assertRaises(ValueError):
            NameDatabase.from_bytes(b"not a database")

    def test_nonpositive_search_limit_is_empty_with_or_without_prefix(self) -> None:
        database = NameDatabase.from_bytes(encode_database(["aaberg", "aaron", "abigail"]))
        for prefix in ("", "aa"):
            for limit in (0, -1):
                self.assertEqual(database.search(prefix, limit=limit), [])
        self.assertEqual(database.search("aa", limit=1), ["aaberg"])

    INSTALLED = Path(
        r"C:\Program Files (x86)\Final Draft 13\Data\Names\Name Database.fddat"
    )

    @unittest.skipUnless(INSTALLED.is_file(), "Final Draft name database is not installed")
    def test_installed_database(self) -> None:
        database = NameDatabase.from_path(self.INSTALLED)
        self.assertEqual(database.count, 88799)
        self.assertEqual(database.first, "aaberg")
        self.assertEqual(database.last, "zywiec")
        self.assertEqual(database.search("aaron", limit=3)[0], "aaron")


if __name__ == "__main__":
    unittest.main()
