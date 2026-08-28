import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { DevicesApiService, DeviceView } from '../../core/api/devices-api.service';
import { PeopleApiService, PersonSummary } from '../../core/api/people-api.service';
import { CreateUserInput, UsersApiService } from '../../core/api/users-api.service';
import { UserProfile } from '../../core/api/api-models';
import { Router } from '@angular/router';
import { AuthApiService } from '../../core/api/auth-api.service';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { ConfirmService } from '../../shared/confirm.service';
import { MenuButton } from '../../shared/menu-button';
import { BackButton } from '../../shared/back-button';
import { BottomNav } from '../../shared/bottom-nav';
import { Sheet } from '../../shared/sheet';

/** Admin settings: cameras and household members. The library has its own page. */
@Component({
  selector: 'app-settings-page',
  imports: [MenuButton, BackButton, BottomNav, FormsModule, RouterLink, Sheet],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage implements OnInit {
  private readonly usersApi = inject(UsersApiService);
  private readonly devicesApi = inject(DevicesApiService);
  private readonly peopleApi = inject(PeopleApiService);
  private readonly auth = inject(AuthStateService);
  private readonly authApi = inject(AuthApiService);
  private readonly confirms = inject(ConfirmService);
  private readonly router = inject(Router);

  readonly users = signal<UserProfile[]>([]);
  /** The member whose password is being reset (drives the sheet). */
  readonly resettingUser = signal<UserProfile | null>(null);
  resetPasswordDraft = '';
  readonly devices = signal<DeviceView[]>([]);
  readonly namedPeople = signal<PersonSummary[]>([]);
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
    const personId = this.deviceDrafts[key] || null;
    await this.devicesApi.setOwner(device.cameraMake, device.cameraModel, personId);
    const personName =
      this.namedPeople().find((candidate) => candidate.id === personId)?.name ?? null;
    this.devices.update((list) =>
      list.map((entry) =>
        this.deviceKey(entry) === key ? { ...entry, personId, personName } : entry,
      ),
    );
    this.deviceJustSaved.set(key);
    setTimeout(() => {
      if (this.deviceJustSaved() === key) {
        this.deviceJustSaved.set(null);
      }
    }, 2000);
  }

  async signOutEverywhere(): Promise<void> {
    const confirmed = await this.confirms.ask({
      title: 'Sign out everywhere?',
      message:
        'Every device signed in to your account — phones, tablets, browsers — is signed out immediately, including this one.',
      confirmLabel: 'Sign out all',
    });
    if (!confirmed) {
      return;
    }
    await this.auth.logoutAll();
    await this.router.navigateByUrl('/login');
  }

  startPasswordReset(user: UserProfile): void {
    this.resetPasswordDraft = '';
    this.resettingUser.set(user);
  }

  async confirmPasswordReset(): Promise<void> {
    const target = this.resettingUser();
    if (!target || this.resetPasswordDraft.length < 8) {
      return;
    }
    this.error.set(null);
    try {
      await this.authApi.resetMemberPassword(target.id, this.resetPasswordDraft);
      this.resettingUser.set(null);
      this.resetPasswordDraft = '';
    } catch (error) {
      this.error.set(this.messageFrom(error, 'Could not reset that password.'));
    }
  }

  grantLabel(user: UserProfile): string {
    const grant = { read: 'Read only', write: 'Read & write', delete: 'Full (can delete)' }[
      user.permission
    ];
    return user.isAdmin ? `${grant} · Admin` : grant;
  }

  private async reload(): Promise<void> {
    const [usersResult, devicesResult, peopleResult] = await Promise.all([
      this.isAdmin ? this.usersApi.list() : Promise.resolve({ users: [] }),
      this.isAdmin ? this.devicesApi.list() : Promise.resolve({ devices: [] }),
      this.isAdmin ? this.peopleApi.list() : Promise.resolve({ people: [] }),
    ]);
    this.users.set(usersResult.users);
    this.devices.set(devicesResult.devices);
    this.namedPeople.set(peopleResult.people.filter((person) => person.name !== null));
    for (const device of devicesResult.devices) {
      this.deviceDrafts[this.deviceKey(device)] = device.personId ?? '';
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
