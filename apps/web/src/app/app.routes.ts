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
    path: 'memories/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/memories/memory-detail-page').then((m) => m.MemoryDetailPage),
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
