import { session } from '@/auth/session';

import type { PhotoPage, PhotoPose, ProgressPhoto, Upload, UploadContentType } from './types';
import { ApiError } from './client';

export function listPhotos(cursor: string | null = null): Promise<PhotoPage> {
  return session.request<PhotoPage>(`/body/photos${cursor ? `?cursor=${cursor}` : ''}`);
}

export function presignPhoto(contentType: UploadContentType): Promise<Upload> {
  return session.request<Upload>('/uploads/presign', {
    method: 'POST',
    body: { kind: 'progress_photo', content_type: contentType },
  });
}

export function createPhoto(body: {
  object_key: string;
  taken_at: string;
  pose: PhotoPose | null;
}): Promise<ProgressPhoto> {
  return session.request<ProgressPhoto>('/body/photos', { method: 'POST', body });
}

export function deletePhoto(id: string): Promise<void> {
  return session.request<void>(`/body/photos/${id}`, { method: 'DELETE' });
}

/** PUT a local file straight to object storage with the signed URL (never via the API). */
export async function uploadFile(upload: Upload, fileUri: string): Promise<void> {
  let response: Response;
  try {
    const file = await (await fetch(fileUri)).blob();
    response = await fetch(upload.upload_url, {
      method: upload.method,
      headers: upload.headers,
      body: file,
    });
  } catch (cause) {
    throw new ApiError(
      0,
      'network_error',
      cause instanceof Error ? cause.message : 'Upload failed',
    );
  }
  if (!response.ok) throw new ApiError(response.status, 'upload_failed', 'The upload failed');
}
