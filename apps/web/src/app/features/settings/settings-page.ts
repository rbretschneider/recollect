import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LibraryApiService } from '../../core/api/library-api.service';
import { CreateUserInput, UsersApiService } from '../../core/api/users-api.service';
import { LibraryRootView, UserProfile } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { BottomNav } from '../../shared/bottom-nav';
import { FolderPicker } from '../../shared/folder-picker';

/** Admin settings: library folders and household members. */
@Component({
  selector: 'app-settings-page',
  imports: [BottomNav, FolderPicker, FormsModule, RouterLink],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage implements OnInit {
  private readonly libraryApi = inject(LibraryApiService);
  private readonly usersApi = inject(UsersApiService);
  private readonly auth = inject(AuthStateService);

  readonly roots = signal<LibraryRootView[]>([]);
  readonly users = signal<UserProfile[]>([]);
  readonly isAddingFolder = signal(false);
  readonly isAddingUser = signal(false);
  readonly scanBusyRootId = signal<string | null>(null);
  readonly error = signal<string | null>(null);

  newUser: CreateUserInput = this.emptyUser();

  get isAdmin(): boolean {
    return this.auth.user()?.isAdmin ?? false;
  }

  ngOnInit(): void {
    void this.reload();
  }

  async addFolder(path: string): Promise<void> {
    this.error.set(null);
    this.isAddingFolder.set(false);
    try {
      const name = path.split(/[\\/]/).filter((part) => part.length > 0).pop() ?? 'Photos';
      await this.libraryApi.createRoot(path, name);
      await this.reload();
    } catch (error) {
      this.error.set(this.messageFrom(error, 'Could not add that folder.'));
    }
  }

  async scanNow(root: LibraryRootView): Promise<void> {
    this.scanBusyRootId.set(root.id);
    try {
      await this.libraryApi.rescan(root.id);
    } finally {
      this.scanBusyRootId.set(null);
    }
  }

  async createUser(): Promise<void> {
    this.error.set(null);
    try {
      await this.usersApi.create(this.newUser);
      this.newUser = this.emptyUser();
      this.isAddingUser.set(false);
      await this.reload();
    } catch (error) {
      this.error.set(this.messageFrom(error, 'Could not create that account.'));
    }
  }

  grantLabel(user: UserProfile): string {
    const grant = { read: 'Read only', write: 'Read & write', delete: 'Full (can delete)' }[
      user.permission
    ];
    return user.isAdmin ? `${grant} · Admin` : grant;
  }

  lastScanLabel(root: LibraryRootView): string {
    if (!root.lastScanCompletedAt) {
      return 'Not scanned yet';
    }
    return `Last scan ${new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(root.lastScanCompletedAt))}`;
  }

  private async reload(): Promise<void> {
    const [rootsResult, usersResult] = await Promise.all([
      this.libraryApi.listRoots(),
      this.isAdmin ? this.usersApi.list() : Promise.resolve({ users: [] }),
    ]);
    this.roots.set(rootsResult.roots);
    this.users.set(usersResult.users);
  }

  private emptyUser(): CreateUserInput {
    return { email: '', displayName: '', password: '', permission: 'write', isAdmin: false };
  }

  private messageFrom(error: unknown, fallback: string): string {
    const message = (error as { error?: { message?: string | string[] } })?.error?.message;
    return (Array.isArray(message) ? message[0] : message) ?? fallback;
  }
}
