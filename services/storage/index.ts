import { getAdminStorage } from "@/lib/firebase/admin";

export async function uploadBuffer(
  path: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const bucket = getAdminStorage().bucket();
  const file = bucket.file(path);
  await file.save(buffer, { contentType, resumable: false });
  return path;
}

export async function downloadBuffer(path: string): Promise<Buffer> {
  const bucket = getAdminStorage().bucket();
  const [buffer] = await bucket.file(path).download();
  return buffer;
}

export async function getSignedUploadUrl(
  path: string,
  contentType: string
): Promise<string> {
  const bucket = getAdminStorage().bucket();
  const [url] = await bucket.file(path).getSignedUrl({
    version: "v4",
    action: "write",
    expires: Date.now() + 15 * 60 * 1000,
    contentType,
  });
  return url;
}

export async function getSignedDownloadUrl(path: string): Promise<string> {
  const bucket = getAdminStorage().bucket();
  const [url] = await bucket.file(path).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + 60 * 60 * 1000,
  });
  return url;
}
