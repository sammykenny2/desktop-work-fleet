"""Verify the compositor received real passive and interactive input regions."""
import json
from pathlib import Path
import re
import sys

surfaces, layers, regions = {}, {}, {}
passive = interactive = 0
for line in Path(sys.argv[1]).read_text().splitlines():
    match = re.search(r'get_layer_surface\(new id zwlr_layer_surface_v1@(\d+), wl_surface@(\d+), wl_output@\d+, (\d+), "work-fleet"\)', line)
    if match:
        role, surface, layer = map(int, match.groups())
        surfaces[surface] = layers[role] = layer
    match = re.search(r'create_region\(new id wl_region@(\d+)\)', line)
    if match:
        regions[int(match[1])] = []
    match = re.search(r'wl_region@(\d+)\.add\(([^)]+)\)', line)
    if match:
        regions.setdefault(int(match[1]), []).append(match[2])
    match = re.search(r'wl_surface@(\d+)\.set_input_region\(wl_region@(\d+)\)', line)
    if match and int(match[1]) in surfaces:
        surface, region = map(int, match.groups())
        if surfaces[surface] == 0:
            assert not regions[region], "The compositor received an interactive wallpaper region"
            passive += 1
        elif regions[region]:
            interactive += 1
    match = re.search(r'zwlr_layer_surface_v1@(\d+)\.set_keyboard_interactivity\((\d+)\)', line)
    if match and layers.get(int(match[1])) == 0:
        assert int(match[2]) == 0, "Wallpaper requested keyboard focus"
assert passive >= 3 and interactive >= 2, "Missing real compositor input-region evidence"
Path(sys.argv[2]).write_text(json.dumps({"passiveWallpaperCommits": passive, "interactivePaperCommits": interactive}, indent=2) + "\n")
print("PASS Wayland protocol: empty wallpaper regions, passive keyboard and interactive paper regions")
