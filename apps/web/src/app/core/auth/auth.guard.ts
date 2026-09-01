import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthStateService } from './auth-state.service';

/** Gates the app routes: restores the session or redirects to setup/login. */
export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthStateService);
  const router = inject(Router);
  if (auth.user() !== null) {
    return true;
  }
  const destination = await auth.resolveEntry();
  if (destination === 'app') {
    return true;
  }
  // Carry where they were headed, so a shared link (e.g. /lookback?day=…) lands
  // there after sign-in instead of dumping them on the home page.
  if (destination === 'login' && state.url && state.url !== '/') {
    return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  }
  return router.createUrlTree([`/${destination}`]);
};
