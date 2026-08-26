import { parseDateQuery } from './date-query';

describe('parseDateQuery', () => {
  it('parses month + year', () => {
    const range = parseDateQuery('july 2025');
    expect(range?.label).toBe('July 2025');
    expect(range?.from).toEqual(new Date(2025, 6, 1));
    expect(range?.to).toEqual(new Date(2025, 7, 1));
  });

  it('parses abbreviated months', () => {
    expect(parseDateQuery('aug 2024')?.label).toBe('August 2024');
    expect(parseDateQuery('Sept 2023')?.label).toBe('September 2023');
  });

  it('parses a bare year', () => {
    const range = parseDateQuery('2023');
    expect(range?.label).toBe('2023');
    expect(range?.from).toEqual(new Date(2023, 0, 1));
    expect(range?.to).toEqual(new Date(2024, 0, 1));
  });

  it('rejects non-dates and ambiguity', () => {
    expect(parseDateQuery('maine')).toBeNull();
    expect(parseDateQuery('july')).toBeNull();
    expect(parseDateQuery('birthday 2025 party')).toBeNull();
    expect(parseDateQuery('3025')).toBeNull();
  });
});
