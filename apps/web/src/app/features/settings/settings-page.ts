import { Component, inject, OnInit, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
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
import { AccountBadge } from '../../shared/account-badge';
import { MenuButton } from '../../shared/menu-button';
import { BackButton } from '../../shared/back-button';
import { Sheet } from '../../shared/sheet';
import { ToastService } from '../../shared/toast.service';
import { PushNotificationsService } from '../../core/push-notifications.service';

/** Admin settings: cameras and household members. The library has its own page. */
@Component({
  selector: 'app-settings-page',
  imports: [AccountBadge, MenuButton, BackButton, FormsModule, RouterLink, Sheet],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.scss',
})
export class SettingsPage implements OnInit {
  private readonly usersApi = inject(UsersApiService);
  private readonly http = inject(HttpClient);
  private readonly devicesApi = inject(DevicesApiService);
  private readonly peopleApi = inject(PeopleApiService);
  private readonly auth = inject(AuthStateService);
  private readonly authApi = inject(AuthApiService);
  private readonly confirms = inject(ConfirmService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);
  readonly push = inject(PushNotificationsService);

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
  readonly isCreatingUser = signal(false);
  readonly error = signal<string | null>(null);

  newUser: CreateUserInput = this.emptyUser();

  get isAdmin(): boolean {
    return this.auth.user()?.isAdmin ?? false;
  }

  ngOnInit(): void {
    void this.reload();
    void this.push.refresh();
  }

  /** Turn this device's push notifications on or off. */
  async toggleNotifications(): Promise<void> {
    try {
      if (this.push.subscribed()) {
        await this.push.disable();
        this.toasts.success('Notifications turned off for this device.');
      } else {
        await this.push.enable();
        this.toasts.success('Notifications on — this device will be notified.');
      }
    } catch {
      this.toasts.error(
        "Couldn't change notifications. Your browser may have blocked them — check its site permissions.",
      );
    }
  }

  async sendTestNotification(): Promise<void> {
    try {
      const delivered = await this.push.sendTest();
      this.toasts.success(
        delivered > 0
          ? `Test sent to ${delivered} device${delivered === 1 ? '' : 's'}.`
          : 'No subscribed devices to notify yet.',
      );
    } catch {
      this.toasts.error("Couldn't send the test notification.");
    }
  }

  /** "Invite email sent to X" flash after member creation (or a heads-up). */
  readonly inviteNote = signal<string | null>(null);

  async createUser(): Promise<void> {
    // Guard against a double-submit queuing two accounts for the same person.
    if (this.isCreatingUser()) {
      return;
    }
    this.isCreatingUser.set(true);
    this.error.set(null);
    try {
      const created = (await this.usersApi.create(this.newUser)) as {
        user: UserProfile;
        inviteEmailSent?: boolean;
      };
      this.inviteNote.set(
        created.inviteEmailSent
          ? `Invite email sent to ${created.user.email} ✓`
          : `Account created — no invite email (outgoing mail ${this.mailStatus()?.enabled ? 'failed' : 'not set up'}), share the password yourself.`,
      );
      setTimeout(() => this.inviteNote.set(null), 6000);
      this.newUser = this.emptyUser();
      this.isAddingUser.set(false);
      await this.reload();
    } catch (error) {
      // The create form lives in a sheet that covers the page-level banner, so
      // surface failures through a toast (its host renders above sheets).
      this.toasts.error(this.messageFrom(error, 'Could not create that account.'));
    } finally {
      this.isCreatingUser.set(false);
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

  /** Outgoing-mail status card (admin): configured state + test send. */
  readonly mailStatus = signal<{ enabled: boolean; host: string; from: string } | null>(null);
  readonly mailTestState = signal<'idle' | 'sending' | 'sent'>('idle');
  readonly mailTestError = signal<string | null>(null);

  async sendTestMail(): Promise<void> {
    const to = this.auth.user()?.email;
    if (!to || this.mailTestState() === 'sending') {
      return;
    }
    this.mailTestState.set('sending');
    this.mailTestError.set(null);
    try {
      await firstValueFrom(this.http.post('/api/v1/mail/test', { to }));
      this.mailTestState.set('sent');
      setTimeout(() => this.mailTestState.set('idle'), 2500);
    } catch (error) {
      this.mailTestState.set('idle');
      this.mailTestError.set(this.messageFrom(error, 'Test send failed.'));
    }
  }

  /** Member being edited (drives the edit sheet) and its working copy. */
  readonly editingMember = signal<UserProfile | null>(null);
  readonly isSavingMember = signal(false);
  memberDraft: {
    displayName: string;
    permission: 'read' | 'write' | 'delete';
    isAdmin: boolean;
    personId: string | null;
  } = { displayName: '', permission: 'write', isAdmin: false, personId: null };

  get myId(): string {
    return this.auth.user()?.id ?? '';
  }

  personName(personId: string | null | undefined): string | null {
    if (!personId) {
      return null;
    }
    return this.namedPeople().find((person) => person.id === personId)?.name ?? null;
  }

  startEditingMember(user: UserProfile): void {
    this.memberDraft = {
      displayName: user.displayName,
      permission: user.permission,
      isAdmin: user.isAdmin,
      personId: user.personId,
    };
    this.editingMember.set(user);
  }

  async saveMemberEdits(): Promise<void> {
    const target = this.editingMember();
    if (!target || this.isSavingMember() || !this.memberDraft.displayName.trim()) {
      return;
    }
    this.isSavingMember.set(true);
    this.error.set(null);
    try {
      await this.usersApi.update(target.id, {
        displayName: this.memberDraft.displayName.trim(),
        permission: this.memberDraft.permission,
        isAdmin: this.memberDraft.isAdmin,
        personId: this.memberDraft.personId,
      });
      this.editingMember.set(null);
      await this.reload();
    } catch (error) {
      // Edit runs inside a sheet; route the failure to a toast so it isn't
      // hidden behind the open sheet.
      this.toasts.error(this.messageFrom(error, 'Could not save those changes.'));
    } finally {
      this.isSavingMember.set(false);
    }
  }

  async disableMember(user: UserProfile): Promise<void> {
    const confirmed = await this.confirms.ask({
      title: `Disable ${user.displayName}?`,
      message:
        'They are signed out everywhere and cannot sign in until re-enabled. Nothing they created is affected.',
      confirmLabel: 'Disable',
    });
    if (!confirmed) {
      return;
    }
    await this.usersApi.disable(user.id);
    this.editingMember.set(null);
    await this.reload();
  }

  async enableMember(user: UserProfile): Promise<void> {
    await this.usersApi.enable(user.id);
    await this.reload();
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
      // A silent close read as "did nothing"; confirm the reset landed.
      this.toasts.success(`Password reset for ${target.displayName}`);
    } catch (error) {
      // Reset runs inside a sheet; a page-level banner would be hidden behind
      // it, so report through a toast instead.
      this.toasts.error(this.messageFrom(error, 'Could not reset that password.'));
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
    if (this.isAdmin) {
      this.mailStatus.set(
        await firstValueFrom(
          this.http.get<{ enabled: boolean; host: string; from: string }>('/api/v1/mail/status'),
        ).catch(() => null),
      );
    }
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
