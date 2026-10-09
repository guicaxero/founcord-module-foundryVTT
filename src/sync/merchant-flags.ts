import { MODULE_ID } from "../constants";
import { nullableQuantity } from "../sanitize";

/** Marca dos itens criados pelo portal (sorteio, seleção ou edição do estoque). */
export const GENERATED_BY = "merchant-stock";

type ItemFlags = Readonly<{ generatedBy?: unknown; drawId?: unknown; catalogItemId?: unknown }>;
export type ItemLike = Readonly<{
  name?: string | null;
  type?: string;
  system?: Readonly<{ quantity?: unknown }> | null;
  flags?: Readonly<Record<string, unknown>> | null;
}>;

function moduleFlags(item: ItemLike): ItemFlags | undefined {
  return item.flags?.[MODULE_ID] as ItemFlags | undefined;
}

/** O item foi criado pelo portal e ainda é trocado no próximo sorteio. */
export function isPortalItem(item: ItemLike): boolean {
  return moduleFlags(item)?.generatedBy === GENERATED_BY;
}

/** `catalogItemId` do portal, só nos itens que ainda são do portal. */
export function portalCatalogItemId(item: ItemLike): string | null {
  const id = isPortalItem(item) ? moduleFlags(item)?.catalogItemId : null;
  return typeof id === "string" && id ? id.slice(0, 64) : null;
}

/** Itens iguais têm o mesmo tipo e o mesmo nome, sem diferenciar acento e caixa. */
export function stackKey(item: ItemLike): string {
  const name = String(item.name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("pt-BR");
  return `${item.type ?? ""}|${name}`;
}

/** Quantidade do item; sem valor, o sistema trata o item como uma unidade. */
export function itemQuantity(item: ItemLike): number {
  return nullableQuantity(item.system?.quantity) ?? 1;
}
