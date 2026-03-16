import { execSync } from 'child_process';
import { type ConfirmationBroker, defaultBroker } from './confirmation.js';

const MAX_OUTPUT_LENGTH = 4000;

export interface BashExecInput {
  command: string;
}

// Module-level broker — overridden by initToolConfig() for dashboard context
let _broker: ConfirmationBroker = defaultBroker();

export function setBashBroker(broker: ConfirmationBroker): void {
  _broker = broker;
}

export async function bashExec(input: BashExecInput): Promise<string> {
  const { command } = input;

  const approved = await _broker.ask(`[JARVIS] Run: \`${command}\`? (y/n) `);
  if (!approved) {
    return 'Command execution cancelled by user.';
  }

  try {
    const output = execSync(command, {
      encoding: 'utf-8',
      timeout: 60000,
      maxBuffer: 10 * 1024 * 1024,
      shell: '/bin/bash',
    });

    const combined = output.toString();
    if (combined.length > MAX_OUTPUT_LENGTH) {
      return combined.slice(0, MAX_OUTPUT_LENGTH) + '\n... [output truncated]';
    }
    return combined || '(command completed with no output)';
  } catch (error: unknown) {
    const execError = error as {
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    const stdout = execError.stdout?.toString() || '';
    const stderr = execError.stderr?.toString() || '';
    const combined = `${stdout}\n${stderr}`.trim();

    if (combined.length > MAX_OUTPUT_LENGTH) {
      return combined.slice(0, MAX_OUTPUT_LENGTH) + '\n... [output truncated]';
    }
    return combined || `Error: ${execError.message || 'Unknown error'}`;
  }
}

export const bashExecDefinition = {
  name: 'bash_exec',
  description: 'Execute a bash command on the local system',
  input_schema: {
    type: 'object' as const,
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute',
      },
    },
    required: ['command'],
  },
};
