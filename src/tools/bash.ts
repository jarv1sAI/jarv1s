import { execSync } from 'child_process';
import * as readline from 'readline';

const MAX_OUTPUT_LENGTH = 4000;

export interface BashExecInput {
  command: string;
}

async function promptUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase().trim());
    });
  });
}

export async function bashExec(input: BashExecInput): Promise<string> {
  const { command } = input;

  const answer = await promptUser(`[JARVIS] Run: \`${command}\`? (y/n) `);

  if (answer !== 'y' && answer !== 'yes') {
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
