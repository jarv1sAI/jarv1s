/**
 * ConfirmationBroker — abstracts the "ask the user before doing something risky" pattern.
 *
 * Four implementations:
 *   TerminalBroker      — readline prompt on process.stdin (CLI / REPL context)
 *   DenyAllBroker       — always returns false (safe fallback when no channel available)
 *   AllowAllBroker      — always returns true (testing / non-interactive automation)
 *   WsDashboardBroker   — forwards prompt to browser via WebSocket, awaits response
 */

import * as readline from 'readline';
import { type WebSocket } from 'ws';

export interface ConfirmationBroker {
  ask(prompt: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// TerminalBroker — interactive readline prompt
// ---------------------------------------------------------------------------

export const TerminalBroker: ConfirmationBroker = {
  ask(prompt: string): Promise<boolean> {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer.toLowerCase().trim() === 'y' || answer.toLowerCase().trim() === 'yes');
      });
    });
  },
};

// ---------------------------------------------------------------------------
// DenyAllBroker — safe default when there is no terminal (dashboard, peer daemon)
// ---------------------------------------------------------------------------

export const DenyAllBroker: ConfirmationBroker = {
  ask(_prompt: string): Promise<boolean> {
    process.stderr.write('[JARVIS] Confirmation required but no terminal available — operation denied.\n');
    return Promise.resolve(false);
  },
};

// ---------------------------------------------------------------------------
// AllowAllBroker — for non-interactive automation / testing only
// ---------------------------------------------------------------------------

export const AllowAllBroker: ConfirmationBroker = {
  ask(_prompt: string): Promise<boolean> {
    return Promise.resolve(true);
  },
};

// ---------------------------------------------------------------------------
// Resolve the right broker based on execution context
// ---------------------------------------------------------------------------

/**
 * Returns TerminalBroker when stdout is a real TTY (interactive CLI session),
 * DenyAllBroker otherwise (dashboard, piped, or background service).
 */
export function defaultBroker(): ConfirmationBroker {
  return process.stdout.isTTY ? TerminalBroker : DenyAllBroker;
}

// ---------------------------------------------------------------------------
// WsDashboardBroker — forwards confirmation prompts to the browser over WS
// ---------------------------------------------------------------------------

/** Incrementing request ID so responses can be matched to pending promises. */
let _nextConfirmId = 1;

/**
 * A confirmation broker backed by a live WebSocket connection to the dashboard.
 *
 * Protocol (JSON messages over the socket):
 *   → server sends: { type: "confirm_request",  id: number, prompt: string }
 *   ← client sends: { type: "confirm_response", id: number, approved: boolean }
 *
 * If the socket closes or errors before the user responds, the operation is
 * denied (safe default).
 */
export class WsDashboardBroker implements ConfirmationBroker {
  private _pending = new Map<number, (approved: boolean) => void>();

  constructor(private _ws: WebSocket) {
    _ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; id?: number; approved?: boolean };
        if (msg.type === 'confirm_response' && typeof msg.id === 'number') {
          const resolve = this._pending.get(msg.id);
          if (resolve) {
            this._pending.delete(msg.id);
            resolve(msg.approved === true);
          }
        }
      } catch { /* ignore malformed messages */ }
    });

    _ws.on('close', () => {
      // Deny all pending confirmations if the socket drops
      for (const [id, resolve] of this._pending) {
        this._pending.delete(id);
        resolve(false);
      }
    });

    _ws.on('error', () => {
      for (const [id, resolve] of this._pending) {
        this._pending.delete(id);
        resolve(false);
      }
    });
  }

  ask(prompt: string): Promise<boolean> {
    return new Promise((resolve) => {
      const id = _nextConfirmId++;
      this._pending.set(id, resolve);
      try {
        this._ws.send(JSON.stringify({ type: 'confirm_request', id, prompt }));
      } catch {
        this._pending.delete(id);
        resolve(false);
      }
    });
  }
}
