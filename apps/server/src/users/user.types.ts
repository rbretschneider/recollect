import { Permission } from '../auth/permission';

/** A household member as exposed to the application layer (no password hash). */
export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  permission: Permission;
  isAdmin: boolean;
  mustChangePassword: boolean;
}

/** Input for creating a household member account. */
export interface CreateUserInput {
  email: string;
  displayName: string;
  password: string;
  permission: Permission;
  isAdmin: boolean;
}
