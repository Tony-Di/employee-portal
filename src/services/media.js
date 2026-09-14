import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { ValidationError } from '../errors.js';

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const ALLOWED = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export const uploadDir = dataDir => path.join(dataDir, 'uploads');

// The type comes from the file's bytes, never from the client-supplied name or MIME type.
export async function saveMedia(pool, dataDir, buffer, adminId) {
  if (!buffer?.length) throw new ValidationError({ file: ['请选择要上传的图片。', 'Choose an image to upload.'] });
  if (buffer.length > MAX_UPLOAD_BYTES) throw new ValidationError({ file: ['图片不能超过 2 MB。', 'Images must be 2 MB or smaller.'] });
  const type = await fileTypeFromBuffer(buffer);
  const extension = ALLOWED[type?.mime];
  if (!extension) throw new ValidationError({ file: ['仅支持 PNG、JPEG 或 WebP 图片。', 'Only PNG, JPEG or WebP images are supported.'] });

  const id = randomUUID();
  const filename = `${id}.${extension}`;
  const target = path.join(uploadDir(dataDir), filename);
  await mkdir(uploadDir(dataDir), { recursive: true });
  await writeFile(target, buffer, { flag: 'wx' });
  try {
    await pool.query('INSERT INTO media(id, filename, mime_type, created_by) VALUES ($1, $2, $3, $4)', [id, filename, type.mime, adminId]);
  } catch (error) {
    await unlink(target).catch(() => {});
    throw error;
  }
  return { id, filename, url: `/media/${filename}` };
}
