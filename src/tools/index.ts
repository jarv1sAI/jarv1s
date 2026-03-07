import { bashExec, bashExecDefinition, type BashExecInput } from './bash.js';
import {
  readFile,
  writeFile,
  readFileDefinition,
  writeFileDefinition,
  type ReadFileInput,
  type WriteFileInput,
} from './files.js';
import {
  remember,
  recall,
  rememberDefinition,
  recallDefinition,
  type RememberInput,
  type RecallInput,
} from './memory.js';

export const TOOLS = [
  bashExecDefinition,
  readFileDefinition,
  writeFileDefinition,
  rememberDefinition,
  recallDefinition,
];

type ToolInput =
  | BashExecInput
  | ReadFileInput
  | WriteFileInput
  | RememberInput
  | RecallInput;

export async function executeTool(
  name: string,
  input: ToolInput
): Promise<string> {
  switch (name) {
    case 'bash_exec':
      return await bashExec(input as BashExecInput);

    case 'read_file':
      return readFile(input as ReadFileInput);

    case 'write_file':
      return await writeFile(input as WriteFileInput);

    case 'remember':
      return remember(input as RememberInput);

    case 'recall':
      return recall(input as RecallInput);

    default:
      return `Unknown tool: ${name}`;
  }
}
