/**
 * JARVIS provider configuration.
 * Reads ~/.jarvis/config/jarvis.yaml, with env var and CLI overrides.
 *
 * Supported providers:
 *   ollama     — local Ollama instance (default: http://localhost:11434/v1)
 *   openai     — any OpenAI-compatible API: OpenAI, Hugging Face, Together, Groq,
 *                Mistral, Fireworks, LM Studio, etc. Set base_url + api_key.
 *   subprocess — pipe through any local CLI that already has its own auth
 *                e.g. subprocess_cmd: "claude -p"  uses your Claude Code login
 *                     subprocess_cmd: "sgpt"        uses ShellGPT
 *                No API key required for either.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
const parseYaml = yaml.load.bind(yaml) as (s: string) => unknown;
import { getConfigDir } from './identity.js';

export type Provider = 'ollama' | 'openai' | 'subprocess';
export type Personality = 'developer' | 'research' | 'general';

export interface JarvisConfig {
  provider: Provider;
  model: string;
  base_url?: string;       // override endpoint
  api_key?: string;        // if not using env var
  max_tokens: number;
  stream: boolean;
  // subprocess provider only: the CLI command to pipe queries through
  // e.g. "claude -p" or "cursor chat" — must accept prompt on stdin or as last arg
  subprocess_cmd?: string;
  // Paths the read_file/write_file/list_directory/search_files tools may access.
  // Defaults to [process.cwd(), os.homedir()] when not set.
  // Use ~ for home dir, e.g. "~/projects"
  allowed_paths?: string[];
  // Optional SearXNG instance URL for the web_search tool.
  // e.g. http://localhost:8888
  // When not set the web_search tool is unavailable.
  searxng_url?: string;
  // Scheduled background tasks (used with `jarvis daemon`).
  scheduled_tasks?: Array<{ name: string; cron: string; prompt: string }>;
  // Per-tool enable/disable map.  Omitting a tool name means it is enabled.
  // Example:
  //   tool_permissions:
  //     bash_exec: false   # disable shell execution
  //     web_fetch: true
  tool_permissions?: Record<string, boolean>;
  // Personality mode — shapes tone and focus of the system prompt.
  //   developer  — code-focused, terse, references project/git context
  //   research   — thorough, cites sources, expansive answers
  //   general    — balanced assistant (default)
  personality?: Personality;
}

// Defaults per provider
const PROVIDER_DEFAULTS: Record<Provider, Partial<JarvisConfig>> = {
  ollama: {
    base_url: 'http://localhost:11434/v1',
    model: 'llama3.2',
    api_key: 'ollama',  // Ollama ignores the key but the OpenAI SDK requires one
  },
  openai: {
    // base_url and api_key must be set in jarvis.yaml or env vars.
    // Examples:
    //   Hugging Face:  https://api-inference.huggingface.co/v1
    //   Together AI:   https://api.together.xyz/v1
    //   Groq:          https://api.groq.com/openai/v1
    //   Mistral:       https://api.mistral.ai/v1
    //   Fireworks:     https://api.fireworks.ai/inference/v1
    //   LM Studio:     http://localhost:1234/v1
    //   OpenAI:        https://api.openai.com/v1  (default if base_url omitted)
    model: 'gpt-4o-mini',
  },
  subprocess: {
    // Pipe queries through any local CLI that already has its own auth.
    // Set subprocess_cmd in jarvis.yaml to the command to run.
    // The prompt is appended as the last shell argument.
    // Examples:
    //   subprocess_cmd: "claude -p"
    //   subprocess_cmd: "claude -p --model claude-opus-4-6"
    //   subprocess_cmd: "sgpt"
    model: 'subprocess',
    api_key: 'none',
  },
};

const DEFAULT_CONFIG: JarvisConfig = {
  provider: 'ollama',
  model: 'llama3.2',
  max_tokens: 8096,
  stream: true,
  subprocess_cmd: undefined,
  personality: 'general',
};

const CONFIG_TEMPLATE = `# JARVIS Configuration

# Provider: ollama | openai | subprocess
#
#   ollama     — local Ollama (no API key needed)
#                pulls from http://localhost:11434 by default
#
#   openai     — any OpenAI-compatible API endpoint.
#                set base_url + api_key below (or via env vars).
#                Works with: Hugging Face, Together AI, Groq, Mistral,
#                            Fireworks, LM Studio, OpenAI, and more.
#
#   subprocess — pipe through any local CLI tool that already has its own auth.
#                set subprocess_cmd below. no key needed.
#                e.g. your Claude Code login, sgpt, oterm, etc.
#
provider: ollama

# Model name passed to the provider.
# ollama examples:    llama3.2, qwen2.5-coder, mistral, gemma3, phi4
# openai examples:    gpt-4o-mini, gpt-4o
# Hugging Face:       meta-llama/Llama-3.3-70B-Instruct
# Together AI:        meta-llama/Llama-3.3-70B-Instruct-Turbo
# Groq:               llama-3.3-70b-versatile
# Mistral:            mistral-small-latest
model: llama3.2

# openai provider: base URL of the OpenAI-compatible endpoint.
# Leave commented to use the real OpenAI API (https://api.openai.com/v1).
#
# Hugging Face:  base_url: https://api-inference.huggingface.co/v1
# Together AI:   base_url: https://api.together.xyz/v1
# Groq:          base_url: https://api.groq.com/openai/v1
# Mistral:       base_url: https://api.mistral.ai/v1
# Fireworks:     base_url: https://api.fireworks.ai/inference/v1
# LM Studio:     base_url: http://localhost:1234/v1
#
# base_url: https://api-inference.huggingface.co/v1

# API key for the openai provider.
# Can also be set via env vars: HF_TOKEN, OPENAI_API_KEY, GROQ_API_KEY, JARVIS_API_KEY, etc.
#
# api_key: hf_...

# subprocess provider: the CLI command to run.
# The full prompt is appended as the last quoted argument.
# The command must be on your PATH and already authenticated.
#
# Examples (uncomment one and set provider: subprocess above):
#   subprocess_cmd: "claude -p"
#   subprocess_cmd: "claude -p --model claude-opus-4-6"
#   subprocess_cmd: "sgpt"
#
# subprocess_cmd: "claude -p"

# Paths the file tools (read_file, write_file, list_directory, search_files) may access.
# Defaults to your home directory and current working directory when not set.
# Use ~ for home dir.
#
# allowed_paths:
#   - ~/projects
#   - ~/Documents

# Per-tool enable/disable permissions.
# Omitting a tool means it is enabled.
# Example: disable shell execution for safety
#
# tool_permissions:
#   bash_exec: false
#   web_fetch: true
#   web_search: true

# SearXNG web search — optional.
# Point to your local SearXNG instance to enable the web_search tool.
# Run SearXNG with Docker: https://docs.searxng.org/admin/installation-docker.html
#
# searxng_url: http://localhost:8888

# Personality mode — shapes tone and focus of the system prompt.
#   developer  — code-focused, terse, references project/git context
#   research   — thorough, cites sources, expansive answers
#   general    — balanced assistant (default)
#
# personality: developer

# Generation settings
max_tokens: 8096
stream: true
`;

export function loadConfig(overrides: Partial<JarvisConfig> = {}): JarvisConfig {
  const configPath = join(getConfigDir(), 'jarvis.yaml');

  // Create default config file if it doesn't exist
  if (!existsSync(configPath)) {
    writeFileSync(configPath, CONFIG_TEMPLATE);
  }

  let fileConfig: Partial<JarvisConfig> = {};
  try {
    const raw = readFileSync(configPath, 'utf-8');
    fileConfig = (parseYaml(raw) as Partial<JarvisConfig>) ?? {};
  } catch (e: unknown) {
    process.stderr.write(`[JARVIS] Warning: could not parse jarvis.yaml: ${(e as { message?: string }).message}\n`);
  }

  // Env var overrides
  const envProvider = process.env.JARVIS_PROVIDER as Provider | undefined;
  const envModel = process.env.JARVIS_MODEL;
  const envBaseUrl = process.env.JARVIS_BASE_URL;
  const envApiKey =
    process.env.JARVIS_API_KEY ??
    process.env.HF_TOKEN ??
    process.env.OPENAI_API_KEY ??
    process.env.GROQ_API_KEY ??
    process.env.TOGETHER_API_KEY ??
    process.env.MISTRAL_API_KEY ??
    process.env.FIREWORKS_API_KEY ??
    process.env.ANTHROPIC_API_KEY ??
    process.env.CLAUDE_LOCAL_API_KEY;

  const provider: Provider = overrides.provider ?? envProvider ?? fileConfig.provider ?? DEFAULT_CONFIG.provider;
  const providerDefaults = PROVIDER_DEFAULTS[provider] ?? {};

  const config: JarvisConfig = {
    ...DEFAULT_CONFIG,
    ...providerDefaults,
    ...fileConfig,
    provider,
    model: overrides.model ?? envModel ?? fileConfig.model ?? providerDefaults.model ?? DEFAULT_CONFIG.model,
    base_url: overrides.base_url ?? envBaseUrl ?? fileConfig.base_url ?? providerDefaults.base_url,
    api_key: overrides.api_key ?? envApiKey ?? fileConfig.api_key ?? providerDefaults.api_key,
    max_tokens: overrides.max_tokens ?? fileConfig.max_tokens ?? DEFAULT_CONFIG.max_tokens,
    stream: overrides.stream ?? fileConfig.stream ?? DEFAULT_CONFIG.stream,
    personality: overrides.personality ?? fileConfig.personality ?? DEFAULT_CONFIG.personality,
  };

  return config;
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'jarvis.yaml');
}
