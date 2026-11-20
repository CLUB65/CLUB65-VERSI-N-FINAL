import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toArgentinaDate,
  formatArgentinaDateOnly,
  formatArgentinaDateTime,
  formatArgentinaTimeOnly,
  formatToArgentinaDate,
  getMessageArgentinaDate,
  formatArgentinaDateHeader,
  getArgentinaTodayYMD,
  getArgentinaCurrentMinutes
} from './argentinaTime';

test('toArgentinaDate correctly handles YYYY-MM-DD format in Argentina UTC-3', () => {
  const d = toArgentinaDate('2026-11-06');
  assert.ok(d !== null);
  // When formatted in Argentina, must be 06/11/2026
  assert.equal(formatArgentinaDateOnly(d), '06/11/2026');
});

test('formatArgentinaDateOnly formats in Spanish d/m/a and respects UTC-3 offset', () => {
  // 2026-11-06T01:30:00Z in UTC is 2026-11-05 22:30 in Argentina (UTC-3)
  const utcDate = new Date('2026-11-06T01:30:00.000Z');
  assert.equal(formatArgentinaDateOnly(utcDate), '05/11/2026');

  // 2026-11-06T18:00:00Z in UTC is 2026-11-06 15:00 in Argentina (UTC-3)
  const utcDayDate = new Date('2026-11-06T18:00:00.000Z');
  assert.equal(formatArgentinaDateOnly(utcDayDate), '06/11/2026');
});

test('formatArgentinaTimeOnly outputs Argentina time in HH:mm hs', () => {
  // 15:00 UTC = 12:00 ART
  const date = new Date('2026-11-06T15:00:00.000Z');
  assert.equal(formatArgentinaTimeOnly(date), '12:00 hs');

  // String time preservation
  assert.equal(formatArgentinaTimeOnly('14:30'), '14:30 hs');
  assert.equal(formatArgentinaTimeOnly('9:15 hs'), '09:15 hs');
});

test('formatArgentinaDateTime formats full d/m/a and time', () => {
  const date = new Date('2026-11-06T15:30:00.000Z');
  assert.equal(formatArgentinaDateTime(date), '06/11/2026, 12:30 hs');
});

test('formatToArgentinaDate standardizes any date string to d/m/a format', () => {
  assert.equal(formatToArgentinaDate('2026-11-06'), '06/11/2026');
  assert.equal(formatToArgentinaDate('6/11/2026'), '06/11/2026');
  assert.equal(formatToArgentinaDate('06/11/2026'), '06/11/2026');
  assert.equal(formatToArgentinaDate(''), '');
});

test('getMessageArgentinaDate extracts Argentina date from various message shapes', () => {
  // From ISO createdAt
  const msg1 = { id: 'm1', text: 'Hola', createdAt: '2026-11-06T15:00:00.000Z' };
  assert.equal(getMessageArgentinaDate(msg1), '06/11/2026');

  // From timestamp in ID
  const nowTs = new Date('2026-10-23T18:00:00.000Z').getTime();
  const msg2 = { id: `msg_${nowTs}`, text: 'Antiguo' };
  assert.equal(getMessageArgentinaDate(msg2), '23/10/2026');

  // From explicit date field
  const msg3 = { id: 'm3', text: 'Prueba', date: '2026-11-04' };
  assert.equal(getMessageArgentinaDate(msg3), '04/11/2026');
});

test('formatArgentinaDateHeader shows friendly label with d/m/a date', () => {
  const todayStr = formatArgentinaDateOnly(new Date());
  assert.equal(formatArgentinaDateHeader(todayStr), `Hoy - ${todayStr}`);

  // An arbitrary past date
  assert.equal(formatArgentinaDateHeader('15/08/2026'), '15/08/2026');
});

test('getArgentinaTodayYMD returns YYYY-MM-DD according to Argentina clock', () => {
  const ymd = getArgentinaTodayYMD();
  assert.match(ymd, /^\d{4}-\d{2}-\d{2}$/);
});

test('getArgentinaCurrentMinutes returns value between 0 and 1439', () => {
  const mins = getArgentinaCurrentMinutes();
  assert.ok(mins >= 0 && mins < 1440);
});
