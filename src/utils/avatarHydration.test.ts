import test from 'node:test';
import assert from 'node:assert/strict';
import { collectNeededAvatarUserIds, mergeAvatarsIntoUsersMap } from './avatarHydration';
import { supabase } from '../supabaseClient';
import { api, invalidateApiCaches } from '../api';

test('collectNeededAvatarUserIds collects organizer, chat participant, sender, and contact IDs without duplicates or already-hydrated IDs', () => {
  const allUsersMap: Record<string, any> = {
    usr_org_1: {
      id: 'usr_org_1',
      usuario: 'corredoresfelices',
      apodo: 'Deportistas Felices',
      avatar: ''
    },
    'deportistas felices': {
      id: 'usr_org_1',
      usuario: 'corredoresfelices',
      apodo: 'Deportistas Felices',
      avatar: ''
    },
    usr_org_loaded: {
      id: 'usr_org_loaded',
      usuario: 'club65',
      apodo: 'CLUB65',
      avatar: 'https://xklmlvhgmepepkiptzqg.supabase.co/storage/v1/object/public/avatars/club65.jpg'
    },
    usr_marito: {
      id: 'usr_marito',
      usuario: 'marito',
      apodo: 'Marito',
      avatar: ''
    },
    marito: {
      id: 'usr_marito',
      usuario: 'marito',
      apodo: 'Marito',
      avatar: ''
    },
    usr_gus: {
      id: 'usr_gus',
      usuario: 'gus',
      apodo: 'Gustavo Mac',
      avatar: ''
    },
    'gustavo mac': {
      id: 'usr_gus',
      usuario: 'gus',
      apodo: 'Gustavo Mac',
      avatar: ''
    }
  };

  const ids = collectNeededAvatarUserIds({
    activities: [
      { id: 1, title: 'Natación', organizerId: 'usr_org_1', organizer: 'Corredores Felices' },
      { id: 2, title: 'Gimnasia', organizerId: 'usr_org_loaded', organizer: 'CLUB65' }
    ],
    chats: [
      {
        id: 'chat-priv-1',
        type: 'privado',
        title: 'Marito',
        participantIds: ['usr_neri', 'usr_marito'],
        participants: ['Neri', 'Marito'],
        messages: [
          { id: 'm1', senderId: 'system', sender: 'Sistema CLUB65', text: 'Hola' },
          { id: 'm2', senderId: 'usr_gus', sender: 'Gustavo Mac', text: 'Buen día' }
        ]
      }
    ],
    contacts: [{ id: 'c_1', nombre: 'Marito', foto: null }],
    allUsersMap,
    currentUser: {
      id: 'usr_neri',
      usuario: 'Nerina',
      apodo: 'Neri',
      avatar: 'https://xklmlvhgmepepkiptzqg.supabase.co/storage/v1/object/public/avatars/neri.jpg'
    },
    attemptedIds: new Set(['usr_already_tried'])
  });

  assert.deepEqual(ids.sort(), ['usr_gus', 'usr_marito', 'usr_org_1']);
});

test('collectNeededAvatarUserIds skips already-attempted IDs and handles empty inputs', () => {
  const attemptedIds = new Set(['usr_org_1']);
  const ids = collectNeededAvatarUserIds({
    activities: [{ id: 1, organizerId: 'usr_org_1' }],
    allUsersMap: { usr_org_1: { id: 'usr_org_1', avatar: '' } },
    attemptedIds
  });
  assert.deepEqual(ids, []);
  assert.deepEqual(collectNeededAvatarUserIds({}), []);
});

test('mergeAvatarsIntoUsersMap updates all alias keys for a user and preserves reference when nothing changes', () => {
  const baseUser = { id: 'usr_1', usuario: 'corredoresfelices', apodo: 'Deportistas Felices', avatar: '' };
  const loadedUser = {
    id: 'usr_2',
    usuario: 'club65',
    apodo: 'CLUB65',
    avatar: 'https://example.com/club65.jpg'
  };
  const prevMap = {
    usr_1: baseUser,
    corredoresfelices: baseUser,
    'deportistas felices': baseUser,
    usr_2: loadedUser,
    club65: loadedUser
  };

  const merged = mergeAvatarsIntoUsersMap(prevMap, {
    usr_1: 'https://example.com/deportistas.jpg',
    usr_2: 'https://example.com/club65.jpg'
  });

  assert.notEqual(merged, prevMap);
  assert.equal(merged.usr_1.avatar, 'https://example.com/deportistas.jpg');
  assert.equal(merged.corredoresfelices.avatar, 'https://example.com/deportistas.jpg');
  assert.equal(merged['deportistas felices'].avatar, 'https://example.com/deportistas.jpg');
  assert.equal(merged.usr_2.avatar, 'https://example.com/club65.jpg');

  // Re-merging identical avatars must return the exact same object reference
  const mergedAgain = mergeAvatarsIntoUsersMap(merged, {
    usr_1: 'https://example.com/deportistas.jpg',
    usr_2: 'https://example.com/club65.jpg'
  });
  assert.equal(mergedAgain, merged);
});

test('api.getUserAvatarsByIds batches uncached IDs into one .in() query, caches results, and does not re-query cached IDs', async () => {
  invalidateApiCaches();
  const originalFrom = supabase.from.bind(supabase);
  let selectCalls = 0;
  let requestedIdsLog: string[][] = [];

  (supabase as any).from = (table: string) => {
    assert.equal(table, 'users');
    const builder: any = {
      select(cols: string) {
        assert.equal(cols, 'id, avatar');
        return builder;
      },
      in(_col: string, ids: string[]) {
        selectCalls++;
        requestedIdsLog.push([...ids]);
        return Promise.resolve({
          data: [
            { id: 'usr_a', avatar: 'https://xklmlvhgmepepkiptzqg.supabase.co/storage/v1/object/public/avatars/a.jpg' },
            { id: 'usr_b', avatar: '' }
          ],
          error: null
        });
      }
    };
    return builder;
  };

  try {
    const first = await api.getUserAvatarsByIds(['usr_a', 'usr_b', 'usr_a']);
    assert.equal(selectCalls, 1);
    assert.deepEqual(requestedIdsLog[0], ['usr_a', 'usr_b']);
    assert.equal(first.usr_a, 'https://xklmlvhgmepepkiptzqg.supabase.co/storage/v1/object/public/avatars/a.jpg');
    assert.equal(first.usr_b, '');

    // Second call for cached IDs (including empty avatar usr_b) must trigger zero Supabase queries
    const second = await api.getUserAvatarsByIds(['usr_a', 'usr_b']);
    assert.equal(selectCalls, 1);
    assert.equal(second.usr_a, first.usr_a);
    assert.equal(second.usr_b, '');
  } finally {
    invalidateApiCaches();
    (supabase as any).from = originalFrom;
  }
});
