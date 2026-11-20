# Linked Brightness

A GNOME Shell 50 extension that puts laptop and external-monitor brightness in one top-bar menu. **Link brightness** applies the same percentage to every available screen when you adjust any slider. The toggle defaults to off and remembers its state across sessions.

This build targets the Iiyama PL2776HD and Dell S2417DG from the original HP USB-C dock setup. To use other external monitors, update the `monitors` list in [extension/ddc.js](extension/ddc.js) with the model and serial from `ddcutil detect`, then rebuild.

## Build and install

You need `ddcutil` and the `gnome-extensions` CLI. From the repository root, run:

```bash
./scripts/build
gnome-extensions install --force ./dist/linked-brightness@local.shell-extension.zip
```

Disable any other DDC brightness extension before testing. For **Brightness control using ddcutil**, run:

```bash
gnome-extensions disable display-brightness-ddcutil@themightydeity.github.com
```

Log out and back in, then enable Linked Brightness.

```bash
gnome-extensions enable linked-brightness@local
gnome-extensions info linked-brightness@local
```

Look for **State: ACTIVE** and open the sun icon in the top bar. Use **Refresh displays** to retry detection. Dragging a slider applies the value when you release it. Keyboard and scroll changes apply after 200 ms without input.

## Develop and test

Run `./scripts/test` with Node.js 22 or newer, GJS, and `glib-compile-schemas`. The tests cover EDID matching, brightness scaling, queued writes, dock bus changes, and subprocess timeout and cancellation.

- [extension/extension.js](extension/extension.js) provides the GNOME menu and binds the laptop backlight.
- [extension/ddc.js](extension/ddc.js) parses DDC output and serializes external monitor reads and writes.
- [extension/process.js](extension/process.js) runs `ddcutil` asynchronously with a 15-second timeout.

For a hardware check, confirm that each slider controls the correct screen independently and that all three reach 50% in linked mode. Reconnect the dock and confirm that both external sliders recover. The automated tests use simulated monitor queries. A live test requires a GNOME session with access to the I²C devices.

## Uninstall

```bash
gnome-extensions disable linked-brightness@local
gnome-extensions uninstall linked-brightness@local
```

If you disabled the previous extension during installation, re-enable it with `gnome-extensions enable display-brightness-ddcutil@themightydeity.github.com`.
