/**
 * Uploads an image directly to Cloudinary from the browser using a server-signed
 * payload (keeps image bytes out of Vercel's serverless body limit).
 */
export async function uploadImageToCloudinary(
  file: File,
  folder: string,
): Promise<{ publicId: string; url: string }> {
  const sigRes = await fetch("/api/upload/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder }),
  });
  if (!sigRes.ok) throw new Error("Unable to get upload signature");
  const sig = await sigRes.json();

  const form = new FormData();
  form.append("file", file);
  form.append("api_key", sig.apiKey);
  form.append("timestamp", String(sig.timestamp));
  form.append("folder", sig.folder);
  form.append("signature", sig.signature);

  const upRes = await fetch(
    `https://api.cloudinary.com/v1_1/${sig.cloudName}/auto/upload`,
    { method: "POST", body: form },
  );
  const data = await upRes.json();
  if (!upRes.ok || data.error) {
    throw new Error(data.error?.message ?? "Image upload failed");
  }
  return { publicId: data.public_id, url: data.secure_url };
}
