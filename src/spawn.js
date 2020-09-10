// This tracks all the processes that we spawn from this file.
// Used to clean up processes when exiting this program.
const p = {};

const { spawn } = require("child_process");
const { resolve, dirname } = require('path');
const fs = require('fs');

// Output the chainspec of a node.
export async function generateChainSpec(bin, chain) {
	return new Promise(function (resolve) {
		let args = [
			"build-spec",
			"--chain=" + chain,
			"--disable-default-bootnode"
		];

		p['spec'] = spawn(bin, args);
		let spec = fs.createWriteStream(`${chain}.json`);

		p['spec'].stdout.on('data', function (chunk) {
			let message = chunk.toString();
			spec.write(message);
		});

		p['spec'].stderr.on('data', function (chunk) {
			let message = chunk.toString();
			console.error(message);
		});

		p['spec'].on('close', () => {
			resolve();
		});

		p['spec'].on('error', (err) => {
			reject(err);
		});
	})
}

// Output the chainspec of a node using `--raw` from a JSON file.
export async function generateChainSpecRaw(bin, chain) {
	return new Promise(function (resolve) {
		let args = [
			"build-spec",
			"--chain=" + chain + '.json',
			"--raw",
		];

		p['spec'] = spawn(bin, args);
		let spec = fs.createWriteStream(`${chain}-raw.json`);

		p['spec'].stdout.on('data', function (chunk) {
			let message = chunk.toString();
			spec.write(message);
		});

		p['spec'].stderr.on('data', function (chunk) {
			let message = chunk.toString();
			console.error(message);
		});

		p['spec'].on('close', () => {
			resolve();
		});

		p['spec'].on('error', (err) => {
			reject(err);
		});
	})
}

// Spawn a new relay chain node.
// `name` must be `alice`, `bob`, `charlie`, etc... (hardcoded in Substrate).
export function startNode(bin, name, wsPort, port, spec, flags) {
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
	}

	p[name] = spawn(bin, args);

	let log = fs.createWriteStream(`${name}.log`)

	p[name].stdout.on('data', function (chunk) {
		let message = chunk.toString();
		log.write(message);
	});

	p[name].stderr.on('data', function (chunk) {
		let message = chunk.toString();
		log.write(message);
	});
}

// Export the genesis wasm for a parachain.
// Used for registering the parachain on the relay chain.
export function generateWasm(bin, id) {
	let bin_path = dirname(bin);
	let wasm_file = resolve(bin_path, `${id}.wasm`);
	let wasm = fs.createWriteStream(wasm_file);
	let outputWasm = spawn(bin, [
		"export-genesis-wasm"
	]);
	outputWasm.stdout.on('data', function (chunk) {
		wasm.write(chunk);
	});
}

// Start a collator node for a parachain.
export function startCollator(bin, id, wsPort, port, spec, flags) {
	console.log("startapsdapdh")
	// Generate a wasm file for the collator. Used in registration.
	generateWasm(bin, id);

	console.log("wasm made")


	// TODO: Make DB directory configurable rather than just `tmp`
	let args = [
		"--tmp",
		"--ws-port=" + wsPort,
		"--port=" + port,
		"--parachain-id=" + id,
		"--validator",
	];

	if (flags) {
		// Add any additional flags to the CLI
		args = args.concat(flags);
	}

	// Arguments for the relay chain node part of the collator binary.
	args = args.concat([
		"--",
		"--chain=" + spec
	]);

	console.log("Hi Shawn", args)

	p[id] = spawn(bin, args);

	let log = fs.createWriteStream(`${id}.log`)

	p[id].stdout.on('data', function (chunk) {
		let message = chunk.toString();
		log.write(message);
	});

	p[id].stderr.on('data', function (chunk) {
		let message = chunk.toString();
		log.write(message);
	});
}

// Purge the chain for any node.
// You shouldn't need to use this function since every node starts with `--tmp`
// TODO: Make DB directory configurable rather than just `tmp`
export function purgeChain(bin, spec) {
	console.log("Purging Chain...");
	let args = ["purge-chain"];

	if (spec) {
		args.push("--chain=" + spec);
	}

	// Avoid prompt to confirm.
	args.push("-y");

	p['purge'] = spawn(bin, args);

	p['purge'].stdout.on('data', function (chunk) {
		let message = chunk.toString();
		console.log(message);
	});

	p['purge'].stderr.on('data', function (chunk) {
		let message = chunk.toString();
		console.log(message);
	});
}

// Kill all processes spawned and tracked by this file.
export function killAll() {
	console.log("\nKilling all processes...")
	for (const key of Object.keys(p)) {
		p[key].kill();
	}
}
