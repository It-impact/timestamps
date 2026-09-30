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

    // ---------- clock picker ----------
    // An in-page clock dial modeled on Android's time picker. Built entirely in
    // the page, so it never hands off to the phone's clock / time picker.
    var picker = (function () {
        var SVGNS = 'http://www.w3.org/2000/svg';
        var C = 128, R_OUT = 100, R_IN = 64, R_SEL = 20;

        var overlay, hourBtn, minBtn, amBtn, pmBtn, ampmBox, svg, hand, knob, knobDot, labels, labelsHi, clipKnob;
        var state = null;      // { h: 0-23, m: 0-59 }
        var mode = 'hour';     // 'hour' | 'minute'
        var done = null;
        var dragging = false;

        function btn(cls, text, onTap) {
            var b = make('button', cls, text);
            b.type = 'button';
            b.addEventListener('click', onTap);
            return b;
        }

        function svgEl(tag, attrs) {
            var n = document.createElementNS(SVGNS, tag);
            for (var k in attrs) n.setAttribute(k, attrs[k]);
            return n;
        }

        function polar(angleDeg, r) {
            var a = angleDeg * Math.PI / 180;
            return { x: C + r * Math.sin(a), y: C - r * Math.cos(a) };
        }

        function build() {
            overlay = make('div', 'ck-overlay');
            var dlg = make('div', 'ck-dialog');
            dlg.setAttribute('role', 'dialog');
            dlg.setAttribute('aria-modal', 'true');

            dlg.appendChild(make('div', 'ck-caption', 'Select time'));

            var head = make('div', 'ck-head');
            hourBtn = btn('ck-num', '', function () { setMode('hour'); });
            minBtn = btn('ck-num', '', function () { setMode('minute'); });
            head.appendChild(hourBtn);
            head.appendChild(make('span', 'ck-colon', ':'));
            head.appendChild(minBtn);

            ampmBox = make('div', 'ck-ampm');
            amBtn = btn('ck-period', 'AM', function () { if (state.h >= 12) state.h -= 12; refresh(); });
            pmBtn = btn('ck-period', 'PM', function () { if (state.h < 12) state.h += 12; refresh(); });
            ampmBox.appendChild(amBtn);
            ampmBox.appendChild(pmBtn);
            head.appendChild(ampmBox);
            dlg.appendChild(head);

            var dialWrap = make('div', 'ck-dial');
            svg = svgEl('svg', { viewBox: '0 0 256 256', 'aria-hidden': 'true' });
            svg.appendChild(svgEl('circle', { cx: C, cy: C, r: 124, 'class': 'ck-face' }));
            // Numbers, then the hand/knob on top, then a white copy of the numbers
            // clipped to the knob so whatever sits under the knob reads white.
            labels = svgEl('g', {});
            svg.appendChild(labels);
            hand = svgEl('line', { x1: C, y1: C, 'class': 'ck-hand' });
            svg.appendChild(hand);
            svg.appendChild(svgEl('circle', { cx: C, cy: C, r: 4, 'class': 'ck-pin' }));
            knob = svgEl('circle', { r: R_SEL, 'class': 'ck-knob' });
            svg.appendChild(knob);
            var defs = svgEl('defs', {});
            var clip = svgEl('clipPath', { id: 'ck-clip' });
            clipKnob = svgEl('circle', { r: R_SEL });
            clip.appendChild(clipKnob);
            defs.appendChild(clip);
            svg.appendChild(defs);
            labelsHi = svgEl('g', { 'clip-path': 'url(#ck-clip)', 'class': 'ck-hi' });
            svg.appendChild(labelsHi);
            knobDot = svgEl('circle', { r: 3, 'class': 'ck-knobdot' });
            svg.appendChild(knobDot);
            dialWrap.appendChild(svg);
            dlg.appendChild(dialWrap);

            svg.addEventListener('pointerdown', function (e) {
                dragging = true;
                try { svg.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
                pick(e);
                e.preventDefault();
            });
            svg.addEventListener('pointermove', function (e) { if (dragging) { pick(e); e.preventDefault(); } });
            function release() {
                if (!dragging) return;
                dragging = false;
                if (mode === 'hour') setTimeout(function () { setMode('minute'); }, 150);
            }
            svg.addEventListener('pointerup', release);
            svg.addEventListener('pointercancel', function () { dragging = false; });

            var foot = make('div', 'ck-foot');
            foot.appendChild(btn('ck-text ck-clear', 'Clear', function () { finish(''); }));
            foot.appendChild(btn('ck-text', 'Now', function () {
                var t = splitTime(currentTime()); state.h = t.h; state.m = t.m; refresh();
            }));
            foot.appendChild(make('span', 'ck-spacer'));
            foot.appendChild(btn('ck-text', 'Cancel', close));
            foot.appendChild(btn('ck-text ck-ok', 'OK', function () { finish(two(state.h) + ':' + two(state.m)); }));
            dlg.appendChild(foot);

            overlay.appendChild(dlg);
            overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
            document.addEventListener('keydown', function (e) {
                if (e.key === 'Escape' && overlay.classList.contains('open')) close();
            });
            document.body.appendChild(overlay);
        }

        // Convert a pointer position on the dial into an hour or minute.
        function pick(e) {
            var box = svg.getBoundingClientRect();
            var x = (e.clientX - box.left) * 256 / box.width - C;
            var y = (e.clientY - box.top) * 256 / box.height - C;
            var ang = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
            var dist = Math.sqrt(x * x + y * y);

            if (mode === 'hour') {
                var idx = Math.round(ang / 30) % 12;
                if (use24h) {
                    state.h = dist < (R_OUT + R_IN) / 2 ? idx + 12 : idx;
                } else {
                    state.h = idx + (state.h >= 12 ? 12 : 0);
                }
            } else {
                state.m = Math.round(ang / 6) % 60;
            }
            refresh();
        }

        function setMode(m) {
            mode = m;
            drawLabels();
            refresh();
        }

        function drawLabels() {
            labels.textContent = '';
            labelsHi.textContent = '';
            var items = [];
            if (mode === 'minute') {
                for (var m = 0; m < 60; m += 5) items.push({ v: m, text: two(m), ang: m * 6, r: R_OUT });
            } else if (use24h) {
                for (var h = 0; h < 12; h++) items.push({ v: h, text: two(h), ang: h * 30, r: R_OUT });
                for (var h2 = 12; h2 < 24; h2++) items.push({ v: h2, text: String(h2), ang: (h2 - 12) * 30, r: R_IN, inner: true });
            } else {
                for (var i = 0; i < 12; i++) items.push({ v: i === 0 ? 12 : i, text: String(i === 0 ? 12 : i), ang: i * 30, r: R_OUT });
            }
            items.forEach(function (it) {
                var p = polar(it.ang, it.r);
                var t = svgEl('text', {
                    x: p.x, y: p.y, 'text-anchor': 'middle', 'dominant-baseline': 'central',
                    'class': 'ck-label' + (it.inner ? ' ck-inner' : '')
                });
                t.textContent = it.text;
                labels.appendChild(t);
                labelsHi.appendChild(t.cloneNode(true));
            });
        }

        function refresh() {
            var h12 = state.h % 12 || 12;
            hourBtn.textContent = use24h ? two(state.h) : two(h12);
            minBtn.textContent = two(state.m);
            hourBtn.classList.toggle('on', mode === 'hour');
            minBtn.classList.toggle('on', mode === 'minute');
            ampmBox.style.display = use24h ? 'none' : '';
            amBtn.classList.toggle('on', state.h < 12);
            pmBtn.classList.toggle('on', state.h >= 12);

            var ang, r;
            if (mode === 'hour') {
                ang = (state.h % 12) * 30;
                r = use24h && state.h >= 12 ? R_IN : R_OUT;
            } else {
                ang = state.m * 6;
                r = R_OUT;
            }
            var p = polar(ang, r);
            var edge = polar(ang, r - R_SEL);
            hand.setAttribute('x2', edge.x);
            hand.setAttribute('y2', edge.y);
            knob.setAttribute('cx', p.x);
            knob.setAttribute('cy', p.y);
            knobDot.setAttribute('cx', p.x);
            knobDot.setAttribute('cy', p.y);
            clipKnob.setAttribute('cx', p.x);
            clipKnob.setAttribute('cy', p.y);
            // Minutes between the 5-minute labels show a small dot, like Android.
            knobDot.style.display = (mode === 'minute' && state.m % 5 !== 0) ? '' : 'none';

        }

        function open(value, callback) {
            if (!overlay) build();
            state = splitTime(value) || splitTime(currentTime());
            done = callback;
            mode = 'hour';
            drawLabels();
            refresh();
            overlay.classList.add('open');
            document.body.style.overflow = 'hidden';
        }

        function close() {
            overlay.classList.remove('open');
            document.body.style.overflow = '';
            done = null;
        }

        function finish(value) {
            var cb = done;
            close();
            if (cb) cb(value);
        }

        return { open: open };
    })();

    // Looks exactly like the original time box; the whole box is tappable.
    function timeBox(value, label, onPick) {
        var box = make('button', 'time-box', displayTime(value) || ' ');
        box.type = 'button';
        box.setAttribute('aria-label', label + ' time: ' + (displayTime(value) || 'not set'));
        box.addEventListener('click', function () { picker.open(value, onPick); });
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
