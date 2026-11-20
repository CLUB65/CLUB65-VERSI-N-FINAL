import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFETTI_COLORS,
  getConfettiBurstOptions,
  shouldTriggerActivityPublishedConfetti,
  shouldTriggerReviewPublishedConfetti,
  shouldTriggerEnrollmentConfetti,
} from './confetti';

test('getConfettiBurstOptions returns vibrant palette, high zIndex, and clamped origin', () => {
  const defaultOpts = getConfettiBurstOptions();
  assert.deepEqual(defaultOpts.colors, CONFETTI_COLORS);
  assert.equal(defaultOpts.zIndex, 99999);
  assert.equal(defaultOpts.origin.x, 0.5);
  assert.equal(defaultOpts.origin.y, 0.38);

  const clampedOpts = getConfettiBurstOptions({ x: 0.99, y: 0.01 });
  assert.equal(clampedOpts.origin.x, 0.85);
  assert.equal(clampedOpts.origin.y, 0.2);
});

test('shouldTriggerActivityPublishedConfetti fires ONLY when a validated activity is actually published to Cartelera', () => {
  assert.equal(
    shouldTriggerActivityPublishedConfetti({
      isEditResubmission: false,
      isInst: true,
      createdActivity: { id: 'act-1', isApproved: true, proposalStatus: 'aprobada', estado: 'aprobada' },
    }),
    true
  );

  // Personal proposal sent for moderation review -> MUST NOT fire
  assert.equal(
    shouldTriggerActivityPublishedConfetti({
      isEditResubmission: false,
      isInst: false,
      createdActivity: { id: 'act-2', isApproved: false, proposalStatus: 'pendiente', estado: 'pendiente' },
    }),
    false
  );

  // Resubmission of existing proposal -> MUST NOT fire
  assert.equal(
    shouldTriggerActivityPublishedConfetti({
      isEditResubmission: true,
      isInst: true,
      createdActivity: { id: 'act-3', isApproved: true, proposalStatus: 'aprobada' },
    }),
    false
  );

  // Missing or failed creation -> MUST NOT fire
  assert.equal(
    shouldTriggerActivityPublishedConfetti({
      isEditResubmission: false,
      isInst: true,
      createdActivity: null,
    }),
    false
  );

  // Explicitly unapproved or baja_forzada -> MUST NOT fire
  assert.equal(
    shouldTriggerActivityPublishedConfetti({
      isEditResubmission: false,
      isInst: true,
      createdActivity: { id: 'act-4', isApproved: false, proposalStatus: 'pendiente' },
    }),
    false
  );
  assert.equal(
    shouldTriggerActivityPublishedConfetti({
      isEditResubmission: false,
      isInst: true,
      createdActivity: { id: 'act-5', isApproved: true, estado: 'baja_forzada' },
    }),
    false
  );
});

test('shouldTriggerReviewPublishedConfetti fires ONLY when a new review has complete data and succeeded', () => {
  assert.equal(
    shouldTriggerReviewPublishedConfetti({
      isEdit: false,
      textoResena: 'Excelente taller de caminata!',
      califEstrellas: 5,
      actividadId: 123,
      hasUser: true,
      createdReview: { id: 99 },
    }),
    true
  );

  // Missing or whitespace comment -> MUST NOT fire
  assert.equal(
    shouldTriggerReviewPublishedConfetti({
      isEdit: false,
      textoResena: '   ',
      califEstrellas: 5,
      actividadId: 123,
      hasUser: true,
      createdReview: { id: 99 },
    }),
    false
  );

  // Invalid star rating -> MUST NOT fire
  assert.equal(
    shouldTriggerReviewPublishedConfetti({
      isEdit: false,
      textoResena: 'Muy bueno',
      califEstrellas: 0,
      actividadId: 123,
      hasUser: true,
      createdReview: { id: 99 },
    }),
    false
  );

  // Missing activityId -> MUST NOT fire
  assert.equal(
    shouldTriggerReviewPublishedConfetti({
      isEdit: false,
      textoResena: 'Muy bueno',
      califEstrellas: 4,
      actividadId: null,
      hasUser: true,
      createdReview: { id: 99 },
    }),
    false
  );

  // Failed API response (null createdReview) -> MUST NOT fire
  assert.equal(
    shouldTriggerReviewPublishedConfetti({
      isEdit: false,
      textoResena: 'Muy bueno',
      califEstrellas: 4,
      actividadId: 123,
      hasUser: true,
      createdReview: null,
    }),
    false
  );

  // Editing an existing review -> MUST NOT fire
  assert.equal(
    shouldTriggerReviewPublishedConfetti({
      isEdit: true,
      textoResena: 'Editado',
      califEstrellas: 4,
      actividadId: 123,
      hasUser: true,
      createdReview: { id: 99 },
    }),
    false
  );
});

test('shouldTriggerEnrollmentConfetti fires ONLY when enrolling succeeds for a logged-in user', () => {
  assert.equal(
    shouldTriggerEnrollmentConfetti({
      wasAlreadyEnrolled: false,
      hasUser: true,
      enrollSucceeded: true,
    }),
    true
  );

  // Cancelling enrollment -> MUST NOT fire
  assert.equal(
    shouldTriggerEnrollmentConfetti({
      wasAlreadyEnrolled: true,
      hasUser: true,
      enrollSucceeded: true,
    }),
    false
  );

  // Enrollment failed -> MUST NOT fire
  assert.equal(
    shouldTriggerEnrollmentConfetti({
      wasAlreadyEnrolled: false,
      hasUser: true,
      enrollSucceeded: false,
    }),
    false
  );

  // Unauthenticated -> MUST NOT fire
  assert.equal(
    shouldTriggerEnrollmentConfetti({
      wasAlreadyEnrolled: false,
      hasUser: false,
      enrollSucceeded: true,
    }),
    false
  );
});
