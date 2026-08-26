import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { UserProfile } from './api-models';

/** Input for creating a household member. */
export interface CreateUserInput {
  email: string;
  displayName: string;
  password: string;
  permission: 'read' | 'write' | 'delete';
  isAdmin: boolean;
}

/** Raw HTTP calls for household member management (admin). */
@Injectable({ providedIn: 'root' })
export class UsersApiService {
  private readonly http = inject(HttpClient);

  list(): Promise<{ users: UserProfile[] }> {
    return firstValueFrom(this.http.get<{ users: UserProfile[] }>('/api/v1/users'));
  }

  create(input: CreateUserInput): Promise<{ user: UserProfile }> {
    return firstValueFrom(this.http.post<{ user: UserProfile }>('/api/v1/users', input));
  }
}
