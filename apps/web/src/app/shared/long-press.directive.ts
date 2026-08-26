import { Directive, ElementRef, inject, NgZone, OnDestroy, OnInit, output } from '@angular/core';

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;

/**
 * Emits `longPress` when the user presses and holds (touch or mouse) without
 * dragging — the PhotoPrism-PWA gesture for entering selection mode. A long
 * press suppresses the click that would otherwise follow, and the context menu
 * on touch devices.
 */
@Directive({ selector: '[appLongPress]' })
export class LongPressDirective implements OnInit, OnDestroy {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);

  readonly longPress = output<void>();

  private timer: ReturnType<typeof setTimeout> | null = null;
  private startX = 0;
  private startY = 0;
  private didFire = false;
  private readonly abort = new AbortController();

  ngOnInit(): void {
    const element = this.elementRef.nativeElement;
    const options = { signal: this.abort.signal };
    this.zone.runOutsideAngular(() => {
      element.addEventListener('pointerdown', (event) => this.onDown(event), options);
      element.addEventListener('pointermove', (event) => this.onMove(event), options);
      element.addEventListener('pointerup', () => this.cancel(), options);
      element.addEventListener('pointercancel', () => this.cancel(), options);
      element.addEventListener('pointerleave', () => this.cancel(), options);
      element.addEventListener('click', (event) => this.onClick(event), {
        ...options,
        capture: true,
      });
      element.addEventListener('contextmenu', (event) => this.onContextMenu(event), options);
    });
  }

  ngOnDestroy(): void {
    this.cancel();
    this.abort.abort();
  }

  private onDown(event: PointerEvent): void {
    this.didFire = false;
    this.startX = event.clientX;
    this.startY = event.clientY;
    this.timer = setTimeout(() => {
      this.didFire = true;
      this.zone.run(() => this.longPress.emit());
    }, LONG_PRESS_MS);
  }

  private onMove(event: PointerEvent): void {
    const movedTooFar =
      Math.abs(event.clientX - this.startX) > MOVE_TOLERANCE_PX ||
      Math.abs(event.clientY - this.startY) > MOVE_TOLERANCE_PX;
    if (movedTooFar) {
      this.cancel();
    }
  }

  /** A long press must not also count as a tap. */
  private onClick(event: MouseEvent): void {
    if (this.didFire) {
      event.preventDefault();
      event.stopPropagation();
      this.didFire = false;
    }
  }

  /** Touch long-press opens the browser context menu; suppress it on tiles. */
  private onContextMenu(event: Event): void {
    if (this.timer !== null || this.didFire) {
      event.preventDefault();
    }
  }

  private cancel(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
