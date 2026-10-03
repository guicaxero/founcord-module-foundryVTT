import type {
  CharacterSheet,
  CharacterSheetInventoryItem,
  CharacterSheetSpell,
  CharacterSheetTalent,
} from "../bridge/contracts";
import { htmlToPlainText, nullableLongText, sanitizedPlainText } from "../sanitize";
import { consumableType } from "./merchant-item";

/**
 * Ficha completa do personagem para a área do jogador no portal. Lê os
 * valores já preparados pelo sistema `demonlord` e envia só texto simples e
 * números: nenhum HTML, caminho de arquivo, flag ou nota do mestre.
 */

type Json = Readonly<Record<string, unknown>>;

const INVENTORY_TYPES = ["weapon", "armor", "item", "ammo", "relic"] as const;
const TALENT_TYPES = ["talent", "feature", "specialaction"] as const;
const ATTRIBUTES = ["strength", "agility", "intellect", "will", "perception"] as const;

/** Limites do contrato do portal (`CharacterSheetSchema`). */
const LIMITS = { inventory: 200, spells: 120, talents: 200, professions: 20, languages: 40 } as const;
/** Abaixo do máximo do portal (400 000), para sobrar margem. */
export const SHEET_BUDGET_CHARS = 380_000;

const record = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};

function integer(value: unknown, max: number): number {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) ? Math.min(max, Math.max(0, number)) : 0;
}

function optionalInteger(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number.parseInt(String(value), 10);
  return Number.isFinite(number) ? Math.min(100_000, Math.max(0, number)) : null;
}

const label = (value: unknown, max: number) => nullableLongText(value, max);
const itemName = (item: FoundryItem) => String(item.name ?? "").trim().slice(0, 120) || "Sem nome";
const itemText = (item: FoundryItem, max: number) => sanitizedPlainText(record(item.system).description, max) ?? "";

/** Marca curta da versão do texto (FNV-1a de 32 bits), para detectar edições no Foundry. */
export function textRevision(value: unknown): string {
  const text = String(value ?? "");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}-${hash.toString(16).padStart(8, "0")}`;
}

/** Defesa da armadura em uma linha, como no catálogo do Lojista. */
function armorDefense(system: Json): string | null {
  const fixed = label(system.fixed, 20);
  if (fixed) return `Defesa ${fixed}`;
  const agility = label(system.agility, 20);
  if (agility) return `Agilidade +${agility.replace(/^\+/u, "")}`;
  const defense = label(system.defense, 20);
  return defense ? `Defesa +${defense.replace(/^\+/u, "")}` : null;
}

function inventoryItem(item: FoundryItem): CharacterSheetInventoryItem {
  const system = record(item.system);
  const type = item.type as CharacterSheetInventoryItem["type"];
  return {
    id: item.id,
    name: itemName(item),
    description: itemText(item, 1_500),
    type,
    quantity: integer(system.quantity ?? 1, 100_000),
    equipped: system.wear === true,
    price: label(system.value, 64),
    availability: label(system.availability, 20),
    properties: label(system.properties, 500),
    damage: type === "weapon" ? label(record(system.action).damage, 60) : null,
    hands: type === "weapon" ? label(String(system.hands ?? "").toLowerCase(), 20) : null,
    defense: type === "armor" ? armorDefense(system) : null,
    consumableType: type === "item" ? consumableType(system.consumabletype) : null,
  };
}

function spell(item: FoundryItem): CharacterSheetSpell {
  const system = record(item.system);
  const castings = record(system.castings);
  const spellType = String(system.spelltype ?? "").toLowerCase();
  return {
    id: item.id,
    name: itemName(item),
    description: itemText(item, 1_500),
    tradition: label(system.tradition, 80),
    rank: integer(system.rank, 20),
    spellType: spellType === "attack" || spellType === "utility" ? spellType : null,
    attribute: label(system.attribute, 20),
    castings: { value: optionalInteger(castings.value), max: optionalInteger(castings.max) },
    target: label(system.target, 200),
    area: label(system.area, 200),
    duration: label(system.duration, 120),
  };
}

function talent(item: FoundryItem): CharacterSheetTalent {
  const system = record(item.system);
  const uses = record(system.uses);
  return {
    id: item.id,
    name: itemName(item),
    description: itemText(item, 1_500),
    kind: item.type as CharacterSheetTalent["kind"],
    group: label(system.groupname, 120),
    uses: { value: optionalInteger(uses.value), max: optionalInteger(uses.max) },
  };
}

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

/** Corta descrições até a ficha caber no orçamento; o resto da ficha é mantido. */
export function fitSheet(sheet: CharacterSheet, budget = SHEET_BUDGET_CHARS): CharacterSheet {
  let current = sheet;
  for (const max of [600, 200, 0]) {
    if (JSON.stringify(current).length <= budget) return current;
    const cut = <T extends { description: string }>(entries: readonly T[]) =>
      entries.map((entry) => ({ ...entry, description: entry.description.slice(0, max) }));
    current = { ...current, inventory: cut(current.inventory), spells: cut(current.spells), talents: cut(current.talents) };
  }
  return current;
}

export function characterSheet(actor: FoundryActor): CharacterSheet {
  const system = record(actor.system);
  const attributes = record(system.attributes);
  const characteristics = record(system.characteristics);
  const appearance = record(system.appearance);
  const items = [...(actor.items ?? [])];
  const ofType = (types: readonly string[]) => items.filter((item) => types.includes(item.type));

  const ancestry = ofType(["ancestry"])[0];
  return fitSheet({
    attributes: Object.fromEntries(
      ATTRIBUTES.map((key) => [key, integer(record(attributes[key]).value, 100)]),
    ) as CharacterSheet["attributes"],
    characteristics: {
      defense: integer(characteristics.defense, 100_000),
      speed: integer(characteristics.speed, 100_000),
      power: integer(characteristics.power, 100_000),
      size: label(characteristics.size, 20),
      fortune: integer(characteristics.fortune, 100_000),
    },
    appearance: {
      age: label(appearance.age, 60),
      sex: label(appearance.sex, 60),
      eyes: label(appearance.eyes, 60),
      hair: label(appearance.hair, 60),
      height: label(appearance.height, 60),
      weight: label(appearance.weight, 60),
      feature: label(appearance.feature, 200),
    },
    religion: label(record(system.religion).value, 120),
    inventory: items
      .filter((item) => isOneOf(INVENTORY_TYPES, item.type))
      .slice(0, LIMITS.inventory)
      .map(inventoryItem),
    spells: ofType(["spell"]).slice(0, LIMITS.spells).map(spell),
    talents: items
      .filter((item) => isOneOf(TALENT_TYPES, item.type))
      .slice(0, LIMITS.talents)
      .map(talent),
    roots: {
      ancestry: ancestry ? { name: itemName(ancestry), description: itemText(ancestry, 3_000) } : null,
      professions: ofType(["profession"])
        .slice(0, LIMITS.professions)
        .map((item) => ({ name: itemName(item), description: itemText(item, 1_500) })),
      languages: ofType(["language"])
        .slice(0, LIMITS.languages)
        .map((item) => {
          const language = record(item.system);
          return {
            name: itemName(item).slice(0, 80),
            speak: language.speak !== false,
            read: language.read === true,
            write: language.write === true,
          };
        }),
    },
    notes: {
      text: htmlToPlainText(system.description).slice(0, 8_000),
      revision: textRevision(system.description),
    },
  });
}
