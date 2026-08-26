import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { InboxSuggestion, MemoryDetail, MemorySummary } from './api-models';

/** Raw HTTP calls for the Memory Inbox and memories. */
@Injectable({ providedIn: 'root' })
export class MemoriesApiService {
  private readonly http = inject(HttpClient);

  listInbox(): Promise<{ suggestions: InboxSuggestion[] }> {
    return firstValueFrom(this.http.get<{ suggestions: InboxSuggestion[] }>('/api/v1/inbox'));
  }

  acceptSuggestion(clusterId: string, title?: string): Promise<{ memoryId: string }> {
    return firstValueFrom(
      this.http.post<{ memoryId: string }>(`/api/v1/inbox/${clusterId}/accept`, { title }),
    );
  }

  dismissSuggestion(clusterId: string): Promise<void> {
    return firstValueFrom(this.http.post<void>(`/api/v1/inbox/${clusterId}/dismiss`, {}));
  }

  getSuggestionAssets(clusterId: string): Promise<{ assetIds: string[] }> {
    return firstValueFrom(this.http.get<{ assetIds: string[] }>(`/api/v1/inbox/${clusterId}/assets`));
  }

  deleteMemory(memoryId: string): Promise<void> {
    return firstValueFrom(this.http.delete<void>(`/api/v1/memories/${memoryId}`));
  }

  listMemories(): Promise<{ memories: MemorySummary[] }> {
    return firstValueFrom(this.http.get<{ memories: MemorySummary[] }>('/api/v1/memories'));
  }

  getMemory(memoryId: string): Promise<MemoryDetail> {
    return firstValueFrom(this.http.get<MemoryDetail>(`/api/v1/memories/${memoryId}`));
  }

  updateMemory(memoryId: string, edits: { title?: string; locationLabel?: string }): Promise<void> {
    return firstValueFrom(this.http.patch<void>(`/api/v1/memories/${memoryId}`, edits));
  }

  writeJournal(memoryId: string, bodyMd: string): Promise<void> {
    return firstValueFrom(this.http.put<void>(`/api/v1/memories/${memoryId}/journal`, { bodyMd }));
  }
}
