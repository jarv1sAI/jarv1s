#!/usr/bin/env node

import { runAgent } from './agent.js';
import { startDashboard } from './dashboard.js';
import { runDoctor } from './doctor.js';
import { startPeerDaemon, listPeers, askPeer } from './peer.js';
import { runExport, runImport, runSync } from './transfer.js';

function printHelp(): void {
  console.log(`
JARVIS v2.1 — local-first AI assistant

Usage:
  jarvis [query]                      One-shot query
  jarvis                              Interactive REPL
  jarvis dashboard [--port N]         Start the web dashboard (default port 4444)
  jarvis doctor                       Run system health checks

  jarvis export [--out <file>]        Export full identity + memory to a bundle file
               [--no-history]         Exclude conversation history from bundle
  jarvis import <file>                Import a bundle onto this device (merge)
               [--adopt-identity]     Adopt the bundle's agent ID (same identity across devices)
               [--no-history]         Skip importing conversation history
               [--no-config]          Skip importing jarvis.yaml

  jarvis peer [--port N]              Start peer daemon (default port 7474)
  jarvis peers                        List JARVIS instances on the local network
  jarvis ask <host:port> <query>      Send a query to a peer instance
  jarvis sync <host:port>             Pull all memory + facts from a running peer

  jarvis --help                       Show this help

Flags:
  --model <name>       Override the model for this invocation
  --provider <name>    Override the provider (ollama|openai|anthropic|custom)

Environment:
  ANTHROPIC_API_KEY    API key for Anthropic provider
  OPENAI_API_KEY       API key for OpenAI provider
  JARVIS_API_KEY       Generic API key override
  JARVIS_MODEL         Override the model
  JARVIS_PROVIDER      Override the provider
  JARVIS_BASE_URL      Override the API base URL

Config file: ~/.jarvis/config/jarvis.yaml
  provider: ollama        # ollama | openai | anthropic | custom
  model: llama3.2
  base_url: http://localhost:11434/v1

REPL commands:
  /memory              Show all stored facts
  /history             Browse recent conversation history
  /forget <key>        Delete a stored fact
  /clear               Clear the screen
  /exit                Quit

Image input (REPL or one-shot):
  Include image paths in angle brackets: "describe <./screenshot.png>"

Portability:
  # Export from old device
  jarvis export --out my-jarvis.jarvis.bundle

  # Import on new device (keeps new identity, merges data)
  jarvis import my-jarvis.jarvis.bundle

  # Import and become the same agent as the source device
  jarvis import my-jarvis.jarvis.bundle --adopt-identity

  # Live sync from a peer on the LAN
  jarvis sync 192.168.1.10:7474

Peer networking:
  # On device A:
  jarvis peer --port 7474

  # On device B (same LAN):
  jarvis peers                           # auto-discover A
  jarvis ask 192.168.1.10:7474 "hello"   # query A directly
`.trim());
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === '--help' || args[0] === '-h') {
    printHelp();
    return;
  }

  if (args[0] === 'doctor') {
    runDoctor();
    return;
  }

  if (args[0] === 'dashboard') {
    const portIdx = args.indexOf('--port');
    const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 4444;
    startDashboard(isNaN(port) ? 4444 : port);
    return;
  }

  // --- export ---
  if (args[0] === 'export') {
    await runExport(args.slice(1));
    return;
  }

  // --- import ---
  if (args[0] === 'import') {
    await runImport(args.slice(1));
    return;
  }

  // --- sync from peer ---
  if (args[0] === 'sync') {
    await runSync(args.slice(1));
    return;
  }

  // --- peer daemon ---
  if (args[0] === 'peer') {
    const portIdx = args.indexOf('--port');
    const port = portIdx !== -1 ? parseInt(args[portIdx + 1], 10) : 7474;
    await startPeerDaemon(isNaN(port) ? 7474 : port);
    return;
  }

  // --- list peers on LAN ---
  if (args[0] === 'peers') {
    process.stdout.write('Scanning local network for JARVIS peers (3s)...\n');
    const peers = await listPeers(3000);
    if (peers.length === 0) {
      console.log('No peers found. Make sure other devices are running: jarvis peer');
    } else {
      console.log(`Found ${peers.length} peer(s):\n`);
      for (const p of peers) {
        console.log(`  ${p.address}:${p.port}  ${p.name}  (v${p.version ?? '?'})`);
      }
    }
    return;
  }

  // --- ask <host:port> <query> ---
  if (args[0] === 'ask') {
    const target = args[1];
    const query = args.slice(2).join(' ');
    if (!target || !query) {
      console.error('Usage: jarvis ask <host:port> <query>');
      process.exit(1);
    }
    const [host, portStr] = target.includes(':') ? target.split(':') : [target, '7474'];
    const port = parseInt(portStr, 10);
    if (isNaN(port)) { console.error('Invalid port in target'); process.exit(1); }

    const peer = { name: target, host, address: host, port };
    try {
      await askPeer(peer, query);
      process.stdout.write('\n');
    } catch (err: unknown) {
      console.error(`Error: ${(err as { message?: string }).message ?? String(err)}`);
      process.exit(1);
    }
    return;
  }

  // --model and --provider flags
  const modelIdx = args.indexOf('--model');
  const model = modelIdx !== -1 ? args[modelIdx + 1] : undefined;
  const providerIdx = args.indexOf('--provider');
  const provider = providerIdx !== -1 ? args[providerIdx + 1] : undefined;

  const flagPairs = new Set<number>();
  [modelIdx, providerIdx].forEach((i) => { if (i !== -1) { flagPairs.add(i); flagPairs.add(i + 1); } });
  const queryArgs = args.filter((_, i) => !flagPairs.has(i));

  if (queryArgs.length > 0) {
    await runAgent(queryArgs.join(' '), { model, provider });
  } else {
    await runAgent(undefined, { model, provider });
  }
}

main().catch((error) => {
  console.error('Fatal error:', (error as { message?: string }).message || error);
  process.exit(1);
});
