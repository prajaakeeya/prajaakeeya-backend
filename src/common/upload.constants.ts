import { BadRequestException } from "@nestjs/common";

/**
 * Maximum upload size (in bytes) accepted by every multipart endpoint.
 * Change here to update every upload limit at once.
 */
export const MAX_UPLOAD_BYTES = 700 * 1024; // 700 KB

/**
 * Larger cap for media uploads (profile photos, ID/document scans) handled by
 * MediaController. Matches the documented "max 10MB" limit.
 */
export const MAX_MEDIA_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Multer fileFilter shared by the media upload endpoints. Rejects anything
 * that isn't an allowed image or PDF by extension. Pair with a `limits.fileSize`
 * on the interceptor to also bound the upload size — together these stop
 * oversized uploads and arbitrary-content (e.g. HTML/SVG) being stored.
 */
export function mediaFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (/\.(jpe?g|png|webp|heic|heif|pdf)$/i.test(file.originalname)) {
    cb(null, true);
  } else {
    cb(
      new BadRequestException(
        "Only image (JPEG, PNG, WEBP, HEIC) or PDF files are allowed",
      ),
      false,
    );
  }
}
