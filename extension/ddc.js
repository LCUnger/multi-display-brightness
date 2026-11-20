export const monitors = [
    {id: 'iiyama', label: 'Iiyama', model: 'PL2776HD', serial: '1112213801965'},
    {id: 'dell', label: 'Dell', model: 'Dell S2417DG', serial: '#ASPTvn2EJrrd'},
];

export function parseDisplays(output) {
    const buses = new Map();
    for (const block of output.split(/^(?=Display\s+\d+\s*$|Invalid display\s*$)/m)) {
        if (!/^Display\s+\d+\s*$/m.test(block))
            continue;
        const bus = block.match(/^\s*I2C bus:\s*\/dev\/i2c-(\d+)\s*$/m)?.[1];
        const model = block.match(/^[ \t]*Model:[ \t]*(.+)$/m)?.[1].trim();
        const serial = block.match(/^[ \t]*Serial number:[ \t]*(.+)$/m)?.[1].trim();
        const monitor = monitors.find(item => item.model === model && item.serial === serial);
        if (monitor && bus)
            buses.set(monitor.id, bus);
    }
    return buses;
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
    constructor(run, onChange) {
        this.run = run;
        this.onChange = onChange;
        this.rows = new Map(monitors.map(({id}) => [
            id, {bus: null, raw: null, max: null, status: 'Detecting…'},
        ]));
        this.writes = new Map();
        this.reads = new Set();
        this.generation = 0;
        this.scanPending = false;
        this.running = null;
        this.stopped = false;
    }

    refresh(topologyChanged = false) {
        if (this.stopped)
            return;
        if (topologyChanged) {
            this.generation++;
            this.writes.clear();
            for (const [id, row] of this.rows) {
                Object.assign(row, {bus: null, raw: null, max: null, status: 'Detecting…'});
                this.publish(id);
            }
        }
        this.scanPending = true;
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
                    this.reads.clear();
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
        let buses = new Map();
        let error;
        try {
            buses = parseDisplays(await this.run(['detect']));
        } catch (failure) {
            error = failure.message;
        }
        if (!this.isCurrent(generation))
            return;
        for (const [id, row] of this.rows) {
            const bus = buses.get(id) ?? null;
            if (bus !== row.bus) {
                this.writes.delete(id);
                Object.assign(row, {bus, raw: null, max: null});
            }
            row.status = error ?? (!bus ? 'Monitor not detected' : row.max === null ? 'Reading brightness…' : '');
            if (bus)
                this.reads.add(id);
            this.publish(id);
        }
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
