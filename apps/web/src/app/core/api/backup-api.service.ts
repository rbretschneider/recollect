import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';

/** Mirrors the server's BackupSettings. */
export interface BackupSettings {
  mode: 'off' | 'daily' | 'weekly';
  time: string;
  weekday: number;
  directory: string;
  keep: number;
  includeMlData: boolean;
}

export interface BackupLastRun {
  at: string;
  ok: boolean;
  sizeBytes?: number;
  message?: string;
}

export interface BackupFile {
  name: string;
  sizeBytes: number;
  createdAt: string;
  kind: 'dump' | 'json';
}

export interface BackupStatus {
  settings: BackupSettings;
  /** The directory actually in use, after settings/env/default fallback. */
  directory: string;
  lastRun: BackupLastRun | null;
  backups: BackupFile[];
}

/** Raw HTTP calls for scheduled database backups (admin only). */
@Injectable({ providedIn: 'root' })
export class BackupApiService {
  private readonly http = inject(HttpClient);

  status(): Promise<BackupStatus> {
    return firstValueFrom(this.http.get<BackupStatus>('/api/v1/backup'));
  }

  saveSettings(settings: BackupSettings): Promise<{ settings: BackupSettings }> {
    return firstValueFrom(
      this.http.post<{ settings: BackupSettings }>('/api/v1/backup/settings', settings),
    );
  }

  runNow(): Promise<{ accepted: true }> {
    return firstValueFrom(this.http.post<{ accepted: true }>('/api/v1/backup/run', {}));
  }

  downloadUrl(name: string): string {
    return `/api/v1/backup/file/${encodeURIComponent(name)}`;
  }

  remove(name: string): Promise<void> {
    return firstValueFrom(
      this.http.delete<void>(`/api/v1/backup/file/${encodeURIComponent(name)}`),
    );
  }
}
