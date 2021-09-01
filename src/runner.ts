#!/usr/bin/env node

import {
	startNode,
	startCollator,
	generateChainSpec,
	generateChainSpecRaw,
	exportGenesisWasm,
	exportGenesisState,
	startSimpleCollator,
	getParachainIdFromSpec,
} from "./spawn";
import { connect, registerParachain, setBalance } from "./rpc";
import { checkConfig } from "./check";
import {
	clearAuthorities,
	addAuthority,
	changeGenesisConfig,
	addGenesisParachain,
	addGenesisHrmpChannel,
} from "./spec";
import { parachainAccount } from "./parachain";
import { ApiPromise } from "@polkadot/api";

import { resolve } from "path";
import fs from "fs";
import {
	LaunchConfig,
	ResolvedParachainConfig,
	HrmpChannelsConfig,
	ResolvedLaunchConfig,
} from "./types";

function loadTypeDef(types: string | object): object {
	if (typeof types === "string") {
		// Treat types as a json file path
		try {
			const rawdata = fs.readFileSync(types, { encoding: "utf-8" });
			return JSON.parse(rawdata);
		} catch {
			console.error("failed to load parachain typedef file");
			process.exit(1);
		}
	} else {
		return types;
	}
}

// keep track of registered parachains
let registeredParachains: { [key: string]: boolean } = {};

export async function run(config_dir: string, rawConfig: LaunchConfig) {
	// Verify that the `config.json` has all the expected properties.
	if (!checkConfig(rawConfig)) {
		return;
	}
	const config = await resolveParachainId(config_dir, rawConfig);

	const relay_chain_bin = resolve(config_dir, config.relaychain.bin);
	if (!fs.existsSync(relay_chain_bin)) {
		console.error("Relay chain binary does not exist: ", relay_chain_bin);
		process.exit();
	}
	const chain = config.relaychain.chain;
	await generateChainSpec(relay_chain_bin, chain);
	// -- Start Chain Spec Modify --
	clearAuthorities(`${chain}.json`);
	for (const node of config.relaychain.nodes) {
		await addAuthority(`${chain}.json`, node.name);
	}
	if (config.relaychain.genesis) {
		await changeGenesisConfig(`${chain}.json`, config.relaychain.genesis);
	}
	await addParachainsToGenesis(config_dir, `${chain}.json`, config.parachains);
	if (config.hrmpChannels) {
		await addHrmpChannelsToGenesis(`${chain}.json`, config.hrmpChannels);
	}
	// -- End Chain Spec Modify --
	await generateChainSpecRaw(relay_chain_bin, chain);
	const spec = resolve(`${chain}-raw.json`);

	// First we launch each of the validators for the relay chain.
	for (const node of config.relaychain.nodes) {
		const { name, wsPort, port, flags, basePath } = node;
		console.log(`Starting ${name}...`);
		// We spawn a `child_process` starting a node, and then wait until we
		// able to connect to it using PolkadotJS in order to know its running.
		startNode(relay_chain_bin, name, wsPort, port, spec, flags, basePath);
	}

	// Connect to the first relay chain node to submit the extrinsic.
	let relayChainApi: ApiPromise = await connect(
		config.relaychain.nodes[0].wsPort,
		loadTypeDef(config.types)
	);

	// Then launch each parachain
	for (const parachain of config.parachains) {
		const { id, resolvedId, balance, chain } = parachain;
		const bin = resolve(config_dir, parachain.bin);
		if (!fs.existsSync(bin)) {
			console.error("Parachain binary does not exist: ", bin);
			process.exit();
		}
		let account = parachainAccount(resolvedId);

		for (const node of parachain.nodes) {
			const { wsPort, port, flags, name, basePath } = node;
			console.log(
				`Starting a Collator for parachain ${resolvedId}: ${account}, Collator port : ${port} wsPort : ${wsPort}`
			);
			const skipIdArg = !id;
			await startCollator(
				bin,
				resolvedId,
				wsPort,
				port,
				name,
				chain,
				spec,
				flags,
				basePath,
				skipIdArg
			);
		}

		// Allow time for the TX to complete, avoiding nonce issues.
		// TODO: Handle nonce directly instead of this.
		if (balance) {
			await setBalance(relayChainApi, account, balance, config.finalization);
		}
	}

	// Then launch each simple parachain (e.g. an adder-collator)
	if (config.simpleParachains) {
		for (const simpleParachain of config.simpleParachains) {
			const { id, resolvedId, port, balance } = simpleParachain;
			const bin = resolve(config_dir, simpleParachain.bin);
			if (!fs.existsSync(bin)) {
				console.error("Simple parachain binary does not exist: ", bin);
				process.exit();
			}

			let account = parachainAccount(resolvedId);
			console.log(`Starting Parachain ${resolvedId}: ${account}`);
			const skipIdArg = !id;
			await startSimpleCollator(bin, resolvedId, spec, port, skipIdArg);

			// Get the information required to register the parachain on the relay chain.
			let genesisState;
			let genesisWasm;
			try {
				// adder-collator does not support `--parachain-id` for export-genesis-state (and it is
				// not necessary for it anyway), so we don't pass it here.
				genesisState = await exportGenesisState(bin);
				genesisWasm = await exportGenesisWasm(bin);
			} catch (err) {
				console.error(err);
				process.exit(1);
			}

			console.log(`Registering Parachain ${resolvedId}`);
			await registerParachain(
				relayChainApi,
				resolvedId,
				genesisWasm,
				genesisState,
				config.finalization
			);

			// Allow time for the TX to complete, avoiding nonce issues.
			// TODO: Handle nonce directly instead of this.
			if (balance) {
				await setBalance(relayChainApi, account, balance, config.finalization);
			}
		}
	}

	// We don't need the PolkadotJs API anymore
	await relayChainApi.disconnect();

	// Here we beging hacking.
	// We want to cause a multi-block re-org on the relay chain
	// which will imply a reorg on the parachain also.
	//
	// Based on our config, we know that we have the following nodes:
	// alice, bob, charlie, dave, 9988, 9989
	
	// TODO wait until the parachain has authored a few blocks

	// TODO Kill half the nodes (charlie, dave, 9989)
	// This drops the finality voters below 2/3 which will stop finality
	// and also prevents the offline-nodes from syncing the chain

	// TODO wait for a few more parablocks to be authored

	// TODO Kill remaining nodes (Alice, bob, 9988)
	// This will stall the entire chain

	// TODO bring first-killed nodes back online (charlie, dave, 9989)
	// This will cause them to pick up where they left off, shortly after the para became live
	// We are still below 2/3 so the new histories that they author will also be unfinalized.

	// TODO wait for the new fork length to exceed the old fork length (by at least on para block)

	// TODO restart all all nodes.
	// This should cause the second-killed nodes (Alice, Bob, 9988)
	// to re-org to the more-recently-authored longer chain.
	// With all finality voters back online, the newer, longer chain should quickly becom finalized.

	// TODO check which nodes know tell us about which blocks.

	console.log("🚀 POLKADOT LAUNCH COMPLETE 🚀");
}

async function addParachainsToGenesis(
	config_dir: string,
	spec: string,
	parachains: ResolvedParachainConfig[]
) {
	console.log("\n⛓ Adding Genesis Parachains");
	for (const parachain of parachains) {
		const { id, resolvedId, chain } = parachain;
		const bin = resolve(config_dir, parachain.bin);
		if (!fs.existsSync(bin)) {
			console.error("Parachain binary does not exist: ", bin);
			process.exit();
		}
		// If it isn't registered yet, register the parachain in genesis
		if (!registeredParachains[resolvedId]) {
			// Get the information required to register the parachain in genesis.
			let genesisState;
			let genesisWasm;
			try {
				genesisState = await exportGenesisState(bin, id, chain);
				genesisWasm = await exportGenesisWasm(bin, chain);
			} catch (err) {
				console.error(err);
				process.exit(1);
			}

			await addGenesisParachain(
				spec,
				resolvedId,
				genesisState,
				genesisWasm,
				true
			);
			registeredParachains[resolvedId] = true;
		}
	}
}

async function addHrmpChannelsToGenesis(
	spec: string,
	hrmpChannels: HrmpChannelsConfig[]
) {
	console.log("⛓ Adding Genesis HRMP Channels");
	for (const hrmpChannel of hrmpChannels) {
		await addGenesisHrmpChannel(spec, hrmpChannel);
	}
}

// Resolves parachain id from chain spec if not specified
async function resolveParachainId(
	config_dir: string,
	config: LaunchConfig
): Promise<ResolvedLaunchConfig> {
	console.log(`\n🧹 Resolving parachain id...`);
	const resolvedConfig = config as ResolvedLaunchConfig;
	for (const parachain of resolvedConfig.parachains) {
		if (parachain.id) {
			parachain.resolvedId = parachain.id;
		} else {
			const bin = resolve(config_dir, parachain.bin);
			const paraId = await getParachainIdFromSpec(bin, parachain.chain);
			console.log(`  ✓ Read parachain id for ${parachain.bin}: ${paraId}`);
			parachain.resolvedId = paraId.toString();
		}
	}
	return resolvedConfig;
}
