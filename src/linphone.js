"use strict";
const child_process_1 = require("child_process");
const crypto_1 = require("crypto");
const events_1 = require("events");
const fs_1 = require("fs");
const ini = require("ini");
const DebugLogger = require("local-dfi-debug-logger/debugLogger");
const ChildrenManager = require("./childrenManager");
let logger = new DebugLogger("dfi:linphone");
class Linphone extends events_1.EventEmitter {
    constructor(configuration) {
        super();
        this._logger = new DebugLogger("dfi:linphone");
        let config = {
            host: "localhost",
            password: "not set",
            port: 5060,
            rtpPort: 7078,
            sip: "not set"
        };
        this._configuration = configuration || config;
        this._incoming = {};
        this._calls = {};
        this._output = [];
        this.registered = false;
        if (false) {
            this._bindProcessSignals();
        }
        this.on(Linphone.events.ERROR, (err) => {
            this._logger.error(err);
        });
        this.on(Linphone.events.READY, () => {
            let target = this._configuration.file.replace("conf", "wav");
            this._write("soundcard use files");
            this.on(Linphone.events.SOUNDCARD_CHANGED, () => {
                this._write("record " + target);
            });
        });
        let date = new Date();
        let randomInt = Math.floor(Math.random() * (100000 - 10000 + 1) + 1000);
        let fileName = crypto_1.createHash("sha1")
            .update(date.toUTCString() + date.getMilliseconds() + randomInt)
            .digest("hex");
        let filePath = "/tmp/" + fileName + ".linphone.conf";
        this._onConfigName(filePath);
    }
    static get events() {
        return EVENTS;
    }
    static newLineStream(callback, context) {
        let buffer = "";
        return ((chunk) => {
            let i;
            let piece = "";
            let offset = 0;
            buffer += chunk;
            while (buffer.indexOf("\n", offset) !== -1) {
                i = buffer.indexOf("\n", offset);
                piece = buffer.substr(offset, i - offset);
                offset = i + 1;
                callback.call(context, piece);
            }
            buffer = buffer.substr(offset);
        });
    }
    static _eventName(event) {
        let symbolName = Symbol.prototype.toString.call(event);
        let x = symbolName.match(/Symbol\((.*)\)/);
        return x[1];
    }
    makeCall(target) {
        this._logger.info(this._configuration.sip + ": making call to : " + target);
        this._write("call " + target);
    }
    answer(callNumber) {
        this._logger.info(this._configuration.sip + " :answering");
        let msg = "answer";
        if (typeof callNumber !== "undefined") {
            msg = msg + " " + callNumber;
        }
        this._write(msg);
    }
    ;
    endCall(callNumber) {
        this._logger.info(this._configuration.sip + ": ending call");
        let msg = "terminate";
        if (typeof callNumber !== "undefined") {
            msg = msg + " " + callNumber;
        }
        this._write(msg);
    }
    ;
    unregister() {
        this._logger.info(this._configuration.sip + ": unregister");
        this._write("unregister");
    }
    ;
    register() {
        this._logger.info(this._configuration.sip + ":register");
        this._write("register");
    }
    ;
    clearBindings() {
        this.removeAllListeners(Linphone.events.ANSWERED);
        this.removeAllListeners(Linphone.events.END);
        this.removeAllListeners(Linphone.events.END_CALL);
        this.removeAllListeners(Linphone.events.INCOMING);
        this.removeAllListeners(Linphone.events.UNREGISTERED);
    }
    ;
    exit() {
        this._logger.info("exiting");
        this._write("quit");
        // this._linphoneProcess.stdout.removeAllListeners("data");
        // this._linphoneProcess.stderr.removeAllListeners("data");
    }
    ;
    kill() {
        this._logger.info("kill");
        this._linphoneProcess.kill();
        // this._linphoneProcess.stdout.removeAllListeners("data");
        // this._linphoneProcess.stderr.removeAllListeners("data");
    }
    ;
    getInterface() {
        return this._configuration.technology + "/" + this._configuration.sip;
    }
    ;
    getSipNumber() {
        return this._configuration.sip;
    }
    ;
    getListenersCount(eventName) {
        return this.listenerCount(eventName);
    }
    _write(data) {
        this._logger.debug("writing-" + this._configuration.sip + ": " + data);
        this._linphoneProcess.stdin.write(data + "\n");
    }
    ;
    _processIncomingLine(line) {
        line = line.trim();
        if (!line) {
            return;
        }
        if (line === "Ready") {
            this._logger.info("emitting-" + this._configuration.sip + ": " + Linphone._eventName(Linphone.events.READY)
                + " c:" + this.getListenersCount(Linphone.events.READY));
            this.emit(Linphone.events.READY, this);
        }
        else if (line.match(/Could not start/)) {
            this._logger.info("emitting-" + this._configuration.sip + ": " + Linphone._eventName(Linphone.events.ERROR)
                + " c:" + this.getListenersCount(Linphone.events.ERROR));
            this.emit(Linphone.events.ERROR, new Error(line), this);
        }
        else if (line.match(/Registration.+failed/)) {
            this._logger.info("emitting-" + this._configuration.sip + ": " + Linphone._eventName(Linphone.events.ERROR)
                + " c:" + this.getListenersCount(Linphone.events.ERROR));
            this.emit(Linphone.events.ERROR, new Error(line), this);
        }
        else if (line.match(/Registration.+successful/)) {
            this._logger.info("emitting-" + this._configuration.sip + ": " + Linphone._eventName(Linphone.events.REGISTERED)
                + " c:" + this.getListenersCount(Linphone.events.REGISTERED));
            this.registered = true;
            this.emit(Linphone.events.REGISTERED, line, this);
        }
        else if (line === "Using wav files instead of soundcard.") {
            this._logger.info("emitting-" + this._configuration.sip + ": " + Linphone._eventName(Linphone.events.SOUNDCARD_CHANGED)
                + " c:" + this.getListenersCount(Linphone.events.SOUNDCARD_CHANGED));
            this.emit(Linphone.events.SOUNDCARD_CHANGED, this);
        }
        else if (line.match(/Receiving new incoming call/)) {
            // Receiving new incoming call from <sip:e1307a08-b16d-4202-a1b5-fec8e1e84613@10.0.11.10>, assigned id 1
            let parts = /.*<(.*)>.*(\d+)/.exec(line);
            let id = 1;
            if (parts) {
                this._incoming[parts[2]] = parts[1];
                id = parseInt(parts[2], 10);
            }
            this._logger.info("emitting-" + this._configuration.sip + ": " + Linphone._eventName(Linphone.events.INCOMING) + " c:" + this.getListenersCount(Linphone.events.INCOMING) + "");
            this.emit(Linphone.events.INCOMING, line, id, this);
        }
        else if (line.match(/Call.+connected/)) {
            this._logger.info("emitting-" + this._configuration.sip + ": " + Linphone._eventName(Linphone.events.ANSWERED) + " c:" + this.getListenersCount(Linphone.events.ANSWERED) + "");
            let id = /Call (\d+).+connected/.exec(line)[1];
            this.emit(Linphone.events.ANSWERED, line, id, this);
        }
        else if (line.match(/Call.+with.+ended/)) {
            this._logger.info("emitting-" + this._configuration.sip + ": " + Linphone._eventName(Linphone.events.END_CALL) + " c:" + this.getListenersCount(Linphone.events.END_CALL) + "");
            this.emit(Linphone.events.END_CALL, line, this);
        }
        else if (line.match(/Unregistration on.+done/)) {
            this._logger.info("emitting-" + this._configuration.sip + ": " + Linphone._eventName(Linphone.events.UNREGISTERED) + " c:" + this.getListenersCount(Linphone.events.UNREGISTERED) + "");
            this.registered = false;
            this.emit(Linphone.events.UNREGISTERED, line, this);
        }
        else {
        }
    }
    _bindLinphoneStdio() {
        let stdOutListener = Linphone.newLineStream((message) => {
            message = message.replace("linphonec>", "").trim();
            this._logger.debug("stdout-" + this._configuration.sip + ": " + message);
            this._output.push(message);
            this._processIncomingLine(message);
        }, this);
        this._linphoneProcess.stdout.on("data", stdOutListener.bind(this));
        this._linphoneProcess.stderr.on("data", (data) => {
            let lines = data.toString().split("\n");
            lines.forEach(line => {
                if (line && !line.match(/ALSA lib/)) {
                    this._logger.warn("stderr-" + this._configuration.sip + ": " + data);
                }
            });
        });
        this._linphoneProcess.on("close", (code) => {
            this._logger.info("child process exited with code " + code);
        });
    }
    _onConfigWritten(conf) {
        let onError = (err) => {
            this._logger.error(err.message + err.stack);
        };
        this._linphoneProcess = child_process_1.spawn("linphonec", ["-c", conf]);
        ChildrenManager.addChild(this._linphoneProcess);
        this._linphoneProcess.on("error", onError);
        this._linphoneProcess.stderr.on("error", onError);
        this._linphoneProcess.stdin.on("error", onError);
        this._linphoneProcess.stdout.on("error", onError);
        this._linphoneProcess.on("exit", (arg) => {
            this._logger.info("emitting-" + this._configuration.sip + ": " + Linphone._eventName(Linphone.events.END));
            this.emit(Linphone.events.END, this);
        });
        this._linphoneProcess.on("close", (arg) => {
            this._logger.info("emitting-" + this._configuration.sip + ": " + Linphone._eventName(Linphone.events.CLOSE));
            this.emit(Linphone.events.CLOSE, this);
            this.removeAllListeners();
            this._linphoneProcess.on("error", onError);
        });
        this._linphoneProcess.on("disconnect", () => {
            this._logger.info("break");
        });
        this._linphoneProcess.on("message", () => {
            this._logger.info("break");
        });
        this._bindLinphoneStdio();
    }
    _onConfigName(filePath) {
        this._configuration.file = filePath;
        fs_1.readFile(__dirname + "/linphone.conf", { encoding: "utf8" }, (err, data) => {
            if (err) {
                this.emit(Linphone.events.ERROR, err);
                return;
            }
            /**
             * @type {{rtp,auth_info_0,proxy_0}}
             */
            let newData = ini.parse(data);
            let linConfig = this._configuration;
            newData.sip.sip_port = linConfig.port;
            newData.rtp.audio_rtp_port = linConfig.rtpPort;
            newData.auth_info_0.passwd = linConfig.password;
            newData.auth_info_0.username = linConfig.sip;
            newData.proxy_0.reg_identity = "sip:" + linConfig.sip + "@" + linConfig.host;
            newData.proxy_0.reg_proxy = "<sip:" + linConfig.host + ">";
            // newData.sound.capture_dev_id = "ALSA: default device";
            // newData.sound.playback_dev_id = "ALSA: default device";
            // newData.sound.ringer_dev_id = "ALSA: default device";
            fs_1.writeFile(filePath, ini.stringify(newData), (writeErr) => {
                if (writeErr) {
                    this.emit(Linphone.events.ERROR, writeErr);
                    return;
                }
                this._onConfigWritten(filePath);
            });
        });
    }
    _bindProcessSignals() {
        // let signals = ["SIGUSR1", "SIGTERM", "SIGPIPE", "SIGHUP", "SIGTERM", "SIGINT", "exit", "uncaughtException"];
        process.on("SIGUSR1", () => {
            logger.info("Got SIGUSR1.  Press Control-D to exit.");
        });
        process.on("SIGTERM", () => {
            logger.info("Got SIGTERM.  Press Control-D to exit.");
        });
        process.on("SIGPIPE", () => {
            logger.info("Got Got.  Press Control-D to exit.");
        });
        process.on("SIGHUP", () => {
            logger.info("Got SIGHUP.  Press Control-D to exit.");
        });
        process.on("SIGTERM", () => {
            logger.info("Got SIGTERM.  Press Control-D to exit.");
        });
        process.on("SIGINT", () => {
            logger.info("Got SIGINT.  Press Control-D to exit.");
        });
        process.on("exit", () => {
            this._linphoneProcess.kill();
            // logger.info("About to exit with code:", code);
        });
        process.on("uncaughtException", (err) => {
            logger.info("Caught exception: " + err);
            throw err;
        });
    }
}
const EVENTS = {
    CLOSE: Symbol("close"),
    CONFIG_WRITTEN: Symbol("configWritten"),
    ERROR: Symbol("error"),
    READY: Symbol("ready"),
    RECORD_SET: Symbol("recordFileSet"),
    REGISTERED: Symbol("registered"),
    SOUNDCARD_CHANGED: Symbol("soundcardChanged"),
    STARTED: Symbol("processStarted"),
    ANSWERED: Symbol("answered"),
    END: Symbol("end"),
    END_CALL: Symbol("endCall"),
    INCOMING: Symbol("incoming"),
    UNREGISTERED: Symbol("unregistered")
};
module.exports = Linphone;
//# sourceMappingURL=linphone.js.map