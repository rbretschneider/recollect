import { isFilesystemRoot } from './filesystem-root';

const isWindows = process.platform === 'win32';

describe('isFilesystemRoot', () => {
  (isWindows ? it : it.skip)('rejects drive roots (Windows)', () => {
    expect(isFilesystemRoot('C:/')).toBe(true);
    expect(isFilesystemRoot('C:\\')).toBe(true);
    expect(isFilesystemRoot('D:/')).toBe(true);
  });

  (isWindows ? it.skip : it)('rejects the filesystem root (POSIX)', () => {
    expect(isFilesystemRoot('/')).toBe(true);
  });

  it('allows ordinary folders', () => {
    if (isWindows) {
      expect(isFilesystemRoot('C:/Photos')).toBe(false);
      expect(isFilesystemRoot('D:/nas/photos/2025')).toBe(false);
    } else {
      expect(isFilesystemRoot('/library')).toBe(false);
      expect(isFilesystemRoot('/library/photos/2025')).toBe(false);
    }
  });
});
