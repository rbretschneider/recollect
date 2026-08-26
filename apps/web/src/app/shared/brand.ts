import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** The app icon + wordmark; tapping it returns to the default Photos view. */
@Component({
  selector: 'app-brand',
  imports: [RouterLink],
  template: `
    <h1>
      <a routerLink="/" aria-label="Recollect — back to photos">
        <img src="icons/icon.svg" alt="" width="26" height="26" />
        <span>Recollect</span>
      </a>
    </h1>
  `,
  styles: `
    h1 {
      margin: 0;
      font-size: 1.15rem;
      letter-spacing: -0.02em;
    }

    a {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      color: inherit;
      text-decoration: none;
      min-height: 40px;
      border-radius: 0.5rem;
      transition: opacity 0.15s ease;

      &:active {
        opacity: 0.7;
      }
    }

    img {
      display: block;
      border-radius: 0.4rem;
    }
  `,
})
export class Brand {}
