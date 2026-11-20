import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeStorageFileName, dataUrlToBlob } from '../storageService.ts';

test('sanitizeStorageFileName removes accents, spaces, and adds timestamp/suffix', () => {
  const result = sanitizeStorageFileName('Foto de Perfil en la Plaza!.PNG');
  assert.ok(result.endsWith('.png'));
  assert.ok(!result.includes(' '));
  assert.ok(!result.includes('!'));
  assert.ok(result.startsWith('foto_de_perfil_en_la_plaza_'));
});

test('sanitizeStorageFileName handles files without extensions using mimeType', () => {
  const result = sanitizeStorageFileName('avatar_upload', 'image/webp');
  assert.ok(result.endsWith('.webp'));
});

test('dataUrlToBlob converts base64 image data url to Blob with correct mime type', () => {
  // 1x1 transparent gif base64
  const dataUrl = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const blob = dataUrlToBlob(dataUrl);
  assert.equal(blob.type, 'image/gif');
  assert.ok(blob.size > 0);
});
