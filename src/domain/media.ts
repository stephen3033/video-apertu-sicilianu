import { HTTPException } from 'hono/http-exception';
export function mediaMetadata(filename: string, type: string) {
  const original = filename
    .replace(/[\x00-\x1f\x7f]/g, '')
    .split(/[\\/]/)
    .pop()!
    .trim();
  const extension = original.slice(original.lastIndexOf('.')).toLowerCase();
  const contentType = type.split(';')[0].toLowerCase();
  const kind =
    ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi'].includes(extension) &&
    /^video\/[a-z0-9.+-]+$/.test(contentType)
      ? 'video'
      : ['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.opus'].includes(extension) &&
          (/^audio\/[a-z0-9.+-]+$/.test(contentType) ||
            (extension === '.ogg' && contentType === 'application/ogg'))
        ? 'audio'
        : null;
  if (!kind || !original || [...original].length > 255 || contentType.length > 128)
    throw new HTTPException(400, { message: 'error.file_type' });
  return { original, extension, contentType, kind };
}
export function metadataErrors(title: string, notes: string) {
  return [
    ...(!title ? ['error.title_required'] : []),
    ...([...title].length > 160 ? ['error.title_long'] : []),
    ...([...notes].length > 2000 ? ['error.notes_long'] : []),
  ];
}
