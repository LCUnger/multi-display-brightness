// SPDX-License-Identifier: GPL-2.0-or-later
function countBy(items, key) {
    const counts = new Map();
    for (const item of items)
        counts.set(item[key], (counts.get(item[key]) ?? 0) + 1);
    return counts;
}

export function parseDisplays(output, generation = 0) {
    const byBus = new Map();
    const blocks = output.split(/^(?=(?:Display[ \t]+\d+|Invalid display|Phantom display)\b)/mi);
    for (const block of blocks) {
        if (!/^Display[ \t]+\d+[ \t]*\r?$/m.test(block))
            continue;

        const fields = new Map();
        for (const [, key, value] of block.matchAll(/^[ \t]*([^:\r\n]+):([^\r\n]*)/gm))
            fields.set(key.trim(), value.trim());

        const bus = fields.get('I2C bus')?.match(/^\/dev\/i2c-(\d+)$/)?.[1];
        const connector = fields.get('DRM_connector') || '';
        if (!bus || /(?:^|-)(?:eDP|LVDS|DSI)(?:-|$)/i.test(connector))
            continue;

        const manufacturer = fields.get('Mfg id')?.split(' - ', 1)[0] || '';
        const model = fields.get('Model') || '';
        const serial = fields.get('Serial number') || '';
        const usableSerial = serial && !/^(?:0+|n\/a|none|unknown|unspecified)$/i.test(serial);
        const edid = usableSerial ? JSON.stringify([manufacturer, model, serial]) : null;
        byBus.set(bus, {bus, connector, edid, label: model || 'External display'});
    }

    const displays = [...byBus.values()];
    const edidCounts = countBy(displays, 'edid');
    const connectorCounts = countBy(displays, 'connector');
    const labelCounts = countBy(displays, 'label');

    return new Map(displays.map(({bus, connector, edid, label}) => {
        const uniqueConnector = connector && connectorCounts.get(connector) === 1;
        let id = `bus:${generation}:${bus}`;
        if (edid && edidCounts.get(edid) === 1)
            id = `edid:${edid}`;
        else if (uniqueConnector)
            id = `connector:${connector}`;

        if (labelCounts.get(label) > 1)
            label += uniqueConnector ? ` (${connector})` : ` (I²C ${bus})`;
        return [id, {bus, label}];
    }));
}

export function parseBrightness(output) {
    const match = output.match(/^VCP 10 C (\d+) (\d+)\s*$/m);
    const raw = Number(match?.[1]);
    const max = Number(match?.[2]);
    if (!Number.isSafeInteger(raw) || !Number.isSafeInteger(max) || max < 1 || raw > max)
        throw new Error('Brightness could not be read');
    return {raw, max};
}

export function targets(source, linked, available) {
    return linked ? available : available.filter(id => id === source);
}

export class DdcQueue {
    constructor(run, onChange, onScanStatus = () => {}) {
        this.run = run;
        this.onChange = onChange;
        this.onScanStatus = onScanStatus;
        this.rows = new Map();
        this.writes = new Map();
        this.reads = new Set();
        this.generation = 0;
        this.scanPending = false;
        this.running = null;
        this.stopped = false;
    }

    refresh() {
        if (this.stopped)
            return;
        this.generation++;
        this.writes.clear();
        this.reads.clear();
        this.scanPending = true;
        this.onScanStatus('Detecting external displays…');
        for (const [id, row] of this.rows) {
            Object.assign(row, {bus: null, raw: null, max: null, status: 'Detecting…'});
            this.publish(id);
        }
        return this.start();
    }

    write(id, percent) {
        const row = this.rows.get(id);
        if (this.stopped || !row?.bus || row.max === null)
            return;
        this.writes.set(id, percent);
        return this.start();
    }

    stop() {
        this.stopped = true;
        this.writes.clear();
        this.reads.clear();
    }

    publish(id, inFlight = null) {
        this.onChange(id, {...this.rows.get(id)}, this.writes.get(id) ?? inFlight);
    }

    start() {
        this.running ??= Promise.resolve().then(() => this.drain());
        return this.running;
    }

    async drain() {
        try {
            while (!this.stopped) {
                if (this.scanPending) {
                    this.scanPending = false;
                    await this.scan();
                } else if (this.writes.size) {
                    const [id, percent] = this.writes.entries().next().value;
                    this.writes.delete(id);
                    await this.setBrightness(id, percent);
                } else if (this.reads.size) {
                    const id = this.reads.values().next().value;
                    this.reads.delete(id);
                    await this.readBrightness(id);
                } else {
                    break;
                }
            }
        } finally {
            this.running = null;
        }
    }

    isCurrent(generation) {
        return !this.stopped && generation === this.generation;
    }

    async scan() {
        const generation = this.generation;
        let displays;
        try {
            displays = parseDisplays(await this.run(['detect']), generation);
        } catch (error) {
            if (!this.isCurrent(generation))
                return;
            this.onScanStatus(error.message);
            for (const [id, row] of this.rows) {
                row.status = 'Unavailable';
                this.publish(id);
            }
            return;
        }
        if (!this.isCurrent(generation))
            return;

        for (const id of this.rows.keys()) {
            if (!displays.has(id)) {
                this.rows.delete(id);
                this.onChange(id, null);
            }
        }
        for (const [id, {bus, label}] of displays) {
            this.rows.set(id, {bus, label, raw: null, max: null, status: 'Reading brightness…'});
            this.reads.add(id);
            this.publish(id);
        }
        this.onScanStatus(displays.size ? '' : 'No external displays detected');
    }

    async readBrightness(id) {
        const generation = this.generation;
        const row = this.rows.get(id);
        try {
            const value = parseBrightness(await this.run(['--bus', row.bus, 'getvcp', '--brief', '10']));
            if (this.isCurrent(generation))
                Object.assign(row, value, {status: ''});
        } catch (error) {
            if (this.isCurrent(generation))
                Object.assign(row, {max: null, status: error.message});
        }
        if (this.isCurrent(generation))
            this.publish(id);
    }

    async setBrightness(id, percent) {
        const generation = this.generation;
        const row = this.rows.get(id);
        // Keep the panel above raw zero when a display accepts zero as its minimum.
        if (!row.bus || row.max === null) {
            this.publish(id);
            return;
        }
        const raw = Math.max(1, Math.min(row.max, Math.round(percent * row.max / 100)));
        row.status = 'Applying…';
        this.publish(id, percent);
        try {
            await this.run(['--bus', row.bus, 'setvcp', '10', String(raw)]);
            if (this.isCurrent(generation))
                Object.assign(row, {raw, status: ''});
        } catch (error) {
            if (this.isCurrent(generation))
                row.status = error.message;
        }
        if (this.isCurrent(generation))
            this.publish(id);
    }
}
