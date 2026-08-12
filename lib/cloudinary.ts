import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Generate a signed upload payload so the browser can POST the image directly
 * to Cloudinary (avoids routing image bytes through Vercel's serverless body
 * limit). The signature authorises exactly these params.
 */
export function signUpload(opts: { folder: string; publicId?: string }) {
  const timestamp = Math.round(Date.now() / 1000);
  const params: Record<string, unknown> = { timestamp, folder: opts.folder };
  if (opts.publicId) params.public_id = opts.publicId;
  const signature = cloudinary.utils.api_sign_request(
    params,
    process.env.CLOUDINARY_API_SECRET ?? "",
  );
  return {
    signature,
    timestamp,
    apiKey: process.env.CLOUDINARY_API_KEY,
    cloudName: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    folder: opts.folder,
    publicId: opts.publicId,
  };
}

/** Delete an image by public id (e.g. when an item photo is replaced). */
export async function deleteImage(publicId: string) {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (e) {
    console.error("[cloudinary] destroy failed for", publicId, e);
  }
}
