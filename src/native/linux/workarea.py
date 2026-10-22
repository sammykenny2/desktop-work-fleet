"""Work areas for layer-shell scenes: the part of each monitor that panels leave free.

GTK on Wayland reports a monitor's whole geometry as its work area, so new papers would land under a panel such as
wf-panel-pi. Compositors that run XWayland, such as labwc, publish the free area as _NET_WORKAREA on its root window,
which is read here through libxcb: unlike Xlib, it never ends the process when the connection is lost. Without a
published area, papers keep MARGIN clear on every edge. The margin is only a guess, so it waits for a definite answer:
until then the monitor stays whole, and a guess never rescues papers that sit near an edge for good."""
import ctypes
import os
import threading
import time

import scenes

# Clears the usual panels at scale 1: wf-panel-pi 36, GNOME 32, KDE Plasma 44, Windows 48.
MARGIN = 48
CARDINAL = 6
NAME = b"_NET_WORKAREA"
# How long a connection or a new layout may go without a matching area before it counts as unpublished: an Xwayland
# the compositor starts on demand only gets _NET_WORKAREA once the compositor's window manager is attached.
GRACE = 10.0
# Not answered yet: the monitor keeps GTK's work area.
UNKNOWN = object()


def inset(rect, margin):
    # A display too small for the margin keeps its whole area rather than losing every place for a paper.
    if rect["width"] <= 4 * margin or rect["height"] <= 4 * margin:
        return dict(rect)
    return {"x": rect["x"] + margin, "y": rect["y"] + margin, "width": rect["width"] - 2 * margin, "height": rect["height"] - 2 * margin}


def resolve(geometry, work, published):
    """GTK's work area when it knows one or XWayland has not answered, then the published area within this monitor,
    then the monitor less MARGIN."""
    if work != geometry or published is UNKNOWN:
        return dict(work)
    free = None if published is None else scenes.intersection(geometry, published)
    return free if free is not None else inset(geometry, MARGIN)


def accept(values, root, layout):
    """The first desktop's area, if it uses the same coordinates as GTK: the X root must span the monitor layout,
    which a compositor that scales XWayland itself does not."""
    if len(values) < 4 or root != layout:
        return None
    x, y, width, height = values[:4]
    if width <= 0 or height <= 0 or x + width > root[0] or y + height > root[1]:
        return None
    return {"x": x, "y": y, "width": width, "height": height}


class Cookie(ctypes.Structure):
    _fields_ = [("sequence", ctypes.c_uint)]


class Screens(ctypes.Structure):
    _fields_ = [("data", ctypes.c_void_p), ("rem", ctypes.c_int), ("index", ctypes.c_int)]


class Screen(ctypes.Structure):
    _fields_ = [("root", ctypes.c_uint32)]


class AtomReply(ctypes.Structure):
    _fields_ = [("response_type", ctypes.c_uint8), ("pad0", ctypes.c_uint8), ("sequence", ctypes.c_uint16),
                ("length", ctypes.c_uint32), ("atom", ctypes.c_uint32)]


class GeometryReply(ctypes.Structure):
    _fields_ = [("response_type", ctypes.c_uint8), ("depth", ctypes.c_uint8), ("sequence", ctypes.c_uint16),
                ("length", ctypes.c_uint32), ("root", ctypes.c_uint32), ("x", ctypes.c_int16), ("y", ctypes.c_int16),
                ("width", ctypes.c_uint16), ("height", ctypes.c_uint16), ("border_width", ctypes.c_uint16)]


class PropertyReply(ctypes.Structure):
    _fields_ = [("response_type", ctypes.c_uint8), ("format", ctypes.c_uint8), ("sequence", ctypes.c_uint16),
                ("length", ctypes.c_uint32), ("type", ctypes.c_uint32), ("bytes_after", ctypes.c_uint32),
                ("value_len", ctypes.c_uint32)]


def bind():
    # Sonames rather than ctypes.util.find_library, which runs ldconfig in a subprocess. libxcb comes with GTK's X11
    # backend; free comes from the C library Python itself links.
    xcb, libc = ctypes.CDLL("libxcb.so.1"), ctypes.CDLL(None)
    connection, error = ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)
    for name, result, arguments in (
            ("xcb_connect", connection, [ctypes.c_char_p, ctypes.POINTER(ctypes.c_int)]),
            ("xcb_connection_has_error", ctypes.c_int, [connection]),
            ("xcb_disconnect", None, [connection]),
            ("xcb_poll_for_event", ctypes.c_void_p, [connection]),
            ("xcb_get_setup", ctypes.c_void_p, [connection]),
            ("xcb_setup_roots_iterator", Screens, [ctypes.c_void_p]),
            ("xcb_screen_next", None, [ctypes.POINTER(Screens)]),
            ("xcb_intern_atom", Cookie, [connection, ctypes.c_uint8, ctypes.c_uint16, ctypes.c_char_p]),
            ("xcb_intern_atom_reply", ctypes.POINTER(AtomReply), [connection, Cookie, error]),
            ("xcb_get_geometry", Cookie, [connection, ctypes.c_uint32]),
            ("xcb_get_geometry_reply", ctypes.POINTER(GeometryReply), [connection, Cookie, error]),
            ("xcb_get_property", Cookie, [connection, ctypes.c_uint8, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_uint32, ctypes.c_uint32]),
            ("xcb_get_property_reply", ctypes.POINTER(PropertyReply), [connection, Cookie, error]),
            ("xcb_get_property_value", ctypes.c_void_p, [ctypes.POINTER(PropertyReply)]),
            ("xcb_get_property_value_length", ctypes.c_int, [ctypes.POINTER(PropertyReply)])):
        function = getattr(xcb, name)
        function.restype, function.argtypes = result, arguments
    libc.free.restype, libc.free.argtypes = None, [ctypes.c_void_p]
    return xcb, libc


class Published:
    """_NET_WORKAREA, read on a thread of its own so that an Xwayland that is starting or stalled holds up GTK for at
    most first seconds at start and wait seconds on a display change.

    The thread owns one connection and reads every interval seconds; holding it keeps an Xwayland that the compositor
    starts on demand running while Work Fleet does. A read that fails keeps the sample before it, so a lost reply never
    shrinks the work area to the margin."""
    def __init__(self, display=None, library=bind, interval=2.0, first=3.0, wait=1.0, grace=GRACE):
        self.display = os.environ.get("DISPLAY", "") if display is None else display
        self.bind, self.library, self.connection = library, None, None
        self.root = self.atom = 0
        self.opened = 0.0
        self.interval, self.first, self.wait, self.grace = interval, first, wait, grace
        self.condition = threading.Condition()
        self.thread = self.layout = self.sample = None
        self.wanted = self.done = 0
        self.changed = 0.0
        self.closed = self.answered = False

    def read(self, layout):
        """The published area for a monitor layout spanning layout = (width, height) from the origin; None when
        nothing is published; UNKNOWN until the first answer, or while a new layout's area does not match yet.

        A new layout waits up to wait seconds for a fresh sample (first seconds at start, while Xwayland may still be
        starting); the same layout uses the latest sample."""
        layout = tuple(layout)
        with self.condition:
            if self.layout != layout:
                wait = self.wait if self.layout is not None else self.first
                self.layout, self.changed = layout, time.monotonic()
                self.refresh(wait)
            if self.closed or not self.display:
                return None
            if self.sample is None:
                return None if self.answered else UNKNOWN
            values, root = self.sample
            # XWayland may still report the old layout just after a display change.
            if root != layout and time.monotonic() - self.changed < self.grace:
                return UNKNOWN
        return accept(values, root, layout)

    def refresh(self, wait):
        """Asks the thread for a new sample and waits up to wait seconds for it; the caller holds the condition."""
        if self.closed or not self.display:
            return
        if self.thread is None:
            self.thread = threading.Thread(target=self.run, name="work-fleet-workarea", daemon=True)
            self.thread.start()
        self.wanted += 1
        wanted = self.wanted
        self.condition.notify_all()
        self.condition.wait_for(lambda: self.done >= wanted or self.closed or not self.display, wait)

    def close(self):
        """The thread disconnects once it is free; one still waiting on a stalled Xwayland ends with the process."""
        with self.condition:
            self.closed = True
            self.condition.notify_all()

    def run(self):
        try:
            self.library = self.bind()
        except Exception:
            with self.condition:
                # Without libxcb there is nothing to read, now or on a later poll.
                self.display = ""
                self.condition.notify_all()
            return
        while True:
            with self.condition:
                self.condition.wait_for(lambda: self.closed or self.wanted > self.done, self.interval)
                if self.closed:
                    break
                wanted = self.wanted
            try:
                sample = self.fetch()
            except Exception:
                self.disconnect()
                sample = None
            with self.condition:
                if sample is not None:
                    self.sample = sample
                # No server, or a connection that has had its grace without the property, answers for good.
                self.answered = (self.answered or sample is not None or self.connection is None
                                 or time.monotonic() - self.opened >= self.grace)
                self.done = wanted
                self.condition.notify_all()
        self.disconnect()

    def fetch(self):
        """One blocking read on the thread: the property's cardinals and the root size, or None."""
        xcb, libc = self.library
        if self.connection is not None and xcb.xcb_connection_has_error(self.connection):
            self.disconnect()
        if self.connection is None:
            self.open()
            if self.connection is None:
                return None
        # Nothing is selected, but MappingNotify reaches every client; drop what has queued up.
        event = xcb.xcb_poll_for_event(self.connection)
        while event:
            libc.free(event)
            event = xcb.xcb_poll_for_event(self.connection)
        geometry = self.reply(xcb.xcb_get_geometry_reply, xcb.xcb_get_geometry(self.connection, self.root))
        if geometry is None:
            return None
        if not self.atom:
            atom = self.reply(xcb.xcb_intern_atom_reply, xcb.xcb_intern_atom(self.connection, 1, len(NAME), NAME))
            self.atom = 0 if atom is None else atom.atom
            if not self.atom:
                return None
        values = self.cardinals(xcb.xcb_get_property(self.connection, 0, self.root, self.atom, CARDINAL, 0, 4))
        return None if values is None else (values, (geometry.width, geometry.height))

    def open(self):
        xcb, _ = self.library
        preferred = ctypes.c_int(0)
        connection = xcb.xcb_connect(self.display.encode(), ctypes.byref(preferred))
        if not connection or xcb.xcb_connection_has_error(connection):
            if connection:
                xcb.xcb_disconnect(connection)
            return
        screens = xcb.xcb_setup_roots_iterator(xcb.xcb_get_setup(connection))
        for _ in range(max(0, preferred.value)):
            xcb.xcb_screen_next(ctypes.byref(screens))
        if screens.rem <= 0 or not screens.data:
            xcb.xcb_disconnect(connection)
            return
        self.connection, self.root, self.atom = connection, Screen.from_address(screens.data).root, 0
        self.opened = time.monotonic()

    def reply(self, function, cookie):
        """Copies the reply and frees what libxcb allocated; an X error reads as no reply."""
        _, libc = self.library
        error = ctypes.c_void_p()
        pointer = function(self.connection, cookie, ctypes.byref(error))
        if error.value:
            libc.free(error.value)
        if not pointer:
            return None
        value = type(pointer.contents).from_buffer_copy(pointer.contents)
        libc.free(ctypes.cast(pointer, ctypes.c_void_p).value)
        return value

    def cardinals(self, cookie):
        xcb, libc = self.library
        error = ctypes.c_void_p()
        pointer = xcb.xcb_get_property_reply(self.connection, cookie, ctypes.byref(error))
        if error.value:
            libc.free(error.value)
        if not pointer:
            return None
        try:
            reply = pointer.contents
            if reply.format != 32 or reply.type != CARDINAL:
                return None
            count = xcb.xcb_get_property_value_length(pointer) // 4
            return list((ctypes.c_uint32 * count).from_address(xcb.xcb_get_property_value(pointer))) if count else []
        finally:
            libc.free(ctypes.cast(pointer, ctypes.c_void_p).value)

    def disconnect(self):
        if self.connection is not None and self.library is not None:
            self.library[0].xcb_disconnect(self.connection)
        self.connection, self.root, self.atom = None, 0, 0
