import { decodeTimelineCursor, encodeTimelineCursor } from './timeline-cursor';

describe('timeline cursor', () => {
  it('round-trips a cursor', () => {
    const cursor = {
      capturedAt: new Date('2025-07-18T12:34:56.000Z'),
      id: '0198c9a2-1111-7000-8000-000000000001',
    };
    expect(decodeTimelineCursor(encodeTimelineCursor(cursor))).toEqual(cursor);
  });

  it('returns null for garbage tokens', () => {
    expect(decodeTimelineCursor('not-base64url-!!!')).toBeNull();
    expect(decodeTimelineCursor(Buffer.from('no-separator').toString('base64url'))).toBeNull();
    expect(decodeTimelineCursor(Buffer.from('bad-date|some-id').toString('base64url'))).toBeNull();
    expect(decodeTimelineCursor(Buffer.from('2025-07-18T12:00:00Z|').toString('base64url'))).toBeNull();
  });
});
