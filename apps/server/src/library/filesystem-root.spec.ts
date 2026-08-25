import { isFilesystemRoot } from './filesystem-root';

describe('isFilesystemRoot', () => {
  it('rejects drive roots', () => {
    expect(isFilesystemRoot('C:/')).toBe(true);
    expect(isFilesystemRoot('C:\\')).toBe(true);
    expect(isFilesystemRoot('D:/')).toBe(true);
  });

  it('allows ordinary folders', () => {
    expect(isFilesystemRoot('C:/Photos')).toBe(false);
    expect(isFilesystemRoot('D:/nas/photos/2025')).toBe(false);
  });
});
