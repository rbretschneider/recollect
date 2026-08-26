import { Component, inject } from '@angular/core';
import { EditModeService } from '../core/edit-mode.service';

/** The pencil that flips the app between read-only and edit mode. */
@Component({
  selector: 'app-edit-toggle',
  template: `
    @if (editMode.canEnterEditMode()) {
      <button
        type="button"
        class="toggle"
        [class.active]="editMode.isEditing()"
        [attr.aria-pressed]="editMode.isEditing()"
        [attr.aria-label]="editMode.isEditing() ? 'Done editing' : 'Edit'"
        (click)="editMode.toggle()"
      >
        {{ editMode.isEditing() ? '✓ Done' : '✎ Edit' }}
      </button>
    }
  `,
  styles: `
    .toggle {
      display: grid;
      place-items: center;
      min-height: 40px;
      padding: 0 0.9rem;
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      background: var(--surface);
      color: var(--text);
      font-size: 0.9rem;
      cursor: pointer;
      transition: background-color 0.15s ease, color 0.15s ease;

      &.active {
        background: var(--accent);
        color: var(--accent-contrast);
        font-weight: 600;
      }
    }
  `,
})
export class EditToggle {
  protected readonly editMode = inject(EditModeService);
}
