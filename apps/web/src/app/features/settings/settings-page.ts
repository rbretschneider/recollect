import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DevicesApiService, DeviceView } from '../../core/api/devices-api.service';
import { LibraryApiService } from '../../core/api/library-api.service';
import { CreateUserInput, UsersApiService } from '../../core/api/users-api.service';
import { LibraryRootView, LibraryStatus, UserProfile } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { BackButton } from '../../shared/back-button';
import { BottomNav } from '../../shared/bottom-nav';
import { FolderPicker } from '../../shared/folder-picker';

/** Admin settings: library folders and household members. */
@Component({
  selector: 'app-settings-page',
  imports: [BackButton, BottomNav, FolderPicker, FormsModule, RouterLink],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage implements OnInit {
  private readonly libraryApi = inject(LibraryApiService);
  private readonly usersApi = inject(UsersApiService);
  private readonly devicesApi = inject(DevicesApiService);
  private readonly auth = inject(AuthStateService);

  readonly roots = signal<LibraryRootView[]>([]);
  readonly users = signal<UserProfile[]>([]);
  readonly devices = signal<DeviceView[]>([]);
  /** Device key that just saved, driving the "Saved ✓" flash. */
  readonly deviceJustSaved = signal<string | null>(null);
  /** Per-device owner-name drafts, keyed by deviceKey(). */
  deviceDrafts: Record<string, string> = {};
  readonly isAddingFolder = signal(false);
  readonly isAddingUser = signal(false);
  readonly justQueuedRootId = signal<string | null>(null);
  readonly status = signal<LibraryStatus | null>(null);
  readonly error = signal<string | null>(null);

  /** How many indexing jobs are queued or running right now. */
  readonly pendingCount = computed(() => {
    const status = this.status();
    return status ? status.queuedJobs + status.runningJobs : 0;
  });

  newUser: CreateUserInput = this.emptyUser();
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private wasIndexing = false;
  private readonly destroyRef = inject(DestroyRef);

  get isAdmin(): boolean {
    return this.auth.user()?.isAdmin ?? false;
  }

  ngOnInit(): void {
    void this.reload();
    void this.pollStatus();
    this.statusTimer = setInterval(() => void this.pollStatus(), 3000);
    this.destroyRef.onDestroy(() => {
      if (this.statusTimer !== null) {
        clearInterval(this.statusTimer);
      }
    });
  }

  async addFolder(path: string): Promise<void> {
    this.error.set(null);
    this.isAddingFolder.set(false);
    try {
      const name = path.split(/[\\/]/).filter((part) => part.length > 0).pop() ?? 'Photos';
      const { root } = await this.libraryApi.createRoot(path, name);
      // Adding a folder auto-starts its first scan — say so, don't leave a mystery.
      this.justQueuedRootId.set(root.id);
      await this.reload();
      await this.pollStatus();
    } catch (error) {
      this.error.set(this.messageFrom(error, 'Could not add that folder.'));
    }
  }

  async scanNow(root: LibraryRootView): Promise<void> {
    this.justQueuedRootId.set(root.id);
    await this.libraryApi.rescan(root.id);
    await this.pollStatus();
  }

  /** The three-signal contract: ack on the control, live progress, completion. */
  scanButtonLabel(root: LibraryRootView): string {
    if (this.justQueuedRootId() === root.id && this.pendingCount() === 0) {
      return 'Scan queued ✓';
    }
    if (this.pendingCount() > 0) {
      return 'Scanning…';
    }
    return 'Scan now';
  }

  private async pollStatus(): Promise<void> {
    try {
      this.status.set(await this.libraryApi.getStatus());
    } catch {
      return;
    }
    const isIndexing = this.pendingCount() > 0;
    // Completion signal: when the queue drains, refresh last-scan times.
    if (this.wasIndexing && !isIndexing) {
      this.justQueuedRootId.set(null);
      const { roots } = await this.libraryApi.listRoots();
      this.roots.set(roots);
    }
    this.wasIndexing = isIndexing;
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

  deviceKey(device: DeviceView): string {
    return `${device.cameraMake} ${device.cameraModel}`;
  }

  deviceLabel(device: DeviceView): string {
    return `${device.cameraMake} ${device.cameraModel}`.trim() || 'Unknown camera';
  }

  async saveDeviceOwner(device: DeviceView): Promise<void> {
    const key = this.deviceKey(device);
    const name = (this.deviceDrafts[key] ?? '').trim();
    await this.devicesApi.setOwner(device.cameraMake, device.cameraModel, name);
    this.devices.update((list) =>
      list.map((entry) =>
        this.deviceKey(entry) === key ? { ...entry, ownerName: name || null } : entry,
      ),
    );
    this.deviceJustSaved.set(key);
    setTimeout(() => {
      if (this.deviceJustSaved() === key) {
        this.deviceJustSaved.set(null);
      }
    }, 2000);
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
    const [rootsResult, usersResult, devicesResult] = await Promise.all([
      this.libraryApi.listRoots(),
      this.isAdmin ? this.usersApi.list() : Promise.resolve({ users: [] }),
      this.isAdmin ? this.devicesApi.list() : Promise.resolve({ devices: [] }),
    ]);
    this.roots.set(rootsResult.roots);
    this.users.set(usersResult.users);
    this.devices.set(devicesResult.devices);
    for (const device of devicesResult.devices) {
      this.deviceDrafts[this.deviceKey(device)] = device.ownerName ?? '';
    }
  }

  private emptyUser(): CreateUserInput {
    return { email: '', displayName: '', password: '', permission: 'write', isAdmin: false };
  }

  private messageFrom(error: unknown, fallback: string): string {
    const message = (error as { error?: { message?: string | string[] } })?.error?.message;
    return (Array.isArray(message) ? message[0] : message) ?? fallback;
  }
}
