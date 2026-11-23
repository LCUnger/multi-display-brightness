import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DdcQueue, parseDisplays, parseBrightness, targets} from '../extension/ddc.js';

const laptop = 'Invalid display\n   I2C bus: /dev/i2c-12\n   DRM_connector: card1-eDP-1';
const display = (number, bus, connector, manufacturer, model, serial) => `Display ${number}
   I2C bus: /dev/i2c-${bus}
   DRM_connector: ${connector}
   EDID synopsis:
      Mfg id: ${manufacturer}
      Model: ${model}
      Serial number: ${serial}`;
const iiyama = (bus = 17) => display(1, bus, 'card1-DP-5', 'IVM - Iiyama', 'PL2776HD', '1112213801965');
const dell = display(2, 18, 'card1-DP-6', 'DEL - Dell Inc.', 'Dell S2417DG', '#ASPTvn2EJrrd');
const detection = (bus = 17) => [laptop, iiyama(bus), dell].join('\n\n');

test('discovers the original dock, a new model, and no external displays on a laptop-only setup', () => {
    const samsung = display(3, 23, 'card1-HDMI-A-1', 'SAM', 'Samsung U28E590', 'NEW');
    const displays = [...parseDisplays(detection(20) + '\n' + samsung).values()];
    assert.deepEqual(displays.map(({bus, label}) => [bus, label]), [
        ['20', 'PL2776HD'], ['18', 'Dell S2417DG'], ['23', 'Samsung U28E590'],
    ]);
    assert.equal(parseDisplays(laptop).size, 0);
    assert.equal(parseDisplays('No displays found.').size, 0);
    assert.equal([...parseDisplays(detection()).keys()][0], [...parseDisplays(detection(20)).keys()][0]);
});

test('distinguishes identical models and uses scan-specific IDs for bus-only records', () => {
    const output = [
        display(1, 20, 'card1-DP-1', 'ACR', 'Twin', ''),
        display(2, 21, 'card1-DP-2', 'ACR', 'Twin', ''),
        display(3, 22, '', 'ACR', 'Twin', ''),
        display(4, 23, '', '', '', ''),
    ].join('\n');
    const first = parseDisplays(output, 1);
    const second = parseDisplays(output, 2);
    assert.equal(first.size, 4);
    assert.deepEqual([...first.values()].map(({label}) => label), [
        'Twin (card1-DP-1)', 'Twin (card1-DP-2)', 'Twin (I²C 22)', 'External display',
    ]);
    assert.equal([...first.keys()].filter(id => second.has(id)).length, 2);
    const duplicatedSerial = output.replace(/Serial number: *$/gm, 'Serial number: DUP');
    assert.equal(parseDisplays(duplicatedSerial).size, 4);
});

test('parses valid brightness and rejects errors and invalid ranges', () => {
    assert.deepEqual(parseBrightness('VCP 10 C 85 200'), {raw: 85, max: 200});
    for (const value of ['VCP 10 ERR', 'VCP D6 SNC x01', 'VCP 10 C 1 0', 'VCP 10 C 101 100'])
        assert.throws(() => parseBrightness(value));
});

test('links available targets and coalesces serialized writes with mixed maxima', async () => {
    const calls = [];
    let active = 0;
    const queue = new DdcQueue(async args => {
        assert.equal(++active, 1);
        calls.push(args.join(' '));
        try {
            await Promise.resolve();
            if (args[0] === 'detect')
                return detection();
            if (args.includes('setvcp')) {
                if (args[1] === '17')
                    throw new Error('Timed out');
                return '';
            }
            return args[1] === '17' ? 'VCP 10 C 85 200' : 'VCP 10 C 60 100';
        } finally {
            active--;
        }
    }, () => {});
    await queue.refresh();
    const [first, second] = queue.rows.keys();
    assert.deepEqual(targets(second, false, ['laptop', first, second]), [second]);
    assert.deepEqual(targets(second, true, ['laptop', second]), ['laptop', second]);
    queue.write(first, 20);
    queue.write(first, 50);
    await queue.write(second, 50);
    assert.deepEqual(calls.slice(3), ['--bus 17 setvcp 10 100', '--bus 18 setvcp 10 50']);
    assert.equal(queue.rows.get(first).raw, 85);
    assert.equal(queue.rows.get(first).status, 'Timed out');
    assert.equal(queue.rows.get(second).raw, 50);
    assert(!calls.some(call => call.includes('D6')));
});

test('ignores an active write result and discards queued writes on refresh', async () => {
    let output = detection();
    let release;
    let started;
    const writing = new Promise(resolve => { started = resolve; });
    const calls = [];
    const events = new Map();
    const queue = new DdcQueue(async args => {
        calls.push(args);
        if (args[0] === 'detect')
            return output;
        if (args.includes('setvcp')) {
            started();
            return new Promise(resolve => { release = resolve; });
        }
        return 'VCP 10 C 80 100';
    }, (id, row) => events.set(id, row));

    await queue.refresh();
    const [first, second] = queue.rows.keys();
    queue.write(first, 70);
    queue.write(second, 70);
    await writing;
    output = [laptop, iiyama(21)].join('\n');
    const refresh = queue.refresh();
    assert.equal(queue.write(first, 90), undefined);
    release('');
    await refresh;

    assert.deepEqual(calls.filter(args => args.includes('setvcp')), [
        ['--bus', '17', 'setvcp', '10', '70'],
    ]);
    assert.equal(events.get(first).raw, 80);
    assert.equal(events.get(first).bus, '21');
    assert.equal(events.get(second), null);
    assert.equal(queue.rows.size, 1);
});

test('recovers from a failed scan and a per-monitor read timeout', async () => {
    let failedScan = false;
    let failedRead = false;
    const queue = new DdcQueue(async args => {
        if (args[0] === 'detect') {
            if (failedScan)
                throw new Error('Display scan failed');
            return detection();
        }
        if (failedRead && args[1] === '17')
            throw new Error('Timed out');
        return 'VCP 10 C 80 100';
    }, () => {});
    await queue.refresh();
    failedScan = true;
    await queue.refresh();
    assert.equal(queue.rows.size, 2);
    assert([...queue.rows.values()].every(row => row.max === null));
    failedScan = false;
    failedRead = true;
    await queue.refresh();
    const [first, second] = queue.rows.values();
    assert.equal(first.status, 'Timed out');
    assert.equal(first.max, null);
    assert.equal(second.max, 100);
    failedRead = false;
    await queue.refresh();
    assert([...queue.rows.values()].every(row => row.max === 100));
});

test('a newer refresh supersedes an in-flight scan and clears disconnected rows', async () => {
    const calls = [];
    const events = new Map();
    const statuses = [];
    let finishScan;
    const queue = new DdcQueue(async args => {
        calls.push(args);
        if (args[0] !== 'detect')
            return 'VCP 10 C 80 100';
        if (calls.length === 4)
            return new Promise(resolve => { finishScan = resolve; });
        return calls.length === 1 ? detection() : laptop;
    }, (id, row) => events.set(id, row), status => statuses.push(status));

    await queue.refresh();
    queue.refresh();
    await Promise.resolve();
    assert.equal(typeof finishScan, 'function');
    const latest = queue.refresh();
    finishScan(detection(21));
    await latest;

    assert.equal(queue.rows.size, 0);
    assert([...events.values()].every(row => row === null));
    assert.equal(statuses.at(-1), 'No external displays detected');
    assert.deepEqual(calls.slice(3), [['detect'], ['detect']]);
});
