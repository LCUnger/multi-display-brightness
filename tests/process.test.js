import {DdcProcess} from '../extension/process.js';

const echo = new DdcProcess('/usr/bin/printf', 1000);
if (await echo.run(['VCP 10 C 85 100']) !== 'VCP 10 C 85 100')
    throw new Error('Unexpected stdout');

const slow = new DdcProcess('/usr/bin/sleep', 35);
try {
    await slow.run(['10']);
    throw new Error('Slow process unexpectedly finished');
} catch (error) {
    if (error.message !== 'Monitor command timed out')
        throw error;
}
if (slow.process !== null)
    throw new Error('Process was retained after timeout');

const pending = slow.run(['10']);
slow.cancel();
try {
    await pending;
    throw new Error('Cancelled process unexpectedly finished');
} catch (error) {
    if (error.message !== 'Brightness change failed')
        throw error;
}
print('GJS subprocess stdout, timeout, and cancellation passed');
