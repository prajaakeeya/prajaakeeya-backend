import { MulterOptions } from "@nestjs/platform-express/multer/interfaces/multer-options.interface";
import { fileFilter } from "./multer-file-filter";

/**
 * Maximum upload size (in bytes) accepted by every multipart endpoint.
 * Change here to update every upload limit at once.
 */
export const MAX_UPLOAD_BYTES = 700 * 1024; // 700 KB

/**
 * Accepted MIME types for profile images.
 */
export const PROFILE_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

/**
 * Accepted MIME types for aspirant documents (ID cards, proofs, etc.).
 */
export const ASPIRANT_DOCUMENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
];

/**
 * Multer file filter that rejects files with unsupported MIME types.
 */
export function createFileFilter(allowedTypes: string[]): MulterOptions["fileFilter"] {
  return fileFilter(allowedTypes);
}
