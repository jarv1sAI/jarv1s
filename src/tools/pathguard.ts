/**
 * Path guard — enforces allowed_paths config for all file system tools.
 * Prevents path traversal and unauthorized access outside configured directories.
 */

import { resolve } from 'path';
import { homedir } from 'os';

/**
 * Expand ~ to the actual home directory and resolve to an absolute path.
 */
export function expandPath(p: string): string {
  return resolve(p.startsWith('~') ? p.replace('~', homedir()) : p);
}

/**
 * Returns an error string if `requestedPath` is outside every allowed directory,
 * or null if access is permitted.
 *
 * @param requestedPath  The path the tool wants to access (may be relative or ~-prefixed)
 * @param allowedPaths   The configured allowed_paths array (may be undefined)
 * @param cwd            The process working directory (injected for testability)
 */
export function checkPathAllowed(
  requestedPath: string,
  allowedPaths: string[] | undefined,
  cwd = process.cwd(),
): string | null {
  const resolved = expandPath(requestedPath);

  const roots: string[] =
    allowedPaths && allowedPaths.length > 0
      ? allowedPaths.map(expandPath)
      : [cwd, homedir()];

  const allowed = roots.some((root) => {
    const resolvedRoot = expandPath(root);
    // Ensure root ends with separator to avoid /home/user matching /home/username
    const rootWithSep = resolvedRoot.endsWith('/') ? resolvedRoot : resolvedRoot + '/';
    return resolved === resolvedRoot || resolved.startsWith(rootWithSep);
  });

  if (!allowed) {
    return `Error: Path "${requestedPath}" is outside your allowed directories. Configure allowed_paths in jarvis.yaml to grant access.`;
  }

  return null;
}
