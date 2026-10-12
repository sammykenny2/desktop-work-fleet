"""WebKit renderer defaults that must be chosen before WebKit loads."""
from pathlib import Path


def disable_dmabuf(root="/"):
    """Raspberry Pi's V3D DMA-BUF renderer corrupts the transparent scenes. Elsewhere WebKit keeps its default, because
    the shared-memory fallback leaves stale pixels where a moved paper used to be."""
    base = Path(root)
    try:
        if "raspberry pi" in (base / "proc/device-tree/model").read_bytes().decode("utf-8", "replace").lower():
            return True
    except OSError:
        pass
    return (base / "sys/module/v3d").exists()
