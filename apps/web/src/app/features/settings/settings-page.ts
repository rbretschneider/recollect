import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DevicesApiService, DeviceView } from '../../core/api/devices-api.service';
import { CreateUserInput, UsersApiService } from '../../core/api/users-api.service';
import { UserProfile } from '../../core/api/api-models';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { BackButton } from '../../shared/back-button';
import { BottomNav } from '../../shared/bottom-nav';

/** Admin settings: cameras and household members. The library has its own page. */
@Component({
  selector: 'app-settings-page',
  imports: [BackButton, BottomNav, FormsModule, RouterLink],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage implements OnInit {
  private readonly usersApi = inject(UsersApiService);
  private readonly devicesApi = inject(DevicesApiService);
  private readonly auth = inject(AuthStateService);

  readonly users = signal<UserProfile[]>([]);
  readonly devices = signal<DeviceView[]>([]);
  /** Device key that just saved, driving the "Saved ✓" flash. */
  readonly deviceJustSaved = signal<string | null>(null);
  /** Per-device owner-name drafts, keyed by deviceKey(). */
  deviceDrafts: Record<string, string> = {};
  readonly isAddingUser = signal(false);
  readonly error = signal<string | null>(null);

  newUser: CreateUserInput = this.emptyUser();

  get isAdmin(): boolean {
    return this.auth.user()?.isAdmin ?? false;
  }

  ngOnInit(): void {
    void this.reload();
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

  private async reload(): Promise<void> {
    const [usersResult, devicesResult] = await Promise.all([
      this.isAdmin ? this.usersApi.list() : Promise.resolve({ users: [] }),
      this.isAdmin ? this.devicesApi.list() : Promise.resolve({ devices: [] }),
    ]);
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
