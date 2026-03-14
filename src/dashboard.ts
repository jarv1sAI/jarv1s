/**
 * JARVIS Web Dashboard (v2.0)
 * Local HTTP server — Node built-ins only, no extra dependencies.
 *
 * Home: Iron Man HUD — arc reactor orb, scanlines, hex grid, dynamic response cards
 * Panels: Memory/Facts, History, System
 */

import * as http from 'http';
import { spawn } from 'child_process';
import { statSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import OpenAI from 'openai';
import {
  getAllMessages, getAllFacts, getSessionIds,
  deleteFact, saveMessage, getRecentMessages, loadJarvisMd,
} from './memory.js';
import { loadIdentity, getMemoryDir } from './identity.js';
import { loadConfig } from './config.js';
import { startDiscovery, stopDiscovery, getDiscoveredPeers, askPeer } from './peer.js';
import { exportBundle, syncFromPeer } from './transfer.js';

const DEFAULT_PORT = 4444;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => { d += c; });
    req.on('end', () => resolve(d));
    req.on('error', reject);
  });
}

function json(res: http.ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  });
  res.end(JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

function handleApi(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';

  if (url === '/api/status' && method === 'GET') {
    const identity = loadIdentity();
    const config = loadConfig();
    const facts = getAllFacts();
    const sessions = getSessionIds();
    const msgs = getAllMessages(9999);
    const dbPath = join(getMemoryDir(), 'interactions.db');
    const dbSize = existsSync(dbPath) ? statSync(dbPath).size : 0;
    json(res, {
      identity,
      config: { provider: config.provider, model: config.model, base_url: config.base_url },
      stats: { facts: facts.length, sessions: sessions.length, messages: msgs.length, dbSizeKb: Math.round(dbSize / 1024) },
    });
    return true;
  }

  if (url === '/api/facts' && method === 'GET') { json(res, getAllFacts()); return true; }

  if (url.startsWith('/api/facts/') && method === 'DELETE') {
    const key = decodeURIComponent(url.slice('/api/facts/'.length));
    const deleted = deleteFact(key);
    json(res, { deleted, key }, deleted ? 200 : 404);
    return true;
  }

  if (url === '/api/history' && method === 'GET') { json(res, getAllMessages(300)); return true; }

  if (url === '/api/sessions' && method === 'GET') {
    const ids = getSessionIds();
    const msgs = getAllMessages(9999);
    json(res, ids.map((id) => ({
      id,
      count: msgs.filter((m) => m.session_id === id).length,
      last: msgs.filter((m) => m.session_id === id).at(-1)?.timestamp ?? null,
    })));
    return true;
  }

  if (url === '/api/chat' && method === 'POST') { void handleChatStream(req, res); return true; }

  if (url === '/api/peers' && method === 'GET') {
    json(res, getDiscoveredPeers());
    return true;
  }

  // POST /api/peer-query — stream a query to a peer via SSE
  if (url === '/api/peer-query' && method === 'POST') {
    void handlePeerQueryStream(req, res);
    return true;
  }

  // GET /api/export — download a bundle file
  if (url === '/api/export' && method === 'GET') {
    void (async () => {
      try {
        const noHistory = new URL(req.url ?? '/', 'http://x').searchParams.get('no_history') === '1';
        const tmpPath = join(tmpdir(), `jarvis-export-${Date.now()}.jarvis.bundle`);
        await exportBundle({ out: tmpPath, noHistory });
        const data = readFileSync(tmpPath);
        unlinkSync(tmpPath);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="jarvis.jarvis.bundle"`,
          'Content-Length': data.length,
          'Access-Control-Allow-Origin': '*',
        });
        res.end(data);
      } catch (err: unknown) {
        json(res, { error: (err as { message?: string }).message ?? 'Export failed' }, 500);
      }
    })();
    return true;
  }

  // POST /api/sync — pull from a running peer
  if (url === '/api/sync' && method === 'POST') {
    void (async () => {
      let body: { address?: string; port?: number } = {};
      try { body = JSON.parse(await readBody(req)) as typeof body; } catch { json(res, { error: 'invalid JSON' }, 400); return; }
      const { address, port } = body;
      if (!address || !port) { json(res, { error: 'address and port required' }, 400); return; }
      try {
        const result = await syncFromPeer(address, port);
        json(res, result);
      } catch (err: unknown) {
        json(res, { error: (err as { message?: string }).message ?? 'Sync failed' }, 500);
      }
    })();
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Streaming chat (SSE)
// ---------------------------------------------------------------------------

async function handleChatStream(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let body: { message?: string } = {};
  try { body = JSON.parse(await readBody(req)) as typeof body; } catch { res.writeHead(400); res.end(); return; }

  const userMessage = (body.message ?? '').trim();
  if (!userMessage) { res.writeHead(400); res.end(); return; }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.flushHeaders();

  const sse = (data: object) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };

  try {
    const config = loadConfig();
    saveMessage('user', userMessage);

    if (config.provider === 'subprocess') {
      // Pipe through subprocess CLI — stream stdout as SSE tokens
      const cmd = config.subprocess_cmd;
      if (!cmd) {
        sse({ type: 'error', message: 'subprocess_cmd not set in jarvis.yaml' });
        res.end();
        return;
      }

      const spIdentity = loadIdentity();
      const spFacts = getAllFacts();
      const spJarvisMd = loadJarvisMd();
      const spNow = new Date().toLocaleString();
      let spFactsSection = '';
      if (spFacts.length > 0) {
        spFactsSection = '\n## Known Facts\n' + spFacts.map((f) => `- ${f.key}: ${f.value}`).join('\n') + '\n';
      }
      const spSystemPrompt = `You are JARVIS, a local-first AI assistant.\n\n## Identity\n- ID: ${spIdentity.id}\n- Version: ${spIdentity.version}\n- Current time: ${spNow}\n\n## Memory\n${spJarvisMd}\n${spFactsSection}\n## Instructions\n- Be concise and direct\n- Use the remember tool proactively when the user shares something worth keeping\n- You have persistent memory across sessions — use it wisely`;
      const fullPrompt = `${spSystemPrompt}\n\nUser: ${userMessage}`;

      let fullResponse = '';
      await new Promise<void>((resolve, reject) => {
        const escapedPrompt = fullPrompt.replace(/'/g, `'\\''`);
        const child = spawn('bash', ['-c', `${cmd} '${escapedPrompt}'`], { stdio: ['ignore', 'pipe', 'pipe'] });

        child.stdout.on('data', (chunk: Buffer) => {
          const token = chunk.toString();
          fullResponse += token;
          sse({ type: 'token', token });
        });
        child.stderr.on('data', (chunk: Buffer) => {
          process.stderr.write(chunk);
        });
        child.on('close', (code: number | null) => {
          if (code !== 0 && !fullResponse) reject(new Error(`subprocess exited with code ${code}`));
          else resolve();
        });
        child.on('error', reject);
      });

      if (fullResponse) saveMessage('assistant', fullResponse.trim());
      sse({ type: 'done', stats: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
    } else {
      // Ollama / OpenAI-compatible
      const client = new OpenAI({ apiKey: config.api_key ?? 'no-key', ...(config.base_url ? { baseURL: config.base_url } : {}) });

      const identity = loadIdentity();
      const facts = getAllFacts();
      const jarvisMd = loadJarvisMd();
      const now = new Date().toLocaleString();
      let factsSection = '';
      if (facts.length > 0) {
        factsSection = '\n## Known Facts\n' + facts.map((f) => `- ${f.key}: ${f.value}`).join('\n') + '\n';
      }
      const systemPrompt = `You are JARVIS, a local-first AI assistant.\n\n## Identity\n- ID: ${identity.id}\n- Version: ${identity.version}\n- Current time: ${now}\n\n## Memory\n${jarvisMd}\n${factsSection}\n## Instructions\n- Be concise and direct\n- Use the remember tool proactively when the user shares something worth keeping\n- You have persistent memory across sessions — use it wisely`;

      const history = getRecentMessages(20);
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user', content: userMessage },
      ];

      let fullResponse = '';
      let promptTokens = 0;
      let completionTokens = 0;

      const stream = await client.chat.completions.create({
        model: config.model,
        max_tokens: config.max_tokens,
        messages,
        stream: true,
        stream_options: { include_usage: true },
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) { fullResponse += delta; sse({ type: 'token', token: delta }); }
        if (chunk.usage) { promptTokens = chunk.usage.prompt_tokens ?? 0; completionTokens = chunk.usage.completion_tokens ?? 0; }
      }

      if (fullResponse) saveMessage('assistant', fullResponse);
      sse({ type: 'done', stats: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens } });
    }
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number };
    sse({ type: 'error', message: e.message ?? 'Unknown error', status: e.status });
  } finally {
    res.end();
  }
}

// ---------------------------------------------------------------------------
// Peer query stream proxy (SSE)
// ---------------------------------------------------------------------------

async function handlePeerQueryStream(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let body: { address?: string; port?: number; query?: string } = {};
  try { body = JSON.parse(await readBody(req)) as typeof body; } catch { res.writeHead(400); res.end(); return; }

  const { address, port, query } = body;
  if (!address || !port || !query?.trim()) { res.writeHead(400); res.end(); return; }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.flushHeaders();

  const sse = (data: object) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`); };

  // Override stdout write temporarily to capture tokens from askPeer
  const origWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    const token = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    if (token) sse({ type: 'token', token });
    return origWrite(chunk, ...rest as [BufferEncoding, () => void]);
  }) as typeof process.stdout.write;

  try {
    await askPeer({ name: `${address}:${port}`, host: address, address, port }, query.trim());
    sse({ type: 'done' });
  } catch (err: unknown) {
    sse({ type: 'error', message: (err as { message?: string }).message ?? 'Unknown error' });
  } finally {
    process.stdout.write = origWrite;
    res.end();
  }
}

// ---------------------------------------------------------------------------
// Dashboard HTML — Iron Man HUD
// ---------------------------------------------------------------------------

const HTML = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>JARVIS</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;600;700&family=Share+Tech+Mono&family=Outfit:wght@300;400;600&display=swap" rel="stylesheet"/>
<style>
/* ── Reset & tokens ── */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

:root{
  /* HUD palette */
  --bg0:#050a0e;--bg1:#091520;--bg2:#0d1f2d;--bg3:#1a2d3d;
  --cyan:#00e5ff;--cyan-dim:#00bfff;--cyan-ghost:rgba(0,229,255,.07);
  --cyan-glow:rgba(0,229,255,.35);--cyan-border:rgba(0,229,255,.3);
  --text:#c8f0ff;--text2:rgba(150,210,240,.65);--text3:rgba(0,229,255,.45);
  --gold:#fbca03;--gold-dim:rgba(251,202,3,.15);
  --danger:#ef4444;--success:#22c55e;
  --border:rgba(0,191,255,.18);--border-bright:rgba(0,229,255,.45);
  --radius:3px;
  --font-hud:'Orbitron',sans-serif;
  --font-mono:'Share Tech Mono','JetBrains Mono',monospace;
  --font-body:'Outfit',system-ui,sans-serif;
}

html,body{height:100%;overflow:hidden}
body{
  background:var(--bg0);color:var(--text);
  font-family:var(--font-body);font-size:14px;
  display:flex;flex-direction:column;
}

/* ── Scanline texture overlay ── */
body::before{
  content:'';position:fixed;inset:0;pointer-events:none;z-index:9998;
  background:linear-gradient(rgba(18,16,16,0) 50%,rgba(0,0,0,.15) 50%);
  background-size:100% 3px;
}

/* ── Scan sweep (moves top → bottom continuously) ── */
body::after{
  content:'';position:fixed;left:0;right:0;height:150px;pointer-events:none;z-index:9997;
  background:linear-gradient(to bottom,transparent 0%,rgba(0,229,255,.025) 40%,rgba(0,229,255,.08) 50%,rgba(0,229,255,.025) 60%,transparent 100%);
  animation:scan-sweep 10s linear infinite;top:-150px;
}
@keyframes scan-sweep{0%{top:-150px}100%{top:100%}}

/* ── Scrollbar ── */
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:var(--bg0)}
::-webkit-scrollbar-thumb{background:rgba(0,229,255,.2);border-radius:2px}
::-webkit-scrollbar-thumb:hover{background:rgba(0,229,255,.4)}

/* ── Header ── */
#header{
  display:flex;align-items:center;gap:16px;
  padding:0 24px;height:52px;border-bottom:1px solid var(--border);
  background:linear-gradient(to right,rgba(0,229,255,.04),transparent);
  flex-shrink:0;position:relative;
}
#header::after{
  content:'';position:absolute;bottom:0;left:0;right:0;height:1px;
  background:linear-gradient(90deg,var(--cyan),rgba(0,229,255,.1),transparent);
}
.hud-logo{display:flex;align-items:center;gap:14px;text-decoration:none}
.hud-logo-text{
  font-family:var(--font-hud);font-size:15px;font-weight:700;
  letter-spacing:6px;color:var(--cyan);
  text-shadow:0 0 12px var(--cyan-glow),0 0 24px rgba(0,229,255,.2);
}
#header-meta{font-family:var(--font-mono);font-size:11px;color:var(--text3);flex:1}
#header-status{display:flex;align-items:center;gap:8px;font-family:var(--font-mono);font-size:11px;color:var(--text2)}
.status-dot{width:6px;height:6px;border-radius:50%;background:var(--success);box-shadow:0 0 6px var(--success)}
.status-dot.offline{background:var(--text3);box-shadow:none}

/* ── Layout ── */
#app{display:flex;flex:1;overflow:hidden}
#sidebar{width:190px;flex-shrink:0;background:rgba(5,10,14,.9);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow-y:auto}
#main{flex:1;display:flex;flex-direction:column;overflow:hidden}

/* ── Sidebar nav ── */
.nav-section{
  padding:14px 14px 6px;font-family:var(--font-hud);
  font-size:8px;font-weight:600;letter-spacing:2.5px;color:var(--text3);
}
.nav-btn{
  display:flex;align-items:center;gap:10px;width:100%;
  padding:9px 16px;background:none;border:none;
  color:var(--text2);font-family:var(--font-body);font-size:13px;
  cursor:pointer;text-align:left;border-left:2px solid transparent;
  transition:all .15s;
}
.nav-btn:hover{background:var(--cyan-ghost);color:var(--text)}
.nav-btn.active{background:rgba(0,229,255,.06);color:var(--cyan);border-left-color:var(--cyan)}
.nav-icon{font-size:14px;width:16px;text-align:center}
.nav-badge{margin-left:auto;background:rgba(0,229,255,.1);color:var(--text3);font-family:var(--font-mono);font-size:10px;padding:1px 6px;border-radius:2px;border:1px solid rgba(0,229,255,.15)}

/* ── Sidebar mini-stats ── */
#sidebar-stats{margin-top:auto;padding:14px;border-top:1px solid var(--border)}
.sstat{display:flex;justify-content:space-between;padding:3px 0;font-size:11px;color:var(--text3)}
.sstat span:last-child{font-family:var(--font-mono);color:var(--cyan)}

/* ── Panels ── */
.panel{display:none;flex:1;overflow:hidden;flex-direction:column}
.panel.active{display:flex}
.panel-header{padding:18px 24px 0;display:flex;align-items:center;gap:12px;flex-shrink:0}
.panel-title{font-family:var(--font-hud);font-size:13px;font-weight:600;letter-spacing:3px;color:var(--cyan);text-shadow:0 0 8px var(--cyan-glow)}
.panel-sub{color:var(--text3);font-family:var(--font-mono);font-size:11px;margin-left:auto}
.panel-body{flex:1;overflow-y:auto;padding:18px 24px}

/* ═══════════════════════════════════════════════
   HOME / CHAT PANEL — IRON MAN HUD
   ═══════════════════════════════════════════════ */
#panel-home{flex-direction:column;position:relative;overflow:hidden}

/* Hex grid background */
#panel-home::before{
  content:'';position:absolute;inset:0;pointer-events:none;opacity:.04;
  background-image:
    linear-gradient(60deg,rgba(0,229,255,.8) 1px,transparent 1px),
    linear-gradient(120deg,rgba(0,229,255,.8) 1px,transparent 1px),
    linear-gradient(0deg,rgba(0,229,255,.8) 1px,transparent 1px);
  background-size:40px 70px,40px 70px,40px 70px;
  background-position:0 0,0 0,20px 35px;
}

/* ── Arc reactor orb ── */
.arc-wrap{
  display:flex;justify-content:center;padding:28px 0 8px;
  flex-shrink:0;position:relative;
}
.arc-reactor{
  position:relative;width:96px;height:96px;
}
.arc-reactor > *{
  position:absolute;border-radius:50%;top:50%;left:50%;
  transform:translate(-50%,-50%);
}
.arc-outer{
  width:96px;height:96px;
  border:1px solid rgba(0,229,255,.3);
  box-shadow:0 0 16px rgba(0,229,255,.15),inset 0 0 16px rgba(0,229,255,.04);
  transition:box-shadow .4s;
}
.arc-ring{
  width:72px;height:72px;
  border:1px solid rgba(0,229,255,.2);
  background:radial-gradient(circle,#062030 0%,#020d16 100%);
}
.arc-coil-ring{
  width:96px;height:96px;border-radius:0!important;
  animation:spin-coils 4s linear infinite;
  transition:animation-duration .4s;
}
.arc-coil{
  position:absolute;width:8px;height:14px;
  background:#073c4b;border-radius:2px;
  box-shadow:0 0 4px #52fefe inset;
  top:calc(50% - 38px);left:calc(50% - 4px);
  transform-origin:4px 38px;
}
.arc-core-outer{
  width:46px;height:46px;
  border:1px solid rgba(82,254,254,.4);
  background:radial-gradient(circle,rgba(0,229,255,.12) 0%,transparent 70%);
  box-shadow:0 0 10px rgba(0,229,255,.25);
  transition:box-shadow .3s;
}
.arc-core{
  width:22px;height:22px;
  background:#fff;
  border:2px solid #1b4e5f;
  box-shadow:0 0 6px 4px #52fefe,0 0 10px 8px #52fefe inset;
  transition:box-shadow .3s;
}
/* Pulse ring that emits outward when speaking */
.arc-pulse{
  width:22px;height:22px;
  border:1px solid var(--cyan);opacity:0;
  transition:none;
}
@keyframes spin-coils{from{transform:translate(-50%,-50%) rotate(0deg)}to{transform:translate(-50%,-50%) rotate(360deg)}}

/* ── Orb states ── */
/* idle — default slow spin, done above */

/* thinking */
.arc-reactor.thinking .arc-coil-ring{animation-duration:1.2s}
.arc-reactor.thinking .arc-core{
  box-shadow:0 0 10px 6px #52fefe,0 0 16px 12px #52fefe inset,0 0 30px rgba(82,254,254,.4);
}
.arc-reactor.thinking .arc-outer{box-shadow:0 0 30px rgba(0,229,255,.35),inset 0 0 20px rgba(0,229,255,.08)}
.arc-reactor.thinking .arc-core-outer{box-shadow:0 0 20px rgba(0,229,255,.5)}

/* speaking */
.arc-reactor.speaking .arc-coil-ring{animation-duration:.6s}
.arc-reactor.speaking .arc-core{
  box-shadow:0 0 14px 8px #52fefe,0 0 20px 14px #52fefe inset,0 0 50px rgba(82,254,254,.6);
}
.arc-reactor.speaking .arc-outer{
  box-shadow:0 0 50px rgba(0,229,255,.5),0 0 80px rgba(0,229,255,.15),inset 0 0 20px rgba(0,229,255,.1);
}
.arc-reactor.speaking .arc-pulse{animation:arc-emit 1.0s ease-out infinite}

@keyframes arc-emit{
  0%{width:22px;height:22px;opacity:.8;box-shadow:0 0 4px var(--cyan)}
  100%{width:90px;height:90px;opacity:0;box-shadow:0 0 12px var(--cyan)}
}

/* ── Status label below orb ── */
#orb-status{
  text-align:center;font-family:var(--font-hud);font-size:9px;
  letter-spacing:3px;color:var(--text3);padding-bottom:4px;
  flex-shrink:0;transition:color .3s;
}
#orb-status.thinking{color:var(--gold);text-shadow:0 0 8px var(--gold)}
#orb-status.speaking{color:var(--cyan);text-shadow:0 0 8px var(--cyan-glow)}

/* ── HUD data strip (live stats above messages) ── */
#hud-strip{
  display:flex;gap:1px;padding:0 24px 12px;flex-shrink:0;
}
.hud-cell{
  flex:1;padding:8px 10px;background:var(--cyan-ghost);
  border:1px solid var(--border);position:relative;overflow:hidden;
}
.hud-cell::before{
  content:'';position:absolute;top:0;left:0;right:0;height:1px;
  background:linear-gradient(90deg,var(--cyan),transparent);
}
/* corner ticks */
.hud-cell::after{
  content:'';position:absolute;bottom:0;right:0;width:6px;height:6px;
  border-right:1px solid var(--cyan-border);border-bottom:1px solid var(--cyan-border);
}
.hud-cell-label{font-family:var(--font-hud);font-size:7px;letter-spacing:2px;color:var(--text3);margin-bottom:4px}
.hud-cell-val{font-family:var(--font-mono);font-size:16px;color:var(--cyan);text-shadow:0 0 8px var(--cyan-glow);line-height:1}
.hud-cell-sub{font-family:var(--font-mono);font-size:9px;color:var(--text3);margin-top:2px}

/* ── Chat messages ── */
#chat-messages{
  flex:1;overflow-y:auto;padding:0 24px 12px;
  display:flex;flex-direction:column;gap:12px;
}
.msg{
  display:flex;gap:12px;
  animation:hud-build-in .35s cubic-bezier(.2,0,0,1) both;
  position:relative;
}
@keyframes hud-build-in{
  0%{clip-path:inset(0 100% 0 0);opacity:1}
  100%{clip-path:inset(0 0% 0 0);opacity:1}
}
.msg-avatar{
  width:28px;height:28px;flex-shrink:0;
  border:1px solid var(--border);display:flex;align-items:center;justify-content:center;
  font-size:12px;background:var(--bg1);
}
.msg.assistant .msg-avatar{border-color:rgba(0,229,255,.4);box-shadow:0 0 8px rgba(0,229,255,.15)}
.msg-content{flex:1;min-width:0}
.msg-header{display:flex;align-items:baseline;gap:8px;margin-bottom:3px}
.msg-role{font-family:var(--font-hud);font-size:9px;letter-spacing:2px;font-weight:600}
.msg.user .msg-role{color:var(--gold)}
.msg.assistant .msg-role{color:var(--cyan)}
.msg-time{font-family:var(--font-mono);font-size:9px;color:var(--text3)}
.msg-text{
  font-size:13px;line-height:1.65;color:var(--text);
  word-break:break-word;white-space:pre-wrap;
}
.msg.assistant .msg-text{color:rgba(200,240,255,.88)}
.msg-stats-row{display:flex;gap:12px;margin-top:5px}
.msg-stat{font-family:var(--font-mono);font-size:9px;color:var(--text3)}
.msg-stat span{color:var(--cyan)}
/* scan edge that trails the build-in */
.msg::after{
  content:'';position:absolute;top:0;bottom:0;left:0;width:1px;
  background:linear-gradient(to bottom,transparent,var(--cyan),transparent);
  animation:scan-edge .35s cubic-bezier(.2,0,0,1) both;
  pointer-events:none;
}
@keyframes scan-edge{0%{left:0;opacity:1}100%{left:100%;opacity:0}}
.cursor{
  display:inline-block;width:2px;height:13px;background:var(--cyan);
  margin-left:2px;animation:blink .7s step-end infinite;vertical-align:text-bottom;
}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}

/* ── Chat input ── */
#chat-input-area{
  padding:12px 24px 16px;border-top:1px solid var(--border);
  background:rgba(9,21,32,.95);flex-shrink:0;position:relative;
}
#chat-input-area::before{
  content:'';position:absolute;top:0;left:24px;right:24px;height:1px;
  background:linear-gradient(90deg,var(--cyan),rgba(0,229,255,.1),transparent);
}
#chat-form{display:flex;gap:10px;align-items:flex-end}
#chat-input{
  flex:1;background:rgba(0,229,255,.04);border:1px solid var(--border);
  color:var(--text);font-family:var(--font-body);font-size:13px;
  padding:9px 12px;resize:none;max-height:120px;min-height:38px;
  line-height:1.5;outline:none;transition:border-color .2s;
  border-radius:var(--radius);
}
#chat-input:focus{border-color:rgba(0,229,255,.5);box-shadow:0 0 12px rgba(0,229,255,.08)}
#chat-send{
  background:rgba(0,229,255,.12);border:1px solid var(--cyan-border);
  color:var(--cyan);font-family:var(--font-hud);font-size:9px;font-weight:600;
  letter-spacing:2px;padding:0 16px;height:38px;cursor:pointer;
  border-radius:var(--radius);transition:all .15s;flex-shrink:0;white-space:nowrap;
}
#chat-send:hover{background:rgba(0,229,255,.2);box-shadow:0 0 14px rgba(0,229,255,.25)}
#chat-send:disabled{opacity:.35;cursor:not-allowed;box-shadow:none}
#chat-hint{font-family:var(--font-mono);font-size:10px;color:var(--text3);margin-top:5px}

/* ═══════════════════════════════════════
   OTHER PANELS (Memory, History, System)
   ═══════════════════════════════════════ */

/* Shared HUD panel card */
.hud-card{
  background:var(--bg1);border:1px solid var(--border);
  border-radius:var(--radius);position:relative;overflow:hidden;
  transition:border-color .15s,box-shadow .15s;
}
.hud-card::before{
  content:'';position:absolute;top:0;left:0;right:0;height:1px;
  background:linear-gradient(90deg,var(--cyan),transparent);
}
.hud-card::after{
  content:'';position:absolute;bottom:0;right:0;
  width:8px;height:8px;
  border-right:1px solid var(--border-bright);border-bottom:1px solid var(--border-bright);
}
.hud-card:hover{border-color:rgba(0,229,255,.3);box-shadow:0 0 16px rgba(0,229,255,.08)}

/* Stat grid */
.stat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:20px}
.stat-card{padding:14px 16px}
.stat-card .val{font-family:var(--font-mono);font-size:26px;color:var(--cyan);text-shadow:0 0 8px var(--cyan-glow);line-height:1.1}
.stat-card .lbl{font-family:var(--font-hud);font-size:8px;letter-spacing:2px;color:var(--text3);margin-top:4px;text-transform:uppercase}

/* Info grid */
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.info-card{padding:14px 16px}
.info-card h3{font-family:var(--font-hud);font-size:8px;letter-spacing:2px;color:var(--text3);text-transform:uppercase;margin-bottom:10px}
.info-row{display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid rgba(0,191,255,.08);font-size:12px}
.info-row:last-child{border:none}
.info-row .k{color:var(--text3);font-family:var(--font-mono);font-size:10px}
.info-row .v{font-family:var(--font-mono);font-size:11px;color:var(--cyan);text-align:right;max-width:55%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* Memory */
.memory-toolbar{display:flex;gap:10px;margin-bottom:14px;flex-shrink:0}
.search-box{
  flex:1;background:rgba(0,229,255,.04);border:1px solid var(--border);
  color:var(--text);font-family:var(--font-body);font-size:13px;
  padding:7px 10px;border-radius:var(--radius);outline:none;transition:border-color .15s;
}
.search-box:focus{border-color:rgba(0,229,255,.4)}
.fact-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px}
.fact-card{padding:12px 14px 10px 16px}
.fact-key{font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--cyan);margin-bottom:3px}
.fact-value{font-size:12px;color:var(--text);line-height:1.5;word-break:break-word}
.fact-footer{display:flex;justify-content:space-between;align-items:center;margin-top:6px}
.fact-ts{font-family:var(--font-mono);font-size:9px;color:var(--text3)}
.btn-del{background:none;border:1px solid transparent;color:var(--text3);font-size:10px;padding:2px 7px;cursor:pointer;transition:all .15s;border-radius:2px}
.btn-del:hover{border-color:var(--danger);color:var(--danger)}
.empty-state{padding:48px 0;text-align:center;color:var(--text3);font-family:var(--font-mono);font-size:12px}
.empty-state .icon{font-size:28px;margin-bottom:8px}

/* History */
.history-filters{display:flex;gap:10px;margin-bottom:14px;flex-shrink:0}
.filter-select{
  background:rgba(0,229,255,.04);border:1px solid var(--border);color:var(--text);
  font-family:var(--font-body);font-size:13px;padding:7px 10px;border-radius:var(--radius);
  outline:none;cursor:pointer;
}
.session-group{margin-bottom:18px}
.session-header{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);margin-bottom:6px}
.session-id{font-family:var(--font-mono);font-size:10px;color:var(--cyan)}
.session-count{font-family:var(--font-mono);font-size:10px;color:var(--text3)}
.hist-msg{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid rgba(0,191,255,.06);align-items:flex-start}
.hist-role{font-family:var(--font-mono);font-size:9px;font-weight:600;width:60px;flex-shrink:0;padding-top:1px;letter-spacing:1px}
.hist-role.user{color:var(--gold)}
.hist-role.assistant{color:var(--cyan)}
.hist-text{font-size:12px;color:var(--text2);line-height:1.5;flex:1;word-break:break-word}
.hist-ts{font-family:var(--font-mono);font-size:9px;color:var(--text3);white-space:nowrap;flex-shrink:0;padding-top:1px}

/* Toast */
#toast{position:fixed;bottom:20px;right:20px;padding:9px 14px;border-radius:var(--radius);font-family:var(--font-mono);font-size:11px;opacity:0;pointer-events:none;transition:opacity .25s;z-index:9999}
#toast.show{opacity:1}
#toast.ok{background:rgba(34,197,94,.12);border:1px solid var(--success);color:var(--success)}
#toast.err{background:rgba(239,68,68,.12);border:1px solid var(--danger);color:var(--danger)}
</style>
</head>
<body>

<!-- Header -->
<div id="header">
  <a class="hud-logo" href="#">
    <!-- inline SVG arc reactor (small) -->
    <svg width="28" height="28" viewBox="0 0 28 28" style="flex-shrink:0">
      <circle cx="14" cy="14" r="13" fill="none" stroke="rgba(0,229,255,.35)" stroke-width="1"/>
      <circle cx="14" cy="14" r="9" fill="#062030" stroke="rgba(0,229,255,.25)" stroke-width="1"/>
      <circle cx="14" cy="14" r="5" fill="none" stroke="rgba(82,254,254,.5)" stroke-width="1"/>
      <circle cx="14" cy="14" r="2.5" fill="white" style="filter:drop-shadow(0 0 3px #52fefe)"/>
    </svg>
    <span class="hud-logo-text">JARV1S</span>
  </a>
  <div id="header-meta">LOADING SYSTEMS…</div>
  <div id="header-status">
    <div class="status-dot offline" id="status-dot"></div>
    <span id="status-text">OFFLINE</span>
  </div>
</div>

<!-- App -->
<div id="app">
  <!-- Sidebar -->
  <nav id="sidebar">
    <div class="nav-section">Interface</div>
    <button class="nav-btn active" onclick="switchPanel('home',this)">
      <span class="nav-icon">⬡</span> Home
    </button>

    <div class="nav-section">Data</div>
    <button class="nav-btn" onclick="switchPanel('memory',this)">
      <span class="nav-icon">◈</span> Memory
      <span class="nav-badge" id="badge-facts">0</span>
    </button>
    <button class="nav-btn" onclick="switchPanel('history',this)">
      <span class="nav-icon">◎</span> History
      <span class="nav-badge" id="badge-msgs">0</span>
    </button>

    <div class="nav-section">Network</div>
    <button class="nav-btn" onclick="switchPanel('peers',this)">
      <span class="nav-icon">⬡</span> Peers
      <span class="nav-badge" id="badge-peers">0</span>
    </button>

    <div class="nav-section">System</div>
    <button class="nav-btn" onclick="switchPanel('portability',this)">
      <span class="nav-icon">⇄</span> Portability
    </button>
    <button class="nav-btn" onclick="switchPanel('system',this)">
      <span class="nav-icon">◇</span> System
    </button>

    <div id="sidebar-stats">
      <div class="sstat"><span>SESSIONS</span><span id="ss-sessions">–</span></div>
      <div class="sstat"><span>MESSAGES</span><span id="ss-messages">–</span></div>
      <div class="sstat"><span>DB SIZE</span><span id="ss-db">–</span></div>
    </div>
  </nav>

  <!-- Main -->
  <div id="main">

    <!-- ══ HOME ══ -->
    <div class="panel active" id="panel-home">

      <!-- Arc reactor orb -->
      <div class="arc-wrap">
        <div class="arc-reactor" id="orb">
          <div class="arc-outer"></div>
          <div class="arc-ring"></div>
          <div class="arc-core-outer"></div>
          <div class="arc-pulse"></div>
          <div class="arc-coil-ring" id="coil-ring"></div>
          <div class="arc-core"></div>
        </div>
      </div>
      <div id="orb-status">STANDBY</div>

      <!-- HUD data strip -->
      <div id="hud-strip">
        <div class="hud-cell">
          <div class="hud-cell-label">PROVIDER</div>
          <div class="hud-cell-val" id="hcell-provider" style="font-size:12px;padding-top:3px">–</div>
        </div>
        <div class="hud-cell">
          <div class="hud-cell-label">MODEL</div>
          <div class="hud-cell-val" id="hcell-model" style="font-size:11px;padding-top:4px">–</div>
        </div>
        <div class="hud-cell">
          <div class="hud-cell-label">FACTS</div>
          <div class="hud-cell-val" id="hcell-facts">0</div>
        </div>
        <div class="hud-cell">
          <div class="hud-cell-label">MESSAGES</div>
          <div class="hud-cell-val" id="hcell-messages">0</div>
        </div>
        <div class="hud-cell">
          <div class="hud-cell-label">SESSIONS</div>
          <div class="hud-cell-val" id="hcell-sessions">0</div>
        </div>
        <div class="hud-cell">
          <div class="hud-cell-label">LAST TOKENS</div>
          <div class="hud-cell-val" id="hcell-tokens">–</div>
          <div class="hud-cell-sub" id="hcell-tokens-sub"></div>
        </div>
      </div>

      <!-- Messages -->
      <div id="chat-messages"></div>

      <!-- Input -->
      <div id="chat-input-area">
        <form id="chat-form" onsubmit="return false">
          <textarea id="chat-input" placeholder="INITIATE QUERY…" rows="1"
            onkeydown="chatKeydown(event)" oninput="autoResize(this)"></textarea>
          <button id="chat-send" type="button" onclick="sendChat()">TRANSMIT</button>
        </form>
        <div id="chat-hint">ENTER — SEND &nbsp;·&nbsp; SHIFT+ENTER — NEWLINE</div>
      </div>
    </div>

    <!-- ══ MEMORY ══ -->
    <div class="panel" id="panel-memory">
      <div class="panel-header">
        <div class="panel-title">MEMORY BANKS</div>
        <div class="panel-sub" id="facts-count">0 RECORDS</div>
      </div>
      <div class="panel-body">
        <div class="memory-toolbar">
          <input class="search-box" id="facts-search" placeholder="Search memory…" oninput="renderFacts()"/>
        </div>
        <div class="fact-grid" id="facts-grid"></div>
        <div class="empty-state" id="facts-empty" style="display:none"><div class="icon">◈</div>No records found</div>
      </div>
    </div>

    <!-- ══ HISTORY ══ -->
    <div class="panel" id="panel-history">
      <div class="panel-header">
        <div class="panel-title">INTERACTION LOG</div>
        <div class="panel-sub" id="history-count">0 ENTRIES</div>
      </div>
      <div class="panel-body">
        <div class="history-filters">
          <input class="search-box" id="hist-search" placeholder="Search log…" style="flex:1" oninput="renderHistory()"/>
          <select class="filter-select" id="hist-session" onchange="renderHistory()">
            <option value="">ALL SESSIONS</option>
          </select>
        </div>
        <div id="history-body"></div>
        <div class="empty-state" id="history-empty" style="display:none"><div class="icon">◎</div>No entries</div>
      </div>
    </div>

    <!-- ══ PORTABILITY ══ -->
    <div class="panel" id="panel-portability">
      <div class="panel-header"><div class="panel-title">PORTABILITY</div><div class="panel-sub">IDENTITY TRANSFER & SYNC</div></div>
      <div class="panel-body">

        <!-- Export -->
        <div class="hud-card info-card" style="margin-bottom:14px">
          <h3>Export Bundle</h3>
          <p style="font-size:12px;color:var(--text2);margin:8px 0 12px">Download your full identity, memory, facts, and conversation history as a portable <code style="color:var(--cyan)">.jarvis.bundle</code> file. Transfer it to any device and run <code style="color:var(--cyan)">jarvis import</code>.</p>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="nav-btn" style="border:1px solid var(--cyan-border);color:var(--cyan);padding:0 18px;height:36px" onclick="downloadExport(false)">⬇ EXPORT FULL</button>
            <button class="nav-btn" style="border:1px solid var(--border);color:var(--text2);padding:0 18px;height:36px" onclick="downloadExport(true)">⬇ EXPORT (NO HISTORY)</button>
          </div>
          <div id="export-status" style="margin-top:8px;font-family:var(--font-mono);font-size:11px;color:var(--text3)"></div>
        </div>

        <!-- Live Peer Sync -->
        <div class="hud-card info-card" style="margin-bottom:14px">
          <h3>Live Peer Sync</h3>
          <p style="font-size:12px;color:var(--text2);margin:8px 0 12px">Pull facts, memory, and history from a running peer on the local network. Existing local data is never overwritten.</p>
          <div style="display:flex;gap:8px;align-items:center">
            <select class="filter-select" id="sync-peer-select" style="flex:1">
              <option value="">— select discovered peer —</option>
            </select>
            <span style="color:var(--text3);font-family:var(--font-mono);font-size:11px">or</span>
            <input class="search-box" id="sync-manual" placeholder="host:port" style="width:140px"/>
            <button class="nav-btn" style="border:1px solid var(--cyan-border);color:var(--cyan);padding:0 16px;height:36px;white-space:nowrap" onclick="runSync()">⇄ SYNC NOW</button>
          </div>
          <div id="sync-status" style="margin-top:10px;font-family:var(--font-mono);font-size:11px;color:var(--text3)"></div>
        </div>

        <!-- CLI reference -->
        <div class="hud-card info-card">
          <h3>CLI Reference</h3>
          <div class="info-row"><span class="k">export</span><span class="v" style="color:var(--text2)">jarvis export --out my.jarvis.bundle</span></div>
          <div class="info-row"><span class="k">import (merge)</span><span class="v" style="color:var(--text2)">jarvis import my.jarvis.bundle</span></div>
          <div class="info-row"><span class="k">import (same agent)</span><span class="v" style="color:var(--text2)">jarvis import my.jarvis.bundle --adopt-identity</span></div>
          <div class="info-row"><span class="k">sync from peer</span><span class="v" style="color:var(--text2)">jarvis sync 192.168.1.10:7474</span></div>
        </div>
      </div>
    </div>

    <!-- ══ SYSTEM ══ -->
    <div class="panel" id="panel-system">
      <div class="panel-header"><div class="panel-title">SYSTEM STATUS</div></div>
      <div class="panel-body">
        <div class="stat-grid" id="sys-stats"></div>
        <div class="info-grid" id="sys-info"></div>
      </div>
    </div>

    <!-- ══ PEERS ══ -->
    <div class="panel" id="panel-peers">
      <div class="panel-header">
        <div class="panel-title">NETWORK PEERS</div>
        <div class="panel-sub" id="peers-count">SCANNING…</div>
        <button class="btn-del" style="margin-left:8px;border-color:var(--cyan-border);color:var(--cyan)" onclick="refreshPeers()">↺ RESCAN</button>
      </div>
      <div class="panel-body">
        <!-- Relay chat to a peer -->
        <div class="hud-card info-card" style="margin-bottom:16px">
          <h3>Relay Query to Peer</h3>
          <div style="display:flex;gap:8px;margin-top:8px">
            <select class="filter-select" id="peer-select" style="flex:1">
              <option value="">— select peer —</option>
            </select>
            <button class="nav-btn" style="border:1px solid var(--cyan-border);color:var(--cyan);padding:0 14px;height:36px" onclick="sendPeerChat()">TRANSMIT</button>
          </div>
          <textarea id="peer-input" class="search-box" placeholder="Query to relay…" rows="2" style="margin-top:8px;width:100%;resize:none"></textarea>
          <div id="peer-response" style="margin-top:10px;font-family:var(--font-mono);font-size:12px;color:var(--text);white-space:pre-wrap;min-height:24px"></div>
        </div>

        <!-- Peer grid -->
        <div class="fact-grid" id="peers-grid"></div>
        <div class="empty-state" id="peers-empty" style="display:none">
          <div class="icon">⬡</div>
          No peers found on local network.<br>
          <span style="font-size:10px;margin-top:6px;display:block">Run <span style="color:var(--cyan)">jarvis peer</span> on another device on the same LAN.</span>
        </div>
      </div>
    </div>

  </div>
</div>

<div id="toast"></div>

<!-- Build coils dynamically -->
<script>
(function(){
  const ring = document.getElementById('coil-ring');
  for(let i=0;i<8;i++){
    const c=document.createElement('div');
    c.className='arc-coil';
    c.style.transform='rotate('+i*45+'deg)';
    ring.appendChild(c);
  }
})();
</script>

<script>
// ── State ──────────────────────────────────────
let allFacts=[], allMessages=[], allSessions=[], status=null, streaming=false;
let allPeers=[], peerStreaming=false;
let totalMsgs=0, totalTokensSession=0;

// ── Utilities ──────────────────────────────────
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function fmt(ts){if(!ts)return'';const d=new Date(ts);return d.toLocaleDateString(undefined,{month:'short',day:'numeric'})+' '+d.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'})}
function rel(ts){if(!ts)return'';const d=Date.now()-new Date(ts).getTime(),m=Math.floor(d/60000),h=Math.floor(m/60),dy=Math.floor(h/24);return dy>0?dy+'d ago':h>0?h+'h ago':m>0?m+'m ago':'just now'}
function toast(msg,type='ok'){const el=document.getElementById('toast');el.textContent=msg;el.className='show '+type;setTimeout(()=>el.className='',2500)}

// ── Orb ────────────────────────────────────────
const orb=document.getElementById('orb');
const orbStatus=document.getElementById('orb-status');
function setOrb(state){
  orb.className='arc-reactor'+( state!=='idle' ? ' '+state : '');
  orbStatus.className=state==='idle'?'':state;
  orbStatus.textContent={idle:'STANDBY',thinking:'PROCESSING…',speaking:'RESPONDING…'}[state]||'STANDBY';
}

// ── HUD strip ──────────────────────────────────
function updateStrip(){
  if(!status)return;
  document.getElementById('hcell-provider').textContent=status.config.provider.toUpperCase();
  document.getElementById('hcell-model').textContent=status.config.model.replace('claude-','').replace('gpt-','').replace('-20250514','').toUpperCase().slice(0,16);
  document.getElementById('hcell-facts').textContent=status.stats.facts;
  document.getElementById('hcell-messages').textContent=status.stats.messages+totalMsgs;
  document.getElementById('hcell-sessions').textContent=status.stats.sessions;
}
function updateTokens(stats){
  if(!stats)return;
  document.getElementById('hcell-tokens').textContent=stats.totalTokens||'–';
  document.getElementById('hcell-tokens-sub').textContent=stats.promptTokens+'↑ '+stats.completionTokens+'↓';
  totalTokensSession+=stats.totalTokens||0;
}

// ── Panel switching ────────────────────────────
function switchPanel(name,btn){
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('panel-'+name).classList.add('active');
  btn.classList.add('active');
  if(name==='memory')renderFacts();
  if(name==='history')renderHistory();
  if(name==='system')renderSystem();
  if(name==='peers')refreshPeers();
  if(name==='portability')renderPortability();
}

// ── Init ──────────────────────────────────────
async function init(){
  try{
    const[s,facts,msgs,sessions]=await Promise.all([
      fetch('/api/status').then(r=>r.json()),
      fetch('/api/facts').then(r=>r.json()),
      fetch('/api/history').then(r=>r.json()),
      fetch('/api/sessions').then(r=>r.json()),
    ]);
    status=s;allFacts=facts;allMessages=msgs;allSessions=sessions;

    document.getElementById('header-meta').textContent=
      'SYS-ID: '+s.identity.id.slice(0,22).toUpperCase()+' // REV '+s.identity.version;
    document.getElementById('status-dot').className='status-dot';
    document.getElementById('status-text').textContent=s.config.provider.toUpperCase()+' // ONLINE';
    document.getElementById('badge-facts').textContent=facts.length;
    document.getElementById('badge-msgs').textContent=msgs.length;
    document.getElementById('ss-sessions').textContent=s.stats.sessions;
    document.getElementById('ss-messages').textContent=s.stats.messages;
    document.getElementById('ss-db').textContent=s.stats.dbSizeKb+' KB';
    updateStrip();

    const sel=document.getElementById('hist-session');
    sessions.forEach(sess=>{
      const o=document.createElement('option');
      o.value=sess.id;o.textContent=sess.id.slice(0,22)+' ('+sess.count+')';
      sel.appendChild(o);
    });

    // Welcome message
    addMsg('assistant','JARVIS ONLINE. ALL SYSTEMS NOMINAL. HOW MAY I ASSIST?',null);

    // Background peer discovery
    void refreshPeers();
    setInterval(()=>void refreshPeers(),10000);
  }catch(e){
    document.getElementById('status-text').textContent='OFFLINE';
    console.error(e);
  }
}

// ── Chat ──────────────────────────────────────
function chatKeydown(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat()}}
function autoResize(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,120)+'px'}

function addMsg(role,text,stats){
  const c=document.getElementById('chat-messages');
  const div=document.createElement('div');
  div.className='msg '+role;
  const avatar=role==='user'?'◈':'⬡';
  const name=role==='user'?'OPERATOR':'JARVIS';
  const statsHtml=stats?
    \`<div class="msg-stats-row">
      <span class="msg-stat">IN <span>\${stats.promptTokens}</span></span>
      <span class="msg-stat">OUT <span>\${stats.completionTokens}</span></span>
      <span class="msg-stat">TOTAL <span>\${stats.totalTokens}</span></span>
    </div>\`:'';
  div.innerHTML=\`
    <div class="msg-avatar">\${avatar}</div>
    <div class="msg-content">
      <div class="msg-header">
        <span class="msg-role">\${name}</span>
        <span class="msg-time">\${fmt(new Date().toISOString())}</span>
      </div>
      <div class="msg-text">\${esc(text)}</div>
      \${statsHtml}
    </div>\`;
  c.appendChild(div);c.scrollTop=c.scrollHeight;
  return div;
}

async function sendChat(){
  if(streaming)return;
  const input=document.getElementById('chat-input');
  const msg=input.value.trim();
  if(!msg)return;
  input.value='';input.style.height='auto';
  document.getElementById('chat-send').disabled=true;
  streaming=true;
  setOrb('thinking');
  totalMsgs++;

  addMsg('user',msg,null);

  // Create assistant bubble
  const c=document.getElementById('chat-messages');
  const bubble=document.createElement('div');
  bubble.className='msg assistant';
  const msgId='msg-'+Date.now();
  bubble.innerHTML=\`
    <div class="msg-avatar">⬡</div>
    <div class="msg-content">
      <div class="msg-header">
        <span class="msg-role">JARVIS</span>
        <span class="msg-time">\${fmt(new Date().toISOString())}</span>
      </div>
      <div class="msg-text" id="\${msgId}-text"></div>
      <div class="msg-stats-row" id="\${msgId}-stats" style="display:none"></div>
    </div>\`;
  c.appendChild(bubble);c.scrollTop=c.scrollHeight;

  const textEl=document.getElementById(\`\${msgId}-text\`);
  const statsEl=document.getElementById(\`\${msgId}-stats\`);
  const cur=document.createElement('span');cur.className='cursor';
  textEl.appendChild(cur);

  let full='';
  let firstToken=true;

  try{
    const res=await fetch('/api/chat',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({message:msg}),
    });
    const reader=res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf='';
    while(true){
      const{value,done}=await reader.read();
      if(done)break;
      buf+=value;
      const parts=buf.split('\\n\\n');buf=parts.pop();
      for(const part of parts){
        for(const line of part.split('\\n')){
          if(!line.startsWith('data: '))continue;
          let ev;try{ev=JSON.parse(line.slice(6))}catch{continue}
          if(ev.type==='token'){
            if(firstToken){setOrb('speaking');firstToken=false;}
            full+=ev.token;
            textEl.textContent=full;
            textEl.appendChild(cur);
            c.scrollTop=c.scrollHeight;
          }else if(ev.type==='done'){
            cur.remove();
            if(ev.stats&&ev.stats.totalTokens){
              statsEl.style.display='flex';
              statsEl.innerHTML=\`
                <span class="msg-stat">IN <span>\${ev.stats.promptTokens||0}</span></span>
                <span class="msg-stat">OUT <span>\${ev.stats.completionTokens||0}</span></span>
                <span class="msg-stat">TOTAL <span>\${ev.stats.totalTokens||0}</span></span>\`;
              updateTokens(ev.stats);
            }
            totalMsgs++;
            document.getElementById('badge-msgs').textContent=
              parseInt(document.getElementById('badge-msgs').textContent||'0')+2;
            if(status){status.stats.messages+=2;updateStrip();}
          }else if(ev.type==='error'){
            cur.remove();
            textEl.textContent='// ERROR: '+(ev.message||'UNKNOWN');
            textEl.style.color='var(--danger)';
            toast(ev.message||'Error','err');
          }
        }
      }
    }
  }catch(e){
    cur.remove();
    textEl.textContent='// CONNECTION FAILURE';
    textEl.style.color='var(--danger)';
    toast('Connection error','err');
  }finally{
    streaming=false;
    setOrb('idle');
    document.getElementById('chat-send').disabled=false;
    document.getElementById('chat-input').focus();
    c.scrollTop=c.scrollHeight;
  }
}

// ── Memory ────────────────────────────────────
async function deleteFact(key){
  if(!confirm('DELETE RECORD "'+key+'"?'))return;
  const r=await fetch('/api/facts/'+encodeURIComponent(key),{method:'DELETE'});
  if(r.ok){
    allFacts=allFacts.filter(f=>f.key!==key);
    document.getElementById('badge-facts').textContent=allFacts.length;
    document.getElementById('facts-count').textContent=allFacts.length+' RECORDS';
    if(status){status.stats.facts=allFacts.length;updateStrip();}
    renderFacts();toast('Record deleted');
  }else toast('Delete failed','err');
}
function renderFacts(){
  const q=document.getElementById('facts-search').value.toLowerCase();
  let f=allFacts;
  if(q)f=f.filter(x=>x.key.toLowerCase().includes(q)||x.value.toLowerCase().includes(q));
  document.getElementById('facts-count').textContent=f.length+' RECORD'+(f.length!==1?'S':'');
  const grid=document.getElementById('facts-grid');
  const empty=document.getElementById('facts-empty');
  if(!f.length){grid.innerHTML='';empty.style.display='';return;}
  empty.style.display='none';
  grid.innerHTML=f.map(x=>\`
    <div class="hud-card fact-card">
      <div class="fact-key">\${esc(x.key)}</div>
      <div class="fact-value">\${esc(x.value)}</div>
      <div class="fact-footer">
        <span class="fact-ts">\${rel(x.created_at)}</span>
        <button class="btn-del" onclick="deleteFact('\${esc(x.key)}')">✕ PURGE</button>
      </div>
    </div>\`).join('');
}

// ── History ───────────────────────────────────
function renderHistory(){
  const q=document.getElementById('hist-search').value.toLowerCase();
  const sess=document.getElementById('hist-session').value;
  let msgs=allMessages;
  if(sess)msgs=msgs.filter(m=>m.session_id===sess);
  if(q)msgs=msgs.filter(m=>String(m.content).toLowerCase().includes(q));
  document.getElementById('history-count').textContent=msgs.length+' ENTR'+(msgs.length!==1?'IES':'Y');
  const body=document.getElementById('history-body');
  const empty=document.getElementById('history-empty');
  if(!msgs.length){body.innerHTML='';empty.style.display='';return;}
  empty.style.display='none';
  const grouped={};
  for(const m of msgs){const sid=m.session_id||'unknown';if(!grouped[sid])grouped[sid]=[];grouped[sid].push(m);}
  body.innerHTML=Object.entries(grouped).map(([sid,grp])=>\`
    <div class="session-group">
      <div class="session-header">
        <span class="session-id">\${esc(sid.slice(0,26))}</span>
        <span class="session-count">\${grp.length} MSG</span>
      </div>
      \${grp.map(m=>{
        const t=String(m.content).replace(/\\n/g,' ');
        const preview=t.length>200?t.slice(0,200)+'…':t;
        return \`<div class="hist-msg">
          <span class="hist-role \${m.role}">\${m.role.toUpperCase()}</span>
          <span class="hist-text">\${esc(preview)}</span>
          <span class="hist-ts">\${rel(m.timestamp)}</span>
        </div>\`;
      }).join('')}
    </div>\`).join('');
}

// ── System ────────────────────────────────────
function renderSystem(){
  if(!status)return;
  const s=status;
  document.getElementById('sys-stats').innerHTML=\`
    <div class="hud-card stat-card"><div class="val">\${s.stats.messages}</div><div class="lbl">Total Messages</div></div>
    <div class="hud-card stat-card"><div class="val">\${s.stats.facts}</div><div class="lbl">Memory Records</div></div>
    <div class="hud-card stat-card"><div class="val">\${s.stats.sessions}</div><div class="lbl">Sessions</div></div>
    <div class="hud-card stat-card"><div class="val">\${s.stats.dbSizeKb} KB</div><div class="lbl">Storage</div></div>\`;
  document.getElementById('sys-info').innerHTML=\`
    <div class="hud-card info-card">
      <h3>Identity</h3>
      <div class="info-row"><span class="k">AGENT ID</span><span class="v">\${esc(s.identity.id)}</span></div>
      <div class="info-row"><span class="k">VERSION</span><span class="v">\${esc(s.identity.version)}</span></div>
      <div class="info-row"><span class="k">CREATED</span><span class="v">\${fmt(s.identity.created)}</span></div>
    </div>
    <div class="hud-card info-card">
      <h3>Provider</h3>
      <div class="info-row"><span class="k">PROVIDER</span><span class="v">\${esc(s.config.provider)}</span></div>
      <div class="info-row"><span class="k">MODEL</span><span class="v">\${esc(s.config.model)}</span></div>
      <div class="info-row"><span class="k">ENDPOINT</span><span class="v">\${esc(s.config.base_url||'(default)')}</span></div>
    </div>\`;
}

// ── Peers ─────────────────────────────────────
async function refreshPeers(){
  document.getElementById('peers-count').textContent='SCANNING…';
  try{
    const r=await fetch('/api/peers');
    allPeers=await r.json();
  }catch{allPeers=[];}
  renderPeers();
}

function renderPeers(){
  const count=allPeers.length;
  document.getElementById('peers-count').textContent=count+' PEER'+(count!==1?'S':'');
  document.getElementById('badge-peers').textContent=count;
  const grid=document.getElementById('peers-grid');
  const empty=document.getElementById('peers-empty');
  const sel=document.getElementById('peer-select');

  // Update relay select
  sel.innerHTML='<option value="">— select peer —</option>';
  for(const p of allPeers){
    const o=document.createElement('option');
    o.value=JSON.stringify({address:p.address,port:p.port});
    o.textContent=p.address+':'+p.port+' ('+p.name.slice(0,18)+(p.name.length>18?'…':'')+')';
    sel.appendChild(o);
  }

  if(!count){grid.innerHTML='';empty.style.display='';return;}
  empty.style.display='none';
  grid.innerHTML=allPeers.map(p=>\`
    <div class="hud-card fact-card">
      <div class="fact-key">\${esc(p.address+':'+p.port)}</div>
      <div class="fact-value" style="color:var(--text3)">
        <div>\${esc(p.name.slice(0,32))}</div>
        \${p.version?'<div style="margin-top:2px;font-size:10px">v'+esc(p.version)+'</div>':''}
      </div>
      <div class="fact-footer">
        <span class="fact-ts" style="color:var(--success)">● ONLINE</span>
        <button class="btn-del" style="border-color:var(--cyan-border);color:var(--cyan)"
          onclick="selectPeer('\${esc(p.address)}',\${p.port})">SELECT</button>
      </div>
    </div>\`).join('');
}

function selectPeer(address,port){
  const sel=document.getElementById('peer-select');
  const val=JSON.stringify({address,port});
  for(const o of sel.options){if(o.value===val){o.selected=true;break;}}
  document.getElementById('peer-input').focus();
}

async function sendPeerChat(){
  if(peerStreaming)return;
  const selEl=document.getElementById('peer-select');
  const inputEl=document.getElementById('peer-input');
  const respEl=document.getElementById('peer-response');
  const query=inputEl.value.trim();
  if(!selEl.value||!query){toast('Select a peer and enter a query','err');return;}
  const {address,port}=JSON.parse(selEl.value);

  peerStreaming=true;
  respEl.textContent='';
  respEl.style.color='var(--text)';
  const cur=document.createElement('span');cur.className='cursor';respEl.appendChild(cur);

  try{
    const res=await fetch('/api/peer-query',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({address,port,query}),
    });
    const reader=res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf='',full='';
    while(true){
      const{value,done}=await reader.read();
      if(done)break;
      buf+=value;
      const parts=buf.split('\\n\\n');buf=parts.pop();
      for(const part of parts){
        for(const line of part.split('\\n')){
          if(!line.startsWith('data: '))continue;
          let ev;try{ev=JSON.parse(line.slice(6))}catch{continue}
          if(ev.type==='token'){full+=ev.token;respEl.textContent=full;respEl.appendChild(cur);}
          else if(ev.type==='done'){cur.remove();}
          else if(ev.type==='error'){cur.remove();respEl.textContent='// ERROR: '+esc(ev.message||'unknown');respEl.style.color='var(--danger)';toast(ev.message||'Peer error','err');}
        }
      }
    }
  }catch(e){
    cur.remove();
    respEl.textContent='// CONNECTION FAILURE';
    respEl.style.color='var(--danger)';
    toast('Peer connection failed','err');
  }finally{peerStreaming=false;}
}

// ── Portability ───────────────────────────────
function renderPortability(){
  // Populate sync peer dropdown from discovered peers
  const sel=document.getElementById('sync-peer-select');
  sel.innerHTML='<option value="">— select discovered peer —</option>';
  for(const p of allPeers){
    const o=document.createElement('option');
    o.value=p.address+':'+p.port;
    o.textContent=p.address+':'+p.port+' ('+p.name.slice(0,18)+(p.name.length>18?'…':'')+')';
    sel.appendChild(o);
  }
}

async function downloadExport(noHistory){
  const st=document.getElementById('export-status');
  st.textContent='Generating bundle…';st.style.color='var(--text3)';
  try{
    const url='/api/export'+(noHistory?'?no_history=1':'');
    const res=await fetch(url);
    if(!res.ok)throw new Error('Export failed: HTTP '+res.status);
    const blob=await res.blob();
    const a=document.createElement('a');
    a.href=URL.createObjectURL(blob);
    a.download='jarvis.jarvis.bundle';
    a.click();
    URL.revokeObjectURL(a.href);
    st.textContent='Bundle downloaded.';st.style.color='var(--success)';
    setTimeout(()=>st.textContent='',4000);
  }catch(e){
    st.textContent='Error: '+e.message;st.style.color='var(--danger)';
    toast(e.message,'err');
  }
}

async function runSync(){
  const sel=document.getElementById('sync-peer-select').value;
  const manual=document.getElementById('sync-manual').value.trim();
  const target=sel||manual;
  if(!target){toast('Select or enter a peer address','err');return;}
  const[address,portStr]=target.includes(':')?target.split(':'):[target,'7474'];
  const port=parseInt(portStr,10);
  if(isNaN(port)){toast('Invalid port','err');return;}

  const st=document.getElementById('sync-status');
  st.textContent='Syncing from '+target+'…';st.style.color='var(--text3)';
  try{
    const res=await fetch('/api/sync',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({address,port}),
    });
    const data=await res.json();
    if(!res.ok)throw new Error(data.error||'Sync failed');
    st.innerHTML=\`Sync complete — Facts imported: <span style="color:var(--cyan)">\${data.factsImported}</span> &nbsp; Skipped: <span style="color:var(--text3)">\${data.factsSkipped}</span> &nbsp; History: <span style="color:var(--cyan)">\${data.historyImported}</span> msgs &nbsp; Memory merged: <span style="color:var(--cyan)">\${data.memoryMerged?'yes':'no'}</span>\`;
    st.style.color='var(--success)';
    if(status&&data.factsImported>0){status.stats.facts+=data.factsImported;updateStrip();}
    toast('Sync complete');
  }catch(e){
    st.textContent='Error: '+e.message;st.style.color='var(--danger)';
    toast(e.message,'err');
  }
}

init();
</script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export function startDashboard(port = DEFAULT_PORT): void {
  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    if (handleApi(req, res)) return;

    if (method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(HTML);
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  startDiscovery();

  server.listen(port, '127.0.0.1', () => {
    console.log(`JARVIS Dashboard → http://127.0.0.1:${port}`);
    console.log('Press Ctrl+C to stop.');
  });

  process.on('SIGINT', () => { stopDiscovery(); server.close(); process.exit(0); });
}
