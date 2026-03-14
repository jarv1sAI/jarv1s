import { bashExec, bashExecDefinition, type BashExecInput } from './bash.js';
import {
  readFile, writeFile,
  readFileDefinition, writeFileDefinition,
  type ReadFileInput, type WriteFileInput,
} from './files.js';
import {
  remember, recall,
  rememberDefinition, recallDefinition,
  type RememberInput, type RecallInput,
} from './memory.js';
import {
  listDirectory, searchFiles,
  listDirectoryDefinition, searchFilesDefinition,
  type ListDirectoryInput, type SearchFilesInput,
} from './fs.js';
import {
  webFetch,
  webFetchDefinition,
  type WebFetchInput,
} from './web.js';
import {
  clipboardRead, clipboardWrite,
  clipboardReadDefinition, clipboardWriteDefinition,
  type ClipboardReadInput, type ClipboardWriteInput,
} from './clipboard.js';

export const TOOLS = [
  bashExecDefinition,
  readFileDefinition,
  writeFileDefinition,
  rememberDefinition,
  recallDefinition,
  listDirectoryDefinition,
  searchFilesDefinition,
  webFetchDefinition,
  clipboardReadDefinition,
  clipboardWriteDefinition,
];

type ToolInput =
  | BashExecInput
  | ReadFileInput
  | WriteFileInput
  | RememberInput
  | RecallInput
  | ListDirectoryInput
  | SearchFilesInput
  | WebFetchInput
  | ClipboardReadInput
  | ClipboardWriteInput;

export async function executeTool(name: string, input: ToolInput): Promise<string> {
  switch (name) {
    case 'bash_exec':        return await bashExec(input as BashExecInput);
    case 'read_file':        return readFile(input as ReadFileInput);
    case 'write_file':       return await writeFile(input as WriteFileInput);
    case 'remember':         return remember(input as RememberInput);
    case 'recall':           return recall(input as RecallInput);
    case 'list_directory':   return listDirectory(input as ListDirectoryInput);
    case 'search_files':     return searchFiles(input as SearchFilesInput);
    case 'web_fetch':        return await webFetch(input as WebFetchInput);
    case 'clipboard_read':   return clipboardRead(input as ClipboardReadInput);
    case 'clipboard_write':  return await clipboardWrite(input as ClipboardWriteInput);
    default:                 return `Unknown tool: ${name}`;
  }
}
