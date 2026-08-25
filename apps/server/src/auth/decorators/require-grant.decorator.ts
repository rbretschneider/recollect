import { SetMetadata } from '@nestjs/common';
import { Permission } from '../permission';

/** Metadata key holding the grant a route requires. */
export const REQUIRED_GRANT_KEY = 'requiredGrant';

/** Requires the caller to hold at least the given content grant (grants are cumulative). */
export const RequireGrant = (grant: Permission) => SetMetadata(REQUIRED_GRANT_KEY, grant);
