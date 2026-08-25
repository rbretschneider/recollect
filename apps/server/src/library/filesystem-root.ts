import { parse, resolve } from 'path';

/**
 * Whether a path is a filesystem root (`C:\`, `/`, `\\nas\share`). Indexing an
 * entire drive is always a mistake — it sweeps system files, app data, and
 * temp directories into the library.
 */
export function isFilesystemRoot(path: string): boolean {
  const resolved = resolve(path);
  const parsed = parse(resolved);
  return parsed.root === resolved;
}
