/**
 * JARVIS peer networking — local network orchestration.
 *
 * Provides:
 *   - mDNS advertisement of this instance via Bonjour (_jarvis._tcp)
 *   - mDNS browsing to discover peers on the LAN
 *   - HTTP peer API:
 *       GET  /status           → identity + stats
 *       POST /query            → run a query through the agent, stream SSE response
 *       GET  /sync/facts       → dump all facts (for pull-sync)
 *       POST /sync/facts       → receive facts from a remote peer (push-sync)
 *       GET  /sync/memory      → dump JARVIS.md contents
 * - `jarvis peers`            → list discovered peers and exit
 * - `jarvis ask <host> <msg>` → send a query to a peer, stream response to stdout
 * - `jarvis peer [--port N]`  → start peer daemon (stays running)
 */

import http from 'http';
import { Bonjour } from 'bonjour-service';
import type { Service as BonjourService } from 'bonjour-service';
import OpenAI from 'openai';
import { loadIdentity } from './identity.js';
import {
  getAllFacts,
  saveFact,
  getAllMessages,
  getSessionIds,
  loadJarvisMd,
  saveMessage,
  getOrCreateSession,
} from './memory.js';
import { loadConfig } from './config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PeerInfo {
  name: string;       // mDNS service name (identity ID)
  host: string;       // resolved host
  address: string;    // first IPv4 address
  port: number;
  version?: string;
}

// ---------------------------------------------------------------------------
// mDNS browser (shared singleton)
// ---------------------------------------------------------------------------

let bonjour: InstanceType<typeof Bonjour> | null = null;
const discovered = new Map<string, PeerInfo>();

export function startDiscovery(): void {
  if (bonjour) return;
  bonjour = new Bonjour();
  const browser = bonjour.find({ type: 'jarvis' });

  browser.on('up', (svc: BonjourService) => {
    const ipv4 = (svc.addresses ?? []).find((a: string) => !a.includes(':')) ?? svc.host;
    const info: PeerInfo = {
      name: svc.name,
      host: svc.host,
      address: ipv4,
      port: svc.port,
      version: (svc.txt as Record<string, string>)?.version,
    };
    discovered.set(svc.name, info);
  });

  browser.on('down', (svc: BonjourService) => {
    discovered.delete(svc.name);
  });
}

export function stopDiscovery(): void {
  if (bonjour) {
    bonjour.destroy();
    bonjour = null;
  }
  discovered.clear();
}

export function getDiscoveredPeers(): PeerInfo[] {
  return Array.from(discovered.values());
}

// ---------------------------------------------------------------------------
// Peer API client helpers
// ---------------------------------------------------------------------------

export async function fetchPeerStatus(peer: PeerInfo): Promise<Record<string, unknown>> {
  const url = `http://${peer.address}:${peer.port}/status`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

/**
 * Send a query to a remote peer, streaming the response to stdout.
 * The peer returns SSE; we print tokens as they arrive.
 */
export async function askPeer(peer: PeerInfo, query: string): Promise<void> {
  const url = `http://${peer.address}:${peer.port}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok || !res.body) {
    throw new Error(`Peer returned HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;
      try {
        const obj = JSON.parse(data) as { token?: string; error?: string };
        if (obj.error) throw new Error(obj.error);
        if (obj.token) process.stdout.write(obj.token);
      } catch { /* skip malformed */ }
    }
  }
}

/**
 * Pull all facts from a peer and merge them into local storage.
 * Existing local keys are NOT overwritten.
 */
export async function pullFactsFromPeer(peer: PeerInfo): Promise<number> {
  const url = `http://${peer.address}:${peer.port}/sync/facts`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const facts = (await res.json()) as Array<{ key: string; value: string }>;
  const local = new Set(getAllFacts().map((f) => f.key));
  let imported = 0;
  for (const { key, value } of facts) {
    if (!local.has(key)) {
      saveFact(key, value);
      imported++;
    }
  }
  return imported;
}

// ---------------------------------------------------------------------------
// One-shot peer listing (for `jarvis peers` CLI command)
// ---------------------------------------------------------------------------

export async function listPeers(timeoutMs = 3000): Promise<PeerInfo[]> {
  return new Promise((resolve) => {
    const b = new Bonjour();
    const peers: PeerInfo[] = [];
    const browser = b.find({ type: 'jarvis' });

    browser.on('up', (svc: BonjourService) => {
      const ipv4 = (svc.addresses ?? []).find((a: string) => !a.includes(':')) ?? svc.host;
      peers.push({
        name: svc.name,
        host: svc.host,
        address: ipv4,
        port: svc.port,
        version: (svc.txt as Record<string, string>)?.version,
      });
    });

    setTimeout(() => {
      b.destroy();
      resolve(peers);
    }, timeoutMs);
  });
}

// ---------------------------------------------------------------------------
// Peer daemon
// ---------------------------------------------------------------------------

export async function startPeerDaemon(port = 7474): Promise<void> {
  const identity = loadIdentity();
  const config = loadConfig();

  // Advertise via mDNS
  const b = new Bonjour();
  b.publish({
    name: identity.id,
    type: 'jarvis',
    port,
    txt: { version: identity.version, model: config.model, provider: config.provider },
  });

  // Also start local discovery so the daemon knows about other peers
  startDiscovery();

  // Build OpenAI client for handling incoming queries
  const client = new OpenAI({
    apiKey: config.api_key ?? 'no-key',
    ...(config.base_url ? { baseURL: config.base_url } : {}),
  });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    // CORS for dashboard usage
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // --- GET /status ---
    if (req.method === 'GET' && url.pathname === '/status') {
      const facts = getAllFacts();
      const sessions = getSessionIds();
      const messages = getAllMessages(1000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: identity.id,
        version: identity.version,
        created: identity.created,
        provider: config.provider,
        model: config.model,
        stats: {
          facts: facts.length,
          sessions: sessions.length,
          messages: messages.length,
        },
      }));
      return;
    }

    // --- GET /peers ---
    if (req.method === 'GET' && url.pathname === '/peers') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getDiscoveredPeers()));
      return;
    }

    // --- GET /sync/facts ---
    if (req.method === 'GET' && url.pathname === '/sync/facts') {
      const facts = getAllFacts().map(({ key, value }) => ({ key, value }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(facts));
      return;
    }

    // --- POST /sync/facts (push from remote) ---
    if (req.method === 'POST' && url.pathname === '/sync/facts') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const facts = JSON.parse(body) as Array<{ key: string; value: string }>;
          const local = new Set(getAllFacts().map((f) => f.key));
          let imported = 0;
          for (const { key, value } of facts) {
            if (!local.has(key)) { saveFact(key, value); imported++; }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ imported }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
        }
      });
      return;
    }

    // --- GET /sync/memory ---
    if (req.method === 'GET' && url.pathname === '/sync/memory') {
      const memory = loadJarvisMd();
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(memory);
      return;
    }

    // --- GET /sync/history ---
    if (req.method === 'GET' && url.pathname === '/sync/history') {
      const msgs = getAllMessages(10000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(msgs));
      return;
    }

    // --- POST /query (SSE streaming) ---
    if (req.method === 'POST' && url.pathname === '/query') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        void (async () => {
          let query: string;
          try {
            const parsed = JSON.parse(body) as { query?: string };
            query = parsed.query ?? '';
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid JSON' }));
            return;
          }

          if (!query.trim()) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'query is required' }));
            return;
          }

          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          res.flushHeaders();

          const send = (obj: unknown): void => {
            res.write(`data: ${JSON.stringify(obj)}\n\n`);
          };

          try {
            saveMessage('user', query);
            const stream = await client.chat.completions.create({
              model: config.model,
              max_tokens: config.max_tokens,
              stream: true,
              messages: [
                {
                  role: 'system',
                  content: `You are JARVIS on device ${identity.id.slice(0, 20)}. Be concise.`,
                },
                { role: 'user', content: query },
              ],
            });

            let fullText = '';
            for await (const chunk of stream) {
              const token = chunk.choices[0]?.delta?.content;
              if (token) {
                fullText += token;
                send({ token });
              }
            }
            if (fullText) saveMessage('assistant', fullText);
          } catch (err: unknown) {
            send({ error: (err as { message?: string }).message ?? 'Unknown error' });
          }

          res.write('data: [DONE]\n\n');
          res.end();
        })();
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`JARVIS Peer API → http://0.0.0.0:${port}\n`);
    process.stdout.write(`mDNS: advertising as "${identity.id}" (_jarvis._tcp)\n`);
    process.stdout.write(`Press Ctrl+C to stop.\n`);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    b.unpublishAll();
    b.destroy();
    stopDiscovery();
    server.close(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    b.unpublishAll();
    b.destroy();
    stopDiscovery();
    server.close(() => process.exit(0));
  });

  // Keep alive
  await new Promise<void>(() => {/* runs until signal */});
}
