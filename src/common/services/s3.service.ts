import { Injectable } from "@nestjs/common";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { ConfigService } from "@nestjs/config";
import * as fs from "fs";
import * as path from "path";

// Filenames are timestamp-prefixed so the same key never changes content —
// safe for a one-year immutable browser/CDN cache.
const IMMUTABLE_CACHE_HEADER = "public, max-age=31536000, immutable";

// Dev-only: writes to ./uploads on disk instead of S3, served back via the
// static route registered in main.ts. Hard-gated to non-production so a
// stray env var can never divert production uploads onto local disk.
const LOCAL_UPLOADS_DIR = path.join(process.cwd(), "uploads");

@Injectable()
export class S3Service {
  private s3Client: S3Client;
  private bucketName: string;
  private cdnDomain?: string;

  constructor(private configService: ConfigService) {
    this.s3Client = new S3Client({
      region: this.configService.get("AWS_REGION") || "ap-south-1",
      credentials: {
        accessKeyId: this.configService.get("AWS_ACCESS_KEY_ID") || "",
        secretAccessKey: this.configService.get("AWS_SECRET_ACCESS_KEY") || "",
      },
    });
    this.bucketName =
      this.configService.get("AWS_S3_BUCKET_NAME") || "prajaakeeya";
    this.cdnDomain = this.configService.get<string>("AWS_CLOUDFRONT_DOMAIN");
  }

  private isLocalStorageEnabled(): boolean {
    return (
      this.configService.get<string>("USE_LOCAL_STORAGE") === "true" &&
      this.configService.get<string>("NODE_ENV") !== "production"
    );
  }

  private buildLocalUrl(key: string): string {
    const port = this.configService.get<string>("PORT") || "3000";
    return `http://localhost:${port}/uploads/${key}`;
  }

  private buildPublicUrl(key: string): string {
    if (this.cdnDomain) return `https://${this.cdnDomain}/${key}`;
    const region = this.configService.get("AWS_REGION");
    return `https://${this.bucketName}.s3.${region}.amazonaws.com/${key}`;
  }

  /**
   * Upload a file to S3
   * @param file - Express.Multer.File object
   * @param folder - Optional folder path in S3
   * @returns S3 object URL
   */
  async uploadFile(
    file: Express.Multer.File,
    folder?: string,
  ): Promise<string> {
    const timestamp = Date.now();
    // Sanitize the client-supplied name: strip any path components and reduce
    // to a safe charset so the key can't contain "..", control chars, RTL
    // overrides or null bytes, and stays parseable by deleteFile().
    const safeBase = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, "_");
    const ext = path.extname(safeBase).slice(0, 10);
    const stem = safeBase.slice(0, safeBase.length - ext.length).slice(0, 80) || "file";
    const fileName = `${timestamp}-${stem}${ext}`;
    const key = folder ? `${folder}/${fileName}` : fileName;

    if (this.isLocalStorageEnabled()) {
      const filePath = path.join(LOCAL_UPLOADS_DIR, key);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, file.buffer);
      return this.buildLocalUrl(key);
    }

    const upload = new Upload({
      client: this.s3Client,
      params: {
        Bucket: this.bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        CacheControl: IMMUTABLE_CACHE_HEADER,
      },
    });

    await upload.done();

    return this.buildPublicUrl(key);
  }

  /**
   * Delete a file from S3
   * @param fileUrl - Full S3 URL
   */
  async deleteFile(fileUrl: string): Promise<void> {
    try {
      const key = this.extractKeyFromUrl(fileUrl);
      if (fileUrl.includes("/uploads/")) {
        const localKey = key.replace(/^uploads\//, "");
        await fs.promises
          .unlink(path.join(LOCAL_UPLOADS_DIR, localKey))
          .catch(() => {});
        return;
      }
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });
      await this.s3Client.send(command);
    } catch (error) {
      console.error("Error deleting file from S3:", error);
    }
  }

  /**
   * Extract the S3 object key from a stored URL.
   *
   * Handles BOTH S3 virtual-hosted URLs
   * (`https://<bucket>.s3.<region>.amazonaws.com/<key>`) and CloudFront / CDN
   * URLs (`https://<cdnDomain>/<key>`) — the key is simply the URL path. The
   * old implementation split on ".amazonaws.com/" and returned "" for CDN
   * URLs, which made DeleteObject fail with 403 AccessDenied (empty key).
   */
  private extractKeyFromUrl(url: string): string {
    if (!url) return "";
    try {
      const { pathname } = new URL(url);
      return decodeURIComponent(pathname.replace(/^\/+/, ""));
    } catch {
      // Not an absolute URL — assume it's already a key, with a legacy
      // ".amazonaws.com/" fallback just in case.
      const parts = url.split(".amazonaws.com/");
      return parts.length > 1 ? parts[1] : url.replace(/^\/+/, "");
    }
  }

  /**
   * Generate a presigned GET URL for a key
   */
  async getPresignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    // Local files are served directly by the static route — no signing.
    if (this.isLocalStorageEnabled()) return this.buildLocalUrl(key);

    // CDN serves cached bytes for ~zero egress cost — prefer it whenever set.
    if (this.cdnDomain) return this.buildPublicUrl(key);

    const isPublic = this.configService.get("AWS_PUBLIC_BUCKET");
    if (
      isPublic === true ||
      String(isPublic).toLowerCase() === "true" ||
      String(isPublic) === "1"
    ) {
      return this.buildPublicUrl(key);
    }

    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    return await getSignedUrl(this.s3Client, command, {
      expiresIn: expiresInSeconds,
    });
  }
}
