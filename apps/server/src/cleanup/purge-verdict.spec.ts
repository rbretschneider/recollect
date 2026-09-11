import { purgeVerdict, PurgeEvidence } from './purge-verdict';

// The purge deleted a 14 GB family tape on 2026-09-11 because age was the only
// test. Every condition below is a way the replacement can be untrustworthy;
// each one on its own must be enough to keep the original.
const manifest = {
  assetId: 'asset-1',
  rootId: 'root-1',
  originalRelPath: 'Dumps/tape.avi',
  originalSizeBytes: 14_300_000_000,
  originalMtime: '2026-08-30T22:21:00.000Z',
  originalHash: 'abc',
  convertedRelPath: 'Dumps/tape.mp4',
  convertedSizeBytes: 132_644_908,
  parkedAt: '2026-08-30T22:21:00.000Z',
};

function good(): PurgeEvidence {
  return {
    manifest,
    rootExists: true,
    convertedSizeOnDisk: manifest.convertedSizeBytes,
    owner: { assetId: 'asset-1', status: 'active', playbackError: null, indexedSizeBytes: manifest.convertedSizeBytes },
    recentFailedRestores: 0,
  };
}

describe('purgeVerdict', () => {
  it('allows the purge only when the replacement checks out on every count', () => {
    expect(purgeVerdict(good())).toBeNull();
  });

  it('keeps the original when its library root is gone', () => {
    expect(purgeVerdict({ ...good(), rootExists: false })).toMatch(/root is gone/);
  });

  it('keeps the original when the converted file is missing', () => {
    expect(purgeVerdict({ ...good(), convertedSizeOnDisk: null })).toMatch(/missing from the library/);
  });

  it('keeps the original when the converted file is not the size the conversion produced', () => {
    expect(purgeVerdict({ ...good(), convertedSizeOnDisk: 12 })).toMatch(/12 bytes, but the conversion produced 132644908/);
  });

  it('allows a file the library re-verified after a metadata rewrite grew it', () => {
    // Four tapes were held on exactly this: the confirmed date was written
    // into the mp4 afterwards (+3,262 bytes), the library re-verified the new
    // size, and the gate compared only against the conversion's number.
    const evidence = good();
    evidence.convertedSizeOnDisk = manifest.convertedSizeBytes + 3262;
    evidence.owner = { ...evidence.owner!, indexedSizeBytes: manifest.convertedSizeBytes + 3262 };
    expect(purgeVerdict(evidence)).toBeNull();
  });

  it('still keeps the original when the size matches neither the conversion nor the index', () => {
    const evidence = good();
    evidence.convertedSizeOnDisk = manifest.convertedSizeBytes + 3262;
    // index never re-verified: a change the library does not know about
    expect(purgeVerdict(evidence)).toMatch(/but the conversion produced .* and the library last saw/);
  });

  it('keeps the original when the converted file was never indexed', () => {
    expect(purgeVerdict({ ...good(), owner: null })).toMatch(/not been indexed/);
  });

  it('keeps the original when a scan re-indexed the converted file as a different asset', () => {
    // The exact failure of 2026-09-11: the hash was stale, ingest made a new
    // asset for the mp4, and the parked original's asset went "missing".
    const evidence = good();
    evidence.owner = { assetId: 'asset-2', status: 'active', playbackError: null, indexedSizeBytes: manifest.convertedSizeBytes };
    expect(purgeVerdict(evidence)).toMatch(/different asset/);
  });

  it('keeps the original when its asset is not active', () => {
    for (const status of ['missing', 'trashed']) {
      const evidence = good();
      evidence.owner = { assetId: 'asset-1', status, playbackError: null, indexedSizeBytes: manifest.convertedSizeBytes };
      expect(purgeVerdict(evidence)).toBe(`its asset is ${status}`);
    }
  });

  it('keeps the original when the converted video is flagged as damaged', () => {
    const evidence = good();
    evidence.owner = { assetId: 'asset-1', status: 'active', playbackError: 'moov atom not found', indexedSizeBytes: manifest.convertedSizeBytes };
    expect(purgeVerdict(evidence)).toMatch(/flagged as damaged/);
  });

  it('keeps the original when a restore of it recently failed', () => {
    expect(purgeVerdict({ ...good(), recentFailedRestores: 1 })).toMatch(/restore of it failed/);
  });

  it('reports the first failing reason when several apply', () => {
    // A missing file is checked before ownership: the message should point at
    // the thing a person can act on first.
    const evidence = good();
    evidence.convertedSizeOnDisk = null;
    evidence.owner = null;
    expect(purgeVerdict(evidence)).toMatch(/missing from the library/);
  });
});
