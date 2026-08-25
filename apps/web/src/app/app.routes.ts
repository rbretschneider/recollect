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
  { path: '**', redirectTo: '' },
];
