"""One native mailbox routes display-only surfaces to the management document."""
import time
from gi.repository import Gdk, Gio, GLib, Gtk

import labwc
import protocol as p
import scenes
from shortcuts import Shortcuts
from text import t
import workarea
from surface import Surface, adjust_overlay, backend, come_back, layers, rectangle, remap, resident_layers, scene_viewport, step_aside, wallpaper_placement


class Desktop:
    def __init__(self, assets, web_factory, send, main, hide):
        self.mode = backend()
        p.require(self.mode is not None, "desktop-unsupported", "This desktop doesn't offer what desktop notes need; notes can still be saved in the main window.")
        self.layers = layers(self.mode)
        self.assets, self.web_factory, self.send, self.main, self.hide = assets, web_factory, send, main, hide
        self.session = p.identifier()
        self.transfers = scenes.Transfers()
        self.views, self.commands, self.flushes, self.frozen, self.scene_intents = [], {}, {}, {}, {}
        self.frame = self.frame_token = self.intent = self.focus_sequence = None
        self.proposed = self.displays = None
        self.topology = self.proposed_topology = 0
        self.started = self.closed = self.pending = self.blocked = self.native_menu = False
        self.bindings, self.signals, self.timers = {}, [], []
        self.last_input = self.last_timestamp = 0
        self.display_timer = self.main_place = self.main_timer = None
        application = main.get_application() if hasattr(main, "get_application") else None
        compositor = labwc.Config.detect(self.mode, application.get_application_id() if application is not None else None)
        self.shortcuts = Shortcuts(self.mode, self.action, lambda values: self.send("desktop-shortcut-status", registrations=values, labwc=self.shortcuts.labwc_status()), compositor)
        self.watch(main)
        display = Gdk.Display.get_default()
        self.connect(display, "monitor-added", lambda *_: self.refresh_displays())
        self.connect(display, "monitor-removed", lambda *_: self.refresh_displays())
        self.connect(Gdk.Screen.get_default(), "monitors-changed", lambda *_: self.refresh_displays())
        self.connect(Gdk.Screen.get_default(), "size-changed", lambda *_: self.refresh_displays())
        self.sleep_bus = self.sleep_subscription = None
        try:
            self.sleep_bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, None)
            self.sleep_subscription = self.sleep_bus.signal_subscribe("org.freedesktop.login1", "org.freedesktop.login1.Manager", "PrepareForSleep", "/org/freedesktop/login1", None, Gio.DBusSignalFlags.NONE, self.sleep_changed, None)
        except GLib.Error:
            pass
        # GTK on Wayland has no work area, so layer-shell scenes ask XWayland where the panels are.
        self.published = workarea.Published() if self.mode == "wayland-layer-shell" else None
        try:
            self.displays = self.read_displays()
            self.monitor_fingerprint = self.fingerprint(self.displays)
            self.timers.append(GLib.timeout_add_seconds(2, self.poll_displays))
            self.focus_changed()
            for display in self.displays:
                for layer in self.layers:
                    self.new_view(display, layer)
        except Exception:
            self.close()
            raise

    def connect(self, source, signal, callback):
        token = source.connect(signal, callback)
        self.signals.append((source, token))

    def watch(self, window):
        self.connect(window, "focus-in-event", self.focus_changed)
        self.connect(window, "focus-out-event", self.focus_changed)
        self.connect(window, "key-press-event", self.input)
        self.connect(window, "button-press-event", self.input)

    def input(self, _window, event):
        self.last_input, self.last_timestamp = time.monotonic(), int(getattr(event, "time", 0))
        return False

    def focused(self):
        return any(window.is_active() for window in Gtk.Window.list_toplevels())

    def focus_changed(self, *_):
        GLib.idle_add(lambda: self.update_suspension() if not self.closed else False)
        return False

    def update_suspension(self):
        self.shortcuts.suspend(self.blocked or self.native_menu or self.focused())
        return False

    def menu_active(self, active):
        self.native_menu = active
        self.update_suspension()

    def read_displays(self):
        display = Gdk.Display.get_default()
        count = display.get_n_monitors()
        p.require(0 < count <= 16, "desktop-capacity", "There are more displays than desktop notes support; your data is kept.")
        values, seen = [], {}
        primary = display.get_primary_monitor()
        monitors = [display.get_monitor(index) for index in range(count)]
        geometries = [rectangle(monitor.get_geometry()) for monitor in monitors]
        layout = (max(value["x"] + value["width"] for value in geometries), max(value["y"] + value["height"] for value in geometries))
        published = None if self.published is None else self.published.read(layout)
        for index, monitor in enumerate(monitors):
            name = (monitor.get_manufacturer() or "display") + ":" + (monitor.get_model() or "monitor")
            occurrence = seen.get(name, 0)
            seen[name] = occurrence + 1
            key = name + ":" + str(occurrence)
            geometry, work = geometries[index], rectangle(monitor.get_workarea())
            if self.published is not None:
                work = workarea.resolve(geometry, work, published)
            scenes.rect(geometry)
            scenes.rect(work)
            viewport = scene_viewport(self.mode, geometry, work)
            values.append({"id": key, "primary": monitor == primary if primary is not None else index == 0, "viewport": viewport, "work": work, "monitor": monitor, "scale": monitor.get_scale_factor()})
        return values

    def fingerprint(self, displays):
        return p.encode([{key: value for key, value in display.items() if key != "monitor"} for display in displays])

    def work_areas(self, displays):
        return [{"id": value["id"], "primary": value["primary"], **value["work"]} for value in displays]

    def info(self):
        return {"sessionId": self.session, "referenceDpi": 96, "topology": self.topology, "layers": list(self.layers), "residentLayers": list(resident_layers(self.mode)), "adjustOverlay": adjust_overlay(self.mode), "backend": self.mode, "wallpaperPlacement": wallpaper_placement(self.mode, self.layers), "workAreas": self.work_areas(self.displays), "views": [view.info() for view in self.views if not view.retired]}

    def new_view(self, display, layer):
        p.require(len([view for view in self.views if not view.retired]) < 16 * len(self.layers), "desktop-capacity", "There are too many desktop windows. Save, then reopen Work Fleet.")
        view = Surface(display, layer, self.assets, self.web_factory, self.scene, self.retire, lambda identifier: self.send("desktop-dismiss", viewId=identifier), self.mode)
        self.views.append(view)
        self.watch(view.window)
        return view

    def view(self, identifier):
        value = next((view for view in self.views if view.id == identifier and not view.retired and view.ready), None)
        p.require(value is not None, "desktop-view", "The desktop window is closed or not ready yet.")
        return value

    def start(self):
        self.started = True
        for display in self.displays:
            for layer in self.layers:
                if not any(view.display["id"] == display["id"] and view.layer == layer and not view.retired for view in self.views):
                    self.new_view(display, layer)
        for view in self.views:
            if view.active and not view.retired:
                view.start()

    def active_window(self):
        if self.mode != "x11":
            return None
        try:
            window = Gdk.Screen.get_default().get_active_window()
            return None if window is None else window.get_xid()
        except (AttributeError, GLib.Error):
            return None

    def capture(self, timestamp=0, token=None, source=None):
        if self.blocked or self.native_menu:
            return None
        return {"id": p.identifier(), "created": time.monotonic(), "foreground": self.active_window(), "timestamp": timestamp, "token": token, "source": source}

    def current(self, value):
        if value is None or time.monotonic() - value["created"] > 3:
            return False
        if self.mode == "x11":
            return value["foreground"] is not None and self.active_window() == value["foreground"]
        return bool(value["token"]) or value["source"] is not None and value["source"].is_active()

    def action(self, target, timestamp=0, token=None, source=None):
        if self.closed or not self.started:
            return
        captured = self.capture(timestamp or Gtk.get_current_event_time(), token, source)
        if captured is not None:
            self.intent, self.focus_sequence = captured, None
            self.send("desktop-action", target=target, intent=captured["id"])

    def shortcut(self, key):
        """A labwc keybind handed over by gapplication. It runs whichever window has the focus, so a focused Work Fleet
        window lends the intent its focus, as an in-app key would."""
        if self.closed or not self.started or self.blocked or self.native_menu or self.shortcuts.labwc is None:
            return
        binding = next((value for value in self.shortcuts.bindings if value["key"] == key and value["chord"]), None)
        if binding is not None:
            windows = [self.main, *(view.window for view in self.views if not view.retired)]
            self.action(binding["target"], 0, None, next((window for window in windows if window.is_active()), None))

    def activate(self, window, value):
        if value.get("token"):
            window.set_startup_id(value["token"])
        window.present_with_time(value["timestamp"] or Gdk.CURRENT_TIME)

    def invalidate(self):
        self.pending = True
        self.intent = self.focus_sequence = None
        self.scene_intents.clear()
        for view in self.views:
            if not view.retired:
                view.suspend()
                if view.ready:
                    view.local.event("desktop-displays-changing")
        if self.started:
            self.send("desktop-displays-changing")

    def refresh_displays(self):
        if self.closed:
            return
        self.invalidate()
        if self.display_timer is not None:
            GLib.source_remove(self.display_timer)

        def refresh():
            self.display_timer = None
            if self.closed:
                return False
            try:
                self.proposed = self.read_displays()
                self.monitor_fingerprint = self.fingerprint(self.proposed)
                self.proposed_topology += 1
                if self.started:
                    self.send("desktop-displays", topology=self.proposed_topology, workAreas=self.work_areas(self.proposed))
            except Exception:
                self.send("desktop-error", message=t("desktop.displaysUnreadable"))
            return False
        self.display_timer = GLib.timeout_add(250, refresh)

    def poll_displays(self):
        if self.closed:
            return False
        try:
            if self.fingerprint(self.read_displays()) != self.monitor_fingerprint:
                self.refresh_displays()
        except Exception:
            if not self.pending:
                self.invalidate()
        return True

    def sleep_changed(self, _connection, _sender, _path, _interface, _signal, values, _data):
        if not self.closed:
            self.invalidate() if values.unpack()[0] else self.refresh_displays()

    def apply_displays(self, args):
        requested = p.number(args, "topology")
        if requested == self.topology and not self.pending:
            return self.info()
        p.require(requested == self.proposed_topology and self.proposed is not None, "desktop-topology", "The displays changed again; the layout is being applied again.")
        assignments = {}
        if args.get("editorViewId") is not None:
            editing = self.view(p.text(args, "editorViewId"))
            paper = scenes.rect(args.get("editorRect"))

            def score(display):
                overlap = scenes.intersection(paper, display["viewport"])
                return (0 if overlap is None else overlap["width"] * overlap["height"], display["id"] == editing.display["id"])
            assignments[editing.id] = max(self.proposed, key=score)
        for stable in (True, False):
            for display in self.proposed:
                for layer in self.layers:
                    if any(view.layer == layer and assignments.get(view.id, {}).get("id") == display["id"] for view in self.views):
                        continue
                    match = next((view for view in self.views if not view.retired and view.layer == layer and view.id not in assignments and (not stable or view.display["id"] == display["id"])), None)
                    if match is None and not stable:
                        match = self.new_view(display, layer)
                    if match is not None:
                        assignments[match.id] = display
        for view in self.views:
            if view.retired:
                continue
            view.active = view.id in assignments
            if view.active:
                view.set_display(assignments[view.id])
            else:
                view.suspend()
                view.window.hide()
        self.displays, self.topology, self.pending = self.proposed, requested, False
        for view in self.views:
            if view.ready and not view.retired:
                view.local.event("desktop-viewport", topology=self.topology, view=view.info())
        GLib.idle_add(lambda: (self.start(), False)[1] if not self.closed else False)
        return self.info()

    def invoke(self, method, args):
        p.require(not self.closed, "desktop-closed", "The desktop session has closed.")
        self.sweep()
        if method == "desktop.info":
            return self.info()
        if method == "desktop.start":
            self.start()
            if self.pending:
                self.refresh_displays()
            return self.info()
        if method == "desktop.displays.retry":
            self.refresh_displays()
            return None
        if method == "desktop.displays.apply":
            return self.apply_displays(args)
        if method == "desktop.shortcuts.configure":
            result = self.shortcuts.configure(args)
            self.bindings = {value["key"]: value["target"] for value in self.shortcuts.bindings}
            for view in self.views:
                if view.ready and not view.retired:
                    view.local.event("desktop-shortcuts", bindings=self.bindings)
            return {**result, "labwc": self.shortcuts.labwc_status()}
        if method == "desktop.shortcuts.labwc":
            p.require(self.shortcuts.labwc is not None, "labwc-unavailable", "This desktop isn't labwc.")
            try:
                self.shortcuts.write_labwc()
            except labwc.ConfigError:
                raise p.Failure("labwc-config", "The labwc configuration isn't well-formed, so nothing was changed. Fix rc.xml first.") from None
            except OSError:
                raise p.Failure("labwc-write", "The labwc configuration couldn't be written, so nothing was changed.") from None
            return {"registrations": self.shortcuts.registrations, "labwc": self.shortcuts.labwc_status()}
        if method == "desktop.shortcuts.block":
            self.blocked = p.boolean(args, "blocked")
            self.update_suspension()
            return None
        if method == "desktop.intent":
            captured = self.capture(self.last_timestamp, source=self.main) if self.main.is_active() and time.monotonic() - self.last_input < 1 else None
            if captured:
                self.intent, self.focus_sequence = captured, None
            return {"intent": None if captured is None else captured["id"]}
        if method == "desktop.hideMain":
            p.require(self.hide(), "tray-unavailable", "The tray isn't available right now, so the main window stays open.")
            return None
        if method == "desktop.mainVisible":
            # The adjust overlay moves the main window aside and brings it back where it was, only if it moved it.
            if p.boolean(args, "visible"):
                place, self.main_place = self.main_place, None
                if place is not None:
                    self.return_main(place)
            elif self.main_place is None:
                self.main_place = step_aside(self.main, self.mode, self.hide)
            return None
        if method in ("desktop.showMain", "desktop.focus"):
            if self.intent is None or args.get("intent") != self.intent["id"] or not self.current(self.intent):
                return {"activated" if method == "desktop.showMain" else "accepted": False}
            if method == "desktop.showMain":
                # `hidden` tells quick capture that the window was in the tray, so closing the editor puts it back there.
                value, self.intent, self.focus_sequence = self.intent, None, None
                hidden = not self.main.get_visible()
                self.activate(self.main, value)
                return {"activated": True, "hidden": hidden}
            self.focus_sequence = p.number(args, "sequence")
            for view in self.views:
                if self.try_focus(view):
                    break
            return {"accepted": True}
        if method == "desktop.frame.begin":
            return self.transfers.begin("owner", args, p.RECORD)
        if method == "desktop.frame.append":
            return self.transfers.append("owner", args)
        if method == "desktop.frame.publish":
            token = p.text(args, "token")
            value = scenes.frame(self.transfers.seal("owner", token), self.session, -1 if self.frame is None else self.frame["sequence"])
            self.transfers.retain("owner", token)
            if self.frame_token is not None:
                self.transfers.drop("owner", self.frame_token)
            self.frame_token, self.frame = token, value
            for view in self.views:
                if view.ready and not view.retired:
                    view.local.event("desktop-frame", sequence=value["sequence"])
            return {"sequence": value["sequence"]}
        if method == "desktop.frame.discard":
            token = p.text(args, "token")
            if token != self.frame_token:
                self.transfers.drop("owner", token)
            return None
        if method == "desktop.command.read":
            command = self.command(args)
            p.require(command["upload"] is not None, "scene-command", "This command has no large input.")
            return self.transfers.read(command["view"].id, command["upload"], args)
        if method == "desktop.reply":
            ticket, command = p.text(args, "ticket"), self.command(args)
            p.require(len(p.encode(args)) <= 65536, "scene-size", "The desktop action's reply is too large.")
            command["view"].local.event("desktop-command-result", commandId=command["id"], ok=p.boolean(args, "ok"), result=args.get("result"), error=args.get("error"))
            self.release(ticket)
            return None
        if method == "desktop.flush":
            view, key, draft = self.view(p.text(args, "viewId")), p.text(args, "id"), p.text(args, "draftId")
            p.require(p.is_uuid(key) and len(self.flushes) < 4 and key not in self.flushes, "scene-busy", "A desktop draft is still saving.")
            self.flushes[key], self.frozen[key] = (view.id, draft), view.id
            view.local.event("desktop-flush", id=key, draftId=draft)
            return None
        if method in ("desktop.flush.cancel", "desktop.flush.release"):
            key = p.text(args, "id")
            self.flushes.pop(key, None)
            if method.endswith("release"):
                source = self.frozen.pop(key, None)
                if source is not None:
                    self.view(source).local.event("desktop-unfreeze", id=key, resume=source == args.get("viewId"), draftId=args.get("draftId"))
            return None
        raise p.Failure("unsupported-method", "The desktop host doesn't support this operation.")

    def scene(self, view, method, args):
        p.require(not self.closed and not view.retired, "scene-closed", "The desktop session has closed.")
        self.sweep()
        if method == "scene.info":
            view.ready = True
            return {**view.info(), "sessionId": self.session, "topology": self.topology, "bindings": self.bindings}
        if method == "scene.intent":
            self.scene_intents = {key: value for key, value in self.scene_intents.items() if self.current(value[1])}
            captured = self.capture(view.last_timestamp, source=view.window) if len(self.scene_intents) < 32 and time.monotonic() - view.last_input < 1 else None
            if captured:
                self.scene_intents[captured["id"]] = (view.id, captured)
            return {"intent": None if captured is None else captured["id"]}
        if method == "scene.report":
            self.send("desktop-error", viewId=view.id, message=p.text(args, "message", 2000))
            return None
        if method == "scene.frame":
            if self.frame is None or self.pending or self.frame["topology"] != self.topology:
                return None
            if view.download is not None:
                self.transfers.drop(view.id, view.download)
            value = self.transfers.lease("owner", self.frame_token, view.id)
            view.downloading, view.download = self.frame, value["token"]
            return value
        if method == "scene.read":
            return self.transfers.read(view.id, p.text(args, "token"), args)
        if method == "scene.discard":
            self.transfers.drop(view.id, p.text(args, "token"))
            return None
        if method == "scene.applied":
            sequence = p.number(args, "sequence")
            if self.pending or not view.active or view.downloading is None or view.downloading["topology"] != self.topology or p.number(args, "topology") != self.topology:
                return {"accepted": False}
            p.require(sequence == view.downloading["sequence"] and sequence >= view.applied, "scene-order", "The desktop input doesn't match the frame on screen yet.")
            view.apply(view.downloading)
            view.applied = sequence
            self.try_focus(view)
            return {"accepted": True}
        if method == "scene.command.begin":
            return self.transfers.begin(view.id, args, scenes.COMMAND)
        if method == "scene.command.append":
            return self.transfers.append(view.id, args)
        if method == "scene.command":
            token = args.get("token")
            command = p.decode(self.transfers.seal(view.id, token)) if token is not None else args.get("command")
            p.require(isinstance(command, dict) and (token is not None or len(p.encode(command)) <= 65536), "scene-size", "The desktop command's format or size isn't valid.")
            key, operation = p.text(command, "id"), p.text(command, "method")
            p.require(p.is_uuid(key) and command.get("sessionId") == self.session and p.number(command, "serial") > 0 and isinstance(command.get("args"), dict), "scene-session", "The desktop command's session isn't valid.")
            allowed = ("pointer.down", "pointer.move", "pointer.up", "pointer.cancel", "card.select", "card.edit", "card.details", "card.transfer", "editor.change", "editor.save", "editor.end", "editor.full", "interaction.escape", "interaction.shortcut", "interaction.done", "layout.arrange")
            p.require(operation in allowed, "unsupported-method", "The desktop surface doesn't support this operation.")
            draft, topology = operation == "editor.change", p.number(args, "topology")
            p.require(draft or not self.pending and view.active and topology == self.topology, "desktop-topology", "Desktop coordinates are updating. Keep your current text.")
            p.require(sum(value["draft"] == draft for value in self.commands.values()) < (4 if draft else 24) and not any(value["view"] == view and value["id"] == key for value in self.commands.values()), "scene-busy", "A desktop action is still being processed.")
            ticket = p.identifier()
            self.commands[ticket] = {"view": view, "id": key, "upload": token, "draft": draft, "created": time.monotonic()}
            captured = self.scene_intents.pop(args.get("intent"), None)
            admitted = None
            if operation in ("card.details", "editor.full", "interaction.shortcut") and captured and captured[0] == view.id and self.current(captured[1]):
                self.intent, self.focus_sequence, admitted = captured[1], None, captured[1]["id"]
            values = {"ticket": ticket, "viewId": view.id, "intent": admitted, "topology": topology}
            if token is None:
                values["command"] = command
            else:
                data = self.transfers.seal(view.id, token)
                values["transfer"] = {"size": len(data), "sha256": p.digest(data)}
            self.send("desktop-command", **values)
            return {"accepted": True}
        if method == "scene.flushed":
            key, draft = p.text(args, "id"), p.text(args, "draftId")
            p.require(self.flushes.get(key) == (view.id, draft), "scene-flush", "The draft save request has expired.")
            ok, sequence = p.boolean(args, "ok"), p.number(args, "sequence")
            self.flushes.pop(key)
            self.send("desktop-flushed", id=key, viewId=view.id, draftId=draft, ok=ok, sequence=sequence)
            return None
        raise p.Failure("unsupported-method", "The desktop surface has no access to storage or system operations.")

    def return_main(self, place):
        come_back(self.main, self.mode, place)
        if self.mode != "wayland-layer-shell":
            return
        if self.main_timer is not None:
            GLib.source_remove(self.main_timer)

        def check():
            # labwc refuses the activation without a recent click, leaving the window minimized and unfocused.
            self.main_timer = None
            if not self.closed and self.main_place is None and not self.main.is_active():
                remap(self.main, place)
            return False
        self.main_timer = GLib.timeout_add(600, check)

    def try_focus(self, view):
        if self.focus_sequence is None or not self.current(self.intent):
            return False
        if self.pending or not view.active or view.retired or not view.ready or view.downloading is None or view.layer != "floating" or view.applied < self.focus_sequence or not any(card["layer"] == view.layer and card["draggable"] and scenes.intersection(card["rect"], view.viewport) for card in view.downloading["cards"]):
            return False
        value, self.intent, self.focus_sequence = self.intent, None, None
        if value.get("token"):
            view.window.set_startup_id(value["token"])
        view.focus(value["timestamp"])
        return True

    def command(self, args):
        value = self.commands.get(p.text(args, "ticket"))
        p.require(value is not None, "scene-command", "The desktop action has expired.")
        return value

    def release(self, ticket):
        value = self.commands.pop(ticket, None)
        if value is not None and value["upload"] is not None:
            self.transfers.drop(value["view"].id, value["upload"])

    def sweep(self):
        for ticket, value in list(self.commands.items()):
            if time.monotonic() - value["created"] > 120:
                self.release(ticket)

    def retire(self, view):
        if view.retired or self.closed:
            return
        view.close()
        self.transfers.drop_owner(view.id)
        for ticket, value in list(self.commands.items()):
            if value["view"] == view:
                self.release(ticket)
        self.flushes = {key: value for key, value in self.flushes.items() if value[0] != view.id}
        self.frozen = {key: value for key, value in self.frozen.items() if value != view.id}
        self.scene_intents = {key: value for key, value in self.scene_intents.items() if value[0] != view.id}
        self.send("desktop-view-lost", viewId=view.id, message=t("desktop.viewLost"))

    def close(self):
        if self.closed:
            return
        self.closed = True
        self.shortcuts.close()
        if self.published is not None:
            self.published.close()
        if self.display_timer is not None:
            GLib.source_remove(self.display_timer)
        if self.main_timer is not None:
            GLib.source_remove(self.main_timer)
        for timer in self.timers:
            GLib.source_remove(timer)
        if self.sleep_subscription is not None:
            self.sleep_bus.signal_unsubscribe(self.sleep_subscription)
        for source, token in self.signals:
            if source.handler_is_connected(token):
                source.disconnect(token)
        self.signals.clear()
        for view in self.views:
            view.close()
        self.views.clear()
        self.transfers.entries.clear()
        self.commands.clear()
        self.flushes.clear()
        self.frozen.clear()
        self.scene_intents.clear()
