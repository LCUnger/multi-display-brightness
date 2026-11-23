# Multi-Display Brightness

A GNOME Shell 50 extension that puts laptop and external-monitor brightness in one top-bar menu. **Link brightness** applies the same percentage to every available screen when you adjust any slider. The toggle defaults to off and remembers its state across sessions.

External monitors are discovered automatically at startup, when GNOME reports a display change, and when you select **Refresh displays**. A monitor needs to answer the DDC/CI brightness query over its current cable or dock. If a detected monitor cannot report brightness, its row shows an error and the other controls stay usable.

## Build and install

You need `ddcutil` and the `gnome-extensions` CLI. From the repository root, run:

```bash
./scripts/build
gnome-extensions install --force ./dist/multi-display-brightness@lcunger.github.io.shell-extension.zip
```

Disable any other DDC brightness extension before testing. For **Brightness control using ddcutil**, run:

```bash
gnome-extensions disable display-brightness-ddcutil@themightydeity.github.com
```

Log out and back in, then enable Multi-Display Brightness.

```bash
gnome-extensions enable multi-display-brightness@lcunger.github.io
gnome-extensions info multi-display-brightness@lcunger.github.io
```

Look for **State: ACTIVE** and open the sun icon in the top bar. Use **Refresh displays** to retry detection. Dragging a slider applies the value when you release it. Keyboard and scroll changes apply after 200 ms without input.

## Develop and test

Run `./scripts/test` with Node.js 22 or newer, GJS, and `glib-compile-schemas`. The tests cover monitor discovery and identification, brightness scaling, queued writes, dock reconnection, and subprocess timeout and cancellation.

- [extension/extension.js](extension/extension.js) provides the GNOME menu and binds the laptop backlight.
- [extension/ddc.js](extension/ddc.js) parses DDC output and serializes external monitor reads and writes.
- [extension/process.js](extension/process.js) runs `ddcutil` asynchronously with a 15-second timeout.

For a hardware check, confirm that each slider controls the correct screen independently and that all available screens reach 50% in linked mode. Reconnect the dock and confirm that both external sliders recover. The automated tests use simulated monitor queries. A live test requires a GNOME session with access to the I²C devices.

## Uninstall

```bash
gnome-extensions disable multi-display-brightness@lcunger.github.io
gnome-extensions uninstall multi-display-brightness@lcunger.github.io
```

If you disabled the previous extension during installation, re-enable it with `gnome-extensions enable display-brightness-ddcutil@themightydeity.github.com`.
