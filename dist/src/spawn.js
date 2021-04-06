"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.killAll = exports.purgeChain = exports.startSimpleCollator = exports.startCollator = exports.exportGenesisState = exports.exportGenesisWasm = exports.startNode = exports.generateChainSpecRaw = exports.generateChainSpec = void 0;
const child_process_1 = require("child_process");
const util_1 = __importDefault(require("util"));
const fs_1 = __importDefault(require("fs"));
// This tracks all the processes that we spawn from this file.
// Used to clean up processes when exiting this program.
const p = {};
//const util = require("util");
const execFile = util_1.default.promisify(require("child_process").execFile);
// const { spawn, exec } = require("child_process");
// const fs = require("fs");
// Output the chainspec of a node.
function generateChainSpec(bin, chain) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise(function (resolve, reject) {
            let args = ["build-spec", "--chain=" + chain, "--disable-default-bootnode"];
            p["spec"] = child_process_1.spawn(bin, args);
            let spec = fs_1.default.createWriteStream(`specFiles/${chain}.json`);
            // `pipe` since it deals with flushing and  we need to guarantee that the data is flushed
            // before we resolve the promise.
            p["spec"].stdout.pipe(spec);
            p["spec"].stderr.pipe(process.stderr);
            p["spec"].on("close", () => {
                resolve();
            });
            p["spec"].on("error", (err) => {
                reject(err);
            });
        });
    });
}
exports.generateChainSpec = generateChainSpec;
// Output the chainspec of a node using `--raw` from a JSON file.
function generateChainSpecRaw(bin, chain) {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise(function (resolve, reject) {
            let args = ["build-spec", "--chain=specFiles/" + chain + ".json", "--raw"];
            p["spec"] = child_process_1.spawn(bin, args);
            let spec = fs_1.default.createWriteStream(`specFiles/${chain}-raw.json`);
            // `pipe` since it deals with flushing and  we need to guarantee that the data is flushed
            // before we resolve the promise.
            p["spec"].stdout.pipe(spec);
            p["spec"].stderr.pipe(process.stderr);
            p["spec"].on("close", () => {
                resolve();
            });
            p["spec"].on("error", (err) => {
                reject(err);
            });
        });
    });
}
exports.generateChainSpecRaw = generateChainSpecRaw;
// Spawn a new relay chain node.
// `name` must be `alice`, `bob`, `charlie`, etc... (hardcoded in Substrate).
function startNode(bin, name, wsPort, port, spec, flags) {
    // TODO: Make DB directory configurable rather than just `tmp`
    let args = [
        "--chain=" + spec,
        "--tmp",
        "--ws-port=" + wsPort,
        "--port=" + port,
        "--" + name.toLowerCase(),
    ];
    if (flags) {
        // Add any additional flags to the CLI
        args = args.concat(flags);
        console.log(`Added ${flags}`);
    }
    p[name] = child_process_1.spawn(bin, args);
    let log = fs_1.default.createWriteStream(`${name}.log`);
    p[name].stdout.pipe(log);
    p[name].stderr.pipe(log);
}
exports.startNode = startNode;
// Export the genesis wasm for a parachain and return it as a hex encoded string starting with 0x.
// Used for registering the parachain on the relay chain.
function exportGenesisWasm(bin, chain) {
    return __awaiter(this, void 0, void 0, function* () {
        let args = ["export-genesis-wasm"];
        if (chain) {
            args.push("--chain=" + chain);
        }
        // wasm files are typically large and `exec` requires us to supply the maximum buffer size in
        // advance. Hopefully, this generous limit will be enough.
        let opts = { maxBuffer: 5 * 1024 * 1024 };
        let { stdout, stderr } = yield execFile(bin, args, opts);
        if (stderr) {
            console.error(stderr);
        }
        return stdout.trim();
    });
}
exports.exportGenesisWasm = exportGenesisWasm;
/// Export the genesis state aka genesis head.
function exportGenesisState(bin, id, chain) {
    return __awaiter(this, void 0, void 0, function* () {
        let args = ["export-genesis-state"];
        if (id) {
            args.push("--parachain-id=" + id);
        }
        if (chain) {
            args.push("--chain=" + chain);
        }
        // wasm files are typically large and `exec` requires us to supply the maximum buffer size in
        // advance. Hopefully, this generous limit will be enough.
        let opts = { maxBuffer: 5 * 1024 * 1024 };
        let { stdout, stderr } = yield execFile(bin, args, opts);
        if (stderr) {
            console.error(stderr);
        }
        return stdout.trim();
    });
}
exports.exportGenesisState = exportGenesisState;
// Start a collator node for a parachain.
function startCollator(bin, id, wsPort, port, chain, spec, flags) {
    return new Promise(function (resolve, reject) {
        // TODO: Make DB directory configurable rather than just `tmp`
        let args = [
            "--tmp",
            "--ws-port=" + wsPort,
            "--port=" + port,
            "--parachain-id=" + id,
            "--collator",
        ];
        if (chain) {
            args.push("--chain=" + chain);
            console.log(`Added --chain=${chain}`);
        }
        let flags_collator = null;
        let flags_parachain = null;
        let split_index = flags ? flags.findIndex((value) => value == "--") : -1;
        if (split_index < 0) {
            flags_parachain = flags;
        }
        else {
            flags_parachain = flags ? flags.slice(0, split_index) : null;
            flags_collator = flags ? flags.slice(split_index + 1) : null;
        }
        if (flags_parachain) {
            // Add any additional flags to the CLI
            args = args.concat(flags_parachain);
            console.log(`Added ${flags_parachain} to parachain`);
        }
        // Arguments for the relay chain node part of the collator binary.
        args = args.concat(["--", "--chain=" + spec]);
        if (flags_collator) {
            // Add any additional flags to the CLI
            args = args.concat(flags_collator);
            console.log(`Added ${flags_collator} to collator`);
        }
        p[wsPort] = child_process_1.spawn(bin, args);
        let log = fs_1.default.createWriteStream(`${wsPort}.log`);
        p[wsPort].stdout.pipe(log);
        p[wsPort].stderr.on("data", function (chunk) {
            let message = chunk.toString();
            if (message.substring(33, 62) === "Listening for new connections") {
                resolve();
            }
            log.write(message);
        });
        //p[id].stderr.pipe(log);
    });
}
exports.startCollator = startCollator;
function startSimpleCollator(bin, id, spec, port) {
    let args = [
        "--tmp",
        "--parachain-id=" + id,
        "--port=" + port,
        "--chain=" + spec,
        "--execution=wasm",
    ];
    p[id] = child_process_1.spawn(bin, args);
    let log = fs_1.default.createWriteStream(`${id}.log`);
    p[id].stdout.on("data", function (chunk) {
        let message = chunk.toString();
        log.write(message);
    });
    p[id].stderr.on("data", function (chunk) {
        let message = chunk.toString();
        log.write(message);
    });
}
exports.startSimpleCollator = startSimpleCollator;
// Purge the chain for any node.
// You shouldn't need to use this function since every node starts with `--tmp`
// TODO: Make DB directory configurable rather than just `tmp`
function purgeChain(bin, spec) {
    console.log("Purging Chain...");
    let args = ["purge-chain"];
    if (spec) {
        args.push("--chain=" + spec);
    }
    // Avoid prompt to confirm.
    args.push("-y");
    p["purge"] = child_process_1.spawn(bin, args);
    p["purge"].stdout.on("data", function (chunk) {
        let message = chunk.toString();
        console.log(message);
    });
    p["purge"].stderr.on("data", function (chunk) {
        let message = chunk.toString();
        console.log(message);
    });
}
exports.purgeChain = purgeChain;
// Kill all processes spawned and tracked by this file.
function killAll() {
    console.log("\nKilling all processes... (spawn)");
    for (const key of Object.keys(p)) {
        p[key].kill();
    }
}
exports.killAll = killAll;
