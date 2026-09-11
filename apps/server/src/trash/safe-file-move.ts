import { constants } from 'fs';
import { access, copyFile, mkdir, rename, stat, unlink } from 'fs/promises';
import { dirname } from 'path';

/**
 * Moves a file, creating the destination directory and falling back to
 * copy+delete when rename crosses filesystems. Never overwrites: an occupied
 * destination gets a numbered suffix. Returns the actual destination path.
 */
export async function safeMoveFile(sourcePath: string, destinationPath: string): Promise<string> {
  await mkdir(dirname(destinationPath), { recursive: true });
  const finalPath = await firstFreePath(destinationPath);
  try {
    await rename(sourcePath, finalPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
      throw error;
    }
    await copyFile(sourcePath, finalPath, constants.COPYFILE_EXCL);
    // The source is the only copy until this proves the destination is whole.
    // A full disk or a dropped mount leaves a short file, and deleting the
    // source on the strength of an unverified copy is how a move becomes a
    // loss - this is the path a restored original travels.
    const [from, to] = await Promise.all([stat(sourcePath), stat(finalPath)]);
    if (to.size !== from.size) {
      await unlink(finalPath).catch(() => undefined);
      throw new Error(
        `Move ${sourcePath} -> ${finalPath}: copy is ${to.size} bytes, expected ${from.size}; source left in place.`,
      );
    }
    await unlink(sourcePath);
  }
  return finalPath;
}

async function firstFreePath(desiredPath: string): Promise<string> {
  if (!(await exists(desiredPath))) {
    return desiredPath;
  }
  const dotIndex = desiredPath.lastIndexOf('.');
  const base = dotIndex > 0 ? desiredPath.slice(0, dotIndex) : desiredPath;
  const extension = dotIndex > 0 ? desiredPath.slice(dotIndex) : '';
  for (let suffix = 1; ; suffix++) {
    const candidate = `${base} (${suffix})${extension}`;
    if (!(await exists(candidate))) {
      return candidate;
    }
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
