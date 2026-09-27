import {
  DEFAULT_SHARED_FROM,
  DEFAULT_SITE_NAME,
  normalizePublicName,
  PUBLIC_NAME_MAX,
  sharedFromFor,
  sharedWithFor,
  siteNameFor,
} from './public-name';

/**
 * What an outsider reads when a link is shared. Every one of these strings
 * leaves the server and lands in someone else's messages, so an unset name
 * must still read like something a person wrote.
 */
describe('public name', () => {
  describe('normalizing', () => {
    it('trims and collapses whitespace', () => {
      expect(normalizePublicName('  The   Bretschneiders  ')).toBe('The Bretschneiders');
    });

    it('treats whitespace-only as unset', () => {
      expect(normalizePublicName('   ')).toBe('');
      expect(normalizePublicName('\n\t')).toBe('');
    });

    it('caps a name that would blow out a link preview', () => {
      const long = 'a'.repeat(PUBLIC_NAME_MAX + 40);
      expect(normalizePublicName(long)).toHaveLength(PUBLIC_NAME_MAX);
    });

    it('keeps the punctuation a family name might carry', () => {
      expect(normalizePublicName("The O'Briens & co.")).toBe("The O'Briens & co.");
    });
  });

  describe('the wording', () => {
    it('names the household everywhere once it is set', () => {
      expect(siteNameFor('The Bretschneiders')).toBe('The Bretschneiders');
      expect(sharedFromFor('The Bretschneiders')).toBe('Shared from The Bretschneiders.');
      expect(sharedWithFor('The Bretschneiders')).toBe('Shared from The Bretschneiders');
    });

    // A server that has never been named must not render blanks at someone.
    it('falls back to the product wording when unset', () => {
      expect(siteNameFor('')).toBe(DEFAULT_SITE_NAME);
      expect(sharedFromFor('')).toBe(DEFAULT_SHARED_FROM);
      expect(sharedWithFor('')).toBe(`Shared with ${DEFAULT_SITE_NAME}`);
    });
  });
});
