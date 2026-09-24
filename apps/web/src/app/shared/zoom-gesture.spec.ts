import { ZoomGesture } from './zoom-gesture';

/**
 * Regression cover for the shared pinch/wheel/double-tap gesture.
 *
 * Every case here is something that actually shipped broken. The gesture sits
 * under both the slideshow and the asset viewer, so a mistake in it breaks
 * looking at photos — the one thing this app is for.
 */

/** A stage with a button inside it, like the slideshow's end card. */
function makeStage(): { stage: HTMLElement; button: HTMLButtonElement; image: HTMLElement } {
  const stage = document.createElement('div');
  Object.assign(stage.style, { width: '400px', height: '300px' });
  const button = document.createElement('button');
  button.textContent = 'Replay';
  const image = document.createElement('img');
  stage.append(button, image);
  document.body.appendChild(stage);
  // jsdom has no pointer capture; the spies below are what we assert on.
  stage.setPointerCapture = () => undefined;
  return { stage, button, image };
}

function pointerEvent(
  type: string,
  stage: HTMLElement,
  target: EventTarget,
  init: { x?: number; y?: number; id?: number } = {},
): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    clientX: init.x ?? 0,
    clientY: init.y ?? 0,
  }) as unknown as PointerEvent;
  Object.defineProperty(event, 'target', { value: target });
  Object.defineProperty(event, 'currentTarget', { value: stage });
  Object.defineProperty(event, 'pointerId', { value: init.id ?? 1 });
  return event;
}

function wheelEvent(stage: HTMLElement, deltaY: number): WheelEvent {
  const event = new MouseEvent('wheel', { bubbles: true, clientX: 200, clientY: 150 }) as unknown as WheelEvent;
  Object.defineProperty(event, 'deltaY', { value: deltaY });
  Object.defineProperty(event, 'currentTarget', { value: stage });
  Object.defineProperty(event, 'target', { value: stage });
  Object.defineProperty(event, 'preventDefault', { value: () => undefined });
  return event;
}

describe('ZoomGesture', () => {
  let gesture: ZoomGesture;
  let stage: HTMLElement;
  let button: HTMLButtonElement;
  let image: HTMLElement;

  beforeEach(() => {
    gesture = new ZoomGesture();
    ({ stage, button, image } = makeStage());
  });

  afterEach(() => stage.remove());

  describe('controls inside the stage', () => {
    // THE REGRESSION: capturing the pointer made the browser fire `click` on
    // the stage instead of on the button, so Replay stopped working entirely.
    it('does not take a pointerdown that landed on a button', () => {
      let captured: number | null = null;
      stage.setPointerCapture = (id: number) => (captured = id);

      expect(gesture.pointerDown(pointerEvent('pointerdown', stage, button))).toBe('control');
      expect(captured).toBeNull();
    });

    it('does not take one that landed inside a button either', () => {
      const glyph = document.createElement('span');
      button.appendChild(glyph);
      expect(gesture.pointerDown(pointerEvent('pointerdown', stage, glyph))).toBe('control');
    });

    it('leaves links and form fields alone as well', () => {
      for (const tag of ['a', 'input', 'select', 'textarea']) {
        const element = document.createElement(tag);
        stage.appendChild(element);
        expect(gesture.pointerDown(pointerEvent('pointerdown', stage, element))).toBe('control');
      }
    });

    it('does not zoom when a control is double-clicked', () => {
      const event = pointerEvent('dblclick', stage, button) as unknown as MouseEvent;
      expect(gesture.doubleClick(event)).toBe(false);
      expect(gesture.zoom()).toBe(1);
    });

    it('still takes a pointerdown on the picture itself', () => {
      let captured: number | null = null;
      stage.setPointerCapture = (id: number) => (captured = id);

      expect(gesture.pointerDown(pointerEvent('pointerdown', stage, image))).toBe('captured');
      expect(captured).toBe(1);
    });

    it('hands videos back so their native controls keep working', () => {
      const video = document.createElement('video');
      stage.appendChild(video);
      expect(gesture.pointerDown(pointerEvent('pointerdown', stage, video))).toBe('video');
    });
  });

  describe('wheel zoom', () => {
    // THE REGRESSION (reported as "zoom out is MEGA slow"): worth pinning that
    // the maths itself is symmetric, so a future report points at the CSS
    // rather than sending anyone back here.
    it('moves out at exactly the rate it moves in', () => {
      // Away from both bounds, so nothing is clamped: one notch each way has
      // to land back where it started.
      gesture.wheel(wheelEvent(stage, -100));
      gesture.wheel(wheelEvent(stage, -100));
      const start = gesture.zoom();

      gesture.wheel(wheelEvent(stage, -100));
      gesture.wheel(wheelEvent(stage, 100));
      expect(gesture.zoom()).toBeCloseTo(start, 6);
    });

    it('comes all the way home in the same number of notches it went up', () => {
      // Stop short of the ceiling: a clamped last notch in is a partial step,
      // which would make the counts differ for a reason that is not asymmetry.
      let notchesIn = 0;
      while (gesture.zoom() < 5 && notchesIn < 50) {
        gesture.wheel(wheelEvent(stage, -100));
        notchesIn++;
      }

      let notchesOut = 0;
      while (gesture.zoom() > 1 && notchesOut < 50) {
        gesture.wheel(wheelEvent(stage, 100));
        notchesOut++;
      }
      expect(gesture.zoom()).toBe(1);
      expect(notchesOut).toBe(notchesIn);
    });

    it('never zooms past the bounds', () => {
      for (let i = 0; i < 40; i++) {
        gesture.wheel(wheelEvent(stage, -100));
      }
      expect(gesture.zoom()).toBe(6);

      for (let i = 0; i < 80; i++) {
        gesture.wheel(wheelEvent(stage, 100));
      }
      // Settles exactly home rather than drifting under 1x.
      expect(gesture.zoom()).toBe(1);
      expect(gesture.isZoomed()).toBe(false);
    });

    it('reports being zoomed only when it actually is', () => {
      expect(gesture.isZoomed()).toBe(false);
      gesture.wheel(wheelEvent(stage, -100));
      expect(gesture.isZoomed()).toBe(true);
      gesture.reset();
      expect(gesture.isZoomed()).toBe(false);
    });
  });

  describe('swipe to steer', () => {
    it('reports a decisive horizontal swipe at 1x', () => {
      gesture.pointerDown(pointerEvent('pointerdown', stage, image, { x: 300 }));
      gesture.pointerMove(pointerEvent('pointermove', stage, image, { x: 100 }));
      expect(gesture.pointerUp(pointerEvent('pointerup', stage, image, { x: 100 }))).toBe('next');
    });

    it('ignores a short drag', () => {
      gesture.pointerDown(pointerEvent('pointerdown', stage, image, { x: 300 }));
      gesture.pointerMove(pointerEvent('pointermove', stage, image, { x: 280 }));
      expect(gesture.pointerUp(pointerEvent('pointerup', stage, image, { x: 280 }))).toBeNull();
    });

    it('pans instead of steering once zoomed', () => {
      gesture.wheel(wheelEvent(stage, -100));
      gesture.pointerDown(pointerEvent('pointerdown', stage, image, { x: 300 }));
      gesture.pointerMove(pointerEvent('pointermove', stage, image, { x: 100 }));
      // A zoomed drag moves the picture; it must not also change slide.
      expect(gesture.panX()).not.toBe(0);
      expect(gesture.pointerUp(pointerEvent('pointerup', stage, image, { x: 100 }))).toBeNull();
    });

    it('marks a drag so the trailing click is not treated as a tap', () => {
      gesture.pointerDown(pointerEvent('pointerdown', stage, image, { x: 300 }));
      gesture.pointerMove(pointerEvent('pointermove', stage, image, { x: 100 }));
      expect(gesture.consumedClick).toBe(true);
    });
  });

  it('reset returns the picture to fitted and centred', () => {
    gesture.wheel(wheelEvent(stage, -100));
    gesture.reset();
    expect(gesture.zoom()).toBe(1);
    expect(gesture.panX()).toBe(0);
    expect(gesture.panY()).toBe(0);
  });
});
