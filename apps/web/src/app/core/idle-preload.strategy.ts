import { Injectable } from '@angular/core';
import { PreloadingStrategy, Route } from '@angular/router';
import { EMPTY, Observable, of, timer } from 'rxjs';
import { switchMap } from 'rxjs/operators';

/** Wait this long after the page settles before spending bandwidth on guesses. */
const FIRST_PRELOAD_DELAY_MS = 4000;
/** Space each route out so a burst never competes with a screenful of photos. */
const STAGGER_MS = 700;

interface NetworkInformation {
  effectiveType?: string;
  saveData?: boolean;
}

/** What the browser will admit about the connection, where it admits anything. */
function connection(): NetworkInformation | undefined {
  return (navigator as Navigator & { connection?: NetworkInformation }).connection;
}

/**
 * Loads route chunks during idle time instead of at first paint or on tap.
 *
 * Loading everything up front would bloat the one download that stands between
 * the user and their photos; loading nothing means every navigation pays a
 * round trip first, which on a slow link is the difference between a tap that
 * responds and one that appears to have missed. So: nothing until the initial
 * view has had its bandwidth, then one small chunk at a time.
 *
 * Two refusals. `saveData` is an explicit request not to speculate, and 2G is
 * slow enough that a speculative chunk would measurably delay a real one. On
 * anything faster the chunks are a few kB each and buy instant navigation.
 */
@Injectable({ providedIn: 'root' })
export class IdlePreloadStrategy implements PreloadingStrategy {
  private queued = 0;

  preload(route: Route, load: () => Observable<unknown>): Observable<unknown> {
    const link = connection();
    if (link?.saveData === true) {
      return EMPTY;
    }
    if (link?.effectiveType === 'slow-2g' || link?.effectiveType === '2g') {
      return EMPTY;
    }
    // Routes are handed over all at once, so each takes the next slot rather
    // than every one firing after the same delay.
    const slot = this.queued++;
    const delay = FIRST_PRELOAD_DELAY_MS + slot * STAGGER_MS;
    return timer(delay).pipe(
      switchMap(() => whenIdle()),
      switchMap(() => load()),
    );
  }
}

/** Resolves on the first idle moment, or straight away where that is unsupported. */
function whenIdle(): Observable<unknown> {
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback;
  if (typeof idle !== 'function') {
    return of(null);
  }
  return new Observable((subscriber) => {
    idle.call(window, () => {
      subscriber.next(null);
      subscriber.complete();
    });
  });
}
