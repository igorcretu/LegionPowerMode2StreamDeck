// Adapted from MiraBox StreamDock SDK — namespace-agnostic dispatcher

let $websocket, $lang;

class Timer {
    constructor(task, interval, immediate = false) {
        if (immediate) task();
        this.worker = new Worker('../static/utils/worker.js');
        this.worker.postMessage(interval);
        this.worker.onmessage = task;
    }
    stop() { this.worker.terminate(); }
}

class Action {
    constructor(data) {
        this.data = {};
        this.default = {};
        Object.assign(this, data);
    }
    willAppear(data) {
        const { context, payload: { settings } } = data;
        this.data[context] = Object.assign({ ...this.default }, settings);
        this._willAppear?.(data);
    }
    willDisappear(data) {
        this._willDisappear?.(data);
        delete this.data[data.context];
    }
    interval(task, interval, immediate = false) {
        return new Timer(task, interval, immediate);
    }
}

WebSocket.prototype.openUrl = function (url) {
    this.send(JSON.stringify({ event: "openUrl", payload: { url } }));
};
WebSocket.prototype.sendToPropertyInspector = function (action, context, payload) {
    this.send(JSON.stringify({ event: "sendToPropertyInspector", action, context, payload }));
};
WebSocket.prototype.setSettings = function (context, payload) {
    this.send(JSON.stringify({ event: "setSettings", context, payload }));
};
WebSocket.prototype.setImage = function (context, url) {
    const image = new Image();
    image.src = url;
    image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d").drawImage(image, 0, 0);
        this.send(JSON.stringify({ event: "setImage", context, payload: { target: 0, image: canvas.toDataURL("image/png") } }));
    };
};
WebSocket.prototype.setTitle = function (context, str) {
    this.send(JSON.stringify({ event: "setTitle", context, payload: { target: 0, title: str } }));
};
WebSocket.prototype.setState = function (context, state) {
    this.send(JSON.stringify({ event: "setState", context, payload: { state } }));
};
WebSocket.prototype.showOk = function (context) {
    this.send(JSON.stringify({ event: "showOk", context }));
};
WebSocket.prototype.showAlert = function (context) {
    this.send(JSON.stringify({ event: "showAlert", context }));
};

const connectSocket = connectElgatoStreamDeckSocket;
async function connectElgatoStreamDeckSocket(port, uuid, event, info) {
    $lang = JSON.parse(info).application.language;
    $websocket = new WebSocket("ws://127.0.0.1:" + port);
    $websocket.onopen = () => $websocket.send(JSON.stringify({ uuid, event }));
    $websocket.onmessage = e => {
        const data = JSON.parse(e.data);
        // Use the last segment of the action UUID as the key into $plugin
        const actionKey = data.action?.split('.').pop();
        $plugin[actionKey]?.[data.event]?.(data);
    };
}
