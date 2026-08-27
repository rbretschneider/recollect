import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: 'setup',
    loadComponent: () => import('./features/setup/setup-page').then((m) => m.SetupPage),
  },
  {
    path: 'login',
    loadComponent: () => import('./features/login/login-page').then((m) => m.LoginPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./features/photos/photos-page').then((m) => m.PhotosPage),
  },
  {
    path: 'memories',
    canActivate: [authGuard],
    loadComponent: () => import('./features/memories/memories-page').then((m) => m.MemoriesPage),
  },
  {
    // Must precede memories/:id so "inbox" is not read as an id.
    path: 'memories/inbox',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/memories/inbox-review-page').then((m) => m.InboxReviewPage),
  },
  {
    path: 'memories/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/memories/memory-detail-page').then((m) => m.MemoryDetailPage),
  },
  {
    path: 'search',
    canActivate: [authGuard],
    loadComponent: () => import('./features/search/search-page').then((m) => m.SearchPage),
  },
  {
    path: 'albums',
    canActivate: [authGuard],
    loadComponent: () => import('./features/albums/albums-page').then((m) => m.AlbumsPage),
  },
  {
    path: 'albums/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/albums/album-detail-page').then((m) => m.AlbumDetailPage),
  },
  {
    path: 'folders',
    canActivate: [authGuard],
    loadComponent: () => import('./features/folders/folders-page').then((m) => m.FoldersPage),
  },
  {
    path: 'people',
    canActivate: [authGuard],
    loadComponent: () => import('./features/people/people-page').then((m) => m.PeoplePage),
  },
  {
    path: 'people/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./features/people/person-page').then((m) => m.PersonPage),
  },
  {
    path: 'places',
    canActivate: [authGuard],
    loadComponent: () => import('./features/places/places-page').then((m) => m.PlacesPage),
  },
  {
    path: 'library',
    canActivate: [authGuard],
    loadComponent: () => import('./features/library/library-page').then((m) => m.LibraryPage),
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () => import('./features/settings/settings-page').then((m) => m.SettingsPage),
  },
  {
    path: 'logs',
    canActivate: [authGuard],
    loadComponent: () => import('./features/logs/logs-page').then((m) => m.LogsPage),
  },
  {
    path: 'trash',
    canActivate: [authGuard],
    loadComponent: () => import('./features/trash/trash-page').then((m) => m.TrashPage),
  },
  {
    // Public share links — deliberately outside the auth guard.
    path: 's/:token',
    loadComponent: () =>
      import('./features/share/shared-view-page').then((m) => m.SharedViewPage),
  },
  { path: '**', redirectTo: '' },
];
