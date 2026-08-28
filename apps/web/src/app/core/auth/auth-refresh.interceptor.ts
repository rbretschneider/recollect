import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, retry, switchMap, throwError, timeout, timer } from 'rxjs';
import { AuthStateService } from './auth-state.service';

/** A JSON API call slower than this is dead, not slow — fail it so retry can run. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * The resilience layer every request passes through, aimed at tabs waking
 * from suspend:
 * - JSON API calls time out at 20s instead of hanging forever on a socket
 *   the network quietly killed.
 * - GETs that die transiently (status 0 resets, timeouts) retry once after a
 *   beat — the reused-dead-socket and mid-network-switch cases.
 * - 401s trigger one silent session refresh + retry (shared across
 *   concurrent 401s); only a dead session routes to login.
 */
export const authRefreshInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthStateService);
  const router = inject(Router);
  const isTimeoutExempt =
    req.url.includes('/download') || req.url.includes('/original') || req.url.includes('/upload');
  return next(req).pipe(
    isTimeoutExempt ? (source) => source : timeout(REQUEST_TIMEOUT_MS),
    retry({
      count: 1,
      delay: (error) => {
        const isTransient =
          req.method === 'GET' &&
          ((error instanceof HttpErrorResponse && error.status === 0) ||
            (error as Error)?.name === 'TimeoutError');
        if (!isTransient) {
          throw error;
        }
        return timer(400);
      },
    }),
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
