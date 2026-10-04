"""Check real relative Markdown links, UTF-8/LF and whitespace without reading other agent instructions."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
excluded = {"CLAUDE.md", "GEMINI.md"}
errors = []
links = 0
files = [p for p in ROOT.rglob("*.md") if not any(part in {".git", "build", "node_modules", ".npm", ".claude", ".agents"} for part in p.parts) and p.name not in excluded]
for path in files:
    text = path.read_text(encoding="utf-8")
    if b"\r" in path.read_bytes():
        errors.append(f"{path.relative_to(ROOT)}: CRLF")
    clean = re.sub(r"```.*?```", "", text, flags=re.S)
    for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", clean):
        if target.startswith(("http:", "https:", "mailto:", "#", "app:")):
            continue
        target = target.split("#", 1)[0]
        if "SPEC-XXX" in target or "PLAN-XXX" in target:
            continue
        if not (path.parent / target).exists():
            errors.append(f"{path.relative_to(ROOT)}: missing {target}")
        links += 1
if errors:
    raise SystemExit("\n".join(errors))
print(f"PASS: {len(files)} Markdown files, {links} relative links, UTF-8/LF")
