import { parseDateFromFilename } from './filename-date';

describe('parseDateFromFilename', () => {
  it('parses IMG_date_time pattern', () => {
    const date = parseDateFromFilename('IMG_20250718_123456.jpg');
    expect(date).toEqual(new Date(2025, 6, 18, 12, 34, 56));
  });

  it('parses WhatsApp date-only pattern at noon', () => {
    const date = parseDateFromFilename('IMG-20250718-WA0001.jpg');
    expect(date).toEqual(new Date(2025, 6, 18, 12, 0, 0));
  });

  it('parses bare date_time video names', () => {
    const date = parseDateFromFilename('20241225_091500.mp4');
    expect(date).toEqual(new Date(2024, 11, 25, 9, 15, 0));
  });

  it('parses a camcorder capture stamp before the extension', () => {
    const date = parseDateFromFilename('christmas-12-25-95.22-07-24_19-52.00.avi');
    expect(date).toEqual(new Date(2022, 6, 24, 19, 52, 0));
  });

  it('uses the trailing stamp, not a date in the label', () => {
    const date = parseDateFromFilename('christmas-12-25-2000.00-12-25_07-07.00.avi');
    expect(date).toEqual(new Date(2000, 11, 25, 7, 7, 0));
  });

  it('parses a camcorder stamp with no leading date in the label', () => {
    const date = parseDateFromFilename('Ryan91-93.22-09-28_19-40.00.avi');
    expect(date).toEqual(new Date(2022, 8, 28, 19, 40, 0));
  });

  it('rejects impossible dates and times', () => {
    expect(parseDateFromFilename('IMG_20251345_123456.jpg')).toBeNull();
    expect(parseDateFromFilename('IMG_20250718_256161.jpg')).toBeNull();
  });

  it('returns null when no date is present', () => {
    expect(parseDateFromFilename('DSC01234.jpg')).toBeNull();
    expect(parseDateFromFilename('holiday.png')).toBeNull();
  });

  it('ignores digit runs that are not plausible dates', () => {
    expect(parseDateFromFilename('order-123456789012345.jpg')).toBeNull();
  });
});
