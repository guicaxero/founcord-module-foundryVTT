/** Conteúdo que nunca sai do Foundry: scripts, embeds e trechos marcados como secretos. */
const HIDDEN_CONTENT_SELECTOR =
  "script,style,template,noscript,iframe,object,embed,.secret,.gm-only,[data-secret],[data-gm-only],[data-visibility='gm'],[data-visibility='owner']";

/** Converte HTML em texto simples legível, removendo conteúdo privado. */
export function htmlToPlainText(value: unknown): string {
  const container = document.createElement("div");
  container.innerHTML = String(value ?? "");
  for (const element of container.querySelectorAll(HIDDEN_CONTENT_SELECTOR)) {
    element.remove();
  }
  for (const lineBreak of container.querySelectorAll("br")) lineBreak.replaceWith("\n");
  for (const block of container.querySelectorAll("p,div,li,section,article,header,footer")) {
    block.append("\n");
  }
  return String(container.textContent ?? "")
    .replace(/\u00a0/gu, " ")
    .replace(/[ \t]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function sanitizedPlainText(value: unknown, maxLength: number): string | null {
  const text = htmlToPlainText(value);
  return text ? text.slice(0, maxLength) : null;
}

export function nullableLongText(value: unknown, maxLength: number): string | null {
  const text =
    typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  return text ? text.slice(0, maxLength) : null;
}

export function nullableText(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, 120) : null;
}

export function nullableIdentifier(value: unknown): string | null {
  const identifier = typeof value === "string" ? value.trim() : "";
  return identifier && /^[A-Za-z0-9._-]+$/u.test(identifier) ? identifier.slice(0, 128) : null;
}

export function safeInteger(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

export function nullableQuantity(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const quantity = Number(value);
  return Number.isFinite(quantity)
    ? Math.min(1_000_000, Math.max(0, Math.trunc(quantity)))
    : null;
}

/** Aceita somente imagens já públicas por HTTPS; caminhos locais do Foundry nunca saem. */
export function publicHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString().slice(0, 2_048) : null;
  } catch {
    return null;
  }
}

export function documentUpdatedAt(document: { _stats?: DocumentStats } | null | undefined): string {
  const timestamp = Number(
    document?._stats?.modifiedTime ?? document?._stats?.createdTime ?? Date.now(),
  );
  return new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toISOString();
}
