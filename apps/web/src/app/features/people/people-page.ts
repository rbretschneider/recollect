import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PeopleApiService, PersonSummary } from '../../core/api/people-api.service';
import { AppTopbar } from '../../shared/app-topbar';
import { PageLoading } from '../../shared/page-loading';
import { LoadError } from '../../shared/load-error';

/** Everyone face clustering has found, most-photographed first. */
@Component({
  selector: 'app-people-page',
  imports: [PageLoading, AppTopbar, RouterLink, LoadError],
  templateUrl: './people-page.html',
  styleUrl: './people-page.scss',
})
export class PeoplePage implements OnInit {
  private readonly api = inject(PeopleApiService);

  readonly people = signal<PersonSummary[]>([]);
  readonly isLoaded = signal(false);
  readonly loadFailed = signal(false);

  /** Real people first; anonymous clusters live in their own section below. */
  readonly named = computed(() => this.people().filter((person) => person.name !== null));
  readonly unnamed = computed(() => this.people().filter((person) => person.name === null));

  ngOnInit(): void {
    void this.load();
  }

  avatarUrl(person: PersonSummary): string | null {
    return person.coverFaceId ? this.api.faceCropUrl(person.coverFaceId) : null;
  }

  protected async load(): Promise<void> {
    this.loadFailed.set(false);
    try {
      const { people } = await this.api.list();
      this.people.set(people);
      this.isLoaded.set(true);
    } catch {
      this.loadFailed.set(true);
    }
  }
}
