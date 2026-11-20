import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DdcQueue, parseDisplays, parseBrightness, targets} from '../extension/ddc.js';

const detection = (bus = 17) => `Invalid display
   I2C bus: /dev/i2c-12
   Model:
Display 1
   I2C bus: /dev/i2c-${bus}
   Model: PL2776HD
   Serial number: 1112213801965
Display 2
   I2C bus: /dev/i2c-18
   Model: Dell S2417DG
   Serial number: #ASPTvn2EJrrd`;

test('matches EDID and remaps buses; excludes internal display', () => {
    assert.deepEqual([...parseDisplays(detection(20))], [['iiyama', '20'], ['dell', '18']]);
    assert.equal(parseDisplays(detection().replace('1112213801965', 'wrong')).has('iiyama'), false);
});

test('parses valid brightness and rejects errors and invalid ranges', () => {
    assert.deepEqual(parseBrightness('VCP 10 C 85 200'), {raw: 85, max: 200});
    for (const value of ['VCP 10 ERR', 'VCP D6 SNC x01', 'VCP 10 C 1 0', 'VCP 10 C 101 100'])
        assert.throws(() => parseBrightness(value));
});

test('linked and independent slider targets', () => {
    assert.deepEqual(targets('dell', false, ['laptop', 'dell']), ['dell']);
    assert.deepEqual(targets('dell', true, ['laptop', 'dell']), ['laptop', 'dell']);
});

test('serializes commands, coalesces writes, prioritizes them, and keeps working after timeout', async () => {
    const calls = [];
    const events = [];
    let active = 0;
    let bus = 17;
    let failWrite = false;
    let releaseRead;
    const fakeDdcutil = async args => {
        assert.equal(++active, 1);
        calls.push(args.join(' '));
        try {
            if (args[0] === 'detect')
                return detection(bus);
            if (args.includes('setvcp')) {
                if (failWrite) {
                    failWrite = false;
                    throw new Error('Timed out');
                }
                return '';
            }
            if (releaseRead === undefined && calls.length > 3)
                await new Promise(resolve => { releaseRead = resolve; });
            return 'VCP 10 C 85 200';
        } finally {
            active--;
        }
    };
    const queue = new DdcQueue(fakeDdcutil, (...event) => events.push(event));
    await queue.refresh();
    const refresh = queue.refresh();
    while (!releaseRead)
        await new Promise(resolve => setImmediate(resolve));
    failWrite = true;
    queue.write('iiyama', 20);
    queue.write('iiyama', 50);
    queue.write('dell', 50);
    releaseRead();
    await refresh;
    assert.deepEqual(calls.slice(4), [
        '--bus 17 getvcp --brief 10', '--bus 17 setvcp 10 100',
        '--bus 18 setvcp 10 100', '--bus 18 getvcp --brief 10',
    ]);
    assert(events.some(([id, row]) => id === 'iiyama' && row.status === 'Timed out' && row.raw === 85));
    assert(events.some(([id, row]) => id === 'dell' && row.raw === 100));
    bus = 21;
    await queue.refresh(true);
    assert(calls.includes('--bus 21 getvcp --brief 10'));
    assert(!calls.some(call => call.includes('D6')));
    queue.stop();
});

test('keeps a failed screen visible and discards queued writes when the dock map changes', async () => {
    let bus = 17;
    let release;
    let started;
    const writing = new Promise(resolve => { started = resolve; });
    const calls = [];
    const events = new Map();
    const queue = new DdcQueue(async args => {
        calls.push(args);
        if (args[0] === 'detect')
            return detection(bus);
        if (args.includes('setvcp')) {
            started();
            return new Promise(resolve => { release = resolve; });
        }
        if (args[1] === '21')
            throw new Error('Brightness read failed');
        return 'VCP 10 C 80 100';
    }, (id, row) => events.set(id, row));

    await queue.refresh();
    queue.write('iiyama', 70);
    queue.write('dell', 70);
    await writing;
    bus = 21;
    const refresh = queue.refresh(true);
    release('');
    await refresh;

    assert.deepEqual(calls.filter(args => args.includes('setvcp')), [
        ['--bus', '17', 'setvcp', '10', '70'],
    ]);
    assert.equal(events.get('iiyama').status, 'Brightness read failed');
    assert.equal(events.get('dell').raw, 80);
    queue.stop();
});
