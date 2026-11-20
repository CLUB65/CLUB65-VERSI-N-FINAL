import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  EMAILJS_SERVICE_ID,
  EMAILJS_TEMPLATE_ID_CODIGO,
  EMAILJS_TEMPLATE_ID_MULTIUSO,
  EMAILJS_PUBLIC_KEY,
  EMAIL_ADMIN_CLUB65,
  SOPORTE_ASUNTOS,
  MOTIVOS_RECHAZO_INSTITUCION,
  generateRecoveryCodeAndExpiry,
  validateRecoveryCodeMatch,
  buildSupportEmailParams,
  buildRecoveryCodeEmailParams,
  buildInstitutionalApprovalEmailParams,
  buildInstitutionalRejectionEmailParams,
  sendSupportEmail,
  sendRecoveryCodeEmail,
  sendInstitutionalApprovalEmail,
  sendInstitutionalRejectionEmail,
  type EmailSenderFn
} from './emailService.ts';

test('EmailJS credentials and constants match specification', () => {
  assert.equal(EMAILJS_SERVICE_ID, 'service_lrtiu38');
  assert.equal(EMAILJS_TEMPLATE_ID_CODIGO, 'template_tvhl70r');
  assert.equal(EMAILJS_TEMPLATE_ID_MULTIUSO, 'template_kl5co4n');
  assert.equal(EMAILJS_PUBLIC_KEY, '-ZJsT5jGiOdFiffft');
  assert.equal(EMAIL_ADMIN_CLUB65, 'club65.info@gmail.com');
  assert.ok(SOPORTE_ASUNTOS.length >= 4);
  assert.ok(MOTIVOS_RECHAZO_INSTITUCION.length >= 5);
});

test('generateRecoveryCodeAndExpiry produces a 6-digit code and 1-hour expiry ISO timestamp', () => {
  const fixedNow = Date.UTC(2026, 4, 10, 15, 30, 0);
  const { codigo, codigoExpira } = generateRecoveryCodeAndExpiry(fixedNow);

  assert.match(codigo, /^\d{6}$/);
  assert.equal(new Date(codigoExpira).getTime(), fixedNow + 60 * 60 * 1000);
});

test('validateRecoveryCodeMatch enforces exact code, 1h expiration, and single-use nullification', () => {
  const issuedAt = Date.UTC(2026, 4, 10, 15, 0, 0);
  const expiresAt = new Date(issuedAt + 60 * 60 * 1000).toISOString();

  // Valid within 1 hour
  const okResult = validateRecoveryCodeMatch('482910', expiresAt, '482910', new Date(issuedAt + 30 * 60 * 1000));
  assert.equal(okResult.valid, true);

  // Wrong code
  const mismatch = validateRecoveryCodeMatch('482910', expiresAt, '000000', new Date(issuedAt + 60_000));
  assert.equal(mismatch.valid, false);
  assert.equal(mismatch.reason, 'mismatch');

  // Expired (> 1 hour)
  const expired = validateRecoveryCodeMatch('482910', expiresAt, '482910', new Date(issuedAt + 61 * 60 * 1000));
  assert.equal(expired.valid, false);
  assert.equal(expired.reason, 'expired');
  assert.match(expired.error || '', /venció/i);

  // Single-use: once cleared to null, the same code can never be reused
  const cleared = validateRecoveryCodeMatch(null, null, '482910', new Date(issuedAt + 60_000));
  assert.equal(cleared.valid, false);
  assert.equal(cleared.reason, 'missing');
});

test('sendSupportEmail uses TEMPLATE_ID_MULTIUSO with admin recipient and formatted asunto & cuerpo_mensaje', async () => {
  const calls: any[] = [];
  const fakeSender: EmailSenderFn = async (serviceId, templateId, params, options) => {
    calls.push({ serviceId, templateId, params, options });
  };

  await sendSupportEmail(
    {
      senderName: 'Marta López (@martal)',
      senderEmail: 'marta@ejemplo.com',
      subject: 'Soporte técnico',
      message: 'No puedo ver mis inscripciones.'
    },
    fakeSender
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].serviceId, 'service_lrtiu38');
  assert.equal(calls[0].templateId, 'template_kl5co4n');
  assert.deepEqual(calls[0].options, { publicKey: '-ZJsT5jGiOdFiffft' });
  assert.equal(calls[0].params.to_email, 'club65.info@gmail.com');
  assert.equal(calls[0].params.to_name, 'Equipo CLUB65');
  assert.equal(calls[0].params.asunto, 'Soporte CLUB65: Soporte técnico');
  assert.match(calls[0].params.cuerpo_mensaje, /Marta López \(@martal\)/);
  assert.match(calls[0].params.cuerpo_mensaje, /marta@ejemplo\.com/);
  assert.match(calls[0].params.cuerpo_mensaje, /No puedo ver mis inscripciones\./);
});

test('sendRecoveryCodeEmail uses TEMPLATE_ID_CODIGO with to_email, to_name, and codigo', async () => {
  const calls: any[] = [];
  const fakeSender: EmailSenderFn = async (serviceId, templateId, params, options) => {
    calls.push({ serviceId, templateId, params, options });
  };

  await sendRecoveryCodeEmail(
    {
      toEmail: 'carlos@ejemplo.com',
      toName: 'Carlos Pérez',
      codigo: '654321'
    },
    fakeSender
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].templateId, 'template_tvhl70r');
  assert.deepEqual(calls[0].params, {
    to_email: 'carlos@ejemplo.com',
    to_name: 'Carlos Pérez',
    codigo: '654321'
  });
});

test('institutional approval and rejection emails use TEMPLATE_ID_MULTIUSO and Argentine voseo', async () => {
  const calls: any[] = [];
  const fakeSender: EmailSenderFn = async (serviceId, templateId, params, options) => {
    calls.push({ serviceId, templateId, params, options });
  };

  await sendInstitutionalApprovalEmail(
    {
      toEmail: 'club@ejemplo.org.ar',
      institutionName: 'Centro de Jubilados Sol'
    },
    fakeSender
  );

  await sendInstitutionalRejectionEmail(
    {
      toEmail: 'club2@ejemplo.org.ar',
      institutionName: 'Asociación Barrio Norte',
      reason: MOTIVOS_RECHAZO_INSTITUCION[0]
    },
    fakeSender
  );

  assert.equal(calls.length, 2);

  // Approval
  assert.equal(calls[0].templateId, 'template_kl5co4n');
  assert.equal(calls[0].params.to_email, 'club@ejemplo.org.ar');
  assert.equal(calls[0].params.to_name, 'Centro de Jubilados Sol');
  assert.equal(calls[0].params.asunto, '¡Tu cuenta institucional en CLUB65 fue aprobada!');
  assert.match(calls[0].params.cuerpo_mensaje, /podés/i);

  // Rejection
  assert.equal(calls[1].templateId, 'template_kl5co4n');
  assert.equal(calls[1].params.to_email, 'club2@ejemplo.org.ar');
  assert.equal(calls[1].params.to_name, 'Asociación Barrio Norte');
  assert.match(calls[1].params.cuerpo_mensaje, new RegExp(MOTIVOS_RECHAZO_INSTITUCION[0].slice(0, 20)));
  assert.match(calls[1].params.cuerpo_mensaje, /querés|podés/i);
});

test('api.ts resetPassword clears codigo_recuperacion and codigo_expira in the same update as clave', () => {
  const apiFile = readFileSync(resolve(process.cwd(), 'src/api.ts'), 'utf-8');
  const resetStart = apiFile.indexOf('async resetPassword(');
  assert.ok(resetStart > 0);
  const resetBlock = apiFile.slice(resetStart, resetStart + 2500);

  const updateMatch = resetBlock.match(/\.update\(\{[\s\S]*?\}\)/);
  assert.ok(updateMatch, 'resetPassword must execute a Supabase .update({...})');
  assert.match(updateMatch[0], /clave:\s*cleanPassword/);
  assert.match(updateMatch[0], /codigo_recuperacion:\s*null/);
  assert.match(updateMatch[0], /codigo_expira:\s*null/);
});
