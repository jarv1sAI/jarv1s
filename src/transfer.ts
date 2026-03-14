/**
 * JARVIS portability — export, import, and live peer sync.
 *
 * Commands:
 *   jarvis export [--out <file>]   Pack ~/.jarvis into a .jarvis.bundle JSON file
 *   jarvis import <file>           Unpack a bundle onto this device (merge strategy)
 *   jarvis sync <host:port>        Pull identity + all data from a running peer
 *
 * Bundle format (plain JSON, gzip-compressed, .jarvis.bundle extension):
 * {
 *   version:    "2.1.0",
 *   exported:   ISO timestamp,
 *   identity:   { id, created, version },
 *   facts:      [{ key, value, created_at }],
 *   memory:     "<JARVIS.md contents>",
 *   history:    [{ session_id, role, content, timestamp }],   // optional, --no-history skips
 *   config:     "<jarvis.yaml contents>",
 * }
 */

import { createGzip, gunzipSync } from 'zlib';
import { createWriteStream, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { loadIdentity, DIRS, getMemoryDir } from './identity.js';
import {
  getAllFacts,
  getAllMessages,
  saveFact,
  loadJarvisMd,
  appendToJarvisMd,
  closeDb,
} from './memory.js';
import { getConfigDir } from './identity.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BundleFact {
  key: string;
  value: string;
  created_at: string;
}

interface BundleMessage {
  session_id: string;
  role: string;
  content: string;
  timestamp: string;
}

interface JarvisBundle {
  version: string;
  exported: string;
  identity: { id: string; created: string; version: string };
  facts: BundleFact[];
  memory: string;
  history: BundleMessage[];
  config: string;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function exportBundle(opts: { out?: string; noHistory?: boolean } = {}): Promise<string> {
  const identity = loadIdentity();
  const facts = getAllFacts().map(({ key, value, created_at }) => ({ key, value, created_at }));
  const memory = loadJarvisMd();
  const history = opts.noHistory ? [] : (getAllMessages(10000) as BundleMessage[]);

  const configPath = join(getConfigDir(), 'jarvis.yaml');
  const config = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : '';

  const bundle: JarvisBundle = {
    version: identity.version,
    exported: new Date().toISOString(),
    identity,
    facts,
    memory,
    history,
    config,
  };

  const json = JSON.stringify(bundle, null, 2);
  const outPath = opts.out ?? join(process.cwd(), `jarvis-${identity.id.slice(7, 19)}-${Date.now()}.jarvis.bundle`);

  // Write gzip-compressed bundle
  await new Promise<void>((resolve, reject) => {
    const gz = createGzip();
    const out = createWriteStream(outPath);
    gz.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    gz.pipe(out);
    gz.write(json);
    gz.end();
  });

  return outPath;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportResult {
  factsImported: number;
  factsSkipped: number;
  historyImported: number;
  memoryMerged: boolean;
  configWritten: boolean;
  identityAdopted: boolean;
}

export async function importBundle(
  filePath: string,
  opts: { adoptIdentity?: boolean; noHistory?: boolean; noConfig?: boolean } = {},
): Promise<ImportResult> {
  if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  const json = readGzipJson(filePath);
  const bundle = json as JarvisBundle;

  if (!bundle.version || !bundle.identity?.id) {
    throw new Error('Invalid bundle file — missing version or identity');
  }

  const result: ImportResult = {
    factsImported: 0,
    factsSkipped: 0,
    historyImported: 0,
    memoryMerged: false,
    configWritten: false,
    identityAdopted: false,
  };

  // Facts — no-overwrite merge
  const localKeys = new Set(getAllFacts().map((f) => f.key));
  for (const { key, value } of bundle.facts) {
    if (localKeys.has(key)) {
      result.factsSkipped++;
    } else {
      saveFact(key, value);
      result.factsImported++;
    }
  }

  // JARVIS.md — append bundle memory under a separator if local has content
  if (bundle.memory) {
    const localMemory = loadJarvisMd();
    if (!localMemory.includes(bundle.memory.trim().slice(0, 80))) {
      appendToJarvisMd(`\n\n---\n<!-- Imported from ${bundle.identity.id} on ${new Date().toISOString()} -->\n${bundle.memory}`);
      result.memoryMerged = true;
    }
  }

  // Conversation history — import under original session IDs
  if (!opts.noHistory && bundle.history?.length) {
    for (const msg of bundle.history) {
      // Use saveMessage with the original session context by temporarily overriding
      // We write directly via the DB helper to preserve session_id
      saveMessageWithSession(msg.session_id, msg.role, msg.content, msg.timestamp);
      result.historyImported++;
    }
  }

  // Config — write only if no local config exists (or --adopt-identity implies fresh setup)
  if (!opts.noConfig && bundle.config) {
    const configPath = join(getConfigDir(), 'jarvis.yaml');
    if (!existsSync(configPath)) {
      writeFileSync(configPath, bundle.config);
      result.configWritten = true;
    }
  }

  // Identity — optionally adopt the bundle's identity (same agent across devices)
  if (opts.adoptIdentity) {
    const identityFile = join(DIRS.identity, 'jarvis.id');
    writeFileSync(identityFile, JSON.stringify(bundle.identity, null, 2));
    result.identityAdopted = true;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Live peer sync (pull from running peer daemon)
// ---------------------------------------------------------------------------

export interface SyncResult {
  factsImported: number;
  factsSkipped: number;
  memoryMerged: boolean;
  historyImported: number;
}

export async function syncFromPeer(address: string, port: number): Promise<SyncResult> {
  const base = `http://${address}:${port}`;

  // Fetch facts
  const factsRes = await fetch(`${base}/sync/facts`, { signal: AbortSignal.timeout(10_000) });
  if (!factsRes.ok) throw new Error(`Peer /sync/facts returned HTTP ${factsRes.status}`);
  const remoteFacts = (await factsRes.json()) as Array<{ key: string; value: string }>;

  const localKeys = new Set(getAllFacts().map((f) => f.key));
  let factsImported = 0, factsSkipped = 0;
  for (const { key, value } of remoteFacts) {
    if (localKeys.has(key)) { factsSkipped++; }
    else { saveFact(key, value); factsImported++; }
  }

  // Fetch JARVIS.md
  let memoryMerged = false;
  const memRes = await fetch(`${base}/sync/memory`, { signal: AbortSignal.timeout(10_000) });
  if (memRes.ok) {
    const remoteMemory = await memRes.text();
    const localMemory = loadJarvisMd();
    if (remoteMemory.trim() && !localMemory.includes(remoteMemory.trim().slice(0, 80))) {
      appendToJarvisMd(`\n\n---\n<!-- Synced from ${address}:${port} on ${new Date().toISOString()} -->\n${remoteMemory}`);
      memoryMerged = true;
    }
  }

  // Fetch history
  let historyImported = 0;
  const histRes = await fetch(`${base}/sync/history`, { signal: AbortSignal.timeout(15_000) });
  if (histRes.ok) {
    const remoteHistory = (await histRes.json()) as BundleMessage[];
    const localMsgs = new Set(
      getAllMessages(10000).map((m) => `${m.session_id}|${m.role}|${String(m.content).slice(0, 40)}`)
    );
    for (const msg of remoteHistory) {
      const key = `${msg.session_id}|${msg.role}|${msg.content.slice(0, 40)}`;
      if (!localMsgs.has(key)) {
        saveMessageWithSession(msg.session_id, msg.role, msg.content, msg.timestamp);
        historyImported++;
      }
    }
  }

  return { factsImported, factsSkipped, memoryMerged, historyImported };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readGzipJson(filePath: string): unknown {
  const compressed = readFileSync(filePath);
  const decompressed = gunzipSync(compressed);
  return JSON.parse(decompressed.toString('utf-8'));
}

/**
 * Write a message preserving its original session_id, bypassing the
 * in-memory currentSessionId so we don't contaminate the live session.
 */
function saveMessageWithSession(sessionId: string, role: string, content: string, timestamp: string): void {
  const dbPath = join(getMemoryDir(), 'interactions.db');
  const db = new Database(dbPath);
  try {
    db.prepare('INSERT OR IGNORE INTO conversations (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)')
      .run(sessionId, role, content, timestamp);
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// CLI entry points
// ---------------------------------------------------------------------------

export async function runExport(args: string[]): Promise<void> {
  const outIdx = args.indexOf('--out');
  const out = outIdx !== -1 ? args[outIdx + 1] : undefined;
  const noHistory = args.includes('--no-history');

  process.stdout.write('Packing bundle…\n');
  const filePath = await exportBundle({ out, noHistory });
  const { statSync } = await import('fs');
  const size = Math.round(statSync(filePath).size / 1024);
  console.log(`Bundle saved: ${filePath} (${size} KB)`);
  if (noHistory) console.log('Note: conversation history excluded (--no-history)');
  closeDb();
}

export async function runImport(args: string[]): Promise<void> {
  const filePath = args[0];
  if (!filePath) { console.error('Usage: jarvis import <file.jarvis.bundle> [--adopt-identity] [--no-history] [--no-config]'); process.exit(1); }

  const adoptIdentity = args.includes('--adopt-identity');
  const noHistory = args.includes('--no-history');
  const noConfig = args.includes('--no-config');

  process.stdout.write(`Importing from ${filePath}…\n`);
  const result = await importBundle(filePath, { adoptIdentity, noHistory, noConfig });

  console.log(`\nImport complete:`);
  console.log(`  Facts imported  : ${result.factsImported}`);
  console.log(`  Facts skipped   : ${result.factsSkipped} (already exist locally)`);
  console.log(`  History imported: ${result.historyImported} messages`);
  console.log(`  Memory merged   : ${result.memoryMerged ? 'yes' : 'already up to date'}`);
  console.log(`  Config written  : ${result.configWritten ? 'yes' : 'skipped (already exists)'}`);
  if (adoptIdentity) console.log(`  Identity adopted: yes — this device is now ${result.identityAdopted ? 'the same agent' : '(unchanged)'}`);
  closeDb();
}

export async function runSync(args: string[]): Promise<void> {
  const target = args[0];
  if (!target) { console.error('Usage: jarvis sync <host:port>'); process.exit(1); }

  const [host, portStr] = target.includes(':') ? target.split(':') : [target, '7474'];
  const port = parseInt(portStr, 10);
  if (isNaN(port)) { console.error('Invalid port'); process.exit(1); }

  process.stdout.write(`Syncing from ${host}:${port}…\n`);
  const result = await syncFromPeer(host, port);

  console.log(`\nSync complete:`);
  console.log(`  Facts imported  : ${result.factsImported}`);
  console.log(`  Facts skipped   : ${result.factsSkipped}`);
  console.log(`  History imported: ${result.historyImported} messages`);
  console.log(`  Memory merged   : ${result.memoryMerged ? 'yes' : 'already up to date'}`);
  closeDb();
}
