# Multi-Display Brightness

This repository builds a GNOME Shell 50 extension. Source and the settings schema are in `extension/`. Keep user instructions in `README.md` aligned with the build.

## Development checks

- Run `./scripts/test` for the Node.js DDC tests, GJS subprocess tests, and schema validation.
- Run `./scripts/build` to generate the installable ZIP under `dist/`.
- Use the README's hardware checks for changes to the Shell menu, laptop backlight, or monitor detection. Report whether you ran them on a live GNOME session.
- Keep generated ZIPs and compiled schemas out of Git.

## Behavior to preserve

- Use GNOME Shell's per-monitor brightness scale for the built-in panel. Laptop brightness changes made outside the extension update its slider without propagating to the external monitors.
- Discover external monitors without a fixed list. Identify them by unique EDID fields or connector, with the I²C bus as a scan-local fallback. Discard queued writes at refresh because a dock can reassign buses. Read VCP `10` directly. The `D6` power-state query intermittently dropped the Iiyama.
- Keep DDC commands asynchronous, serialized, and bounded by a timeout. Coalesce pending writes per monitor. Keep detected monitors with failed brightness reads visible while other screens remain controllable. Remove disconnected rows after a successful scan.
- Apply linked changes as the same percentage on available displays. Turning linking on leaves current levels in place until a slider changes.
