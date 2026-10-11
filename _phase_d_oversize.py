"""Verify 413 for uploads exceeding 50 MB (multer LIMIT_FILE_SIZE)."""
from __future__ import annotations

import os
import struct
import tempfile
import urllib.error
import urllib.request
import zlib

SIZE = 51 * 1024 * 1024
NAME = b"blob.bin"


def make_store_zip(path: str, payload_size: int) -> int:
    data = os.urandom(min(payload_size, 1024 * 1024))  # 1MB random seed
    # Repeat to SIZE without holding two full copies in peak if possible
    payload = (data * ((payload_size // len(data)) + 1))[:payload_size]
    crc = zlib.crc32(payload) & 0xFFFFFFFF
    lh = struct.pack(
        "<IHHHHHIIIHH",
        0x04034B50,
        20,
        0,
        0,
        0,
        0,
        crc,
        len(payload),
        len(payload),
        len(NAME),
        0,
    )
    cd = struct.pack(
        "<IHHHHHHIIIHHHHHII",
        0x02014B50,
        20,
        20,
        0,
        0,
        0,
        0,
        crc,
        len(payload),
        len(payload),
        len(NAME),
        0,
        0,
        0,
        0,
        0,
        0,
    )
    eocd = struct.pack(
        "<IHHHHIIH",
        0x06054B50,
        0,
        0,
        1,
        1,
        len(cd) + len(NAME),
        len(lh) + len(NAME) + len(payload),
        0,
    )
    with open(path, "wb") as f:
        f.write(lh)
        f.write(NAME)
        f.write(payload)
        f.write(cd)
        f.write(NAME)
        f.write(eocd)
    return os.path.getsize(path)


def post(url: str, zip_path: str) -> tuple[int, bytes]:
    boundary = "----Bound51"
    head = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="codebase"; filename="big.zip"\r\n'
        f"Content-Type: application/zip\r\n\r\n"
    ).encode()
    tail = f"\r\n--{boundary}--\r\n".encode()
    with open(zip_path, "rb") as f:
        body = head + f.read() + tail
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as res:
            return res.status, res.read()[:200]
    except urllib.error.HTTPError as e:
        return e.code, e.read()[:200]


def main() -> int:
    zip_path = os.path.join(tempfile.gettempdir(), "phase_d_51mb.zip")
    if not os.path.exists(zip_path) or os.path.getsize(zip_path) < SIZE:
        print("building zip…")
        print("zip_size", make_store_zip(zip_path, SIZE))
    else:
        print("reuse zip_size", os.path.getsize(zip_path))

    failed = 0
    for label, url in (
        ("direct", "http://127.0.0.1:5000/api/upload"),
        ("proxy", "http://127.0.0.1:8000/api/audit/upload"),
    ):
        code, body = post(url, zip_path)
        ok = code == 413
        print(f"[{'PASS' if ok else 'FAIL'}] {label} status={code} body={body[:120]!r}")
        if not ok:
            failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
