/** Media classification for a file the library engine can index. */
export interface MediaTypeInfo {
  mediaType: 'image' | 'video';
  mime: string;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.dng': 'image/x-adobe-dng',
};

const VIDEO_EXTENSIONS: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.3gp': 'video/3gpp',
  '.wmv': 'video/x-ms-wmv',
};

/** Classifies a file by extension, or null when the library engine should skip it. */
export function classifyMediaFile(fileName: string): MediaTypeInfo | null {
  const extension = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
  const imageMime = IMAGE_EXTENSIONS[extension];
  if (imageMime) {
    return { mediaType: 'image', mime: imageMime };
  }
  const videoMime = VIDEO_EXTENSIONS[extension];
  if (videoMime) {
    return { mediaType: 'video', mime: videoMime };
  }
  return null;
}
