/**
 * JARVIS scheduled tasks — cron-based background jobs.
 *
 * Tasks are configured in jarvis.yaml under `scheduled_tasks`:
 *
 *   scheduled_tasks:
 *     - name: daily-summary
 *       cron: "0 9 * * *"          # 9 AM every day
 *       prompt: "Summarise my day and any open tasks."
 *     - name: hourly-reminder
 *       cron: "0 * * * *"
 *       prompt: "Any urgent reminders I should know about?"
 *
 * Each task fires a one-shot query to the configured AI provider and
 * logs the response to the audit log. Results are also printed to stderr
 * so they appear in daemon logs.
 *
 * Start the scheduler with `jarvis daemon` (--daemon flag in agent.ts).
 */

import cron from 'node-cron';
import OpenAI from 'openai';
import { loadConfig } from './config.js';
import { saveMessage, logToolCall } from './memory.js';
import { loadIdentity } from './identity.js';

export interface ScheduledTask {
  name: string;
  cron: string;
  prompt: string;
}

/** Loaded from jarvis.yaml at startup. */
interface ConfigWithTasks {
  scheduled_tasks?: ScheduledTask[];
}

const _jobs: cron.ScheduledTask[] = [];

/**
 * Start all configured scheduled tasks.
 * Returns the number of tasks registered.
 */
export function startScheduler(): number {
  const config = loadConfig() as ReturnType<typeof loadConfig> & ConfigWithTasks;
  const tasks = config.scheduled_tasks ?? [];

  for (const task of tasks) {
    if (!task.name || !task.cron || !task.prompt) {
      process.stderr.write(`[JARVIS scheduler] Skipping invalid task (missing name/cron/prompt)\n`);
      continue;
    }

    if (!cron.validate(task.cron)) {
      process.stderr.write(`[JARVIS scheduler] Invalid cron expression for task '${task.name}': ${task.cron}\n`);
      continue;
    }

    const job = cron.schedule(task.cron, () => {
      void runScheduledTask(task);
    });

    _jobs.push(job);
    process.stderr.write(`[JARVIS scheduler] Registered task '${task.name}' (${task.cron})\n`);
  }

  return _jobs.length;
}

/** Stop all scheduled jobs (used for graceful shutdown). */
export function stopScheduler(): void {
  for (const job of _jobs) job.stop();
  _jobs.length = 0;
}

async function runScheduledTask(task: ScheduledTask): Promise<void> {
  const config = loadConfig();
  const identity = loadIdentity();
  const start = Date.now();

  process.stderr.write(`[JARVIS scheduler] Running task '${task.name}'…\n`);

  if (config.provider === 'subprocess') {
    process.stderr.write(`[JARVIS scheduler] Subprocess provider not supported for scheduled tasks.\n`);
    return;
  }

  const client = new OpenAI({
    apiKey: config.api_key ?? 'no-key',
    ...(config.base_url ? { baseURL: config.base_url } : {}),
  });

  const systemPrompt = `You are JARVIS, a local-first AI assistant running a scheduled task.\nAgent ID: ${identity.id}\nTask: ${task.name}\nTime: ${new Date().toLocaleString()}`;

  try {
    const res = await client.chat.completions.create({
      model: config.model,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: task.prompt },
      ],
    });

    const response = res.choices[0]?.message?.content?.trim() ?? '(no response)';
    saveMessage('user', `[SCHEDULED: ${task.name}] ${task.prompt}`);
    saveMessage('assistant', response);
    logToolCall('scheduled_task', { task: task.name, prompt: task.prompt }, response, Date.now() - start);

    process.stderr.write(`[JARVIS scheduler] Task '${task.name}' complete:\n${response}\n`);
  } catch (err: unknown) {
    const e = err as { message?: string };
    process.stderr.write(`[JARVIS scheduler] Task '${task.name}' failed: ${e.message ?? 'unknown error'}\n`);
  }
}
