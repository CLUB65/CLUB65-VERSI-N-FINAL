import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('security and egress: users table is the single source of truth and profiles is never queried', () => {
  const apiFile = readFileSync(resolve(process.cwd(), 'src/api.ts'), 'utf-8');

  // Verify that neither 'profiles' nor "profiles" is queried anywhere in api.ts
  const profilesMatch = apiFile.match(/\.from\(['"]profiles['"]\)/g);
  assert.equal(
    profilesMatch,
    null,
    'api.ts must never query the profiles view/table; users is the sole source of truth'
  );
});

test('security and egress: no query to users selects password (clave) or uses wildcard select(*)', () => {
  const apiFile = readFileSync(resolve(process.cwd(), 'src/api.ts'), 'utf-8');

  // Find all .from('users') query blocks
  const fromUsersIndices: number[] = [];
  let idx = 0;
  while ((idx = apiFile.indexOf(".from('users')", idx)) !== -1) {
    fromUsersIndices.push(idx);
    idx += ".from('users')".length;
  }

  assert.ok(fromUsersIndices.length > 0, 'api.ts should contain queries to users table');

  // For each query to users, inspect the subsequent .select() clause
  for (const pos of fromUsersIndices) {
    const chunk = apiFile.slice(pos, pos + 500);
    const selectMatch = chunk.match(/\.select\(([^)]*)\)/);
    if (selectMatch) {
      const selectedColumns = selectMatch[1].trim();

      // Wildcard check: bare .select() or select('*')
      assert.notEqual(
        selectedColumns,
        '',
        'No query to users should use bare .select() wildcard'
      );
      assert.equal(
        selectedColumns.includes('*'),
        false,
        'No query to users should use wildcard select(*)'
      );

      // Clave check: clave must never be in the projected columns
      const cols = selectedColumns.replace(/['"]/g, '').split(',').map(c => c.trim().toLowerCase());
      assert.equal(
        cols.includes('clave'),
        false,
        `Selected columns must never include 'clave'. Found: ${selectedColumns}`
      );
    }
  }
});

test('caching and in-flight deduplication: verify getUsers and getMe have request caching', () => {
  const apiFile = readFileSync(resolve(process.cwd(), 'src/api.ts'), 'utf-8');

  // Verify caching variables exist
  assert.ok(apiFile.includes('cachedUsersMap'), 'api.ts must define cachedUsersMap');
  assert.ok(apiFile.includes('usersInFlightPromise'), 'api.ts must define usersInFlightPromise');
  assert.ok(apiFile.includes('cachedCurrentUser'), 'api.ts must define cachedCurrentUser');
  assert.ok(apiFile.includes('currentUserInFlightPromise'), 'api.ts must define currentUserInFlightPromise');

  // Verify getMe supports in-flight deduplication
  assert.ok(
    apiFile.includes('if (currentUserInFlightPromise)'),
    'getMe must return running in-flight promise to prevent concurrent duplicate fetches'
  );

  // Verify getUsers supports in-flight deduplication
  assert.ok(
    apiFile.includes('if (usersInFlightPromise)'),
    'getUsers must return running in-flight promise to prevent concurrent duplicate fetches'
  );
});

test('UserContext and AuthContext: verify contexts are exported and share current user globally', () => {
  const authContextFile = readFileSync(resolve(process.cwd(), 'src/context/AuthContext.tsx'), 'utf-8');
  const userContextFile = readFileSync(resolve(process.cwd(), 'src/context/UserContext.tsx'), 'utf-8');

  assert.ok(authContextFile.includes('export function AuthProvider'), 'AuthContext must export AuthProvider');
  assert.ok(authContextFile.includes('export function useAuth'), 'AuthContext must export useAuth');
  assert.ok(authContextFile.includes('export function useUser'), 'AuthContext must export useUser');
  assert.ok(userContextFile.includes('export * from'), 'UserContext must re-export AuthContext');
});

test('egress rule 1: all Realtime channels clean up with removeChannel and never trigger full table refetches', () => {
  const appFile = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
  const useChatFile = readFileSync(resolve(process.cwd(), 'src/hooks/useChat.ts'), 'utf-8');

  // Every supabase.channel(...) in App.tsx and useChat.ts must have a matching supabase.removeChannel(...)
  const appChannels = (appFile.match(/\.channel\(/g) || []).length;
  const appRemoves = (appFile.match(/supabase\.removeChannel\(/g) || []).length;
  assert.equal(appChannels, appRemoves, `App.tsx has ${appChannels} channels but ${appRemoves} removeChannel calls`);
  assert.ok(appChannels >= 4, 'App.tsx should maintain its Realtime channels');

  const hookChannels = (useChatFile.match(/\.channel\(/g) || []).length;
  const hookRemoves = (useChatFile.match(/supabase\.removeChannel\(/g) || []).length;
  assert.equal(hookChannels, hookRemoves, `useChat.ts has ${hookChannels} channels but ${hookRemoves} removeChannel calls`);

  // Inspect the entire Realtime useEffect block in App.tsx (from realtime_all_messages to removeChannel(userNotifChannel))
  const rtStart = appFile.indexOf("channel('realtime_all_messages')");
  const rtEnd = appFile.indexOf('supabase.removeChannel(userNotifChannel)', rtStart);
  assert.ok(rtStart !== -1 && rtEnd > rtStart, 'Could not locate Realtime useEffect block in App.tsx');
  const rtBlock = appFile.slice(rtStart, rtEnd);

  assert.equal(rtBlock.includes('api.getChats('), false, 'Realtime handlers in App.tsx must never trigger full api.getChats() dumps');
  assert.equal(rtBlock.includes('api.getActivities('), false, 'Realtime handlers in App.tsx must patch activities from payload.new instead of calling api.getActivities()');
  assert.equal(rtBlock.includes('api.getBajas('), false, 'Realtime handlers in App.tsx must not refetch api.getBajas() on every activity change');
  assert.equal(rtBlock.includes('api.getMe('), false, 'Realtime user handler must patch from payload.new instead of calling api.getMe()');
  assert.equal(rtBlock.includes('api.getCancelledGroupNotices('), false, 'Realtime handlers must derive notices from payload.new instead of re-fetching');

  // Inspect useChat.ts chat_participants Realtime channel
  const hookRtStart = useChatFile.indexOf('user_chats_changes_');
  const hookRtEnd = useChatFile.indexOf('supabase.removeChannel(channel)', hookRtStart);
  assert.ok(hookRtStart !== -1 && hookRtEnd > hookRtStart);
  const hookRtBlock = useChatFile.slice(hookRtStart, hookRtEnd);
  assert.equal(hookRtBlock.includes('refreshChats()'), false, 'useChat.ts chat_participants Realtime must not call full refreshChats()');
});

test('egress rule 2: zero setInterval polling in frontend source files', () => {
  const filesToCheck = [
    'src/App.tsx',
    'src/api.ts',
    'src/services/chatService.ts',
    'src/hooks/useChat.ts',
    'src/context/AuthContext.tsx'
  ];

  for (const relPath of filesToCheck) {
    const content = readFileSync(resolve(process.cwd(), relPath), 'utf-8');
    assert.equal(
      /\bsetInterval\s*\(/.test(content),
      false,
      `${relPath} must not contain setInterval polling loops`
    );
  }
});

test('egress rule 3: reviews capped at 20 with caching, mass users/messages exclude Base64 avatars, zero select(*) wildcards', () => {
  const apiFile = readFileSync(resolve(process.cwd(), 'src/api.ts'), 'utf-8');
  const chatServiceFile = readFileSync(resolve(process.cwd(), 'src/services/chatService.ts'), 'utf-8');
  const appFile = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf-8');

  // Zero .select('*') wildcards in api.ts, chatService.ts, and App.tsx
  assert.equal(/\.select\(\s*['"]\*['"]\s*\)/.test(apiFile), false, 'api.ts must not contain .select("*")');
  assert.equal(/\.select\(\s*['"]\*['"]\s*\)/.test(chatServiceFile), false, 'chatService.ts must not contain .select("*")');
  assert.equal(/\.select\(\s*['"]\*['"]\s*\)/.test(appFile), false, 'App.tsx must not contain .select("*")');

  // getReviews must use .limit(20) and caching
  const reviewsStart = apiFile.indexOf('async getReviews(');
  const reviewsEnd = apiFile.indexOf('async createReview(', reviewsStart);
  assert.ok(reviewsStart !== -1 && reviewsEnd > reviewsStart);
  const reviewsBlock = apiFile.slice(reviewsStart, reviewsEnd);
  assert.ok(reviewsBlock.includes('.limit(20)'), 'getReviews() must limit initial query to 20 rows');
  assert.ok(reviewsBlock.includes('cachedReviewsList'), 'getReviews() must use in-memory cache');

  // getUsers must exclude avatar in bulk query
  const usersStart = apiFile.indexOf('async getUsers(');
  const usersEnd = apiFile.indexOf('async expirePendingProposals(', usersStart);
  assert.ok(usersStart !== -1 && usersEnd > usersStart);
  const usersBlock = apiFile.slice(usersStart, usersEnd);
  const usersSelectMatch = usersBlock.match(/\.select\(['"]([^'"]+)['"]\)/);
  assert.ok(usersSelectMatch, 'getUsers() must have an explicit select()');
  const usersCols = usersSelectMatch[1].split(',').map(c => c.trim().toLowerCase());
  assert.equal(usersCols.includes('avatar'), false, 'getUsers() must not fetch avatar Base64 strings in bulk');

  // getInstitutions must exclude avatar and cache/deduplicate
  const instStart = apiFile.indexOf('async getInstitutions(');
  const instEnd = apiFile.indexOf('async getPendingInstitutions(', instStart);
  assert.ok(instStart !== -1 && instEnd > instStart);
  const instBlock = apiFile.slice(instStart, instEnd);
  const instSelectMatch = instBlock.match(/\.select\(['"]([^'"]+)['"]\)/);
  assert.ok(instSelectMatch, 'getInstitutions() must have an explicit select()');
  const instCols = instSelectMatch[1].split(',').map(c => c.trim().toLowerCase());
  assert.equal(instCols.includes('avatar'), false, 'getInstitutions() must not fetch avatar Base64 strings in bulk');
  assert.ok(instBlock.includes('institutionsInFlightPromise'), 'getInstitutions() must deduplicate concurrent pending/approved calls');

  // chatService bulk messages & participant user joins must exclude avatar
  assert.equal(
    chatServiceFile.includes("select('id, chat_id, sender_id, sender, avatar"),
    false,
    'chatService.ts must not select avatar column on bulk messages'
  );
  assert.equal(
    /users:user_id\s*\([^)]*\bavatar\b[^)]*\)/.test(chatServiceFile),
    false,
    'chatService.ts must not join users.avatar in bulk chat_participants queries'
  );
});

test('egress rule 4: useEffect dependency arrays prevent object-reference re-execution loops', () => {
  const appFile = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
  const useChatFile = readFileSync(resolve(process.cwd(), 'src/hooks/useChat.ts'), 'utf-8');

  assert.equal(
    appFile.includes('[currentView, activities, currentUser]'),
    false,
    'App.tsx view-tracking useEffect must depend only on [currentView] using refs'
  );
  assert.equal(
    appFile.includes('[currentUser, sanctionsList, bannedUsersList]'),
    false,
    'App.tsx sanctions useEffect must depend on currentUser?.id instead of full currentUser object'
  );
  assert.equal(
    /const refreshChats = useCallback\([\s\S]*?\}, \[currentUser\]\);/.test(useChatFile),
    false,
    'useChat.ts refreshChats must depend on primitive currentUserId, not full currentUser object'
  );
  assert.equal(
    /const loadMessages = useCallback\([\s\S]*?\}, \[currentUser\]\);/.test(useChatFile),
    false,
    'useChat.ts loadMessages must depend on primitive currentUserId, not full currentUser object'
  );
});

