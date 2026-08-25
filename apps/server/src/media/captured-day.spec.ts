import { toCapturedDay } from './captured-day';

describe('toCapturedDay', () => {
  it('uses the capture timezone to pick the local day', () => {
    // 02:30 UTC on Jul 19 was still Jul 18 evening in New York (UTC-4).
    const capturedAt = new Date('2025-07-19T02:30:00Z');
    expect(toCapturedDay(capturedAt, -240)).toBe('2025-07-18');
  });

  it('keeps the UTC day when no offset is known', () => {
    expect(toCapturedDay(new Date('2025-07-19T02:30:00Z'), null)).toBe('2025-07-19');
  });

  it('rolls forward across midnight for positive offsets', () => {
    // 23:30 UTC on Jul 18 was already Jul 19 in Tokyo (UTC+9).
    expect(toCapturedDay(new Date('2025-07-18T23:30:00Z'), 540)).toBe('2025-07-19');
  });
});
