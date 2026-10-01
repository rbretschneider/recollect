import { DestroyRef, effect, Signal } from '@angular/core';

/**
 * Minimal typings: Screen Wake Lock is not in this project's DOM lib yet.
 */
interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}
interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

function wakeLockApi(): WakeLockLike | null {
  const api = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  return api ?? null;
}

/**
 * Holds the screen awake while `shouldHold` is true.
 *
 * A slideshow is the one place in this app where you are watching rather than
 * touching, so the phone's idle timer is measuring the wrong thing: it sees no
 * input and assumes you have gone, in the middle of exactly the moment the app
 * exists for.
 *
 * Everything here fails silently and off the critical path, per the prime
 * directive — the photos never wait on it, and a refused lock (battery saver,
 * low battery, an older browser) just means the screen behaves as it always
 * did. There is nothing a viewer could do about it, so there is nothing worth
 * telling them.
 */
export function holdScreenAwake(
  shouldHold: Signal<boolean>,
  destroyRef: DestroyRef,
): void {
  const api = wakeLockApi();
  if (!api) {
    return; // Chrome before 84, Safari before 16.4, or a non-secure origin.
  }

  let sentinel: WakeLockSentinelLike | null = null;
  /** Guards against overlapping requests while one is still in flight. */
  let requesting = false;

  const acquire = async (): Promise<void> => {
    if (requesting || sentinel || document.visibilityState !== 'visible') {
      return;
    }
    requesting = true;
    try {
      const next = await api.request('screen');
      // Dropped out of the state that wanted it while we were asking.
      if (!shouldHold()) {
        void next.release().catch(() => undefined);
        return;
      }
      sentinel = next;
      // The browser releases it on its own terms too; forget it when it does.
      next.addEventListener('release', () => {
        if (sentinel === next) {
          sentinel = null;
        }
      });
    } catch {
      // Refused — battery saver, low battery, or no permission. Never mind.
    } finally {
      requesting = false;
    }
  };

  const release = (): void => {
    const held = sentinel;
    sentinel = null;
    void held?.release().catch(() => undefined);
  };

  effect(() => {
    if (shouldHold()) {
      void acquire();
    } else {
      release();
    }
  });

  /**
   * A lock is dropped whenever the page is hidden — switching apps, a call,
   * locking the phone — and does NOT come back by itself. Without this, a
   * slideshow would hold the screen until the first interruption and then
   * quietly stop, which is worse than never holding it at all.
   */
  const onVisibility = (): void => {
    if (document.visibilityState === 'visible' && shouldHold()) {
      void acquire();
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  destroyRef.onDestroy(() => {
    document.removeEventListener('visibilitychange', onVisibility);
    release();
  });
}
