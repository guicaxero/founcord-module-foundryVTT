import { publicHttpsUrl } from "../sanitize";

/** Lado da miniatura enviada ao portal, em pixels. */
export const THUMBNAIL_SIZE = 64;
/** Limite de uma miniatura em base64; o contrato do portal aceita até 16 000. */
export const MAX_THUMBNAIL_CHARS = 15_000;
/** Soma das miniaturas de um catálogo; o portal aceita até 1 000 000. */
export const MAX_CATALOG_THUMBNAIL_CHARS = 800_000;

const LOAD_TIMEOUT_MS = 5_000;
const cache = new Map<string, Promise<string | null>>();

/**
 * Imagem pública do item. Endereços HTTPS seguem como estão; caminhos do
 * servidor do Foundry (`icons/...`, `systems/...`) viram uma miniatura de 64 px
 * gerada no navegador do mestre, porque o servidor não é exposto à internet.
 */
export function itemImage(img: unknown): Promise<string | null> {
  if (typeof img !== "string" || !img.trim()) return Promise.resolve(null);
  const https = publicHttpsUrl(img);
  if (https) return Promise.resolve(https);
  const path = img.trim();
  let pending = cache.get(path);
  if (!pending) {
    pending = renderThumbnail(path).catch(() => null);
    cache.set(path, pending);
  }
  return pending;
}

/** Esvazia o cache; usado nos testes. */
export function clearThumbnailCache(): void {
  cache.clear();
}

async function renderThumbnail(path: string): Promise<string | null> {
  const image = new Image();
  image.decoding = "async";
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("image_load_failed"));
  });
  image.src = path;
  await withTimeout(loaded, LOAD_TIMEOUT_MS);

  const canvas = document.createElement("canvas");
  canvas.width = THUMBNAIL_SIZE;
  canvas.height = THUMBNAIL_SIZE;
  const context = canvas.getContext("2d");
  if (!context) return null;

  // Recorte central, como `object-fit: cover`; SVGs sem tamanho usam o quadro inteiro.
  const width = image.naturalWidth || THUMBNAIL_SIZE;
  const height = image.naturalHeight || THUMBNAIL_SIZE;
  const scale = Math.max(THUMBNAIL_SIZE / width, THUMBNAIL_SIZE / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  context.drawImage(
    image,
    (THUMBNAIL_SIZE - drawWidth) / 2,
    (THUMBNAIL_SIZE - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );

  let data = canvas.toDataURL("image/webp", 0.82);
  // Navegadores sem codificador WebP devolvem PNG; ele também é aceito.
  if (!/^data:image\/(webp|png);base64,/u.test(data)) data = canvas.toDataURL("image/png");
  return /^data:image\/(webp|png);base64,/u.test(data) && data.length <= MAX_THUMBNAIL_CHARS
    ? data
    : null;
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("image_load_timeout")), milliseconds);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
