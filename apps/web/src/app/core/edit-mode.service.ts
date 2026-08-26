import { computed, inject, Injectable, signal } from '@angular/core';
import { AuthStateService } from './auth/auth-state.service';

/**
 * App-wide edit mode (locked decision): the app is read-only until the user
 * explicitly enters edit mode. Structural and destructive controls (selection,
 * deletes, removals, title edits) render only while editing; journal writing
 * stays always available. Resets to read-only on every fresh load.
 */
@Injectable({ providedIn: 'root' })
export class EditModeService {
  private readonly auth = inject(AuthStateService);

  private readonly isEditingRaw = signal(false);

  /** True only for users who can write AND have switched editing on. */
  readonly isEditing = computed(() => {
    const permission = this.auth.user()?.permission;
    const canWrite = permission === 'write' || permission === 'delete';
    return canWrite && this.isEditingRaw();
  });

  readonly canEnterEditMode = computed(() => {
    const permission = this.auth.user()?.permission;
    return permission === 'write' || permission === 'delete';
  });

  toggle(): void {
    this.isEditingRaw.update((value) => !value);
  }

  exit(): void {
    this.isEditingRaw.set(false);
  }
}
