import { computed, inject, Injectable, signal } from '@angular/core';
import { NavigationStart, Router } from '@angular/router';
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

  constructor() {
    // Editing is a per-page state of mind: leaving the page always ends it,
    // so a forgotten edit toggle never haunts the next screen.
    inject(Router).events.subscribe((event) => {
      if (event instanceof NavigationStart) {
        this.isEditingRaw.set(false);
      }
    });
  }

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

  /** Starts editing directly — a just-created memory opens ready to write. */
  enter(): void {
    this.isEditingRaw.set(true);
  }

  exit(): void {
    this.isEditingRaw.set(false);
  }
}
