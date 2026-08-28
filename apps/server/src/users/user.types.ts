import { Permission } from '../auth/permission';

/** A household member as exposed to the application layer (no password hash). */
export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  permission: Permission;
  isAdmin: boolean;
  mustChangePassword: boolean;
  /** Their face-recognized identity ("this account IS this person"), if linked. */
  personId: string | null;
}

/** Admin edits to an existing member; every field optional. */
export interface UpdateUserInput {
  displayName?: string;
  permission?: Permission;
  isAdmin?: boolean;
  /** null unlinks; undefined leaves as-is. */
  personId?: string | null;
}

/** Input for creating a household member account. */
export interface CreateUserInput {
  email: string;
  displayName: string;
  password: string;
  permission: Permission;
  isAdmin: boolean;
}
