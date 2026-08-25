/** Cumulative content grants: read ⊂ write ⊂ delete (FRD §7). */
export type Permission = 'read' | 'write' | 'delete';

const GRANT_RANK: Record<Permission, number> = { read: 0, write: 1, delete: 2 };

/** Whether a user's grant satisfies the required grant (grants are cumulative). */
export function hasGrant(userPermission: Permission, required: Permission): boolean {
  return GRANT_RANK[userPermission] >= GRANT_RANK[required];
}
