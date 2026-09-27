import { publicHttpsUrl } from "../sanitize";

/** Lado da miniatura de item enviada ao portal, em pixels. */
export const THUMBNAIL_SIZE = 64;
/** Limite de uma miniatura de item em base64; o contrato do portal aceita até 16 000. */
export const MAX_THUMBNAIL_CHARS = 15_000;
/** Soma das miniaturas de um catálogo; o portal aceita até 1 000 000. */
export const MAX_CATALOG_THUMBNAIL_CHARS = 800_000;

/**
 * Enquadramento da miniatura:
 * - `cover` preenche o quadrado (ícones);
 * - `portrait` preenche alinhando ao topo, para não cortar a cabeça de retratos altos;
 * - `contain` mostra a imagem inteira com fundo transparente (tokens).
 */
export type ThumbnailFit = "cover" | "portrait" | "contain";

export type ThumbnailOptions = Readonly<{ size: number; maxChars: number; fit: ThumbnailFit }>;

const ITEM_THUMBNAIL: ThumbnailOptions = { size: THUMBNAIL_SIZE, maxChars: MAX_THUMBNAIL_CHARS, fit: "cover" };

const LOAD_TIMEOUT_MS = 5_000;
const cache = new Map<string, Promise<string | null>>();

/**
 * Imagem pública a partir de um caminho do Foundry. Endereços HTTPS seguem
 * como estão; caminhos do servidor (`icons/...`, `worlds/...`) viram uma
 * miniatura gerada no navegador do mestre, porque o servidor não é exposto à
 * internet.
 */
export function publicImage(img: unknown, options: ThumbnailOptions): Promise<string | null> {
  if (typeof img !== "string" || !img.trim()) return Promise.resolve(null);
  const https = publicHttpsUrl(img);
  if (https) return Promise.resolve(https);
  const path = img.trim();
  const key = `${options.fit}:${options.size}:${path}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = renderThumbnail(path, options).catch(() => null);
    cache.set(key, pending);
  }
  return pending;
}

/** Ícone de item do Lojista: miniatura de 64 px. */
export function itemImage(img: unknown): Promise<string | null> {
  return publicImage(img, ITEM_THUMBNAIL);
}

/** Esvazia o cache; usado nos testes. */
export function clearThumbnailCache(): void {
  cache.clear();
}

async function renderThumbnail(path: string, options: ThumbnailOptions): Promise<string | null> {
  const image = new Image();
  image.decoding = "async";
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("image_load_failed"));
  });
  image.src = path;
  await withTimeout(loaded, LOAD_TIMEOUT_MS);

  const { size } = options;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;

  // SVGs sem tamanho declarado usam o quadro inteiro.
  const width = image.naturalWidth || size;
  const height = image.naturalHeight || size;
  const scale =
    options.fit === "contain" ? Math.min(size / width, size / height) : Math.max(size / width, size / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  const x = (size - drawWidth) / 2;
  // Retratos altos: recorta mais embaixo que em cima, preservando o rosto.
  const y = options.fit === "portrait" ? Math.min(0, (size - drawHeight) * 0.15) : (size - drawHeight) / 2;
  context.drawImage(image, x, y, drawWidth, drawHeight);

  let data = canvas.toDataURL("image/webp", 0.82);
  // Navegadores sem codificador WebP devolvem PNG; ele também é aceito.
  if (!/^data:image\/(webp|png);base64,/u.test(data)) data = canvas.toDataURL("image/png");
  if (data.length > options.maxChars) data = canvas.toDataURL("image/webp", 0.6);
  return /^data:image\/(webp|png);base64,/u.test(data) && data.length <= options.maxChars ? data : null;
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
