import { BadRequestException } from '@nestjs/common';
import { normalizeCaptionText } from './asset-captions.service';

describe('caption text', () => {
  it('trims edges, preserving Unicode and internal whitespace', () => {
    expect(normalizeCaptionText(' \n Hello  🌻\nworld \t')).toBe('Hello  🌻\nworld');
  });
  it('counts Unicode code points rather than UTF-16 units', () => {
    expect(normalizeCaptionText('🌻'.repeat(500))).toBe('🌻'.repeat(500));
    expect(() => normalizeCaptionText('🌻'.repeat(501))).toThrow(BadRequestException);
  });
  it.each(['', ' \n\t', 'x'.repeat(501), 'a\0b', null, 123])('rejects invalid input %p', (value) => {
    expect(() => normalizeCaptionText(value)).toThrow(BadRequestException);
  });
});
