"""Reader for Final Draft's binary name database (``Name Database.fddat``).

Observed layout for the Final Draft 13.4.0 database:

    u32be  word0             == 104
    u32be  first_record      == 108
    u32be  b_bucket_offset
    ...
    u32be  z_bucket_offset   (25 offsets, B..Z)
    record*                  u32be length + length bytes, lexicographically sorted

Each character byte is XOR 0x85 to recover lowercase ASCII.  The A bucket
begins at ``first_record``; there is no A offset in the header.
"""

from __future__ import annotations

import bisect
import hashlib
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

XOR_KEY = 0x85
HEADER_SIZE = 108
HEADER_WORD0 = 104
HEADER_FIRST_RECORD = 108
BUCKET_COUNT = 25
MAX_RECORD = 256


class NameDatabaseError(ValueError):
    """Raised when a .fddat file does not match the observed format."""


@dataclass(frozen=True)
class NameDatabase:
    path: Path | None
    data: bytes
    buckets: dict[str, int]
    names: tuple[str, ...]
    sha256: str

    @classmethod
    def from_path(cls, path: str | Path) -> "NameDatabase":
        path = Path(path)
        return cls.from_bytes(path.read_bytes(), path=path)

    @classmethod
    def from_bytes(cls, data: bytes, path: Path | None = None) -> "NameDatabase":
        if len(data) < HEADER_SIZE:
            raise NameDatabaseError("file is shorter than the observed 108-byte header")
        header_end, first_record = struct.unpack_from(">II", data, 0)
        if header_end != HEADER_WORD0 or first_record != HEADER_FIRST_RECORD:
            raise NameDatabaseError(
                f"unexpected header ({header_end}, {first_record}); "
                f"expected ({HEADER_WORD0}, {HEADER_FIRST_RECORD})"
            )

        offsets = list(struct.unpack_from(f">{BUCKET_COUNT}I", data, 8))
        if offsets != sorted(offsets):
            raise NameDatabaseError("bucket offsets are not monotonically increasing")
        if offsets[0] < first_record or offsets[-1] >= len(data):
            raise NameDatabaseError("bucket offset outside the file")

        buckets = {
            chr(ord("B") + index): offset for index, offset in enumerate(offsets)
        }
        names = tuple(_parse_records(data, first_record))
        if not names:
            raise NameDatabaseError("no names were decoded")
        if names != tuple(sorted(names)):
            raise NameDatabaseError("decoded names are not in lexical order")

        return cls(
            path=path,
            data=data,
            buckets=buckets,
            names=names,
            sha256=hashlib.sha256(data).hexdigest(),
        )

    @property
    def count(self) -> int:
        return len(self.names)

    @property
    def first(self) -> str:
        return self.names[0]

    @property
    def last(self) -> str:
        return self.names[-1]

    def search(self, prefix: str, limit: int = 20) -> list[str]:
        if limit <= 0:
            return []
        prefix = prefix.lower()
        if not prefix:
            return list(self.names[:limit])
        index = bisect.bisect_left(self.names, prefix)
        matches: list[str] = []
        while index < len(self.names) and self.names[index].startswith(prefix):
            matches.append(self.names[index])
            if len(matches) >= limit:
                break
            index += 1
        return matches

    def __contains__(self, name: object) -> bool:
        if not isinstance(name, str):
            return False
        candidate = name.lower()
        index = bisect.bisect_left(self.names, candidate)
        return index < len(self.names) and self.names[index] == candidate

    def __iter__(self) -> Iterator[str]:
        return iter(self.names)

    def stats(self) -> dict[str, object]:
        initial_counts: dict[str, int] = {}
        for name in self.names:
            initial_counts[name[0]] = initial_counts.get(name[0], 0) + 1
        return {
            "format": "fddat",
            "source": str(self.path) if self.path else None,
            "sha256": self.sha256,
            "bytes": len(self.data),
            "header": {
                "word0": HEADER_WORD0,
                "first_record": HEADER_FIRST_RECORD,
                "header_bytes": HEADER_SIZE,
                "bucket_count": BUCKET_COUNT,
                "buckets": dict(self.buckets),
            },
            "encoding": {
                "character_xor": f"0x{XOR_KEY:02x}",
                "plaintext": "lowercase ASCII",
                "record": "u32be length + length XOR-obfuscated bytes",
                "order": "lexicographic",
            },
            "names": {
                "count": self.count,
                "first": self.first,
                "last": self.last,
                "initial_counts": initial_counts,
            },
        }


def _parse_records(data: bytes, start: int) -> Iterator[str]:
    position = start
    while position < len(data):
        if position + 4 > len(data):
            raise NameDatabaseError(f"truncated record length at offset {position}")
        length = struct.unpack_from(">I", data, position)[0]
        if length == 0 or length > MAX_RECORD:
            raise NameDatabaseError(
                f"invalid record length {length} at offset {position}"
            )
        body_start = position + 4
        body_end = body_start + length
        if body_end > len(data):
            raise NameDatabaseError(f"truncated record at offset {position}")
        raw = data[body_start:body_end]
        decoded = bytes(byte ^ XOR_KEY for byte in raw)
        try:
            name = decoded.decode("ascii")
        except UnicodeDecodeError as exc:
            raise NameDatabaseError(
                f"record at offset {position} does not decode as ASCII"
            ) from exc
        if not name or name != name.lower():
            raise NameDatabaseError(
                f"record at offset {position} is not lowercase: {name!r}"
            )
        yield name
        position = body_end
