(function () {
    'use strict';

    var ENTRIES_KEY = 'timestamps';
    var FORMAT_KEY = 'is24Hour';

    // ---------- storage ----------
    function readJSON(key, fallback) {
        try {
            var raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (e) { return fallback; }
    }
    function writeJSON(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
    }

    var entries = readJSON(ENTRIES_KEY, []);
    if (!Array.isArray(entries)) entries = [];
    var use24h = readJSON(FORMAT_KEY, false) === true;

    function persist() { writeJSON(ENTRIES_KEY, entries); }

    // ---------- time helpers: times are stored as "HH:MM" (24h) or "" ----------
    function two(n) { return (n < 10 ? '0' : '') + n; }

    function currentTime() {
        var d = new Date();
        return two(d.getHours()) + ':' + two(d.getMinutes());
    }

    function splitTime(hhmm) {
        var m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '');
        return m ? { h: +m[1], m: +m[2] } : null;
    }

    function displayTime(hhmm) {
        var t = splitTime(hhmm);
        if (!t) return '';
        if (use24h) return two(t.h) + ':' + two(t.m);
        return two(t.h % 12 || 12) + ':' + two(t.m) + ' ' + (t.h < 12 ? 'AM' : 'PM');
    }

    function reportLine(entry) {
        var a = displayTime(entry.startTime);
        var b = displayTime(entry.endTime);
        if (a && !b) return a + ' -   ' + entry.title;
        if (!a && b) return '  - ' + b + ' ' + entry.title;
        return a + ' - ' + b + ' ' + entry.title;
    }

    // ---------- DOM helpers ----------
    function make(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function addOption(select, value, label, selected) {
        var o = document.createElement('option');
        o.value = value;
        o.textContent = label;
        o.selected = !!selected;
        select.appendChild(o);
    }

    // A box that reads like "01:29 PM" but each part is a tappable dropdown.
    // Dropdowns open the browser's own list, never the Android clock/time picker.
    function timeBox(value, label, onPick) {
        var t = splitTime(value);
        var box = make('div', 'time-box');
        var hour = make('select');
        var min = make('select');
        var ampm = make('select');
        hour.setAttribute('aria-label', label + ' hour');
        min.setAttribute('aria-label', label + ' minute');
        ampm.setAttribute('aria-label', label + ' AM/PM');

        addOption(hour, '', '--', !t);
        if (use24h) {
            for (var h = 0; h < 24; h++) addOption(hour, h, two(h), t && t.h === h);
        } else {
            var h12 = t ? (t.h % 12 || 12) : 0;
            for (var i = 1; i <= 12; i++) addOption(hour, i, two(i), h12 === i);
        }

        addOption(min, '', '--', !t);
        for (var m = 0; m < 60; m++) addOption(min, m, two(m), t && t.m === m);

        addOption(ampm, '', '--', !t);
        addOption(ampm, 'AM', 'AM', t && t.h < 12);
        addOption(ampm, 'PM', 'PM', t && t.h >= 12);

        function changed() {
            if (hour.value === '') { onPick(''); return; }
            var hr = +hour.value;
            if (!use24h) {
                hr = hr % 12;
                if (ampm.value === 'PM') hr += 12;
            }
            onPick(two(hr) + ':' + two(min.value === '' ? 0 : +min.value));
        }
        hour.addEventListener('change', changed);
        min.addEventListener('change', changed);
        ampm.addEventListener('change', changed);

        box.appendChild(hour);
        box.appendChild(make('span', 'sep', ':'));
        box.appendChild(min);
        if (!use24h) {
            box.appendChild(make('span', 'gap'));
            box.appendChild(ampm);
        }
        return box;
    }

    // ---------- render ----------
    var list = document.getElementById('entries');
    var header = document.getElementById('formatToggle');

    function render() {
        header.textContent = (use24h ? '24hr' : '12hr') + ' Timestamp Manager';
        list.textContent = '';

        entries.forEach(function (entry, idx) {
            var title = make('div', 'entry-title', entry.title);
            title.contentEditable = 'true';
            title.addEventListener('blur', function () {
                entry.title = title.innerText.trim();
                persist();
            });

            var row = make('div', 'entry-row');
            row.appendChild(timeBox(entry.startTime, 'Start', function (v) { entry.startTime = v; persist(); render(); }));
            row.appendChild(timeBox(entry.endTime, 'End', function (v) { entry.endTime = v; persist(); render(); }));

            var del = make('button', 'delete-btn', 'Delete');
            del.type = 'button';
            del.addEventListener('click', function () {
                if (confirm('Are you sure you want to delete this event?')) {
                    entries.splice(idx, 1);
                    persist();
                    render();
                }
            });
            row.appendChild(del);

            var main = make('div', 'entry-main');
            main.appendChild(title);
            main.appendChild(row);

            var side = make('div', 'entry-side');
            [['▲', -1, 'Move up'], ['▼', 1, 'Move down']].forEach(function (a) {
                var b = make('button', 'arrow', a[0]);
                b.type = 'button';
                b.setAttribute('aria-label', a[2]);
                b.addEventListener('click', function () { move(idx, a[1]); });
                side.appendChild(b);
            });

            var card = make('div', 'entry');
            card.appendChild(main);
            card.appendChild(side);
            list.appendChild(card);
        });
    }

    function move(idx, dir) {
        var to = idx + dir;
        if (to < 0 || to >= entries.length) return;
        var tmp = entries[idx];
        entries[idx] = entries[to];
        entries[to] = tmp;
        persist();
        render();
    }

    // ---------- clipboard ----------
    function legacyCopy(text) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        return ok;
    }

    function copyReport() {
        var text = entries.map(reportLine).join('\n');
        var done = function () { alert('Report copied to clipboard!'); };
        var fail = function () {
            if (legacyCopy(text)) done();
            else alert('Failed to copy text to clipboard');
        };
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(done, fail);
        } else {
            fail();
        }
    }

    // ---------- wiring ----------
    document.getElementById('addForm').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var input = document.getElementById('newTitle');
        var title = input.value.trim();
        if (!title) return;
        var now = currentTime();
        entries.push({ title: title, startTime: now, endTime: now });
        persist();
        input.value = '';
        render();
    });

    document.getElementById('copyBtn').addEventListener('click', copyReport);

    document.getElementById('clearBtn').addEventListener('click', function () {
        if (confirm('Are you sure you want to delete all entries? This cannot be undone.')) {
            entries = [];
            persist();
            render();
        }
    });

    header.addEventListener('click', function () {
        use24h = !use24h;
        writeJSON(FORMAT_KEY, use24h);
        render();
    });

    // Offline support
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('sw.js').catch(function () { /* ignore */ });
        });
    }

    window.__ts = { reportLine: reportLine };
    render();
})();
