import { Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PeopleApiService, PersonSummary } from '../../core/api/people-api.service';
import { AppTopbar } from '../../shared/app-topbar';
import { BottomNav } from '../../shared/bottom-nav';

/** Everyone face clustering has found, most-photographed first. */
@Component({
  selector: 'app-people-page',
  imports: [AppTopbar, BottomNav, RouterLink],
  templateUrl: './people-page.html',
  styleUrl: './people-page.scss',
})
export class PeoplePage implements OnInit {
  private readonly api = inject(PeopleApiService);

  readonly people = signal<PersonSummary[]>([]);
  readonly isLoaded = signal(false);

  ngOnInit(): void {
    void this.load();
  }

  avatarUrl(person: PersonSummary): string | null {
    return person.coverAssetId ? `/api/v1/assets/${person.coverAssetId}/thumb/240` : null;
  }

  private async load(): Promise<void> {
    const { people } = await this.api.list();
    this.people.set(people);
    this.isLoaded.set(true);
  }
}
