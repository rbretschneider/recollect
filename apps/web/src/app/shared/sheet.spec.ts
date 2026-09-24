import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Sheet } from './sheet';

/**
 * Regression cover for the portalled overlay.
 *
 * app-sheet moves its own host element to <body> so a fixed panel escapes
 * whatever stacking context it was declared in. It shipped without taking the
 * node back out, and when Angular tears down a whole subtree at once it
 * removes the ancestor and skips the descendants — which a portalled node is
 * no longer one of. The result was an inert, unstyled copy of the panel stuck
 * to the page until a reload.
 */

/** An inner component, so destroying it tears down a subtree. */
@Component({
  selector: 'app-holder',
  imports: [Sheet],
  template: `
    @if (open()) {
      <app-sheet sheetTitle="Share this photo" (closed)="open.set(false)">
        <p>body</p>
      </app-sheet>
    }
  `,
})
class Holder {
  readonly open = signal(false);
}

@Component({
  selector: 'app-host',
  imports: [Holder],
  template: `
    @if (alive()) {
      <app-holder />
    }
  `,
})
class Host {
  readonly alive = signal(true);
}

function sheetsInBody(): number {
  return document.body.querySelectorAll('app-sheet').length;
}

describe('Sheet', () => {
  function setup() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const holder = fixture.debugElement.children[0].componentInstance as Holder;
    return { fixture, holder };
  }

  it('portals itself to <body> so it escapes its stacking context', () => {
    const { fixture, holder } = setup();
    holder.open.set(true);
    fixture.detectChanges();

    expect(sheetsInBody()).toBe(1);
    // Directly under body, not nested back inside the component that opened it.
    expect([...document.body.children].some((el) => el.tagName === 'APP-SHEET')).toBe(true);
  });

  it('takes the node back out when closed normally', () => {
    const { fixture, holder } = setup();
    holder.open.set(true);
    fixture.detectChanges();
    holder.open.set(false);
    fixture.detectChanges();

    expect(sheetsInBody()).toBe(0);
  });

  // THE REGRESSION: an open sheet outliving the component that owned it.
  it('does not outlive a subtree torn down around it', () => {
    const { fixture, holder } = setup();
    holder.open.set(true);
    fixture.detectChanges();
    expect(sheetsInBody()).toBe(1);

    // The slideshow closing, the viewer closing, a route change: the whole
    // subtree goes at once while the sheet is still open.
    (fixture.componentInstance as Host).alive.set(false);
    fixture.detectChanges();

    expect(sheetsInBody()).toBe(0);
  });

  it('does not outlive the whole component being destroyed', () => {
    const { fixture, holder } = setup();
    holder.open.set(true);
    fixture.detectChanges();

    fixture.destroy();

    expect(sheetsInBody()).toBe(0);
  });
});
