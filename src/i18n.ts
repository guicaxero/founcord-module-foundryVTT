export function localize(key: string, fallback: string): string {
  const translation = game.i18n.localize(key);
  return translation === key ? fallback : translation;
}

export function formatLocalized(
  key: string,
  data: Record<string, string>,
  fallback: string,
): string {
  const translation = game.i18n.format(key, data);
  return translation === key ? fallback : translation;
}

export function formatDateTime(value: string): string {
  try {
    return new Intl.DateTimeFormat(game.i18n.lang || "pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
