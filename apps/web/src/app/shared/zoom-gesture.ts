import { computed, signal } from '@angular/core';

/** Minimum horizontal swipe distance (px) that counts as navigation. */
const SWIPE_THRESHOLD_PX = 60;

/** Zoom bounds and the double-tap zoom level. */
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const DOUBLE_TAP_ZOOM = 2.5;

/** Movement beyond this (px) makes a gesture a drag, not a tap/click. */
const DRAG_THRESHOLD_PX = 8;

export type SwipeDirection = 'next' | 'previous';

/**
 * What a pointerdown turned into.
 * - `captured`: the gesture owns it (zoom / pan / swipe).
 * - `video`: left alone so native video controls keep working.
 * - `control`: landed on a button or link, so the gesture keeps its hands off
 *   entirely — see `isControl`.
 */
export type PointerOutcome = 'captured' | 'video' | 'control';

/**
 * Controls that live INSIDE the stage — Replay on the end card, the motion
 * photo badge — must keep working.
 *
 * setPointerCapture on the stage retargets the pointerup that follows, and the
 * browser then fires `click` on the capturing element rather than on the
 * button that was pressed. The button simply never hears about it, which is
 * what stopped Replay working, on mouse and touch alike.
 */
function isControl(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('button, a, input, select, textarea, [role="button"]') !== null
  );
}

/**
 * Pinch / scroll-wheel / double-tap zoom with pan, plus swipe-to-navigate at
 * 1x, over one "stage" element whose media sits centred inside it. Shared by
 * the asset viewer and the slideshow so both feel the same under the fingers.
 *
 * The host wires the pointer events through and binds `transform` to the
 * media. Video targets are left alone (their controls need the events).
 */
export class ZoomGesture {
  /** 1 = fitted. Pan is in screen pixels. */
  readonly zoom = signal(1);
  readonly panX = signal(0);
  readonly panY = signal(0);
  /** A finger (or two) is down: hosts drop transitions so tracking is exact. */
  readonly isActive = signal(false);
  readonly isZoomed = computed(() => this.zoom() > MIN_ZOOM);

  readonly transform = computed(
    () => `translate(${this.panX()}px, ${this.panY()}px) scale(${this.zoom()})`,
  );

  private readonly activePointers = new Map<number, { x: number; y: number }>();
  private gestureStart: {
    zoom: number;
    panX: number;
    panY: number;
    x: number;
    y: number;
    pinchDistance: number | null;
  } | null = null;
  private didDrag = false;
  private didPinch = false;
  /** Centre of the stage, captured at gesture start; zoom pivots around it. */
  private origin = { x: 0, y: 0 };

  /** True when the click that follows this gesture was really its tail end. */
  get consumedClick(): boolean {
    return this.didDrag || this.didPinch;
  }

  pointerDown(event: PointerEvent): PointerOutcome {
    if (isControl(event.target)) {
      return 'control';
    }
    if ((event.target as HTMLElement).tagName === 'VIDEO') {
      return 'video';
    }
    const stage = event.currentTarget as HTMLElement;
    this.captureOrigin(stage);
    this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    stage.setPointerCapture(event.pointerId);
    this.isActive.set(true);
    this.didDrag = false;
    if (this.activePointers.size === 2) {
      this.didPinch = true;
      this.beginGesture(this.pinchDistance());
    } else {
      this.didPinch = false;
      this.beginGesture(null);
    }
    return 'captured';
  }

  pointerMove(event: PointerEvent): void {
    if (!this.activePointers.has(event.pointerId) || !this.gestureStart) {
      return;
    }
    this.activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const start = this.gestureStart;
    const center = this.pointerCenter();
    if (Math.hypot(center.x - start.x, center.y - start.y) > DRAG_THRESHOLD_PX) {
      this.didDrag = true;
    }
    if (this.activePointers.size === 2 && start.pinchDistance !== null) {
      const scale = this.clampZoom((start.zoom * this.pinchDistance()) / start.pinchDistance);
      this.zoomAround(center, scale, start);
    } else if (this.activePointers.size === 1 && this.zoom() > MIN_ZOOM) {
      this.panX.set(start.panX + (center.x - start.x));
      this.panY.set(start.panY + (center.y - start.y));
    }
  }

  /** Ends the gesture; a decisive horizontal swipe at 1x reports a direction. */
  pointerUp(event: PointerEvent): SwipeDirection | null {
    if (!this.activePointers.has(event.pointerId)) {
      return null;
    }
    const wasSingle = this.activePointers.size === 1;
    const start = this.gestureStart;
    this.activePointers.delete(event.pointerId);
    if (this.activePointers.size > 0) {
      this.beginGesture(this.activePointers.size === 2 ? this.pinchDistance() : null);
      return null;
    }
    this.isActive.set(false);
    if (this.zoom() < 1.05) {
      this.reset();
    }
    this.gestureStart = null;
    if (wasSingle && !this.didPinch && this.zoom() === MIN_ZOOM && start) {
      const deltaX = event.clientX - start.x;
      if (deltaX < -SWIPE_THRESHOLD_PX) {
        return 'next';
      } else if (deltaX > SWIPE_THRESHOLD_PX) {
        return 'previous';
      }
    }
    return null;
  }

  /** Desktop: scroll wheel zooms toward the cursor. */
  wheel(event: WheelEvent): void {
    event.preventDefault();
    this.captureOrigin(event.currentTarget as HTMLElement);
    const scale = this.clampZoom(this.zoom() * Math.exp(-event.deltaY * 0.0022));
    this.zoomAround({ x: event.clientX, y: event.clientY }, scale, {
      zoom: this.zoom(),
      panX: this.panX(),
      panY: this.panY(),
    });
    if (this.zoom() < 1.05) {
      this.reset();
    }
  }

  /** Double tap / double click toggles between fitted and zoomed-in. */
  doubleClick(event: MouseEvent): boolean {
    if (isControl(event.target) || (event.target as HTMLElement).tagName === 'VIDEO') {
      return false;
    }
    if (this.zoom() > MIN_ZOOM) {
      this.reset();
    } else {
      this.captureOrigin(event.currentTarget as HTMLElement);
      this.zoomAround({ x: event.clientX, y: event.clientY }, DOUBLE_TAP_ZOOM, {
        zoom: 1,
        panX: 0,
        panY: 0,
      });
    }
    return true;
  }

  reset(): void {
    this.zoom.set(1);
    this.panX.set(0);
    this.panY.set(0);
  }

  private captureOrigin(stage: HTMLElement): void {
    const rect = stage.getBoundingClientRect();
    this.origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  private beginGesture(pinchDistance: number | null): void {
    const center = this.pointerCenter();
    this.gestureStart = {
      zoom: this.zoom(),
      panX: this.panX(),
      panY: this.panY(),
      x: center.x,
      y: center.y,
      pinchDistance,
    };
  }

  /** Rescales so the image point under `anchor` stays under it. */
  private zoomAround(
    anchor: { x: number; y: number },
    scale: number,
    from: { zoom: number; panX: number; panY: number },
  ): void {
    const imagePointX = (anchor.x - this.origin.x - from.panX) / from.zoom;
    const imagePointY = (anchor.y - this.origin.y - from.panY) / from.zoom;
    this.zoom.set(scale);
    this.panX.set(anchor.x - this.origin.x - imagePointX * scale);
    this.panY.set(anchor.y - this.origin.y - imagePointY * scale);
  }

  private pointerCenter(): { x: number; y: number } {
    const points = [...this.activePointers.values()];
    if (points.length === 0) {
      return { x: 0, y: 0 };
    }
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    };
  }

  private pinchDistance(): number {
    const [first, second] = [...this.activePointers.values()];
    return Math.hypot(second.x - first.x, second.y - first.y);
  }

  private clampZoom(value: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM * 0.85, value));
  }
}
