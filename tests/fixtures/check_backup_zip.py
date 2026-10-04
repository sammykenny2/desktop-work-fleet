"""Independent standard-library ZIP validation for backup archive tests (stdin bytes)."""

import hashlib
import io
import json
import sys
import zipfile

with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive:
    assert archive.testzip() is None
    print(json.dumps({name: hashlib.sha256(archive.read(name)).hexdigest() for name in archive.namelist()}))
