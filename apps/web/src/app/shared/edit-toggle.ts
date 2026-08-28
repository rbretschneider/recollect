import { Component, inject, input } from '@angular/core';
import { EditModeService } from '../core/edit-mode.service';
import { Icon } from './icon';

/**
 * THE edit control, everywhere: a pencil flips the page into edit mode, a
 * check flips it back. 'chip' is the bordered button for action rows;
 * 'overlay' is the circular chrome button for photo heroes.
 */
@Component({
  selector: 'app-edit-toggle',
  imports: [Icon],
  template: `
    @if (editMode.canEnterEditMode()) {
      <button
        type="button"
        class="toggle"
        [class.overlay]="variant() === 'overlay'"
        [class.active]="editMode.isEditing()"
        [attr.aria-pressed]="editMode.isEditing()"
        [attr.aria-label]="editMode.isEditing() ? 'Done editing' : 'Edit'"
        [title]="editMode.isEditing() ? 'Done editing' : 'Edit'"
        (click)="editMode.toggle()"
      >
        <app-icon [name]="editMode.isEditing() ? 'check' : 'pencil'" [size]="18" />
      </button>
    }
  `,
  styles: `
    .toggle {
      display: grid;
      place-items: center;
      width: 44px;
      height: 40px;
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      background: var(--surface);
      color: var(--text);
      cursor: pointer;
      transition: background-color 0.15s ease, color 0.15s ease;

      &.active {
        background: var(--accent);
        border-color: var(--accent);
        color: var(--accent-contrast);
      }

      &.overlay {
        width: 44px;
        height: 44px;
        border: none;
        border-radius: 50%;
        background: rgb(0 0 0 / 45%);
        color: white;

        &.active {
          background: var(--accent);
          color: var(--accent-contrast);
        }
      }
    }
  `,
})
export class EditToggle {
  protected readonly editMode = inject(EditModeService);

  readonly variant = input<'chip' | 'overlay'>('chip');
}
