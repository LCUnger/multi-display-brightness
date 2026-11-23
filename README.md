# Multi-Display Brightness

A GNOME Shell 50 extension that puts laptop and external-monitor brightness in one top-bar menu. **Link brightness** applies the same percentage to every available screen when you adjust any slider. The toggle defaults to off and remembers its state across sessions.

External monitors are discovered automatically at startup, when GNOME reports a display change, and when you select **Refresh displays**. A monitor needs to answer the DDC/CI brightness query over its current cable or dock. If a detected monitor cannot report brightness, its row shows an error and the other controls stay usable.

## Requirements

- GNOME Shell 50 and the `gnome-extensions` command.
- For external brightness control, install `ddcutil` and enable DDC/CI on each monitor if it has that setting. Run `ddcutil detect` as your normal user to check that your monitors are visible over the current cable or dock.

## Install from GitHub Releases

Download `multi-display-brightness@lcunger.github.io.shell-extension.zip` from the **Assets** section of a [GitHub release](https://github.com/LCUnger/multi-display-brightness/releases). GitHub’s **Source code (zip)** archive can be used to build the extension from source.

From the directory where you downloaded the extension ZIP, run:

```bash
gnome-extensions install ./multi-display-brightness@lcunger.github.io.shell-extension.zip
```

Add `--force` to replace an existing installation of Multi-Display Brightness.

## Build from source

Clone or download the repository. From the repository root, run:

```bash
./scripts/build
gnome-extensions install ./dist/multi-display-brightness@lcunger.github.io.shell-extension.zip
```

## Enable the extension

After installing, log out and back in, then run:

```bash
gnome-extensions enable multi-display-brightness@lcunger.github.io
gnome-extensions info multi-display-brightness@lcunger.github.io
```

Look for **State: ACTIVE** and open the sun icon in the top bar. Use **Refresh displays** to retry detection. Dragging a slider applies the value when you release it. Keyboard and scroll changes apply after 200 ms without input.

## Troubleshooting

If an external monitor is missing, check whether `ddcutil detect` can see it as your normal user, then try **Refresh displays**. If another brightness extension is active, disable it while testing Multi-Display Brightness.

## Develop and test

Run `./scripts/test` with Node.js 22 or newer, GJS, and `glib-compile-schemas`. The tests cover monitor discovery and identification, brightness scaling, queued writes, dock reconnection, and subprocess timeout and cancellation.

- [extension/extension.js](extension/extension.js) provides the GNOME menu and binds the laptop backlight.
- [extension/ddc.js](extension/ddc.js) parses DDC output and serializes external monitor reads and writes.
- [extension/process.js](extension/process.js) runs `ddcutil` asynchronously with a 15-second timeout.

For a hardware check, confirm that each slider controls the correct screen independently and that all available screens reach 50% in linked mode. Reconnect the dock and confirm that the external sliders recover. The automated tests use simulated monitor queries. A live test requires a GNOME session with access to the I²C devices.

## Uninstall

```bash
gnome-extensions disable multi-display-brightness@lcunger.github.io
gnome-extensions uninstall multi-display-brightness@lcunger.github.io
```

## License

Multi-Display Brightness is licensed under the GNU General Public License, version 2 or (at your option) any later version (`GPL-2.0-or-later`). See [LICENSE](LICENSE).
