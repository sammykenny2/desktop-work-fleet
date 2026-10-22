"""Layer-shell work areas leave panels free: the XWayland _NET_WORKAREA within each monitor, otherwise a margin."""
import ctypes
import importlib.util
from pathlib import Path
import sys
import threading
import time
import types
import unittest

NATIVE = Path(__file__).resolve().parents[1] / "src/native/linux"


def load_native(name):
    spec = importlib.util.spec_from_file_location(name, NATIVE / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


previous = {name: sys.modules.get(name) for name in ("protocol", "scenes")}
sys.modules["protocol"] = load_native("protocol")
sys.modules["scenes"] = load_native("scenes")
try:
    workarea = load_native("workarea")
finally:
    for name, module in previous.items():
        if module is None:
            sys.modules.pop(name)
        else:
            sys.modules[name] = module

SCREEN = {"x": 0, "y": 0, "width": 1920, "height": 1080}
# wf-panel-pi on labwc, as XWayland reports it on a 1920 x 1080 Raspberry Pi display (2026-10-23).
TOP_PANEL = {"x": 0, "y": 36, "width": 1920, "height": 1044}


class FakeXcb:
    """libxcb as workarea calls it, answering from Python; every structure it hands out stays alive with it."""
    def __init__(self, values=(0, 36, 1920, 1044), root=(1920, 1080), atom=301, value_format=32, kind=6):
        self.values, self.root, self.atom, self.value_format, self.kind = list(values), root, atom, value_format, kind
        self.kept, self.calls, self.error, self.events = [], [], 0, []
        self.missing, self.failing = set(), set()

    def keep(self, value):
        self.kept.append(value)
        return value

    def answer(self, name, error, reply):
        if name in self.failing:
            # An X error: libxcb hands the caller an error to free and no reply.
            error._obj.value = 4000 + len(self.calls)
            return None
        return None if name in self.missing else ctypes.pointer(self.keep(reply))

    def xcb_connect(self, name, _preferred):
        self.calls.append(("connect", name))
        return 1000 + len(self.calls)

    def xcb_connection_has_error(self, _connection):
        return self.error

    def xcb_disconnect(self, connection):
        self.calls.append(("disconnect", connection))

    def xcb_poll_for_event(self, _connection):
        return self.events.pop(0) if self.events else None

    def xcb_get_setup(self, _connection):
        return 1

    def xcb_setup_roots_iterator(self, _setup):
        screen = self.keep(workarea.Screen(root=77))
        return workarea.Screens(data=ctypes.addressof(screen), rem=1, index=0)

    def xcb_screen_next(self, _screens):
        raise AssertionError("only screen 0 is used")

    def xcb_get_geometry(self, _connection, window):
        self.calls.append(("geometry", window))
        return workarea.Cookie(1)

    def xcb_get_geometry_reply(self, _connection, _cookie, error):
        return self.answer("geometry", error, workarea.GeometryReply(width=self.root[0], height=self.root[1]))

    def xcb_intern_atom(self, _connection, only_if_exists, length, name):
        self.calls.append(("atom", only_if_exists, length, name))
        return workarea.Cookie(2)

    def xcb_intern_atom_reply(self, _connection, _cookie, error):
        return self.answer("atom", error, workarea.AtomReply(atom=self.atom))

    def xcb_get_property(self, _connection, delete, window, atom, kind, offset, length):
        self.calls.append(("property", delete, window, atom, kind, offset, length))
        return workarea.Cookie(3)

    def xcb_get_property_reply(self, _connection, _cookie, error):
        reply = workarea.PropertyReply(format=self.value_format, type=self.kind, value_len=len(self.values))
        return self.answer("property", error, reply)

    def xcb_get_property_value(self, _reply):
        return ctypes.addressof(self.keep((ctypes.c_uint32 * len(self.values))(*self.values)))

    def xcb_get_property_value_length(self, _reply):
        return 4 * len(self.values)


def fetcher(xcb, display=":0"):
    """A reader whose fetch runs on the test thread, with free recording what it is handed."""
    freed = []
    reader = workarea.Published(display)
    reader.library = (xcb, types.SimpleNamespace(free=freed.append))
    return reader, freed


def threaded(xcb, display=":0", **timing):
    return workarea.Published(display, lambda: (xcb, types.SimpleNamespace(free=lambda _address: None)), **timing)


def settled(reader):
    """Waits for a read on the thread that starts after this call."""
    with reader.condition:
        reader.wanted += 1
        target = reader.wanted
        reader.condition.notify_all()
        return reader.condition.wait_for(lambda: reader.done >= target, 5)


class ResolveTests(unittest.TestCase):
    def test_published_area_keeps_new_papers_off_the_panel(self):
        self.assertEqual(workarea.resolve(SCREEN, SCREEN, TOP_PANEL), TOP_PANEL)

    def test_a_published_area_without_panels_is_the_whole_monitor(self):
        self.assertEqual(workarea.resolve(SCREEN, SCREEN, dict(SCREEN)), SCREEN)

    def test_a_work_area_gtk_knows_wins(self):
        gtk = {"x": 0, "y": 0, "width": 1920, "height": 1032}
        self.assertEqual(workarea.resolve(SCREEN, gtk, TOP_PANEL), gtk)

    def test_without_a_published_area_every_edge_keeps_the_margin(self):
        self.assertEqual(workarea.MARGIN, 48)
        self.assertEqual(workarea.resolve(SCREEN, SCREEN, None), {"x": 48, "y": 48, "width": 1824, "height": 984})

    def test_each_monitor_takes_its_part_of_the_published_area(self):
        right = {"x": 1920, "y": 0, "width": 1280, "height": 1024}
        whole = {"x": 0, "y": 36, "width": 3200, "height": 988}
        self.assertEqual(workarea.resolve(right, right, whole), {"x": 1920, "y": 36, "width": 1280, "height": 988})
        # A monitor the published area misses entirely falls back to the margin.
        self.assertEqual(workarea.resolve(right, right, TOP_PANEL), {"x": 1968, "y": 48, "width": 1184, "height": 928})

    def test_before_xwayland_answers_the_monitor_stays_whole(self):
        self.assertEqual(workarea.resolve(SCREEN, SCREEN, workarea.UNKNOWN), SCREEN)

    def test_a_display_too_small_for_the_margin_keeps_its_whole_area(self):
        small = {"x": 0, "y": 0, "width": 320, "height": 180}
        self.assertEqual(workarea.resolve(small, small, None), small)

    def test_accept_requires_the_coordinates_gtk_uses(self):
        self.assertEqual(workarea.accept([0, 36, 1920, 1044], (1920, 1080), (1920, 1080)), TOP_PANEL)
        # Only the first desktop's area is used.
        self.assertEqual(workarea.accept([0, 36, 1920, 1044, 0, 0, 1, 1], (1920, 1080), (1920, 1080)), TOP_PANEL)
        # A compositor that scales XWayland itself reports device pixels.
        self.assertIsNone(workarea.accept([0, 72, 3840, 2088], (3840, 2160), (1920, 1080)))
        self.assertIsNone(workarea.accept([0, 36, 1920], (1920, 1080), (1920, 1080)))
        self.assertIsNone(workarea.accept([0, 36, 0, 1044], (1920, 1080), (1920, 1080)))
        self.assertIsNone(workarea.accept([0, 36, 1920, 1080], (1920, 1080), (1920, 1080)))


class FetchTests(unittest.TestCase):
    def test_reads_the_root_property_over_one_connection(self):
        xcb = FakeXcb()
        xcb.events = [5001, 5002]
        reader, freed = fetcher(xcb)
        self.assertEqual(reader.fetch(), ([0, 36, 1920, 1044], (1920, 1080)))
        self.assertEqual(reader.fetch(), ([0, 36, 1920, 1044], (1920, 1080)))
        self.assertEqual([call for call in xcb.calls if call[0] == "connect"], [("connect", b":0")])
        self.assertEqual([call for call in xcb.calls if call[0] == "atom"], [("atom", 1, 13, b"_NET_WORKAREA")])
        self.assertIn(("property", 0, 77, 301, 6, 0, 4), xcb.calls)
        # Queued events, then geometry, atom and property replies; the atom is not asked for again.
        self.assertEqual(freed[:2], [5001, 5002])
        self.assertEqual(len(freed), 7)
        reader.disconnect()
        self.assertEqual(xcb.calls[-1][0], "disconnect")

    def test_a_missing_or_foreign_property_reads_as_nothing(self):
        for xcb in (FakeXcb(atom=0), FakeXcb(value_format=8), FakeXcb(kind=31), FakeXcb(values=())):
            values = fetcher(xcb)[0].fetch()
            self.assertTrue(values is None or not values[0])
            self.assertIsNone(None if values is None else workarea.accept(values[0], values[1], (1920, 1080)))

    def test_an_x_error_is_freed_and_reads_as_nothing(self):
        for name in ("geometry", "atom", "property"):
            xcb = FakeXcb()
            xcb.failing.add(name)
            reader, freed = fetcher(xcb)
            self.assertIsNone(reader.fetch())
            self.assertTrue(any(address >= 4000 for address in freed), name)

    def test_a_reply_lost_with_the_connection_reads_as_nothing(self):
        for name in ("geometry", "atom", "property"):
            xcb = FakeXcb()
            xcb.missing.add(name)
            self.assertIsNone(fetcher(xcb)[0].fetch(), name)

    def test_a_lost_connection_is_opened_again(self):
        xcb = FakeXcb()
        reader, _ = fetcher(xcb)
        reader.fetch()
        xcb.error = 1
        self.assertIsNone(reader.fetch())
        xcb.error = 0
        self.assertIsNotNone(reader.fetch())
        # The broken connection closes, the reconnect that still fails closes too, and the next read connects.
        self.assertEqual([call[0] for call in xcb.calls if call[0] in ("connect", "disconnect")],
                         ["connect", "disconnect", "connect", "disconnect", "connect"])


class PublishedTests(unittest.TestCase):
    def test_the_first_read_waits_for_the_thread(self):
        reader = threaded(FakeXcb())
        try:
            self.assertEqual(reader.read((1920, 1080)), TOP_PANEL)
            self.assertEqual(reader.read((1920, 1080)), TOP_PANEL)
            self.assertEqual(reader.thread.name, "work-fleet-workarea")
        finally:
            reader.close()

    def test_a_failed_read_keeps_the_sample_before_it(self):
        xcb = FakeXcb()
        reader = threaded(xcb)
        try:
            self.assertEqual(reader.read((1920, 1080)), TOP_PANEL)
            xcb.missing.add("property")
            self.assertTrue(settled(reader))
            self.assertEqual(reader.read((1920, 1080)), TOP_PANEL)
        finally:
            reader.close()

    def test_a_moved_panel_is_picked_up_by_the_next_read(self):
        xcb = FakeXcb()
        reader = threaded(xcb, interval=0.01)
        try:
            self.assertEqual(reader.read((1920, 1080)), TOP_PANEL)
            xcb.values = [0, 0, 1920, 1032]
            self.assertTrue(settled(reader))
            self.assertEqual(reader.read((1920, 1080)), {"x": 0, "y": 0, "width": 1920, "height": 1032})
        finally:
            reader.close()

    def test_a_new_layout_waits_for_a_fresh_sample(self):
        xcb = FakeXcb()
        reader = threaded(xcb, interval=60)
        try:
            self.assertEqual(reader.read((1920, 1080)), TOP_PANEL)
            xcb.root, xcb.values = (3200, 1080), [0, 36, 3200, 1044]
            self.assertEqual(reader.read((3200, 1080)), {"x": 0, "y": 36, "width": 3200, "height": 1044})
        finally:
            reader.close()

    def test_a_stalled_xwayland_does_not_hold_up_the_caller(self):
        release = threading.Event()

        class Stalled(FakeXcb):
            def xcb_get_geometry_reply(self, connection, cookie, error):
                release.wait(5)
                return super().xcb_get_geometry_reply(connection, cookie, error)
        reader = threaded(Stalled(), first=0.05, wait=0.05)
        try:
            started = time.monotonic()
            # Without an answer the margin is not guessed, so no paper is rescued from near an edge.
            self.assertIs(reader.read((1920, 1080)), workarea.UNKNOWN)
            self.assertIs(reader.read((1280, 720)), workarea.UNKNOWN)
            self.assertLess(time.monotonic() - started, 2)
        finally:
            release.set()
            reader.close()

    def test_a_property_still_missing_after_the_grace_reads_as_unpublished(self):
        xcb = FakeXcb()
        xcb.missing.add("property")
        reader = threaded(xcb)
        try:
            self.assertIs(reader.read((1920, 1080)), workarea.UNKNOWN)
        finally:
            reader.close()
        reader = threaded(xcb, grace=0)
        try:
            self.assertIsNone(reader.read((1920, 1080)))
        finally:
            reader.close()

    def test_a_root_still_at_the_old_layout_waits_out_the_grace(self):
        reader = threaded(FakeXcb(), interval=60)
        try:
            self.assertEqual(reader.read((1920, 1080)), TOP_PANEL)
            self.assertIs(reader.read((3200, 1080)), workarea.UNKNOWN)
            reader.grace = 0
            self.assertIsNone(reader.read((3200, 1080)))
        finally:
            reader.close()

    def test_close_ends_the_thread_and_its_connection(self):
        xcb = FakeXcb()
        reader = threaded(xcb)
        reader.read((1920, 1080))
        reader.close()
        reader.thread.join(5)
        self.assertFalse(reader.thread.is_alive())
        self.assertEqual(xcb.calls[-1][0], "disconnect")
        self.assertIsNone(reader.read((1280, 720)))

    def test_without_x_nothing_is_loaded(self):
        def refuse():
            raise AssertionError("libxcb must not load without DISPLAY")
        reader = workarea.Published("", refuse)
        self.assertIsNone(reader.read((1920, 1080)))
        self.assertIsNone(reader.thread)

    def test_without_libxcb_later_reads_do_not_try_again(self):
        attempts = []

        def missing():
            attempts.append(1)
            raise OSError("libxcb.so.1: cannot open shared object file")
        reader = workarea.Published(":0", missing)
        self.assertIsNone(reader.read((1920, 1080)))
        self.assertEqual(reader.display, "")
        self.assertIsNone(reader.read((1280, 720)))
        self.assertEqual(attempts, [1])

    def test_real_libxcb_without_a_server_reads_as_unpublished(self):
        try:
            workarea.bind()
        except OSError:
            self.skipTest("libxcb is not installed")
        # libxcb itself refuses this display name, without trying a socket or TCP.
        reader = workarea.Published("unix:59000")
        try:
            self.assertIsNone(reader.read((1920, 1080)))
            self.assertEqual(reader.display, "unix:59000")
        finally:
            reader.close()


if __name__ == "__main__":
    unittest.main()
