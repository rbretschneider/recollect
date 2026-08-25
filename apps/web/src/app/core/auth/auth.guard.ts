import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStateService } from './auth-state.service';

/** Gates the app routes: restores the session or redirects to setup/login. */
export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthStateService);
  const router = inject(Router);
  if (auth.user() !== null) {
    return true;
  }
  const destination = await auth.resolveEntry();
  if (destination === 'app') {
    return true;
  }
  return router.createUrlTree([`/${destination}`]);
};
