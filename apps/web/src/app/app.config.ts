import { ApplicationConfig, isDevMode, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { authRefreshInterceptor } from './core/auth/auth-refresh.interceptor';
import {
  provideRouter,
  withInMemoryScrolling,
  withPreloading,
  withViewTransitions,
} from '@angular/router';
import { IdlePreloadStrategy } from './core/idle-preload.strategy';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withViewTransitions(),
      // New views open at the top (drilling into a place/folder must not
      // inherit the list's scroll depth); back restores where you were.
      withInMemoryScrolling({ scrollPositionRestoration: 'enabled' }),
      // Route chunks fetch themselves once the first view has had its
      // bandwidth, so navigation costs no round trip on a slow link.
      withPreloading(IdlePreloadStrategy),
    ),
    provideHttpClient(withFetch(), withInterceptors([authRefreshInterceptor])),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
