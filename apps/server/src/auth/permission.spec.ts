import { hasGrant } from './permission';

describe('hasGrant', () => {
  it('grants are cumulative: delete satisfies everything', () => {
    expect(hasGrant('delete', 'read')).toBe(true);
    expect(hasGrant('delete', 'write')).toBe(true);
    expect(hasGrant('delete', 'delete')).toBe(true);
  });

  it('write satisfies read and write but not delete', () => {
    expect(hasGrant('write', 'read')).toBe(true);
    expect(hasGrant('write', 'write')).toBe(true);
    expect(hasGrant('write', 'delete')).toBe(false);
  });

  it('read satisfies only read', () => {
    expect(hasGrant('read', 'read')).toBe(true);
    expect(hasGrant('read', 'write')).toBe(false);
    expect(hasGrant('read', 'delete')).toBe(false);
  });
});
