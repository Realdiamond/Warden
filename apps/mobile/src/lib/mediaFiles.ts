// Phone storage for files waiting to be sent (M8). Files live in the app's private folder, which
// other apps cannot read and Android does not clear, and are deleted once sent or refused.

import { randomUUID } from "expo-crypto";
import { Directory, File, Paths, UploadType } from "expo-file-system";
import type { FileSender } from "./api.ts";

function folder(): Directory {
  const dir = new Directory(Paths.document, "warden-media");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Copies a recorded or picked file into the app's folder. */
export async function keepFile(
  uri: string,
  extension: string,
): Promise<{ uri: string; bytes: number }> {
  const source = new File(uri);
  const target = new File(folder(), `${randomUUID()}.${extension}`);
  await source.copy(target);
  return { uri: target.uri, bytes: target.size ?? 0 };
}

export async function removeFile(uri: string): Promise<void> {
  const file = new File(uri);
  if (file.exists) file.delete();
}

/** Sends the file's bytes as the request body, straight from storage. */
export const sendFile: FileSender = async (url, uri, headers) => {
  const result = await new File(uri).upload(url, {
    httpMethod: "POST",
    uploadType: UploadType.BINARY_CONTENT,
    headers,
    ...(headers["content-type"] ? { mimeType: headers["content-type"] } : {}),
  });
  return result.status;
};

/** Writes downloaded bytes to a temporary file, for playing. */
export function writeTemp(bytes: Uint8Array, extension: string): string {
  const file = new File(Paths.cache, `${randomUUID()}.${extension}`);
  file.write(bytes);
  return file.uri;
}

/**
 * Deletes files left behind (a report closed without sending, an app stopped mid-way). Run once
 * at start-up, before anything new is recorded.
 */
export function removeLeftovers(keep: Set<string>): void {
  const dir = new Directory(Paths.document, "warden-media");
  if (!dir.exists) return;
  for (const entry of dir.list()) {
    if (entry instanceof File && !keep.has(entry.uri)) entry.delete();
  }
}
