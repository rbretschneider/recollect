import { AfterViewInit, Directive, ElementRef, inject, input, OnDestroy } from '@angular/core';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]),' +
  ' select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * One focus contract for every modal surface (sheet, drawer, pickers, confirm).
 * Put it on the dialog panel element:
 *
 *   <div class="sheet" role="dialog" aria-modal="true" overlayFocus>
 *
 * On open it moves focus into the panel; Tab is trapped and wraps; on close it
 * restores focus to whatever was focused before (so keyboard users land back on
 * the trigger). Pass [overlayFocus]="'.some-selector'" to choose what gets
 * focused first — e.g. Cancel on a destructive confirm.
 */
@Directive({
  selector: '[overlayFocus]',
})
export class OverlayFocus implements AfterViewInit, OnDestroy {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** CSS selector for the element to focus first; defaults to the first focusable. */
  readonly initialFocus = input<string>('', { alias: 'overlayFocus' });

  private previouslyFocused: HTMLElement | null = null;

  ngAfterViewInit(): void {
    this.previouslyFocused = document.activeElement as HTMLElement | null;
    // Defer a tick: the panel is portaled to <body> and animates in via
    // @starting-style; focusing before it's laid out can be dropped.
    queueMicrotask(() => {
      const selector = this.initialFocus();
      const target =
        (selector && this.el.querySelector<HTMLElement>(selector)) ||
        this.focusable()[0] ||
        this.el;
      target.focus({ preventScroll: true });
    });
    this.el.addEventListener('keydown', this.onKeydown);
  }

  ngOnDestroy(): void {
    this.el.removeEventListener('keydown', this.onKeydown);
    // Restore focus to the trigger, but only if focus is still inside us —
    // never yank it back from wherever the user has since moved on to.
    if (this.previouslyFocused?.isConnected && this.el.contains(document.activeElement)) {
      this.previouslyFocused.focus({ preventScroll: true });
    }
  }

  private focusable(): HTMLElement[] {
    return [...this.el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (item) => item.offsetParent !== null || item === document.activeElement,
    );
  }

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab') {
      return;
    }
    const items = this.focusable();
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement;
    if (event.shiftKey && (active === first || !this.el.contains(active))) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  };
}
