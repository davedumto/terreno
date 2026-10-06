import { v2 as cloudinary } from "cloudinary";
import { requireEnv } from "./env";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export class PhotoUploadError extends Error {
  constructor(
    message: string,
    public readonly code: "too_large" | "bad_type" | "upload_failed",
  ) {
    super(message);
    this.name = "PhotoUploadError";
  }
}

function configuredClient(): typeof cloudinary {
  // Configured per call, not once at module load: requireEnv() must stay
  // the single place every route-reachable env read goes through, and a
  // module-level config() call would run before that guard ever executes.
  cloudinary.config({
    cloud_name: requireEnv("CLOUDINARY_CLOUD_NAME"),
    api_key: requireEnv("CLOUDINARY_API_KEY"),
    api_secret: requireEnv("CLOUDINARY_API_SECRET"),
  });
  return cloudinary;
}

export interface UploadedPhoto {
  publicId: string;
  url: string;
}

/**
 * Uploads a worker-submitted task photo to Cloudinary, server-side, using
 * the account's API secret (never exposed to the browser). Returns the
 * stable public_id (stored as submissions.photo_key) and the real public
 * HTTPS URL (what GET /api/tasks/[id] hands back to the paying agent).
 */
export async function uploadTaskPhoto(
  fileBuffer: Buffer,
  mimeType: string,
  taskId: string,
): Promise<UploadedPhoto> {
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new PhotoUploadError(`unsupported photo type: ${mimeType}`, "bad_type");
  }
  if (fileBuffer.byteLength > MAX_PHOTO_BYTES) {
    throw new PhotoUploadError("photo exceeds the 8MB limit", "too_large");
  }

  const dataUri = `data:${mimeType};base64,${fileBuffer.toString("base64")}`;

  try {
    const result = await configuredClient().uploader.upload(dataUri, {
      folder: "terreno/task-photos",
      public_id: taskId,
      overwrite: true,
      resource_type: "image",
    });
    return { publicId: result.public_id, url: result.secure_url };
  } catch (err) {
    throw new PhotoUploadError(
      err instanceof Error ? err.message : "Cloudinary upload failed",
      "upload_failed",
    );
  }
}

/**
 * Deterministically rebuilds the real public HTTPS URL from a stored
 * public_id (submissions.photo_key), with no extra API call: Cloudinary's
 * URL scheme is computable client-side from cloud_name + public_id alone.
 * Used by GET /api/tasks/[id] to hand the paying agent a real image URL
 * without a round trip to Cloudinary on every poll.
 */
export function taskPhotoUrl(publicId: string): string {
  return configuredClient().url(publicId, { secure: true, resource_type: "image" });
}
