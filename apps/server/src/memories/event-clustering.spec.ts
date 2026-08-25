import { ClusterInput, ClusteringConfig, detectClusters } from './event-clustering';

const config: ClusteringConfig = { maxGapHours: 3, maxJumpKm: 50, minClusterSize: 3 };

function shot(id: string, iso: string, gps?: [number, number]): ClusterInput {
  return {
    id,
    capturedAt: new Date(iso),
    gpsLat: gps?.[0] ?? null,
    gpsLon: gps?.[1] ?? null,
  };
}

describe('detectClusters', () => {
  it('groups a burst of photos within the time gap into one event', () => {
    const clusters = detectClusters(
      [
        shot('a', '2025-07-18T10:00:00Z'),
        shot('b', '2025-07-18T10:30:00Z'),
        shot('c', '2025-07-18T12:00:00Z'),
      ],
      config,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0].assetIds).toEqual(['a', 'b', 'c']);
    expect(clusters[0].signals.memberCount).toBe(3);
  });

  it('splits events separated by a large time gap', () => {
    const clusters = detectClusters(
      [
        shot('a', '2025-07-18T10:00:00Z'),
        shot('b', '2025-07-18T10:10:00Z'),
        shot('c', '2025-07-18T10:20:00Z'),
        shot('d', '2025-07-18T19:00:00Z'),
        shot('e', '2025-07-18T19:10:00Z'),
        shot('f', '2025-07-18T19:20:00Z'),
      ],
      config,
    );
    expect(clusters.map((cluster) => cluster.assetIds)).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', 'f'],
    ]);
  });

  it('splits on a large geographic jump even within the time gap', () => {
    const boston: [number, number] = [42.36, -71.06];
    const portland: [number, number] = [43.66, -70.26];
    const clusters = detectClusters(
      [
        shot('a', '2025-07-18T10:00:00Z', boston),
        shot('b', '2025-07-18T10:20:00Z', boston),
        shot('c', '2025-07-18T10:40:00Z', boston),
        shot('d', '2025-07-18T12:00:00Z', portland),
        shot('e', '2025-07-18T12:10:00Z', portland),
        shot('f', '2025-07-18T12:20:00Z', portland),
      ],
      config,
    );
    expect(clusters).toHaveLength(2);
  });

  it('ignores GPS when either side lacks coordinates', () => {
    const clusters = detectClusters(
      [
        shot('a', '2025-07-18T10:00:00Z', [42.36, -71.06]),
        shot('b', '2025-07-18T10:20:00Z'),
        shot('c', '2025-07-18T10:40:00Z', [48.85, 2.35]),
      ],
      config,
    );
    expect(clusters).toHaveLength(1);
  });

  it('drops groups smaller than the minimum size', () => {
    const clusters = detectClusters(
      [shot('a', '2025-07-18T10:00:00Z'), shot('b', '2025-07-19T10:00:00Z')],
      config,
    );
    expect(clusters).toHaveLength(0);
  });

  it('is deterministic: same input, same output', () => {
    const input = [
      shot('a', '2025-07-18T10:00:00Z'),
      shot('b', '2025-07-18T10:30:00Z'),
      shot('c', '2025-07-18T11:00:00Z'),
    ];
    expect(detectClusters(input, config)).toEqual(detectClusters(input, config));
  });

  it('scores larger clusters higher, capped at 1', () => {
    const small = detectClusters(
      ['a', 'b', 'c'].map((id, index) => shot(id, `2025-07-18T10:0${index}:00Z`)),
      config,
    );
    const large = detectClusters(
      Array.from({ length: 20 }, (_, index) =>
        shot(`x${index}`, `2025-07-18T10:${String(index).padStart(2, '0')}:00Z`),
      ),
      config,
    );
    expect(small[0].score).toBeLessThan(large[0].score);
    expect(large[0].score).toBe(1);
  });
});
