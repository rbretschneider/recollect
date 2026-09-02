import { isBackupFileName } from './backup.service';

describe('isBackupFileName', () => {
  /**
   * Regression: the first version used a character class without `Z`, so it
   * rejected every name this service actually writes — toISOString() ends in
   * `Z` — and Restore/Download/Delete all failed with "Not a backup file."
   */
  it('accepts the names the backup service generates', () => {
    const stamp = new Date('2026-09-02T02:52:59.643Z').toISOString().replace(/[:.]/g, '-');
    expect(stamp).toBe('2026-09-02T02-52-59-643Z');
    expect(isBackupFileName(`recollect-${stamp}.dump`)).toBe(true);
    expect(isBackupFileName(`recollect-${stamp}.json`)).toBe(true);
  });

  it('rejects path traversal and separators', () => {
    expect(isBackupFileName('../recollect-2026.dump')).toBe(false);
    expect(isBackupFileName('recollect-../../etc/passwd.dump')).toBe(false);
    expect(isBackupFileName('sub/recollect-2026.dump')).toBe(false);
    expect(isBackupFileName('sub\\recollect-2026.dump')).toBe(false);
  });

  it('rejects anything that is not one of our backups', () => {
    expect(isBackupFileName('recollect-2026-09-02T02-52-59-643Z.tar')).toBe(false);
    expect(isBackupFileName('other-2026-09-02.dump')).toBe(false);
    expect(isBackupFileName('recollect-.dump')).toBe(false);
    expect(isBackupFileName('')).toBe(false);
  });
});
