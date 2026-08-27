import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * The circular back button used on every drill-in page. The chevron is an
 * SVG path, so it is geometrically centered — text glyphs never are.
 * Add class="overlay" when it floats over a photo (memory hero).
 */
@Component({
  selector: 'app-back',
  imports: [RouterLink],
  template: `
    <a class="back" [routerLink]="to()" [attr.aria-label]="label()">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M14.5 5.5 8 12l6.5 6.5"
          stroke="currentColor"
          stroke-width="2.4"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </a>
  `,
  styles: `
    :host {
      display: block;
      flex-shrink: 0;
    }

    .back {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--surface);
      color: var(--text);
      text-decoration: none;

      svg {
        display: block;
      }
    }

    :host(.overlay) .back {
      width: 44px;
      height: 44px;
      background: rgb(0 0 0 / 45%);
      color: white;
    }
  `,
})
export class BackButton {
  readonly to = input.required<string>();
  readonly label = input.required<string>();
}
