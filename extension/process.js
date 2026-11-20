import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');

export class DdcProcess {
    constructor(binary = '/usr/bin/ddcutil', timeoutMs = 15000) {
        this.binary = binary;
        this.timeoutMs = timeoutMs;
        this.process = null;
    }

    async run(args) {
        const flags = Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE;
        const launcher = new Gio.SubprocessLauncher({flags});
        launcher.setenv('LC_ALL', 'C', true);
        const process = launcher.spawnv([this.binary, ...args]);
        this.process = process;
        let timedOut = false;
        let timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this.timeoutMs, () => {
            timer = 0;
            timedOut = true;
            process.force_exit();
            return GLib.SOURCE_REMOVE;
        });
        try {
            const [stdout] = await process.communicate_utf8_async(null, null);
            if (timedOut)
                throw new Error('Monitor command timed out');
            if (!process.get_successful()) {
                const action = args[0] === 'detect' ? 'Display scan' :
                    args.includes('getvcp') ? 'Brightness read' : 'Brightness change';
                throw new Error(`${action} failed`);
            }
            return stdout ?? '';
        } finally {
            if (timer)
                GLib.Source.remove(timer);
            this.process = null;
        }
    }

    cancel() {
        this.process?.force_exit();
    }
}
