import { unfurlTags } from './unfurl-tags';
import { sharedFromFor, siteNameFor } from './library/public-name';

/**
 * The link-preview block. Bots do not run the app, so this HTML is the whole
 * of what a pasted link looks like in someone else's chat — and the site name
 * in it is free text an admin typed.
 */
describe('unfurlTags', () => {
  it('carries the household name as the site name', () => {
    const tags = unfurlTags('Acadia, 2021', sharedFromFor('The Bretschneiders'), null, siteNameFor('The Bretschneiders'));

    expect(tags).toContain('<meta property="og:site_name" content="The Bretschneiders">');
    expect(tags).toContain('<meta property="og:description" content="Shared from The Bretschneiders.">');
  });

  it('falls back to the product name when unnamed', () => {
    const tags = unfurlTags('Acadia, 2021', sharedFromFor(''), null, siteNameFor(''));

    expect(tags).toContain('<meta property="og:site_name" content="Recollect">');
    expect(tags).toContain('content="Shared from our family photo home."');
  });

  // The one that matters: a name is typed by a person and goes straight into
  // an HTML attribute. A stray quote must not be able to escape it.
  it('escapes a name that would otherwise break out of the attribute', () => {
    const nasty = 'The "Smiths" <script>alert(1)</script> & co';
    const tags = unfurlTags('Title', 'Description', null, nasty);

    expect(tags).toContain(
      'content="The &quot;Smiths&quot; &lt;script&gt;alert(1)&lt;/script&gt; &amp; co"',
    );
    expect(tags).not.toContain('<script>');
  });

  it('escapes the title and image url too', () => {
    const tags = unfurlTags('A "quoted" day', 'Description', 'https://x/y?a=1&b=2', 'Home');

    expect(tags).toContain('content="A &quot;quoted&quot; day"');
    expect(tags).toContain('content="https://x/y?a=1&amp;b=2"');
  });

  it('asks for a large card only when there is an image', () => {
    expect(unfurlTags('T', 'D', 'https://x/y.jpg', 'Home')).toContain(
      '<meta name="twitter:card" content="summary_large_image">',
    );
    expect(unfurlTags('T', 'D', null, 'Home')).toContain(
      '<meta name="twitter:card" content="summary">',
    );
  });
});
