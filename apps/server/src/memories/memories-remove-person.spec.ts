import { MemoriesService } from './memories.service';
import { PeopleService } from '../people/people.service';

/**
 * Cover for "they weren't here" — taking someone off a memory's guest list.
 *
 * The list is computed from faces, so removal means detaching the faces in
 * these photos that claim to be them. removeFaces only detaches faces that
 * belong to the person it is handed, and after a merge a face can still sit
 * under a merged-away identity while the chip shows the survivor's id — so
 * the faces have to be grouped by their OWNING person, not by the chip's.
 */
function makeService(rows: Array<{ face_id: string; owner_id: string }>) {
  const calls: Array<{ personId: string; faceIds: string[] }> = [];
  const db = {
    // requireMemory
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: 'memory-1' }]) }) }),
    }),
    execute: () => Promise.resolve({ rows }),
  };
  const people = {
    removeFaces: (personId: string, faceIds: string[]) => {
      calls.push({ personId, faceIds });
      return Promise.resolve({ removed: faceIds.length });
    },
  } as unknown as PeopleService;
  return { service: new MemoriesService(db as never, people), calls };
}

describe('MemoriesService.removePerson', () => {
  it('detaches the faces that put them on the list', async () => {
    const { service, calls } = makeService([
      { face_id: 'face-1', owner_id: 'walter' },
      { face_id: 'face-2', owner_id: 'walter' },
    ]);

    const result = await service.removePerson('memory-1', 'walter');

    expect(calls).toEqual([{ personId: 'walter', faceIds: ['face-1', 'face-2'] }]);
    expect(result).toEqual({ removed: 2 });
  });

  it('groups by the owning person, so a merged-away identity still lets go', async () => {
    // Both rows surfaced under the survivor's chip, but the faces themselves
    // are still owned by two different person rows.
    const { service, calls } = makeService([
      { face_id: 'face-1', owner_id: 'survivor' },
      { face_id: 'face-2', owner_id: 'merged-away' },
      { face_id: 'face-3', owner_id: 'survivor' },
    ]);

    const result = await service.removePerson('memory-1', 'survivor');

    expect(calls).toEqual([
      { personId: 'survivor', faceIds: ['face-1', 'face-3'] },
      { personId: 'merged-away', faceIds: ['face-2'] },
    ]);
    expect(result).toEqual({ removed: 3 });
  });

  it('does nothing when no face in this memory claims to be them', async () => {
    // A "behind the camera" chip comes from the device owner, not from a face
    // in these photos, so there is nothing here to detach.
    const { service, calls } = makeService([]);

    expect(await service.removePerson('memory-1', 'photographer')).toEqual({ removed: 0 });
    expect(calls).toEqual([]);
  });
});
