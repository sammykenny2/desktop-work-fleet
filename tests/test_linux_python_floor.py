"""The Linux host stays within the Python floor its packages declare (Ubuntu 22.04 ships 3.10)."""
import ast
import io
from pathlib import Path
import re
import tokenize
import unittest

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / "src/native/linux"


def declared_floor():
    match = re.search(r"Depends: [^\n]*\bpython3 \(>= 3\.(\d+)\)", (ROOT / "scripts/linux/package-deb.sh").read_text("utf-8"))
    return (3, int(match.group(1)))


def quote(text):
    return re.match(r"[A-Za-z]*('''|\"\"\"|'|\")", text).group(1)


def fstring_violations(source):
    """ast's feature_version accepts 3.12 f-strings, so walk the 3.12+ f-string tokens for what 3.10/3.11 reject."""
    if not hasattr(tokenize, "FSTRING_START"):
        return []  # Before 3.12 an f-string is one STRING token, and ast.parse already rejects these forms.
    found, enclosing = [], []
    for token in tokenize.generate_tokens(io.StringIO(source).readline):
        kind, text, line = token.type, token.string, token.start[0]
        inside = bool(enclosing) and kind not in (tokenize.FSTRING_MIDDLE, tokenize.FSTRING_END)
        if inside and kind in (tokenize.STRING, tokenize.FSTRING_START) and any(quote(text).startswith(q) for q in enclosing):
            found.append((line, "reuses the enclosing quote"))
        if inside and kind == tokenize.STRING and "\\" in text:
            found.append((line, "backslash inside a replacement field"))
        if inside and kind == tokenize.COMMENT:
            found.append((line, "comment inside a replacement field"))
        if inside and kind == tokenize.NL and len(enclosing[-1]) == 1:
            found.append((line, "line break inside a single-quoted f-string"))
        if kind == tokenize.FSTRING_START:
            enclosing.append(quote(text))
        elif kind == tokenize.FSTRING_END:
            enclosing.pop()
    return found


class LinuxPythonFloorTests(unittest.TestCase):
    def test_both_package_formats_declare_the_same_floor(self):
        major, minor = declared_floor()
        self.assertEqual((major, minor), (3, 10))
        generator = (ROOT / "scripts/generate-linux-package.mjs").read_text("utf-8")
        self.assertIn(f"'python3>={major}.{minor}'", generator)

    def test_host_uses_no_newer_syntax(self):
        floor = declared_floor()
        for path in sorted(NATIVE.glob("*.py")):
            source = path.read_text("utf-8")
            with self.subTest(file=path.name):
                ast.parse(source, filename=str(path), feature_version=floor)
                self.assertEqual(fstring_violations(source), [])

    @unittest.skipUnless(hasattr(tokenize, "FSTRING_START"), "only 3.12+ tokenizes f-string parts")
    def test_fstring_check_rejects_forms_that_need_3_12(self):
        for source in ('f"{x["a"]}"\n', 'f"{"\\n".join(x)}"\n', 'f"{f"{y}"}"\n', 'f"{x # note\n}"\n'):
            with self.subTest(source=source):
                self.assertNotEqual(fstring_violations(source), [])
        for source in ("f'{x[\"a\"]}'\n", 'f"""{x["a"]}"""\n', 'f"{x:>{width}}"\n', "f'{f\"{y}\"}'\n"):
            with self.subTest(source=source):
                self.assertEqual(fstring_violations(source), [])


if __name__ == "__main__":
    unittest.main()
