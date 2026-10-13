"""WebKit renderer defaults that must be chosen before WebKit loads."""
from pathlib import Path

USER_SETTINGS = ("WEBKIT_DISABLE_DMABUF_RENDERER", "WEBKIT_DMABUF_RENDERER_FORCE_SHM")


def raspberry_pi(root="/"):
    base = Path(root)
    try:
        if "raspberry pi" in (base / "proc/device-tree/model").read_bytes().decode("utf-8", "replace").lower():
            return True
    except OSError:
        pass
    return (base / "sys/module/v3d").exists()


def configure(environ, root="/"):
    """Raspberry Pi's V3D DMA-BUF renderer was reported to corrupt the transparent scenes, and WebKit without that
    renderer blanks a whole scene once the pointer moves over it, so the Pi keeps the renderer on shared-memory
    buffers. Elsewhere WebKit keeps its default, and a user setting of either variable always wins."""
    if raspberry_pi(root) and not any(name in environ for name in USER_SETTINGS):
        environ["WEBKIT_DMABUF_RENDERER_FORCE_SHM"] = "1"
