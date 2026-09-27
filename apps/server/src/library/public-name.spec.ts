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
      expect(normalizePublicName('  The   Smiths  ')).toBe('The Smiths');
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
      expect(siteNameFor('The Smiths')).toBe('The Smiths');
      expect(sharedFromFor('The Smiths')).toBe('Shared from The Smiths, a Recollect photo library.');
      expect(sharedWithFor('The Smiths')).toBe('Shared from The Smiths, a Recollect photo library');
    });

    // No possessive: guessing between Smith's and Smiths' for an arbitrary
    // family name is a good way to get somebody's own name wrong.
    it('does not try to make a possessive out of the name', () => {
      expect(sharedWithFor('The Smiths')).not.toContain("Smiths'");
      expect(sharedWithFor('The Smiths')).not.toContain("Smith's");
    });

    // A server that has never been named must not render blanks at someone.
    it('falls back to the product wording when unset', () => {
      expect(siteNameFor('')).toBe(DEFAULT_SITE_NAME);
      expect(sharedFromFor('')).toBe(DEFAULT_SHARED_FROM);
      expect(sharedWithFor('')).toBe(`Shared with ${DEFAULT_SITE_NAME}`);
    });
  });
});
