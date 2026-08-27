import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { AuthStateService } from './auth-state.service';

/**
 * A tab that slept past the 15-minute access token wakes to a wall of 401s.
 * This interceptor turns them into one silent refresh + retry, so tapping
 * anything after a suspend Just Works. Only a genuinely dead session (refresh
 * itself fails) lands on the login page.
 */
export const authRefreshInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthStateService);
  const router = inject(Router);
  return next(req).pipe(
    catchError((error) => {
      const isAuthRoute = req.url.includes('/auth/') || req.url.includes('/setup');
      if (error instanceof HttpErrorResponse && error.status === 401 && !isAuthRoute) {
        return from(auth.tryRefresh()).pipe(
          switchMap((alive) => {
            if (alive) {
              return next(req);
            }
            void router.navigateByUrl('/login');
            return throwError(() => error);
          }),
        );
      }
      return throwError(() => error);
    }),
  );
};
