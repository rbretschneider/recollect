import { classifyScannedFile, isExcludedDirectory } from './scan-classifier';

describe('classifyScannedFile', () => {
  const observed = { sizeBytes: 1000, fsMtimeMs: 5000 };

  it('classifies unknown paths as new', () => {
    expect(classifyScannedFile(undefined, observed)).toBe('new');
  });

  it('classifies matching size and mtime as unchanged', () => {
    expect(classifyScannedFile({ sizeBytes: 1000, fsMtimeMs: 5000 }, observed)).toBe('unchanged');
  });

  it('classifies a size difference as changed', () => {
    expect(classifyScannedFile({ sizeBytes: 999, fsMtimeMs: 5000 }, observed)).toBe('changed');
  });

  it('classifies an mtime difference as changed', () => {
    expect(classifyScannedFile({ sizeBytes: 1000, fsMtimeMs: 4000 }, observed)).toBe('changed');
  });
});

describe('isExcludedDirectory', () => {
  it('always excludes dot-directories and NAS system folders', () => {
    expect(isExcludedDirectory('.thumbnails', [])).toBe(true);
    expect(isExcludedDirectory('@eaDir', [])).toBe(true);
    expect(isExcludedDirectory('#recycle', [])).toBe(true);
    expect(isExcludedDirectory('.recollect-trash', [])).toBe(true);
  });

  it('excludes user-configured names', () => {
    expect(isExcludedDirectory('RAW', ['RAW'])).toBe(true);
  });

  it('allows ordinary directories', () => {
    expect(isExcludedDirectory('2025', [])).toBe(false);
    expect(isExcludedDirectory('Vacation Photos', [])).toBe(false);
  });
});
