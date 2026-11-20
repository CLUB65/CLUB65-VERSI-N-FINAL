import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isUserReview,
  calculateReviewsAverage,
  filterReviewsForActivity,
  formatActivitySystemNotice,
  getReviewsOfUserActivities,
  sanitizeProfileAvatar,
  sanitizeProfileBio
} from './chatLogic.ts';

test('isUserReview correctly identifies reviews authored by current user', () => {
  const userA = {
    id: 'user-uuid-123',
    usuario: 'marta_gomez',
    apodo: 'Marta Gómez',
    nombre: 'Marta Gómez',
    email: 'marta@example.com'
  };

  const userB = {
    id: 'user-uuid-456',
    usuario: 'carlos_lopez',
    apodo: 'Carlos López',
    nombre: 'Carlos López',
    email: 'carlos@example.com'
  };

  // Review created by Marta by id
  const reviewByMartaId = {
    id: 1,
    actividadId: 10,
    autor: 'Marta Gómez',
    usuarioId: 'user-uuid-123',
    estrellas: 5,
    texto: 'Excelente taller'
  };
  assert.equal(isUserReview(reviewByMartaId, userA), true);
  assert.equal(isUserReview(reviewByMartaId, userB), false);

  // Review created by Marta by usuario
  const reviewByMartaUsername = {
    id: 2,
    actividadId: 10,
    autor: 'marta_gomez',
    estrellas: 4,
    texto: 'Muy lindo momento'
  };
  assert.equal(isUserReview(reviewByMartaUsername, userA), true);
  assert.equal(isUserReview(reviewByMartaUsername, userB), false);

  // Review from Supabase with autor_id and autor_nombre
  const reviewSupabase = {
    id: 3,
    actividad_id: 15,
    autor_id: 'user-uuid-123',
    autor_nombre: 'Marta',
    calificacion: 5,
    comentario: 'Hermoso compartir'
  };
  assert.equal(isUserReview(reviewSupabase, userA), true);
  assert.equal(isUserReview(reviewSupabase, userB), false);

  // Review by Carlos
  const reviewByCarlos = {
    id: 4,
    actividadId: 10,
    autor: 'Carlos López',
    usuarioId: 'user-uuid-456',
    estrellas: 5,
    texto: 'Me encantó la clase'
  };
  assert.equal(isUserReview(reviewByCarlos, userB), true);
  assert.equal(isUserReview(reviewByCarlos, userA), false);

  // Null/undefined checks
  assert.equal(isUserReview(null, userA), false);
  assert.equal(isUserReview(reviewByMartaId, null), false);
  assert.equal(isUserReview({}, userA), false);
});

test('calculateReviewsAverage calculates correct mathematical average and formatted value', () => {
  // Empty array
  const empty = calculateReviewsAverage([]);
  assert.equal(empty.count, 0);
  assert.equal(empty.average, 0);
  assert.equal(empty.formatted, '0.0');

  // Single 5-star review
  const single = calculateReviewsAverage([{ estrellas: 5 }]);
  assert.equal(single.count, 1);
  assert.equal(single.average, 5);
  assert.equal(single.formatted, '5.0');

  // Multiple reviews with decimal average
  const multi = calculateReviewsAverage([
    { estrellas: 5 },
    { estrellas: 4 }
  ]);
  assert.equal(multi.count, 2);
  assert.equal(multi.average, 4.5);
  assert.equal(multi.formatted, '4.5');

  // Three reviews: 5, 5, 4 -> 14 / 3 = 4.6666... -> "4.7"
  const rounded = calculateReviewsAverage([
    { estrellas: 5 },
    { estrellas: 5 },
    { estrellas: 4 }
  ]);
  assert.equal(rounded.count, 3);
  assert.equal(rounded.formatted, '4.7');

  // Supports calificacion property as fallback
  const califFallback = calculateReviewsAverage([
    { calificacion: 4 },
    { calificacion: 4 }
  ]);
  assert.equal(califFallback.count, 2);
  assert.equal(califFallback.average, 4);
  assert.equal(califFallback.formatted, '4.0');
});

test('filterReviewsForActivity filters reviews correctly by activityId or normalized activity title', () => {
  const reviews = [
    {
      id: 1,
      actividadId: 101,
      actividad: 'Taller de Pintura y Acuarela',
      autor: 'Marta',
      estrellas: 5
    },
    {
      id: 2,
      actividadId: 101,
      actividad: 'Taller de Pintura y Acuarela',
      autor: 'Roberto',
      estrellas: 4
    },
    {
      id: 3,
      actividadId: 202,
      actividad: 'Clase de Yoga Suave',
      autor: 'Lucía',
      estrellas: 5
    },
    {
      id: 4,
      actividad_id: 101,
      actividad_titulo: 'Taller de Pintura y Acuarela',
      autor: 'Carlos',
      calificacion: 5
    }
  ];

  // Match by activity ID (numeric)
  const byId = filterReviewsForActivity(reviews, 101, null);
  assert.equal(byId.length, 3);
  assert.deepEqual(byId.map(r => r.id), [1, 2, 4]);

  // Match by activity ID (string)
  const byStringId = filterReviewsForActivity(reviews, '202', null);
  assert.equal(byStringId.length, 1);
  assert.equal(byStringId[0].id, 3);

  // Match by normalized title
  const byTitle = filterReviewsForActivity(reviews, null, 'taller de pintura y acuarela');
  assert.equal(byTitle.length, 3);

  // Match non-existing
  const none = filterReviewsForActivity(reviews, 9999, 'Actividad Inexistente');
  assert.equal(none.length, 0);

  // Safe with null/undefined array
  assert.deepEqual(filterReviewsForActivity(null as any, 101, null), []);
});

test('formatActivitySystemNotice replaces "{apodo} fue agregado al grupo..." with "¡Bienvenido a {actividad}, {apodo}!" for activity groups', () => {
  // Scenario 1: Activity group with old string in database
  const chat1 = { activityId: 10, name: 'PRUEBA RESEÑA 3', type: 'grupal' };
  const act1 = { id: 10, title: 'PRUEBA RESEÑA 3' };
  const notice1 = 'Nerina fue agregado al grupo por el moderador del grupo.';
  assert.equal(
    formatActivitySystemNotice(notice1, chat1, act1),
    '¡Bienvenido a PRUEBA RESEÑA 3, Nerina!'
  );

  // Scenario 2: Activity group with "Grupo: " prefix in title
  const chat2 = { activityId: 25, title: 'Grupo: Taller de Pintura y Acuarela', type: 'grupal' };
  const notice2 = 'Marta fue agregado al grupo por el moderador del grupo.';
  assert.equal(
    formatActivitySystemNotice(notice2, chat2),
    '¡Bienvenido a Taller de Pintura y Acuarela, Marta!'
  );

  // Scenario 3: Email as participant
  const chat3 = { activityId: 7, name: 'Clase de Yoga' };
  const notice3 = 'carlos@gmail.com fue agregado al grupo por el moderador del grupo.';
  assert.equal(
    formatActivitySystemNotice(notice3, chat3),
    '¡Bienvenido a Clase de Yoga, carlos!'
  );

  // Scenario 4: Already in welcome format
  const notice4 = '¡Bienvenido a Ajedrez, Pedro!';
  assert.equal(
    formatActivitySystemNotice(notice4, { activityId: 100, name: 'Ajedrez' }),
    '¡Bienvenido a Ajedrez, Pedro!'
  );

  // Scenario 5: Removal notice should NOT be changed
  const noticeRemoval = 'Roberto fue retirado del grupo por el moderador del grupo.';
  assert.equal(
    formatActivitySystemNotice(noticeRemoval, chat1, act1),
    'Roberto fue retirado del grupo por el moderador del grupo.'
  );

  // Scenario 6: Non-activity group retains its standard text
  const customChat = { id: 'chat-friends', name: 'Amigos de Merlo', type: 'grupal' };
  const customNotice = 'Carlos fue agregado al grupo por el moderador del grupo.';
  assert.equal(
    formatActivitySystemNotice(customNotice, customChat),
    'Carlos fue agregado al grupo por el moderador del grupo.'
  );
});

test('sanitizeProfileAvatar rejects unsplash and placeholder mock images, keeps real uploads', () => {
  // Mock unsplash urls
  assert.equal(sanitizeProfileAvatar('https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=250'), null);
  assert.equal(sanitizeProfileAvatar('https://images.unsplash.com/photo-1544005313-94ddf0286df2'), null);
  assert.equal(sanitizeProfileAvatar('https://via.placeholder.com/150'), null);

  // Real user uploads (base64, local assets, real custom URLs)
  assert.equal(sanitizeProfileAvatar('data:image/jpeg;base64,/9j/4AAQSkZJRg...'), 'data:image/jpeg;base64,/9j/4AAQSkZJRg...');
  assert.equal(sanitizeProfileAvatar('/assets/aistudio/foto_real.jpg'), '/assets/aistudio/foto_real.jpg');
  assert.equal(sanitizeProfileAvatar('https://xklmlvhgmepepkiptzqg.supabase.co/storage/v1/object/public/avatars/user1.png'), 'https://xklmlvhgmepepkiptzqg.supabase.co/storage/v1/object/public/avatars/user1.png');

  // Empty / null checks
  assert.equal(sanitizeProfileAvatar(null), null);
  assert.equal(sanitizeProfileAvatar(undefined), null);
  assert.equal(sanitizeProfileAvatar(''), null);
  assert.equal(sanitizeProfileAvatar('   '), null);
});

test('sanitizeProfileBio rejects hardcoded fallback bios, keeps real custom bios', () => {
  // Hardcoded bios
  assert.equal(sanitizeProfileBio('Vecino activo de Tres de Febrero.'), null);
  assert.equal(sanitizeProfileBio('Vecino activo de Tres de Febrero'), null);
  assert.equal(sanitizeProfileBio('Miembro de la comunidad de CLUB65.'), null);
  assert.equal(sanitizeProfileBio('Miembro activo de la comunidad de CLUB65.'), null);
  assert.equal(sanitizeProfileBio('Organizador activo de actividades en CLUB65.'), null);

  // Real user bios
  assert.equal(sanitizeProfileBio('Buen día!'), 'Buen día!');
  assert.equal(sanitizeProfileBio('¡Me llamo Marito! ¿Cómo estás?'), '¡Me llamo Marito! ¿Cómo estás?');
  assert.equal(sanitizeProfileBio('Organización comunitaria de Tres de Febrero.'), 'Organización comunitaria de Tres de Febrero.');

  // Empty / null checks
  assert.equal(sanitizeProfileBio(null), null);
  assert.equal(sanitizeProfileBio(undefined), null);
  assert.equal(sanitizeProfileBio(''), null);
  assert.equal(sanitizeProfileBio('   '), null);
});

test('getReviewsOfUserActivities strictly returns reviews that OTHER users wrote for activities organized by the profile user', () => {
  const profileNeri = {
    id: 'usr_1793003176395_bi3dc',
    usuario: 'Nerina',
    apodo: 'Neri'
  };

  const profileClub65 = {
    id: 'usr_1793081503254_pcnbd',
    usuario: 'CLUB65',
    apodo: 'CLUB65'
  };

  const activities = [
    {
      id: '1794008683478',
      title: 'PRUEBA RESEÑA 3',
      organizer: 'CLUB65',
      organizerId: 'usr_1793081503254_pcnbd'
    },
    {
      id: 'act_neri_taller',
      title: 'Taller de Yoga de Neri',
      organizer: 'Neri',
      organizerId: 'usr_1793003176395_bi3dc'
    }
  ];

  const reviews = [
    // Review 1: Authored by Neri for activity organized by CLUB65
    {
      id: 'rev_1',
      actividadId: '1794008683478',
      actividad: 'PRUEBA RESEÑA 3',
      autor: 'Neri',
      userId: 'usr_1793003176395_bi3dc',
      estrellas: 3,
      texto: 'Me gustó.'
    },
    // Review 2: Authored by Marito for activity organized by Neri
    {
      id: 'rev_2',
      actividadId: 'act_neri_taller',
      actividad: 'Taller de Yoga de Neri',
      autor: 'Marito',
      userId: 'usr_marito',
      estrellas: 5,
      texto: '¡Excelente profe Neri!'
    },
    // Review 3: Authored by Neri for her OWN activity (self-review)
    {
      id: 'rev_3',
      actividadId: 'act_neri_taller',
      actividad: 'Taller de Yoga de Neri',
      autor: 'Neri',
      userId: 'usr_1793003176395_bi3dc',
      estrellas: 5,
      texto: 'Auto reseña'
    }
  ];

  // 1. For Neri's profile:
  // - Review 1 was authored by Neri, and is for CLUB65's activity -> MUST NOT APPEAR!
  // - Review 3 was authored by Neri herself -> MUST NOT APPEAR!
  // - Review 2 was authored by Marito for Neri's activity -> MUST APPEAR!
  const neriReviews = getReviewsOfUserActivities(reviews, profileNeri, activities);
  assert.equal(neriReviews.length, 1);
  assert.equal(neriReviews[0].id, 'rev_2');
  assert.equal(neriReviews[0].autor, 'Marito');

  // 2. For CLUB65's profile:
  // - Review 1 was authored by Neri for CLUB65's activity -> MUST APPEAR!
  // - Review 2 is for Neri's activity -> MUST NOT APPEAR!
  const clubReviews = getReviewsOfUserActivities(reviews, profileClub65, activities);
  assert.equal(clubReviews.length, 1);
  assert.equal(clubReviews[0].id, 'rev_1');
  assert.equal(clubReviews[0].autor, 'Neri');

  // 3. Retired reviews for an organizer's activity MUST NOT appear in "Reseñas de sus actividades"
  const reviewsWithRetired = [
    ...reviews,
    {
      id: 'rev_retired_1',
      actividadId: '1794008683478',
      actividad: 'PRUEBA RESEÑA 3',
      autor: 'Marito',
      userId: 'usr_marito',
      estrellas: 5,
      retirado_de_la_vista: true,
      texto: 'Esta reseña fue retirada por no cumplir con las condiciones de uso de CLUB65'
    },
    {
      id: 'rev_retired_2',
      actividadId: 'act_neri_taller',
      actividad: 'Taller de Yoga de Neri',
      autor: 'OtroVecino',
      userId: 'usr_otro',
      estrellas: 4,
      retiradoDeLaVista: true,
      texto: 'Comentario original'
    }
  ];
  const clubReviewsFiltered = getReviewsOfUserActivities(reviewsWithRetired, profileClub65, activities);
  assert.equal(clubReviewsFiltered.length, 1);
  assert.equal(clubReviewsFiltered[0].id, 'rev_1');

  const neriReviewsFiltered = getReviewsOfUserActivities(reviewsWithRetired, profileNeri, activities);
  assert.equal(neriReviewsFiltered.length, 1);
  assert.equal(neriReviewsFiltered[0].id, 'rev_2');

  // 4. If user has no activities, returns empty array
  const userNoActs = { id: 'usr_nobody', usuario: 'nobody', apodo: 'Nobody' };
  const emptyReviews = getReviewsOfUserActivities(reviews, userNoActs, activities);
  assert.equal(emptyReviews.length, 0);
});

test('calculateReviewsAverage excludes retired reviews and accurately averages across all organizer activities', () => {
  const organizer = {
    id: 'contact_org_1',
    userId: 'usr_org_marta',
    nombre: 'Marta',
    usuario: 'marta65'
  };

  const activities = [
    { id: 101, title: 'Caminata Matinal', organizerId: 'usr_org_marta', organizer: 'Marta' },
    { id: 102, title: 'Taller de Lectura', organizerId: 'usr_org_marta', organizer: 'Marta' },
    { id: 103, title: 'Clase de Otro Organizador', organizerId: 'usr_other', organizer: 'Otro' }
  ];

  const reviews = [
    { id: 'r1', actividadId: 101, autor: 'Carlos', userId: 'u_carlos', estrellas: 5, texto: 'Excelente caminata' },
    { id: 'r2', actividadId: 102, autor: 'Lucía', userId: 'u_lucia', estrellas: 4, texto: 'Muy lindo taller' },
    { id: 'r3', actividadId: 102, autor: 'Jorge', userId: 'u_jorge', calificacion: 4, texto: 'Gran coordinación' },
    // Retired reviews (must NOT be counted in the average)
    { id: 'r4', actividadId: 101, autor: 'Pedro', userId: 'u_pedro', estrellas: 1, retirado_de_la_vista: true, texto: 'Spam' },
    { id: 'r5', actividadId: 102, autor: 'Ana', userId: 'u_ana', estrellas: 1, retiradoDeLaVista: true, texto: 'Ofensivo' },
    { id: 'r6', actividadId: 101, autor: 'Luis', userId: 'u_luis', estrellas: 1, deletedByAdmin: true, texto: 'Retirada' },
    { id: 'r7', actividadId: 101, autor: 'Sofía', userId: 'u_sofia', estrellas: 1, texto: 'Esta reseña fue retirada por no cumplir con las condiciones de uso de CLUB65' },
    // Self-review (must NOT be counted)
    { id: 'r8', actividadId: 101, autor: 'Marta', userId: 'usr_org_marta', estrellas: 5, texto: 'Me encantó' },
    // Other organizer's activity (must NOT be counted)
    { id: 'r9', actividadId: 103, autor: 'Carlos', userId: 'u_carlos', estrellas: 2, texto: 'Regular' }
  ];

  // Direct call to calculateReviewsAverage with mixed retired/active reviews ignores retired ones
  const directStats = calculateReviewsAverage([
    { estrellas: 5, texto: 'Genial' },
    { estrellas: 3, texto: 'Bien' },
    { estrellas: 1, retirado_de_la_vista: true, texto: 'Oculta' },
    { estrellas: 1, isDeleted: true, texto: 'Eliminada' }
  ]);
  assert.equal(directStats.count, 2);
  assert.equal(directStats.average, 4);
  assert.equal(directStats.formatted, '4.0');

  // Organizer summary across all their activities: (5 + 4 + 4) / 3 = 4.333... -> "4.3"
  const organizerReviews = getReviewsOfUserActivities(reviews, organizer, activities);
  const orgStats = calculateReviewsAverage(organizerReviews);
  assert.equal(orgStats.count, 3);
  assert.equal(orgStats.formatted, '4.3');

  // If all reviews are retired, count is 0
  const onlyRetired = calculateReviewsAverage([
    { estrellas: 1, retirado_de_la_vista: true, texto: 'Retirada' },
    { estrellas: 2, deletedByAdmin: true, texto: 'Retirada' }
  ]);
  assert.equal(onlyRetired.count, 0);
  assert.equal(onlyRetired.average, 0);
});



