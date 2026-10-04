import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthStateService } from '../../core/auth/auth-state.service';
import { SearchPage } from './search-page';

/**
 * Cover for selecting search results.
 *
 * Results used to be tap-to-open and nothing else, so filing a photo you had
 * just found meant going back to the timeline and finding it a second time.
 * Press-and-hold now starts the same selection the timeline uses — and the
 * thing that breaks quietly is the tap: once selection is on, a tap must pick
 * the photo rather than opening the viewer over the grid.
 */
describe('SearchPage selection', () => {
  let fixture: ComponentFixture<SearchPage>;
  let page: SearchPage;

  function signInWith(permission: 'read' | 'write' | 'delete'): void {
    const auth = TestBed.inject(AuthStateService);
    (auth.user as unknown as { set: (value: unknown) => void }).set({
      id: 'user-1',
      displayName: 'Ryan',
      permission,
      isAdmin: false,
    });
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SearchPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(SearchPage);
    page = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => fixture?.destroy());

  it('starts selection on a press-and-hold and picks that photo', () => {
    signInWith('write');

    page.onHitLongPress('asset-1');

    expect(page.isSelecting()).toBe(true);
    expect(page.isSelected('asset-1')).toBe(true);
  });

  // Read-only users have nothing to file into; selection would dead-end.
  it('does not start selection for a read-only user', () => {
    signInWith('read');

    page.onHitLongPress('asset-1');

    expect(page.isSelecting()).toBe(false);
  });

  // THE REGRESSION: a tap during selection must pick, never open the viewer.
  it('picks on tap while selecting instead of opening the photo', () => {
    signInWith('write');
    page.onHitLongPress('asset-1');

    page.onHitClick('assets', 1, 'asset-2');

    expect(page.isSelected('asset-2')).toBe(true);
    expect(page.viewerIndex()).toBeNull();
  });

  it('opens the photo on tap when nothing is being selected', () => {
    signInWith('write');

    page.onHitClick('assets', 3, 'asset-4');

    expect(page.viewerIndex()).toBe(3);
    expect(page.isSelecting()).toBe(false);
  });

  it('reads a semantic hit from its own list, not the filename hits', () => {
    signInWith('write');

    page.onHitClick('semantic', 2, 'asset-5');

    expect(page.viewerSource()).toBe('semantic');
    expect(page.viewerIndex()).toBe(2);
  });

  it('tapping a picked photo again lets it go', () => {
    signInWith('write');
    page.onHitLongPress('asset-1');

    page.onHitClick('assets', 0, 'asset-1');

    expect(page.isSelected('asset-1')).toBe(false);
    // Still selecting: emptying the selection is not the same as leaving.
    expect(page.isSelecting()).toBe(true);
  });

  it('cancelling clears both the mode and what was picked', () => {
    signInWith('write');
    page.onHitLongPress('asset-1');

    page.cancelSelecting();

    expect(page.isSelecting()).toBe(false);
    expect(page.selectedIdList()).toEqual([]);
  });
});
