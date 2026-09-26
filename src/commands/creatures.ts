import type { CommandResult, CreatureDraft, CreatureItem, CreatureUpsertPayload } from "../bridge/contracts";
import { MODULE_ID } from "../constants";
import { localize } from "../i18n";

/** Pasta de atores onde as criaturas do portal são criadas. */
export const CREATURE_FOLDER = "Ordem — Criaturas";

/** Marca dos itens criados pelo portal; só eles são trocados no reenvio. */
export const CREATURE_ITEM_MARK = "creature";

const DIFFICULTIES = [1, 5, 10, 25, 50, 100, 250, 500];
const ATTRIBUTES = ["strength", "agility", "intellect", "will", "perception"] as const;
const ITEM_KINDS = ["attack", "trait", "special_action", "end_of_round", "spell"] as const;
const MAX_ITEMS = 60;
const ITEM_TYPES: Readonly<Record<CreatureItem["kind"], string>> = {
  attack: "weapon",
  trait: "talent",
  special_action: "specialaction",
  end_of_round: "endoftheround",
  spell: "spell",
};

type CreatureFlags = Readonly<{ creatureId?: unknown; version?: unknown; generatedBy?: unknown }>;

function flagsOf(document: { flags?: FoundryActor["flags"] } | null | undefined): CreatureFlags | undefined {
  return document?.flags?.[MODULE_ID] as CreatureFlags | undefined;
}

function invalid(detail: string): Error {
  return new Error(
    `${localize("ORDEM_BRIDGE.Errors.CreatureInvalid", "A criatura recebida do portal é inválida.")} (${detail})`,
  );
}

function text(value: unknown, max: number, field: string, required = false): string {
  if (typeof value !== "string") throw invalid(field);
  const trimmed = value.trim();
  if (trimmed.length > max || (required && !trimmed)) throw invalid(field);
  return trimmed;
}

function integer(value: unknown, min: number, max: number, field: string): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw invalid(field);
  return value as number;
}

/** Caminho relativo do Foundry ou HTTPS; nunca `..`, caminho absoluto ou outro esquema. */
export function safeImagePath(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  const path = text(value, 512, field);
  const https = /^https:\/\/[^\s<>"']+$/u.test(path);
  const relative =
    /^(?![a-z][a-z0-9+.-]*:)(?!\/)[^\s<>"'\\]+$/iu.test(path.replaceAll("%20", "")) && !path.includes("..");
  if (!https && !relative) throw invalid(field);
  return path;
}

function validateItem(item: CreatureItem, index: number): CreatureItem {
  const field = (name: string) => `items[${index}].${name}`;
  if (!item || typeof item !== "object" || !(ITEM_KINDS as readonly string[]).includes(item.kind)) {
    throw invalid(field("kind"));
  }
  const base = {
    id: text(item.id, 64, field("id"), true),
    name: text(item.name, 120, field("name"), true),
    description: text(item.description, 8_000, field("description")),
    image: safeImagePath(item.image, field("image")),
  };
  switch (item.kind) {
    case "attack":
      if (item.against !== "defense" && !(ATTRIBUTES as readonly string[]).includes(item.against)) {
        throw invalid(field("against"));
      }
      return {
        ...base,
        kind: item.kind,
        bonus: text(item.bonus, 10, field("bonus")),
        against: item.against,
        boons: integer(item.boons, -10, 10, field("boons")),
        damage: text(item.damage, 60, field("damage")),
        properties: text(item.properties, 200, field("properties")),
      };
    case "spell":
      if (item.attribute !== "intellect" && item.attribute !== "will") throw invalid(field("attribute"));
      if (item.spellType !== "attack" && item.spellType !== "utility") throw invalid(field("spellType"));
      return {
        ...base,
        kind: item.kind,
        tradition: text(item.tradition, 60, field("tradition")),
        rank: integer(item.rank, 0, 10, field("rank")),
        attribute: item.attribute,
        spellType: item.spellType,
        target: text(item.target, 200, field("target")),
        area: text(item.area, 200, field("area")),
        duration: text(item.duration, 120, field("duration")),
      };
    default:
      return { ...base, kind: item.kind };
  }
}

/**
 * Confere a criatura antes de tocar em qualquer ator: só os campos e limites
 * do contrato passam, e nada do payload vira HTML ou código.
 */
export function validateCreaturePayload(payload: CreatureUpsertPayload): CreatureUpsertPayload {
  if (typeof payload?.creatureId !== "string" || !payload.creatureId) throw invalid("creatureId");
  const version = integer(payload.version, 1, Number.MAX_SAFE_INTEGER, "version");
  const creature = payload.creature;
  if (!creature || typeof creature !== "object") throw invalid("creature");
  if (!DIFFICULTIES.includes(creature.difficulty)) throw invalid("difficulty");
  if (!creature.attributes || typeof creature.attributes !== "object") throw invalid("attributes");
  if (!Array.isArray(creature.items) || creature.items.length > MAX_ITEMS) throw invalid("items");
  if (typeof creature.frightening !== "boolean" || typeof creature.horrifying !== "boolean") {
    throw invalid("frightening");
  }
  const name = text(creature.name, 120, "name", true);
  if (name.length < 2) throw invalid("name");
  return {
    ...payload,
    version,
    creature: {
      name,
      descriptor: text(creature.descriptor, 120, "descriptor"),
      description: text(creature.description, 8_000, "description"),
      difficulty: creature.difficulty,
      size: text(creature.size, 20, "size", true),
      image: safeImagePath(creature.image, "image"),
      attributes: Object.fromEntries(
        ATTRIBUTES.map((key) => [key, integer(creature.attributes[key], 0, 30, `attributes.${key}`)]),
      ) as CreatureDraft["attributes"],
      defense: integer(creature.defense, 0, 40, "defense"),
      health: integer(creature.health, 1, 2_000, "health"),
      speed: integer(creature.speed, 0, 100, "speed"),
      power: integer(creature.power, 0, 10, "power"),
      insanity: integer(creature.insanity, 0, 100, "insanity"),
      corruption: integer(creature.corruption, 0, 100, "corruption"),
      perceptionSenses: text(creature.perceptionSenses, 200, "perceptionSenses"),
      speedTraits: text(creature.speedTraits, 200, "speedTraits"),
      armor: text(creature.armor, 120, "armor"),
      frightening: creature.frightening,
      horrifying: creature.horrifying,
      items: creature.items.map(validateItem),
    },
  };
}

/** Texto simples do portal em parágrafos HTML, sempre escapado. */
export function paragraphs(value: string): string {
  const escape = (part: string) => foundry.utils.escapeHTML(part).replaceAll("\n", "<br>");
  return value
    .split(/\n{2,}/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${escape(part)}</p>`)
    .join("");
}

/** Sistema do ator `creature` do Demon Lord, com valores base e atuais iguais. */
export function creatureSystemData(creature: CreatureDraft): Record<string, unknown> {
  return {
    description: paragraphs(creature.description),
    attributes: Object.fromEntries(
      ATTRIBUTES.map((key) => [key, { base: creature.attributes[key], value: creature.attributes[key] }]),
    ),
    characteristics: {
      defense: creature.defense,
      defenseBase: creature.defense,
      health: { max: creature.health, maxBase: creature.health, value: creature.health },
      insanity: { value: creature.insanity },
      corruption: { value: creature.corruption },
      power: creature.power,
      powerBase: creature.power,
      size: creature.size,
      sizeBase: creature.size,
      speed: creature.speed,
      speedBase: creature.speed,
    },
    difficulty: creature.difficulty,
    difficultyBase: creature.difficulty,
    descriptor: creature.descriptor,
    perceptionsenses: creature.perceptionSenses,
    speedtraits: creature.speedTraits,
    armor: creature.armor,
    frightening: creature.frightening,
    horrifying: creature.horrifying,
  };
}

/** Item do ator no formato do sistema Demon Lord. */
export function creatureItemData(item: CreatureItem, creatureId: string): Record<string, unknown> {
  const system: Record<string, unknown> = { description: paragraphs(item.description) };
  if (item.kind === "attack") {
    Object.assign(system, {
      properties: item.properties,
      action: {
        active: true,
        attack: item.bonus,
        against: item.against,
        damageactive: Boolean(item.damage),
        damage: item.damage,
        boonsbanesactive: item.boons !== 0,
        boonsbanes: String(item.boons),
      },
    });
  }
  if (item.kind === "spell") {
    Object.assign(system, {
      tradition: item.tradition,
      rank: item.rank,
      attribute: item.attribute,
      spelltype: item.spellType,
      target: item.target,
      area: item.area,
      duration: item.duration,
    });
  }
  return {
    name: item.name,
    type: ITEM_TYPES[item.kind],
    ...(item.image ? { img: item.image } : {}),
    system,
    flags: { [MODULE_ID]: { generatedBy: CREATURE_ITEM_MARK, creatureId, itemId: item.id } },
  };
}

async function creatureFolder(): Promise<FoundryFolder | undefined> {
  const existing = game.folders.filter((folder) => folder.type === "Actor" && folder.name === CREATURE_FOLDER)[0];
  return existing ?? Folder.create({ name: CREATURE_FOLDER, type: "Actor" });
}

/**
 * Cria o ator da criatura ou atualiza o que o portal criou antes. Itens
 * colocados à mão no ator continuam; reenviar a mesma versão não muda nada.
 */
export async function upsertCreature(input: CreatureUpsertPayload): Promise<CommandResult> {
  const payload = validateCreaturePayload(input);
  const { creature, creatureId, version } = payload;
  const flags = { [MODULE_ID]: { creatureId, campaignId: payload.campaignId, version } };
  const token = creature.image ? { prototypeToken: { texture: { src: creature.image } } } : {};
  const items = creature.items.map((item) => creatureItemData(item, creatureId));

  const existing = game.actors.filter((actor) => flagsOf(actor)?.creatureId === creatureId)[0];
  if (existing) {
    const applied = flagsOf(existing)?.version;
    if (typeof applied === "number" && applied >= version) {
      return { actorId: existing.id, created: false, alreadyApplied: true };
    }
    await existing.update({
      name: creature.name,
      ...(creature.image ? { img: creature.image } : {}),
      ...token,
      system: creatureSystemData(creature),
      flags,
    });
    const generated = [...existing.items].filter((item) => flagsOf(item)?.generatedBy === CREATURE_ITEM_MARK);
    if (generated.length > 0) {
      await existing.deleteEmbeddedDocuments(
        "Item",
        generated.map((item) => item.id),
      );
    }
    if (items.length > 0) await existing.createEmbeddedDocuments("Item", items);
    return { actorId: existing.id, created: false, alreadyApplied: false };
  }

  const folder = await creatureFolder();
  const actor = await Actor.create({
    name: creature.name,
    type: "creature",
    ...(creature.image ? { img: creature.image } : {}),
    ...(folder ? { folder: folder.id } : {}),
    ...token,
    system: creatureSystemData(creature),
    items,
    flags,
  });
  if (!actor) {
    throw new Error(
      localize("ORDEM_BRIDGE.Errors.CreatureNotCreated", "O Foundry não criou o ator da criatura."),
    );
  }
  return { actorId: actor.id, created: true, alreadyApplied: false };
}
