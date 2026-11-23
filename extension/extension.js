// SPDX-License-Identifier: GPL-2.0-or-later
import GLib from 'gi://GLib';
import St from 'gi://St';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {DdcQueue, targets} from './ddc.js';
import {DdcProcess} from './process.js';

export default class MultiDisplayBrightness extends Extension {
    enable() {
        this.settings = this.getSettings();
        this.rows = new Map();
        this.preview = null;
        this.commitTimer = 0;
        this.ignoredSlider = null;
        this.dragSlider = null;
        this.syncing = false;
        this.scale = null;
        this.scaleSignal = 0;

        this.button = new PanelMenu.Button(0.0, 'Multi-Display Brightness');
        this.button.add_child(new St.Icon({
            icon_name: 'display-brightness-symbolic',
            style_class: 'system-status-icon',
        }));
        this.addRow('laptop', 'Laptop');
        this.externalSection = new PopupMenu.PopupMenuSection();
        this.button.menu.addMenuItem(this.externalSection);
        this.scanStatus = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
        this.button.menu.addMenuItem(this.scanStatus);

        const link = new PopupMenu.PopupSwitchMenuItem(
            'Link brightness', this.settings.get_boolean('linked'));
        link.connect('toggled', (_item, linked) => {
            this.commit();
            this.settings.set_boolean('linked', linked);
        });
        this.button.menu.addMenuItem(link);
        this.button.menu.addAction('Refresh displays', () => this.refreshDisplays());

        this.process = new DdcProcess();
        const process = this.process;
        const previous = this.previousQueue;
        this.queue = new DdcQueue(async args => {
            if (previous)
                await previous;
            if (this.process !== process)
                throw new Error('Extension disabled');
            return process.run(args);
        }, (id, result, pending) => {
            if (!result) {
                const row = this.rows.get(id);
                this.rows.delete(id);
                if (row?.slider === this.ignoredSlider)
                    this.ignoredSlider = null;
                row?.heading.destroy();
                row?.item.destroy();
                row?.statusItem.destroy();
                return;
            }

            if (!this.rows.has(id))
                this.addRow(id, result.label, this.externalSection);
            const row = this.rows.get(id);
            row.heading.label.text = result.label;
            row.slider.accessible_name = `${result.label} brightness`;
            Object.assign(row, {
                available: result.max !== null,
                percent: result.max === null ? null : 100 * result.raw / result.max,
                pending,
                status: result.status,
            });
            this.render();
        }, status => {
            this.scanStatus.label.text = status;
            this.scanStatus.visible = Boolean(status);
        });

        this.manager = Main.brightnessManager;
        this.managerSignal = this.manager.connect('changed', () => {
            this.bindLaptop();
            this.refreshDisplays();
        });
        this.bindLaptop();
        Main.panel.addToStatusArea(this.uuid, this.button);
        this.refreshDisplays();
    }

    refreshDisplays() {
        this.abortPreview();
        this.queue.refresh();
        this.render();
    }

    addRow(id, label, section = this.button.menu) {
        const heading = new PopupMenu.PopupMenuItem(label, {reactive: false});
        const value = new St.Label({text: '—', style_class: 'multi-display-brightness-value'});
        heading.add_child(value);
        section.addMenuItem(heading);

        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const slider = new Slider(0);
        slider.accessible_name = `${label} brightness`;
        item.add_child(new St.Bin({
            child: slider,
            x_expand: true,
            style_class: 'slider-bin',
        }));
        section.addMenuItem(item);

        const status = new PopupMenu.PopupMenuItem('', {
            reactive: false,
            style_class: 'multi-display-brightness-status',
        });
        section.addMenuItem(status);

        slider.connect('drag-begin', () => {
            this.commit();
            this.dragSlider = slider;
            if (this.ignoredSlider === slider)
                this.ignoredSlider = null;
        });
        slider.connect('drag-end', () => {
            if (this.ignoredSlider === slider) {
                this.ignoredSlider = null;
                this.render();
                return;
            }
            if (this.dragSlider === slider) {
                this.dragSlider = null;
                this.commit();
            }
        });
        slider.connect('notify::value', () => {
            if (!this.syncing && this.ignoredSlider !== slider && this.rows.get(id)?.available)
                this.previewChange(id, slider.value);
        });
        this.rows.set(id, {
            heading, item, slider, value, statusItem: status, available: false,
            percent: null, pending: null, status: 'Detecting…',
        });
    }

    bindLaptop() {
        this.disconnectLaptop();
        this.scale = this.manager.scales.find(scale =>
            scale.monitor.get_monitors().some(monitor =>
                /^(eDP|LVDS|DSI)(?:-|$)/i.test(monitor.get_connector() ?? ''))) ?? null;
        if (this.scale)
            this.scaleSignal = this.scale.connect('notify::value', () => this.syncLaptop());
        this.syncLaptop();
    }

    disconnectLaptop() {
        if (this.scaleSignal)
            this.scale.disconnect(this.scaleSignal);
        this.scaleSignal = 0;
        this.scale = null;
    }

    syncLaptop() {
        const row = this.rows.get('laptop');
        row.available = this.scale !== null;
        row.percent = this.scale ? this.scale.value * 100 : null;
        row.status = this.scale ? '' : 'Laptop backlight unavailable';
        this.render();
    }

    previewChange(id, value) {
        if (this.preview && this.preview.source !== id)
            this.commit();
        const available = [...this.rows].filter(([, row]) => row.available).map(([key]) => key);
        this.preview = {
            source: id,
            percent: Math.max(1, Math.round(value * 100)),
            ids: targets(id, this.settings.get_boolean('linked'), available),
        };
        this.render();
        if (!this.dragSlider) {
            this.clearCommitTimer();
            this.commitTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                this.commitTimer = 0;
                this.commit();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    clearCommitTimer() {
        if (this.commitTimer)
            GLib.Source.remove(this.commitTimer);
        this.commitTimer = 0;
    }

    abortPreview() {
        this.clearCommitTimer();
        this.preview = null;
        if (this.dragSlider)
            this.ignoredSlider = this.dragSlider;
        this.dragSlider = null;
    }

    commit() {
        this.clearCommitTimer();
        const change = this.preview;
        if (!change)
            return;
        this.preview = null;
        for (const id of change.ids) {
            const row = this.rows.get(id);
            if (!row?.available)
                continue;
            if (id === 'laptop') {
                this.scale.value = change.percent / 100;
            } else {
                row.pending = change.percent;
                row.status = 'Applying…';
                this.queue.write(id, change.percent);
            }
        }
        this.render();
    }

    render() {
        this.syncing = true;
        try {
            for (const [id, row] of this.rows) {
                const editing = row.available && this.preview?.ids.includes(id);
                const percent = editing ? this.preview.percent : row.pending ?? row.percent;
                row.value.text = percent === null ? '—' : `${Math.round(percent)}%`;
                // Preserve the native slider's exact pointer position during its active gesture.
                const sliderValue = (percent ?? 0) / 100;
                if (!(editing && this.preview.source === id) && row.slider.value !== sliderValue) {
                    // GNOME 50 uses this cached value as the base for keyboard and scroll changes.
                    row.slider._unsnappedValue = null;
                    row.slider.value = sliderValue;
                }
                row.slider.reactive = row.available;
                row.slider.can_focus = row.available;
                row.statusItem.label.text = row.status;
                row.statusItem.visible = Boolean(row.status);
            }
        } finally {
            this.syncing = false;
        }
    }

    disable() {
        this.abortPreview();
        this.manager.disconnect(this.managerSignal);
        this.disconnectLaptop();
        this.queue.stop();
        this.previousQueue = this.queue.running?.catch(logError) ?? null;
        this.process.cancel();
        this.button.destroy();
        this.button = null;
        this.queue = null;
        this.process = null;
        this.settings = null;
        this.manager = null;
        this.rows.clear();
    }
}
