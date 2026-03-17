import OpenAI from 'openai';
import * as readline from 'readline';
import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadIdentity, type Identity } from './identity.js';
import {
  loadJarvisMd,
  getRecentMessages,
  saveMessage,
  getAllFacts,
  deleteFact,
  getAllMessages,
  closeDb,
  getSessionSummary,
  saveSessionSummary,
  getSessionMessageCount,
  getOrCreateSession,
  SUMMARY_THRESHOLD,
} from './memory.js';
import { getTools, executeTool, initToolConfig } from './tools/index.js';
import { loadConfig, type JarvisConfig, type Personality } from './config.js';
import { startScheduler, stopScheduler } from './scheduler.js';

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const e = err as { status?: number; code?: string; message?: string };
      // Don't retry auth or bad-request errors
      if (e.status === 401 || e.status === 400 || e.status === 404) throw err;
      const wait = RETRY_BASE_MS * Math.pow(2, attempt);
      process.stderr.write(
        `[JARVIS] ${label} failed (attempt ${attempt + 1}/${MAX_RETRIES}): ${e.message ?? String(err)}. Retrying in ${wait}ms...\n`,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Sensitive data redaction
// ---------------------------------------------------------------------------

const REDACTION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /sk-ant-[A-Za-z0-9\-_]{20,}/g, replacement: '[ANTHROPIC_KEY]' },
  { pattern: /sk-[A-Za-z0-9]{20,}/g, replacement: '[OPENAI_KEY]' },
  { pattern: /ghp_[A-Za-z0-9]{36}/g, replacement: '[GITHUB_TOKEN]' },
  { pattern: /(?:password|passwd|secret)\s*[:=]\s*\S+/gi, replacement: '[REDACTED]' },
  { pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g, replacement: 'Bearer [REDACTED]' },
];

function redact(text: string): string {
  let out = text;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Project + Git context
// ---------------------------------------------------------------------------

interface ProjectContext {
  cwd: string;
  projectType: string | null;
  gitBranch: string | null;
  gitStatus: string | null;
  gitLog: string | null;
}

function detectProjectType(cwd: string): string | null {
  const markers: Array<[string, string]> = [
    ['package.json', 'Node.js'],
    ['Cargo.toml', 'Rust'],
    ['pyproject.toml', 'Python'],
    ['requirements.txt', 'Python'],
    ['go.mod', 'Go'],
    ['pom.xml', 'Java (Maven)'],
    ['build.gradle', 'Java (Gradle)'],
    ['Gemfile', 'Ruby'],
    ['composer.json', 'PHP'],
    ['mix.exs', 'Elixir'],
  ];
  for (const [file, label] of markers) {
    if (existsSync(join(cwd, file))) return label;
  }
  return null;
}

function getGitInfo(cwd: string): { branch: string | null; status: string | null; log: string | null } {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const status = execSync('git status --short', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    const log = execSync('git log --oneline -5', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return { branch, status: status || null, log: log || null };
  } catch {
    return { branch: null, status: null, log: null };
  }
}

function buildProjectContext(): ProjectContext {
  const cwd = process.cwd();
  const git = getGitInfo(cwd);
  return { cwd, projectType: detectProjectType(cwd), gitBranch: git.branch, gitStatus: git.status, gitLog: git.log };
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Personality instruction blocks
// ---------------------------------------------------------------------------

const PERSONALITY_INSTRUCTIONS: Record<Personality, string> = {
  developer: `## Mode: Developer
- Be terse and precise — code over prose
- Reference project context, git branch, and file paths directly
- Prefer short explanations with working code snippets
- Skip pleasantries; jump straight to the solution
- Use \`bash_exec\` freely for build/test/lint tasks`,

  research: `## Mode: Research
- Be thorough and cite sources when using \`web_fetch\` or \`web_search\`
- Summarize findings clearly before diving into detail
- Cross-reference multiple sources before drawing conclusions
- Label estimates, projections, and opinions explicitly
- Prefer exhaustive answers over terse ones`,

  general: `## Mode: General
- Be concise and direct in your responses
- Balance depth with brevity based on the question
- Use the \`remember\` tool proactively when the user shares something worth keeping
- You have persistent memory across sessions — use it wisely`,
};

function buildSystemPrompt(identity: Identity, ctx: ProjectContext, personality: Personality = 'general'): string {
  const jarvisMd = loadJarvisMd();
  const facts = getAllFacts();
  const now = new Date().toLocaleString();

  let projectSection = `## Working Directory\n- Path: ${ctx.cwd}`;
  if (ctx.projectType) projectSection += `\n- Project type: ${ctx.projectType}`;
  if (ctx.gitBranch) {
    projectSection += `\n- Git branch: ${ctx.gitBranch}`;
    if (ctx.gitStatus) projectSection += `\n- Dirty files:\n\`\`\`\n${ctx.gitStatus}\n\`\`\``;
    if (ctx.gitLog) projectSection += `\n- Recent commits:\n\`\`\`\n${ctx.gitLog}\n\`\`\``;
  }

  let factsSection = '';
  if (facts.length > 0) {
    factsSection = '\n## Known Facts\n' + facts.map((f) => `- ${f.key}: ${f.value}`).join('\n') + '\n';
  }

  const personalityBlock = PERSONALITY_INSTRUCTIONS[personality] ?? PERSONALITY_INSTRUCTIONS.general;

  return `You are JARVIS, a local-first AI assistant.

## Identity
- ID: ${identity.id}
- Version: ${identity.version}
- Created: ${identity.created}
- Current time: ${now}

## Memory
${jarvisMd}
${factsSection}
${projectSection}

${personalityBlock}

## Core Rules
- Always ask before running potentially destructive bash commands
- Use \`recall\` to search your memory when you need to reference past information
- When working with code or files, use the project context above to orient yourself
`;
}

// ---------------------------------------------------------------------------
// OpenAI-compatible tool definitions
// ---------------------------------------------------------------------------

function buildOpenAITools(): OpenAI.Chat.ChatCompletionTool[] {
  return getTools().map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

// ---------------------------------------------------------------------------
// Session summarization
// ---------------------------------------------------------------------------

/**
 * If the current session has exceeded SUMMARY_THRESHOLD messages and no
 * summary exists yet, ask the LLM to produce one and store it.
 * Called once per session startup — fire-and-forget from the caller.
 */
async function maybeAutoSummarize(client: OpenAI, config: JarvisConfig): Promise<void> {
  const sessionId = getOrCreateSession();
  const count = getSessionMessageCount(sessionId);
  if (count < SUMMARY_THRESHOLD) return;

  const existing = getSessionSummary(sessionId);
  // Only re-summarize when ≥20 new messages have arrived since last summary
  if (existing && count - existing.message_count < 20) return;

  const recent = getRecentMessages(count);
  const transcript = recent
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');

  try {
    const res = await client.chat.completions.create({
      model: config.model,
      max_tokens: 512,
      messages: [
        {
          role: 'system',
          content: 'You are a concise summarizer. Summarize the following conversation in 3-5 bullet points, preserving key decisions, facts learned, and action items. Be terse.',
        },
        { role: 'user', content: transcript },
      ],
    });
    const summary = res.choices[0]?.message?.content?.trim() ?? '';
    if (summary) saveSessionSummary(sessionId, summary, count);
  } catch {
    // Non-critical — silently skip if summarization fails
  }
}

/**
 * Build the history message list, prepending any stored session summary
 * as a system message so the model has context without the full transcript.
 */
function buildHistory(systemPrompt: string): OAIMessage[] {
  const sessionId = getOrCreateSession();
  const stored = getSessionSummary(sessionId);
  const messages: OAIMessage[] = [{ role: 'system', content: systemPrompt }];

  if (stored) {
    messages.push({
      role: 'system',
      content: `## Earlier in this session (summary)\n${stored.summary}`,
    });
  }

  const recent = getRecentMessages(20);
  messages.push(...recent.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })));
  return messages;
}

// ---------------------------------------------------------------------------
// Image input helpers
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

function isImagePath(s: string): boolean {
  return IMAGE_EXTENSIONS.some((ext) => s.toLowerCase().endsWith(ext));
}

function loadImageBase64(path: string): { media_type: string; data: string } {
  const ext = path.toLowerCase().split('.').pop() ?? 'png';
  const types: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp',
  };
  return { media_type: types[ext] ?? 'image/png', data: readFileSync(path).toString('base64') };
}

type OpenAIContent = string | OpenAI.Chat.ChatCompletionContentPart[];

/**
 * Parse inline image references: "text <./path.png> more text"
 * Returns a multi-part content array when images are present.
 */
function parseUserInput(raw: string): OpenAIContent {
  const IMAGE_REF = /<([^>]+)>/g;
  const parts: OpenAI.Chat.ChatCompletionContentPart[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let hasImage = false;

  while ((match = IMAGE_REF.exec(raw)) !== null) {
    const candidate = match[1].trim();
    if (!isImagePath(candidate) || !existsSync(candidate)) continue;

    hasImage = true;
    const before = raw.slice(last, match.index).trim();
    if (before) parts.push({ type: 'text', text: redact(before) });

    const { media_type, data } = loadImageBase64(candidate);
    parts.push({
      type: 'image_url',
      image_url: { url: `data:${media_type};base64,${data}` },
    });

    last = match.index + match[0].length;
  }

  if (!hasImage) return redact(raw);

  const tail = raw.slice(last).trim();
  if (tail) parts.push({ type: 'text', text: redact(tail) });
  return parts;
}

// ---------------------------------------------------------------------------
// Subprocess provider
// ---------------------------------------------------------------------------

/**
 * Runs a prompt through an external CLI tool (e.g. "claude -p", "sgpt").
 * The prompt is passed as the last argument to the command.
 * Uses spawn with an argument array (no shell) to prevent command injection.
 */
async function runSubprocess(cmd: string, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Split cmd into executable + fixed args; append prompt as a separate argument.
    // No shell=true — eliminates injection via subprocess_cmd config value.
    const parts = cmd.trim().split(/\s+/);
    const executable = parts[0];
    const args = [...parts.slice(1), prompt];

    const child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let fullText = '';

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      process.stdout.write(text);
      fullText += text;
    });

    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    child.on('close', (code) => {
      if (code !== 0 && !fullText) {
        reject(new Error(`subprocess exited with code ${code}`));
      } else {
        resolve(fullText);
      }
    });

    child.on('error', reject);
  });
}

async function processSubprocessOneShot(
  systemPrompt: string,
  userInput: string,
  config: JarvisConfig,
): Promise<void> {
  const cmd = config.subprocess_cmd;
  if (!cmd) {
    process.stderr.write('[JARVIS] subprocess_cmd not set in jarvis.yaml\n');
    return;
  }

  const fullPrompt = `${systemPrompt}\n\nUser: ${redact(userInput)}`;
  const response = await runSubprocess(cmd, fullPrompt);
  process.stdout.write('\n');
  if (response.trim()) saveMessage('assistant', response.trim());
}

async function runSubprocessRepl(
  systemPrompt: string,
  identity: Identity,
  config: JarvisConfig,
): Promise<void> {
  const cmd = config.subprocess_cmd;
  if (!cmd) {
    process.stderr.write('[JARVIS] subprocess_cmd not set in jarvis.yaml. Set it in ~/.jarvis/config/jarvis.yaml\n');
    return;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(`JARVIS v${identity.version} | ${identity.id.slice(0, 20)}`);
  console.log(`Provider: subprocess (${cmd})`);
  console.log('Commands: /memory  /history  /forget <key>  /clear  /exit\n');

  const conversationHistory: string[] = [];

  const doPrompt = (): void => {
    rl.question('> ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { doPrompt(); return; }

      if (trimmed === '/exit') { console.log('Goodbye!'); rl.close(); return; }
      if (trimmed === '/clear') { console.clear(); doPrompt(); return; }

      if (trimmed === '/memory') {
        const facts = getAllFacts();
        if (facts.length === 0) {
          console.log('No facts stored yet.\n');
        } else {
          console.log('Stored facts:');
          for (const f of facts) console.log(`  ${f.key}: ${f.value}`);
          console.log();
        }
        doPrompt();
        return;
      }

      if (trimmed === '/history') {
        const msgs = getAllMessages(50);
        if (msgs.length === 0) {
          console.log('No history yet.\n');
        } else {
          console.log('Recent history (oldest → newest):');
          for (const m of msgs) {
            const ts = m.timestamp ? `[${m.timestamp.slice(0, 19).replace('T', ' ')}] ` : '';
            const who = m.role === 'user' ? 'You  ' : 'JARVIS';
            const text = String(m.content).replace(/\n/g, ' ');
            const preview = text.length > 100 ? text.slice(0, 100) + '…' : text;
            console.log(`  ${ts}${who}: ${preview}`);
          }
          console.log();
        }
        doPrompt();
        return;
      }

      if (trimmed.startsWith('/forget ')) {
        const key = trimmed.slice('/forget '.length).trim();
        if (!key) { console.log('Usage: /forget <key>\n'); }
        else {
          const deleted = deleteFact(key);
          console.log(deleted ? `Forgot "${key}".\n` : `No fact found with key "${key}".\n`);
        }
        doPrompt();
        return;
      }

      // Normal message — build prompt with system context + history
      saveMessage('user', redact(trimmed));
      conversationHistory.push(`User: ${trimmed}`);

      const recentHistory = conversationHistory.slice(-10).join('\n');
      const fullPrompt = `${systemPrompt}\n\n${recentHistory}`;

      try {
        const response = await runSubprocess(cmd, fullPrompt);
        process.stdout.write('\n');
        const responseText = response.trim();
        if (responseText) {
          saveMessage('assistant', responseText);
          conversationHistory.push(`JARVIS: ${responseText}`);
        }
      } catch (err: unknown) {
        const e = err as { message?: string };
        console.error(`\nError: ${e.message ?? 'subprocess failed'}\n`);
      }

      console.log();
      doPrompt();
    });
  };

  doPrompt();
}

// ---------------------------------------------------------------------------
// OpenAI client factory
// ---------------------------------------------------------------------------

function createClient(config: JarvisConfig): OpenAI {
  const apiKey = config.api_key ?? 'no-key';
  const baseURL = config.base_url;
  return new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

// ---------------------------------------------------------------------------
// Streaming conversation loop
// ---------------------------------------------------------------------------

type OAIMessage = OpenAI.Chat.ChatCompletionMessageParam;

async function runConversationLoop(
  client: OpenAI,
  systemPrompt: string,
  messages: OAIMessage[],
  config: JarvisConfig,
): Promise<void> {
  const tools = buildOpenAITools();

  while (true) {
    let fullText = '';
    let toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = [];

    await withRetry(async () => {
      if (config.stream) {
        const stream = await client.chat.completions.create({
          model: config.model,
          max_tokens: config.max_tokens,
          messages,
          tools,
          tool_choice: 'auto',
          stream: true,
        });

        // Accumulate streamed tool call deltas
        const tcMap: Map<number, { id: string; name: string; args: string }> = new Map();

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            process.stdout.write(delta.content);
            fullText += delta.content;
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index;
              if (!tcMap.has(idx)) {
                tcMap.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', args: '' });
              }
              const entry = tcMap.get(idx)!;
              if (tc.id) entry.id = tc.id;
              if (tc.function?.name) entry.name = tc.function.name;
              if (tc.function?.arguments) entry.args += tc.function.arguments;
            }
          }
        }

        toolCalls = Array.from(tcMap.values()).map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.args },
        }));
      } else {
        // Non-streaming fallback
        const resp = await client.chat.completions.create({
          model: config.model,
          max_tokens: config.max_tokens,
          messages,
          tools,
          tool_choice: 'auto',
          stream: false,
        });
        const choice = resp.choices[0];
        fullText = choice.message.content ?? '';
        toolCalls = choice.message.tool_calls ?? [];
        if (fullText) process.stdout.write(fullText);
      }
    }, 'API call');

    if (fullText) process.stdout.write('\n');

    // No tool calls — turn is done
    if (toolCalls.length === 0) {
      if (fullText) saveMessage('assistant', fullText);
      break;
    }

    // Append assistant message with tool calls
    messages.push({
      role: 'assistant',
      content: fullText || null,
      tool_calls: toolCalls,
    });

    // Execute each tool and collect results
    for (const tc of toolCalls) {
      if (tc.type !== 'function') continue;
      const name = tc.function.name;
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
      } catch { /* malformed JSON — use empty input */ }

      process.stdout.write(`\n[tool: ${name}]\n`);
      const result = await executeTool(name, input as Parameters<typeof executeTool>[1]);

      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function runAgent(
  userInput?: string,
  opts: { model?: string; provider?: string; daemon?: boolean } = {},
): Promise<void> {
  const config = loadConfig({
    model: opts.model,
    provider: opts.provider as JarvisConfig['provider'] | undefined,
  });

  initToolConfig(config.allowed_paths);

  // --daemon: run scheduled tasks only, no interactive session
  if (opts.daemon) {
    const count = startScheduler();
    if (count === 0) {
      process.stderr.write('[JARVIS daemon] No scheduled_tasks configured in jarvis.yaml — exiting.\n');
      return;
    }
    process.stderr.write(`[JARVIS daemon] Running ${count} scheduled task(s). Press Ctrl+C to stop.\n`);
    process.on('SIGINT', () => { stopScheduler(); closeDb(); process.exit(0); });
    process.on('SIGTERM', () => { stopScheduler(); closeDb(); process.exit(0); });
    // Keep process alive — cron manages its own event loop keepalive
    return;
  }

  const identity = loadIdentity();
  const ctx = buildProjectContext();
  const systemPrompt = buildSystemPrompt(identity, ctx, config.personality);

  if (config.provider === 'subprocess') {
    if (userInput) {
      await processSubprocessOneShot(systemPrompt, userInput, config);
    } else {
      await runSubprocessRepl(systemPrompt, identity, config);
    }
  } else {
    const client = createClient(config);
    if (userInput) {
      await processOneShot(client, systemPrompt, userInput, config);
    } else {
      await runRepl(client, systemPrompt, identity, config);
    }
  }

  closeDb();
}

async function processOneShot(
  client: OpenAI,
  systemPrompt: string,
  userInput: string,
  config: JarvisConfig,
): Promise<void> {
  void maybeAutoSummarize(client, config);
  const messages = buildHistory(systemPrompt);

  const parsed = parseUserInput(userInput);
  messages.push({ role: 'user', content: parsed });
  saveMessage('user', typeof parsed === 'string' ? parsed : JSON.stringify(parsed));

  await runConversationLoop(client, systemPrompt, messages, config);
}

// ---------------------------------------------------------------------------
// Interactive REPL
// ---------------------------------------------------------------------------

async function runRepl(
  client: OpenAI,
  systemPrompt: string,
  identity: Identity,
  config: JarvisConfig,
): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log(`JARVIS v${identity.version} | ${identity.id.slice(0, 20)}`);
  console.log(`Provider: ${config.provider} | Model: ${config.model}`);
  console.log('Commands: /memory  /history  /forget <key>  /clear  /exit\n');

  void maybeAutoSummarize(client, config);
  const messages = buildHistory(systemPrompt);

  const doPrompt = (): void => {
    rl.question('> ', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { doPrompt(); return; }

      if (trimmed === '/exit') { console.log('Goodbye!'); rl.close(); return; }
      if (trimmed === '/clear') { console.clear(); doPrompt(); return; }

      if (trimmed === '/memory') {
        const facts = getAllFacts();
        if (facts.length === 0) {
          console.log('No facts stored yet.\n');
        } else {
          console.log('Stored facts:');
          for (const f of facts) console.log(`  ${f.key}: ${f.value}`);
          console.log();
        }
        doPrompt();
        return;
      }

      if (trimmed === '/history') {
        const msgs = getAllMessages(50);
        if (msgs.length === 0) {
          console.log('No history yet.\n');
        } else {
          console.log('Recent history (oldest → newest):');
          for (const m of msgs) {
            const ts = m.timestamp ? `[${m.timestamp.slice(0, 19).replace('T', ' ')}] ` : '';
            const who = m.role === 'user' ? 'You  ' : 'JARVIS';
            const text = String(m.content).replace(/\n/g, ' ');
            const preview = text.length > 100 ? text.slice(0, 100) + '…' : text;
            console.log(`  ${ts}${who}: ${preview}`);
          }
          console.log();
        }
        doPrompt();
        return;
      }

      if (trimmed.startsWith('/forget ')) {
        const key = trimmed.slice('/forget '.length).trim();
        if (!key) { console.log('Usage: /forget <key>\n'); }
        else {
          const deleted = deleteFact(key);
          console.log(deleted ? `Forgot "${key}".\n` : `No fact found with key "${key}".\n`);
        }
        doPrompt();
        return;
      }

      // Normal message
      const parsed = parseUserInput(trimmed);
      messages.push({ role: 'user', content: parsed });
      saveMessage('user', typeof parsed === 'string' ? parsed : JSON.stringify(parsed));

      try {
        await runConversationLoop(client, systemPrompt, messages, config);
      } catch (err: unknown) {
        const e = err as { message?: string; status?: number };
        if (e.status === 401) {
          console.error(`\nAuth error: check your API key for provider "${config.provider}".\n`);
        } else {
          console.error(`\nError: ${e.message ?? 'Unknown error'}\n`);
        }
      }

      console.log();
      doPrompt();
    });
  };

  doPrompt();
}
