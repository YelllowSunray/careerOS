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

export async function getSignedDownloadUrl(
  path: string,
  fileName?: string
): Promise<string> {
  const bucket = getAdminStorage().bucket();
  const [url] = await bucket.file(path).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + 60 * 60 * 1000,
    ...(fileName
      ? {
          responseDisposition: `attachment; filename="${fileName.replace(/"/g, "")}"`,
        }
      : {}),
  });
  return url;
}

/** Best-effort delete — ignores missing files. */
export async function deleteBuffer(path: string): Promise<void> {
  try {
    const bucket = getAdminStorage().bucket();
    await bucket.file(path).delete({ ignoreNotFound: true });
  } catch (e) {
    console.warn("[Storage] Failed to delete", path, e);
  }
}
