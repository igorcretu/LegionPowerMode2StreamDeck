'use strict';
const { execFile } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const WebSocket = require('./node_modules/ws');

const PIPE_PATH = '\\\\.\\pipe\\igorcretu-legion-powermode';
const HELPER_TASK_NAME = 'IgorCretu-LegionPowerModeHelper';
const POLL_MS = 8000;
const MODES = ['Quiet', 'Balance', 'Performance']; // index+1 == LENOVO_GAMEZONE_DATA SetSmartFanMode value

// Parse StreamDock CLI args: -port 18618 -pluginUUID xxx ...
const argv = process.argv.slice(2);
const args = {};
for (let i = 0; i < argv.length - 1; i += 2) {
    args[argv[i].replace(/^-+/, '')] = argv[i + 1];
}
const { port, pluginUUID } = args;

// Pre-load PNG images as base64 data URLs
const IMG_DIR = path.join(__dirname, '..', 'static', 'img', 'states');
function loadImg(name) {
    try {
        return 'data:image/png;base64,' + fs.readFileSync(path.join(IMG_DIR, name + '.png')).toString('base64');
    } catch { return null; }
}
const IMAGES = {
    Quiet:       loadImg('quiet'),
    Balance:     loadImg('balance'),
    Performance: loadImg('performance'),
    connecting:  loadImg('connecting'),
    error:       loadImg('error'),
    setup:       loadImg('setup'),
};

// Elevated helper (see helper/helper.ps1), reached over a named pipe so this
// non-elevated process never has to call the LENOVO_GAMEZONE_DATA WMI class itself.
function pipeRequest(command, timeoutMs = 3000) {
    return new Promise(resolve => {
        let settled = false;
        const socket = net.connect(PIPE_PATH);
        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            resolve(result);
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        let buf = '';
        socket.on('connect', () => socket.write(command + '\n'));
        socket.on('data', chunk => {
            buf += chunk.toString();
            const nl = buf.indexOf('\n');
            if (nl !== -1) finish(buf.slice(0, nl).trim());
        });
        socket.on('error', () => finish(null));
    });
}
function taskExists() {
    return new Promise(resolve => {
        execFile('schtasks', ['/query', '/tn', HELPER_TASK_NAME], { timeout: 5000 }, (err) => resolve(!err));
    });
}
function triggerHelperTask() {
    return new Promise(resolve => {
        execFile('schtasks', ['/run', '/tn', HELPER_TASK_NAME], { timeout: 5000 }, () => resolve());
    });
}
// Returns { res } on success, { res: null, setupNeeded: true } if the helper task was
// never installed (see helper/install-task.ps1), or { res: null } on a transient failure.
async function pipeCall(command) {
    let res = await pipeRequest(command);
    if (res === null) {
        if (!(await taskExists())) return { res: null, setupNeeded: true };
        // Helper task exists but isn't running right now (first use this session,
        // or it crashed) — silently re-trigger it and retry once.
        await triggerHelperTask();
        await new Promise(r => setTimeout(r, 1000));
        res = await pipeRequest(command);
    }
    return { res, setupNeeded: false };
}
async function getCurrentMode() {
    const { res, setupNeeded } = await pipeCall('GET');
    if (setupNeeded) return { mode: null, setupNeeded: true };
    if (!res || !res.startsWith('OK ')) return { mode: null, setupNeeded: false };
    const n = parseInt(res.slice(3), 10);
    return { mode: MODES[n - 1] || null, setupNeeded: false };
}
async function setMode(mode) {
    const n = MODES.indexOf(mode) + 1;
    if (n <= 0) return { ok: false, setupNeeded: false };
    const { res, setupNeeded } = await pipeCall(`SET ${n}`);
    if (setupNeeded) return { ok: false, setupNeeded: true };
    return { ok: res === 'OK', setupNeeded: false };
}

// StreamDock WebSocket
const ws = new WebSocket(`ws://127.0.0.1:${port}`);
const state = {};

function send(obj) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}
function sendImage(context, key) {
    const image = IMAGES[key];
    if (image) send({ event: 'setImage', context, payload: { target: 0, image } });
}

async function refresh(context) {
    const { mode, setupNeeded } = await getCurrentMode();
    if (!state[context]) return;
    if (setupNeeded) {
        state[context].failures = 0;
        sendImage(context, 'setup');
        return;
    }
    if (!mode) {
        state[context].failures = (state[context].failures || 0) + 1;
        if (state[context].failures >= 5) sendImage(context, 'error');
        return;
    }
    state[context].failures = 0;
    state[context].mode = mode;
    sendImage(context, mode);
}

ws.on('open', () => {
    send({ event: 'registerPlugin', uuid: pluginUUID });
});

ws.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    const { event, context } = msg;

    if (event === 'willAppear') {
        state[context] = { mode: null, failures: 0 };
        sendImage(context, 'connecting');
        await refresh(context);
        if (state[context]) state[context].timer = setInterval(() => refresh(context), POLL_MS);

    } else if (event === 'willDisappear') {
        if (state[context]) { clearInterval(state[context].timer); delete state[context]; }

    } else if (event === 'keyUp') {
        const current = state[context]?.mode;
        const idx = MODES.indexOf(current);
        const next = MODES[(idx + 1) % MODES.length];
        if (state[context]) state[context].mode = next;
        sendImage(context, next);
        const result = await setMode(next);
        if (!result.ok) {
            if (state[context]) state[context].mode = current;
            send({ event: 'showAlert', context });
            sendImage(context, result.setupNeeded ? 'setup' : (current || 'error'));
        }
    }
});

ws.on('close', () => process.exit(0));
ws.on('error', () => {});
