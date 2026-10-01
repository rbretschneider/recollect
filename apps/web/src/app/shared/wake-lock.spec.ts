import { Component, signal } from '@angular/core';
import { DestroyRef, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { holdScreenAwake } from './wake-lock';

/**
 * A slideshow is the one place you watch rather than touch, so the phone's
 * idle timer is measuring the wrong thing. These pin the parts that are easy
 * to get subtly wrong — above all re-acquiring after the page comes back,
 * since a lock is dropped on every interruption and never returns by itself.
 */

/** A stand-in for the browser's wake lock, recording what was asked of it. */
function fakeWakeLock() {
  const sentinels: Array<{ released: boolean; listeners: Array<() => void> }> = [];
  let refuse = false;
  const api = {
    requests: 0,
    request: (type: 'screen') => {
      api.requests++;
      expect(type).toBe('screen');
      if (refuse) {
        return Promise.reject(new Error('battery saver'));
      }
      const sentinel = {
        released: false,
        listeners: [] as Array<() => void>,
        release() {
          sentinel.released = true;
          return Promise.resolve();
        },
        addEventListener(_t: 'release', listener: () => void) {
          sentinel.listeners.push(listener);
        },
      };
      sentinels.push(sentinel);
      return Promise.resolve(sentinel);
    },
  };
  return {
    api,
    sentinels,
    refuseNext: () => (refuse = true),
    allow: () => (refuse = false),
    held: () => sentinels.filter((s) => !s.released).length,
  };
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
}

@Component({ selector: 'app-holder', template: '' })
class Holder {
  readonly playing = signal(false);
  constructor() {
    holdScreenAwake(this.playing, inject(DestroyRef));
  }
}

describe('holdScreenAwake', () => {
  let lock: ReturnType<typeof fakeWakeLock>;

  beforeEach(() => {
    lock = fakeWakeLock();
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: lock.api });
    setVisibility('visible');
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
  });

  function mount() {
    const fixture = TestBed.createComponent(Holder);
    fixture.detectChanges();
    return fixture;
  }

  it('takes the lock when the show starts, and lets it go when it stops', async () => {
    const fixture = mount();
    expect(lock.api.requests).toBe(0);

    fixture.componentInstance.playing.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(lock.held()).toBe(1);

    fixture.componentInstance.playing.set(false);
    fixture.detectChanges();
    expect(lock.held()).toBe(0);
  });

  // THE ONE THAT MATTERS: a lock dies whenever the page is hidden and does not
  // return on its own, so the second half of a show would quietly stop holding.
  it('takes it again after the page comes back', async () => {
    const fixture = mount();
    fixture.componentInstance.playing.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    // The browser drops it as the page hides.
    lock.sentinels[0].released = true;
    lock.sentinels[0].listeners.forEach((listener) => listener());
    setVisibility('hidden');
    setVisibility('visible');
    await fixture.whenStable();

    expect(lock.held()).toBe(1);
  });

  it('does not ask again while hidden', async () => {
    const fixture = mount();
    setVisibility('hidden');
    fixture.componentInstance.playing.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(lock.api.requests).toBe(0);
  });

  it('does not re-acquire for a show that has since stopped', async () => {
    const fixture = mount();
    fixture.componentInstance.playing.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.playing.set(false);
    fixture.detectChanges();
    const before = lock.api.requests;

    setVisibility('hidden');
    setVisibility('visible');
    await fixture.whenStable();

    expect(lock.api.requests).toBe(before);
    expect(lock.held()).toBe(0);
  });

  // Battery saver refuses. A photo slideshow is not worth a complaint.
  it('shrugs off a refusal', async () => {
    lock.refuseNext();
    const fixture = mount();
    fixture.componentInstance.playing.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(lock.held()).toBe(0);

    // And recovers if a later attempt is allowed.
    lock.allow();
    setVisibility('hidden');
    setVisibility('visible');
    await fixture.whenStable();
    expect(lock.held()).toBe(1);
  });

  it('lets go when the slideshow is destroyed', async () => {
    const fixture = mount();
    fixture.componentInstance.playing.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(lock.held()).toBe(1);

    fixture.destroy();
    expect(lock.held()).toBe(0);
  });

  it('does nothing at all where the API is missing', async () => {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: undefined });
    const fixture = mount();

    expect(() => {
      fixture.componentInstance.playing.set(true);
      fixture.detectChanges();
    }).not.toThrow();
  });
});
