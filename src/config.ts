/**
 * JARVIS provider configuration.
 * Reads ~/.jarvis/config/jarvis.yaml, with env var and CLI overrides.
 *
 * Supported providers:
 *   ollama     — local Ollama instance (default: http://localhost:11434/v1)
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

export type Provider = 'ollama' | 'subprocess';

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
}

// Defaults per provider
const PROVIDER_DEFAULTS: Record<Provider, Partial<JarvisConfig>> = {
  ollama: {
    base_url: 'http://localhost:11434/v1',
    model: 'llama3.2',
    api_key: 'ollama',  // Ollama ignores the key but the OpenAI SDK requires one
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
};

const CONFIG_TEMPLATE = `# JARVIS Configuration
# See https://github.com/yourname/jarv1s for documentation

# Provider: ollama | subprocess
#
#   ollama     — local Ollama (no API key needed)
#                pulls from http://localhost:11434 by default
#
#   subprocess — pipe through any local CLI tool that already has its own auth.
#                set subprocess_cmd below. no key needed.
#                e.g. your Claude Code login, sgpt, oterm, etc.
#
provider: ollama

# Model to use with Ollama
# Examples: llama3.2, qwen2.5-coder, mistral, gemma3, phi4
model: llama3.2

# subprocess provider: the CLI command to run.
# The full prompt is appended as the last quoted argument.
# The command must be on your PATH and already authenticated.
#
# Examples (uncomment one and set provider: subprocess above):
#   subprocess_cmd: "claude -p"
#   subprocess_cmd: "claude -p --model claude-opus-4-6 --no-session-persistence"
#   subprocess_cmd: "sgpt"
#
# subprocess_cmd: "claude -p"

# Optional: override the Ollama endpoint if it runs on a non-default port
# base_url: http://localhost:11434/v1

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
    process.env.ANTHROPIC_API_KEY ??
    process.env.OPENAI_API_KEY ??
    process.env.CLAUDE_LOCAL_API_KEY ??
    process.env.JARVIS_API_KEY;

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
  };

  return config;
}

export function getConfigPath(): string {
  return join(getConfigDir(), 'jarvis.yaml');
}
