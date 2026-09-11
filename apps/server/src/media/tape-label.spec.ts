import { parseTapeLabel } from './tape-label';

// Real names from the library, as written on the cassettes and captured by
// WinDV. The stamp after the label is the 2022 digitisation date and must
// never be mistaken for when the footage was shot.
describe('parseTapeLabel', () => {
  it('reads a four-digit year and knows Christmas is the 25th', () => {
    expect(parseTapeLabel('christmas-2007.22-08-19_21-27.00.avi')).toEqual({
      label: 'christmas-2007', title: 'Christmas 2007', date: '2007-12-25', precision: 'day', yearEnd: null,
    });
  });

  it('reads a year glued straight onto the word', () => {
    expect(parseTapeLabel('christmas1999.22-07-26_22-47.00.avi')).toMatchObject({
      title: 'Christmas 1999', date: '1999-12-25', precision: 'day',
    });
  });

  it('reads a two-digit year range, dating from the first year', () => {
    expect(parseTapeLabel('christmas-95-96.22-08-11_10-57.00.avi')).toEqual({
      label: 'christmas-95-96', title: 'Christmas 1995–96', date: '1995-12-25', precision: 'day', yearEnd: 1996,
    });
  });

  it('takes an explicit month-day-year in the label as an exact date', () => {
    expect(parseTapeLabel('christmas-12-25-95.22-07-24_19-52.00.avi')).toMatchObject({
      title: 'Christmas 1995', date: '1995-12-25', precision: 'day',
    });
  });

  it('gives only the year when the label has no holiday to pin a day on', () => {
    expect(parseTapeLabel('Ryan91-93.22-09-28_19-40.00.avi')).toEqual({
      label: 'Ryan91-93', title: 'Ryan 1991–93', date: '1991-01-01', precision: 'year', yearEnd: 1993,
    });
  });

  it('returns a title but no date when the label has no year', () => {
    expect(parseTapeLabel('Germany.22-08-22_22-26.00.avi')).toEqual({
      label: 'Germany', title: 'Germany', date: null, precision: null, yearEnd: null,
    });
  });

  it('never reads the capture stamp as the date', () => {
    // A label that is itself a plain word: the only digits are the stamp.
    const guess = parseTapeLabel('ski.22-09-30_18-33.00.avi');
    expect(guess?.date).toBeNull();
    expect(guess?.title).toBe('Ski');
  });

  it('pivots two-digit years at 30', () => {
    expect(parseTapeLabel('party07.22-01-01_00-00.00.avi')?.date).toBe('2007-01-01');
    expect(parseTapeLabel('party31.22-01-01_00-00.00.avi')?.date).toBe('1931-01-01');
  });

  it('ignores names that are not digitised-tape captures', () => {
    expect(parseTapeLabel('PXL_20240530_140356531.jpg')).toBeNull();
    expect(parseTapeLabel('IMG_1234.MOV')).toBeNull();
  });
});
