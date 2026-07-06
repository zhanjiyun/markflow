import { mkdir, writeFile } from "@tauri-apps/plugin-fs";

/**
 * Save an image file (from clipboard paste or drag-drop) to the assets directory
 * relative to the current markdown file, and return the markdown image tag.
 */
export async function saveImageToDisk(
  blob: Blob,
  currentFilePath: string | null
): Promise<string | null> {
  if (!currentFilePath) {
    console.warn("Cannot save image: file has not been saved yet. Save the file first, then paste images.");
    return null;
  }

  try {
    // Determine the base directory for assets
    const baseDir = getBaseDir(currentFilePath);

    // Ensure assets directory exists
    const assetsDir = `${baseDir}assets`;
    try {
      await mkdir(assetsDir, { recursive: true });
    } catch {
      // Directory might already exist — ignore
    }

    // Generate a unique filename
    const ext = getExtension(blob.type);
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const filename = `image-${timestamp}-${random}.${ext}`;
    const imagePath = `${baseDir}assets/${filename}`;

    // Read blob as bytes and write to disk
    const arrayBuffer = await blob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    await writeFile(imagePath, uint8);

    // Return the relative markdown image tag
    return `![${filename}](assets/${filename})`;
  } catch (err) {
    console.error("保存图片失败:", err);
    return null;
  }
}

/**
 * Handle paste event to detect and save images from clipboard.
 * Returns the markdown tag if an image was found, or null.
 */
export async function handleImagePaste(
  e: ClipboardEvent,
  currentFilePath: string | null
): Promise<string | null> {
  const items = e.clipboardData?.items;
  if (!items) return null;

  // Collect all image blobs first
  const blobs: Blob[] = [];
  for (const item of Array.from(items)) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const blob = item.getAsFile();
      if (blob) blobs.push(blob);
    }
  }

  if (blobs.length === 0) return null;

  // Save all images and collect markdown tags
  const tags = await Promise.all(blobs.map((b) => saveImageToDisk(b, currentFilePath)));
  return tags.filter(Boolean).join("\n");
}

/**
 * Handle drop event to detect and save dragged images.
 * Returns array of markdown tags for inserted images.
 */
export async function handleImageDrop(
  e: DragEvent,
  currentFilePath: string | null
): Promise<string[]> {
  const files = e.dataTransfer?.files;
  if (!files) return [];

  const results: string[] = [];
  for (const file of Array.from(files)) {
    if (file.type.startsWith("image/")) {
      e.preventDefault();
      const mdTag = await saveImageToDisk(file, currentFilePath);
      if (mdTag) results.push(mdTag);
    }
  }
  return results;
}

function getBaseDir(currentFilePath: string | null): string {
  if (currentFilePath) {
    // Use the directory containing the current markdown file
    const normalized = currentFilePath.replace(/\\/g, "/");
    const lastSlash = normalized.lastIndexOf("/");
    if (lastSlash >= 0) {
      return normalized.substring(0, lastSlash + 1);
    }
  }
  // Fallback: use current directory
  return "./";
}

function getExtension(mimeType: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
  };
  return map[mimeType] || "png";
}
