import { SetMetadata } from '@nestjs/common';

/** Metadata key marking a route as admin-only. */
export const REQUIRES_ADMIN_KEY = 'requiresAdmin';

/** Requires the caller to have the admin flag (system management, orthogonal to grants). */
export const RequireAdmin = () => SetMetadata(REQUIRES_ADMIN_KEY, true);
