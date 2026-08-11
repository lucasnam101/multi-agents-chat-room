const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

/** Browser-side equivalent of the image-compression skill for paste/upload. */
export async function compressImageFile(file: Blob): Promise<{ dataBase64: string; mimeType: string }> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = sourceUrl;
    await image.decode();
    const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas is unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    return { dataBase64: dataUrl.slice(dataUrl.indexOf(",") + 1), mimeType: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export async function compressBase64Image(dataBase64: string, mimeType: string) {
  const bytes = Uint8Array.from(atob(dataBase64), (char) => char.charCodeAt(0));
  return compressImageFile(new Blob([bytes], { type: mimeType }));
}
