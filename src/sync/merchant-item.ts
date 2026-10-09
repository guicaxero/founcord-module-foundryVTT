import type {
  MerchantArmorDetails,
  MerchantItemProjection,
  MerchantRequirement,
  MerchantWeaponDetails,
} from "../bridge/contracts";
import { isPortalItem, portalCatalogItemId } from "./merchant-flags";
import {
  documentUpdatedAt,
  nullableLongText,
  nullableQuantity,
  sanitizedPlainText,
} from "../sanitize";

/** Moedas do sistema Demon Lord, na ordem ouro → trocados. */
export const MERCHANT_COINS = ["gc", "ss", "cp", "bits"] as const;
export type MerchantCoin = (typeof MERCHANT_COINS)[number];

export function isMerchantCoin(value: unknown): value is MerchantCoin {
  return typeof value === "string" && (MERCHANT_COINS as readonly string[]).includes(value);
}

/**
 * Preço textual do item. O campo `system.value` é livre; quando o mestre digita
 * só um número (`22`), a moeda padrão escolhida na tela de conexão completa o
 * texto (`22 cp`) para o portal saber qual moeda é.
 */
export function merchantPrice(value: unknown, defaultCoin: MerchantCoin): string | null {
  const text = nullableLongText(value, 64);
  if (!text) return null;
  return /^\d+$/u.test(text) ? `${text} ${defaultCoin}`.slice(0, 64) : text;
}

const AVAILABILITY: Readonly<Record<string, MerchantItemProjection["availability"]>> = {
  C: "common",
  U: "uncommon",
  R: "rare",
  E: "exotic",
};

const CONSUMABLE: Readonly<Record<string, MerchantItemProjection["consumableType"]>> = {
  D: "drink",
  F: "food",
  I: "incantation",
  P: "potion",
  V: "poison",
  T: "trinket",
};

const ATTRIBUTES = ["strength", "agility", "intellect", "will", "perception"] as const;
const HANDS = ["one", "two", "off"] as const;

function code(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

/** Tipo de consumível do sistema (`P`, `F`…) pelo nome do contrato (`potion`, `food`…). */
export function consumableType(value: unknown): MerchantItemProjection["consumableType"] {
  return CONSUMABLE[code(value)] ?? null;
}

function shortStat(value: unknown): string | null {
  return nullableLongText(value, 40);
}

function requirement(value: DemonLordRequirement | null | undefined): MerchantRequirement | null {
  const attribute = typeof value?.attribute === "string" ? value.attribute.trim().toLowerCase() : "";
  const minimum = Math.trunc(Number(value?.minvalue ?? 0));
  if (!(ATTRIBUTES as readonly string[]).includes(attribute) || !Number.isFinite(minimum) || minimum <= 0) {
    return null;
  }
  return {
    attribute: attribute as MerchantRequirement["attribute"],
    minimum: Math.min(99, minimum),
  };
}

function weaponDetails(item: FoundryItem): MerchantWeaponDetails | null {
  if (item.type !== "weapon") return null;
  const hands = typeof item.system?.hands === "string" ? item.system.hands.trim().toLowerCase() : "";
  return {
    damage: shortStat(item.system?.action?.damage),
    hands: (HANDS as readonly string[]).includes(hands) ? (hands as MerchantWeaponDetails["hands"]) : null,
    requirement: requirement(item.system?.requirement),
  };
}

function armorDetails(item: FoundryItem): MerchantArmorDetails | null {
  if (item.type !== "armor") return null;
  return {
    defense: shortStat(item.system?.defense),
    agility: shortStat(item.system?.agility),
    fixed: shortStat(item.system?.fixed),
    shield: item.system?.isShield === true,
    requirement: requirement(item.system?.requirement),
  };
}

/**
 * Projeção pública do item: texto sanitizado, preço com moeda, detalhes do
 * sistema e a imagem já resolvida (miniatura ou HTTPS).
 */
export function merchantItemProjection(
  item: FoundryItem,
  options: Readonly<{ defaultCoin: MerchantCoin; imageUrl: string | null; category: string | null }>,
): MerchantItemProjection {
  return {
    itemId: String(item.id).slice(0, 128),
    name: String(item.name ?? "").trim().slice(0, 160) || "Item sem nome",
    description: sanitizedPlainText(item.system?.description, 4_000),
    category: options.category,
    imageUrl: options.imageUrl,
    price: merchantPrice(item.system?.value, options.defaultCoin),
    quantity: nullableQuantity(item.system?.quantity),
    availability: AVAILABILITY[code(item.system?.availability)] ?? null,
    consumableType: item.type === "item" ? (CONSUMABLE[code(item.system?.consumabletype)] ?? null) : null,
    properties: nullableLongText(item.system?.properties, 500),
    weapon: weaponDetails(item),
    armor: armorDetails(item),
    origin: isPortalItem(item) ? "portal" : "manual",
    catalogItemId: portalCatalogItemId(item),
    sourceUpdatedAt: documentUpdatedAt(item),
  };
}
