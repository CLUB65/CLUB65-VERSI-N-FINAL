import { supabase } from './supabaseClient.ts';

export type StorageBucket =
  | 'avatars'
  | 'chats-grupos'
  | 'actividades'
  | 'reviews-media';

/**
 * Convierte un dataUrl (Base64) a un Blob de forma segura.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Sanitiza el nombre de archivo eliminando caracteres especiales,
 * espacios y acentos, y agregando un timestamp y hash aleatorio
 * para evitar colisiones en Supabase Storage.
 */
export function sanitizeStorageFileName(rawName: string, mimeType?: string): string {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 8);

  // Extraer extensión o inferirla según el mimeType
  let extension = '';
  const lastDot = rawName.lastIndexOf('.');
  if (lastDot !== -1 && lastDot > rawName.length - 8) {
    extension = rawName.substring(lastDot).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  if (!extension) {
    if (mimeType?.includes('png')) extension = 'png';
    else if (mimeType?.includes('webp')) extension = 'webp';
    else if (mimeType?.includes('gif')) extension = 'gif';
    else if (mimeType?.includes('mp4')) extension = 'mp4';
    else if (mimeType?.includes('webm')) extension = 'webm';
    else if (mimeType?.includes('pdf')) extension = 'pdf';
    else extension = 'jpg';
  }

  // Nombre base limpio
  const baseName = (lastDot !== -1 ? rawName.substring(0, lastDot) : rawName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 32);

  return `${baseName || 'archivo'}_${timestamp}_${randomSuffix}.${extension}`;
}

/**
 * Sube un archivo (File o Blob) al bucket especificado de Supabase Storage
 * y retorna la URL pública definitiva para almacenar en la base de datos.
 *
 * Buckets disponibles:
 * - 'avatars'       -> users.avatar, contacts.foto
 * - 'chats-grupos'  -> chats.foto_grupo_url
 * - 'actividades'   -> activities.imagen_url
 * - 'reviews-media' -> reviews.multimedia_urls
 */
export async function uploadToStorage(
  file: File | Blob,
  bucket: StorageBucket,
  folder?: string
): Promise<string> {
  if (!supabase || !supabase.storage) {
    throw new Error('El servicio de almacenamiento de archivos no está disponible.');
  }

  const fileName = (file instanceof File && file.name)
    ? file.name
    : `upload_${Date.now()}`;

  const cleanFileName = sanitizeStorageFileName(fileName, file.type);
  const cleanFolder = folder ? folder.trim().replace(/^\/+|\/+$/g, '') : '';
  const storagePath = cleanFolder ? `${cleanFolder}/${cleanFileName}` : cleanFileName;

  const contentType = file.type || 'image/jpeg';

  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(storagePath, file, {
      cacheControl: '3600',
      upsert: true,
      contentType
    });

  if (error) {
    console.error(`Error al subir archivo al bucket "${bucket}":`, error);
    throw new Error(`Error al subir archivo al servidor (${bucket}): ${error.message}`);
  }

  // Obtener la URL pública directa del archivo subido
  const { data: publicUrlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(data?.path || storagePath);

  if (!publicUrlData?.publicUrl) {
    throw new Error(`No se pudo obtener la URL pública del archivo en "${bucket}".`);
  }

  return publicUrlData.publicUrl;
}

/**
 * Helper para subir un dataUrl (Base64 proveniente de canvas o recorte)
 * directamente a Supabase Storage y retornar su URL pública.
 */
export async function uploadDataUrlToStorage(
  dataUrl: string,
  bucket: StorageBucket,
  rawName = 'imagen.jpg',
  folder?: string
): Promise<string> {
  const blob = dataUrlToBlob(dataUrl);
  const file = new File([blob], rawName, { type: blob.type });
  return uploadToStorage(file, bucket, folder);
}
