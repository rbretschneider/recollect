import { copyFile, mkdir, rm, stat } from 'fs/promises';
import { join } from 'path';

/**
 * Rewrites a library file in place without ever handing the library file to a
 * tool that unlinks or renames it.
 *
 * The naive way - exiftool's `-overwrite_original` straight onto the file -
 * writes a sidecar and renames it over the original. On the CIFS library mount
 * that rename fails and the original does not survive it: a photo was lost to
 * exactly this. Testing on /tmp proves nothing, because /tmp is local ext4 and
 * the rename semantics are what differ.
 *
 * So the library file is only ever *read* and *truncated-and-written*, and the
 * original bytes sit on local disk before it is touched:
 *
 *   1. copy the original to local staging - the rollback copy
 *   2. copy that again and let `rewrite` change the copy, on local disk
 *   3. `verify` the rewritten copy
 *   4. copyFile it over the library file (O_TRUNC: never unlink, never rename)
 *   5. `verify` what landed, and put the rollback copy back if it fails
 *
 * At no point is there a window with neither a good original nor a verified
 * replacement on disk. `verify` must throw on anything short of a fully usable
 * file carrying the change - a size check alone would pass a truncated JPEG.
 */
export async function rewriteLibraryFileSafely(
  livePath: string,
  stageDir: string,
  key: string,
  ops: {
    rewrite: (workingPath: string) => Promise<unknown>;
    verify: (path: string) => Promise<void>;
  },
  log: { warn: (message: string) => void; error: (message: string) => void },
): Promise<void> {
  const originalSize = (await stat(livePath)).size;
  await mkdir(stageDir, { recursive: true });
  const rollbackPath = join(stageDir, `${key}.original`);
  const workingPath = join(stageDir, `${key}.working`);
  try {
    await copyFile(livePath, rollbackPath);
    if ((await stat(rollbackPath)).size !== originalSize) {
      throw new Error('could not take a complete rollback copy; library file untouched');
    }
    await copyFile(rollbackPath, workingPath);
    await ops.rewrite(workingPath);
    await ops.verify(workingPath);
    await copyFile(workingPath, livePath);
    try {
      await ops.verify(livePath);
    } catch (error) {
      await copyFile(rollbackPath, livePath);
      log.error(`Rewrite of ${livePath} failed verification after landing; original restored: ${(error as Error).message}`);
      throw error;
    }
  } catch (error) {
    // Whatever failed, make sure the library file is whole. Restoring a
    // byte-identical copy over a good file is harmless.
    try {
      const live = await stat(livePath).catch(() => null);
      if (!live || live.size !== originalSize) {
        await copyFile(rollbackPath, livePath);
        log.warn(`Restored the original for ${livePath} after a failed rewrite.`);
      }
    } catch (restoreError) {
      log.error(
        `COULD NOT RESTORE ${livePath} - the rollback copy is at ${rollbackPath}: ${(restoreError as Error).message}`,
      );
    }
    await cleanup(rollbackPath, workingPath);
    throw error;
  }
  await cleanup(rollbackPath, workingPath);
}

async function cleanup(...paths: string[]): Promise<void> {
  await Promise.all(paths.map((path) => rm(path, { force: true }).catch(() => undefined)));
}
