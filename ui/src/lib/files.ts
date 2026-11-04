// Helpers for moving dropped audio files across the bridge as base64.

export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000; // stay under the argument limit of String.fromCharCode
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

const AUDIO_EXTENSIONS = /\.(wav|wave|aif|aiff|flac|ogg|mp3|m4a|caf)$/i;

export function isProbablyAudio(file: File): boolean {
  return file.type.startsWith("audio/") || AUDIO_EXTENSIONS.test(file.name);
}
