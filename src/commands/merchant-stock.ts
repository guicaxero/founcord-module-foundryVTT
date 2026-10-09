import type {
  CommandResult,
  MerchantStockEntry,
  MerchantStockPatchOperation,
  MerchantStockPatchPayload,
  MerchantStockReplacePayload,
} from "../bridge/contracts";
import { MODULE_ID } from "../constants";
import { localize } from "../i18n";
import { nullableQuantity } from "../sanitize";
import { merchantActorId } from "../settings";
import { scheduleMerchantSync } from "../sync/merchant";
import { GENERATED_BY, isPortalItem, itemQuantity, portalCatalogItemId } from "../sync/merchant-flags";

export { GENERATED_BY };

const MAX_ITEMS = 100;
const KINDS = ["weapon", "armor", "item"] as const;
const AVAILABILITY_CODES = { common: "C", uncommon: "U", rare: "R", exotic: "E" } as const;
const HANDS = ["one", "two", "off"] as const;
const ATTRIBUTES = ["strength", "agility", "intellect", "will", "perception"] as const;
const ICON_PATH = /^(systems|icons|modules)\/[A-Za-z0-9 %._/-]+\.(webp|png|jpe?g|svg)$/u;

type GeneratedFlags = Readonly<{ generatedBy?: unknown; drawId?: unknown; catalogItemId?: unknown }>;

function generatedFlags(item: FoundryItem): GeneratedFlags | null {
  return isPortalItem(item) ? (item.flags?.[MODULE_ID] as GeneratedFlags) : null;
}

function requireMerchant(): FoundryActor {
  const actorId = merchantActorId();
  const merchant = actorId ? game.actors.get(actorId) : null;
  if (!merchant) {
    throw new Error(
      localize(
        "ORDEM_BRIDGE.Errors.StockMerchantMissing",
        "Nenhum ator está configurado como Lojista neste mundo. Escolha o Lojista na tela de conexão e reenvie o estoque.",
      ),
    );
  }
  return merchant;
}

function invalid(detail: string): Error {
  return new Error(
    `${localize("ORDEM_BRIDGE.Errors.StockInvalid", "O estoque recebido do portal é inválido.")} (${detail})`,
  );
}

function text(value: unknown, max: number, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw invalid(field);
  const trimmed = value.trim();
  if (trimmed.length > max) throw invalid(field);
  return trimmed || null;
}

/**
 * Confere cada item antes de tocar no ator: só os campos e valores do
 * contrato passam, e nada do payload vira HTML ou código.
 */
export function validateStockPayload(payload: MerchantStockReplacePayload): readonly MerchantStockEntry[] {
  if (typeof payload?.drawId !== "string" || !payload.drawId) throw invalid("drawId");
  return validateCatalogEntries(payload.items, MAX_ITEMS);
}

/** Itens do catálogo do portal: só os campos e valores do contrato passam. */
export function validateCatalogEntries(
  items: readonly MerchantStockEntry[] | undefined,
  max: number,
  invalidError: (detail: string) => Error = invalid,
): readonly MerchantStockEntry[] {
  const invalid = invalidError;
  if (!Array.isArray(items) || items.length === 0 || items.length > max) {
    throw invalid("items");
  }
  return items.map((entry, index) => {
    const field = (name: string) => `items[${index}].${name}`;
    const name = text(entry.name, 160, field("name"));
    if (!name) throw invalid(field("name"));
    if (!(KINDS as readonly string[]).includes(entry.kind)) throw invalid(field("kind"));
    if (!(entry.availability in AVAILABILITY_CODES)) throw invalid(field("availability"));
    if (!Number.isInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > 100) {
      throw invalid(field("quantity"));
    }
    if (entry.hands !== null && !(HANDS as readonly string[]).includes(entry.hands)) throw invalid(field("hands"));
    if (
      entry.requirement !== null &&
      (!(ATTRIBUTES as readonly string[]).includes(entry.requirement.attribute) ||
        !Number.isInteger(entry.requirement.minimum) ||
        entry.requirement.minimum < 1 ||
        entry.requirement.minimum > 99)
    ) {
      throw invalid(field("requirement"));
    }
    const icon = text(entry.icon, 512, field("icon"));
    if (icon && !ICON_PATH.test(icon)) throw invalid(field("icon"));
    return {
      ...entry,
      name,
      price: text(entry.price, 64, field("price")),
      damage: text(entry.damage, 40, field("damage")),
      agility: text(entry.agility, 40, field("agility")),
      fixed: text(entry.fixed, 40, field("fixed")),
      properties: text(entry.properties, 500, field("properties")),
      description: text(entry.description, 4_000, field("description")),
      icon,
    };
  });
}

/** Documento de item no formato do sistema Demon Lord. */
export function stockItemData(entry: MerchantStockEntry, drawId: string): Record<string, unknown> {
  return catalogItemData(entry, { generatedBy: GENERATED_BY, drawId, catalogItemId: entry.catalogItemId });
}

/** Item do catálogo do portal no formato do sistema, com as marcas do módulo. */
export function catalogItemData(entry: MerchantStockEntry, flags: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const escape = (value: string) => foundry.utils.escapeHTML(value);
  const requirement = entry.requirement
    ? { attribute: entry.requirement.attribute, minvalue: entry.requirement.minimum }
    : { attribute: "", minvalue: 0 };
  const system: Record<string, unknown> = {
    value: entry.price ?? "",
    availability: AVAILABILITY_CODES[entry.availability],
    quantity: entry.quantity,
    properties: entry.properties ?? "",
    description: entry.description ? `<p>${escape(entry.description).replaceAll("\n", "<br>")}</p>` : "",
  };
  if (entry.kind === "weapon") {
    Object.assign(system, { action: { damage: entry.damage ?? "" }, hands: entry.hands ?? "", requirement });
  }
  if (entry.kind === "armor") {
    Object.assign(system, { agility: entry.agility ?? "", fixed: entry.fixed ?? "", isShield: false, requirement });
  }
  return {
    name: entry.name,
    type: entry.kind,
    ...(entry.icon ? { img: entry.icon } : {}),
    system,
    flags: { [MODULE_ID]: flags },
  };
}

/**
 * Troca o estoque sorteado no ator do Lojista. Itens colocados à mão ficam;
 * reenviar o mesmo sorteio não duplica nada.
 */
export async function replaceMerchantStock(payload: MerchantStockReplacePayload): Promise<CommandResult> {
  const items = validateStockPayload(payload);
  const merchant = requireMerchant();

  const generated = [...merchant.items].filter((item) => generatedFlags(item));
  if (generated.some((item) => generatedFlags(item)?.drawId === payload.drawId)) {
    return { drawId: payload.drawId, created: 0, removed: 0, alreadyApplied: true };
  }

  if (generated.length > 0) {
    await merchant.deleteEmbeddedDocuments(
      "Item",
      generated.map((item) => item.id),
    );
  }
  const created = await merchant.createEmbeddedDocuments(
    "Item",
    items.map((entry) => stockItemData(entry, payload.drawId)),
  );
  scheduleMerchantSync(500);
  return {
    drawId: payload.drawId,
    created: created.length,
    removed: generated.length,
    alreadyApplied: false,
  };
}

const MAX_PATCH_OPERATIONS = 100;
const FOUNDRY_ID = /^[A-Za-z0-9_-]{1,128}$/u;

function invalidPatch(detail: string): Error {
  return new Error(
    `${localize("ORDEM_BRIDGE.Errors.StockPatchInvalid", "A edição de estoque recebida do portal é inválida.")} (${detail})`,
  );
}

function patchQuantity(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1_000) throw invalidPatch(field);
  return value;
}

/** Confere a edição antes de tocar no ator; itens novos passam pela validação do sorteio. */
export function validatePatchPayload(payload: MerchantStockPatchPayload): readonly MerchantStockPatchOperation[] {
  if (typeof payload?.patchId !== "string" || !payload.patchId) throw invalidPatch("patchId");
  const operations = payload.operations;
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > MAX_PATCH_OPERATIONS) {
    throw invalidPatch("operations");
  }
  return operations.map((operation: MerchantStockPatchOperation, index): MerchantStockPatchOperation => {
    const field = (name: string) => `operations[${index}].${name}`;
    if (operation?.op === "add") {
      const [entry] = validateCatalogEntries([operation.entry], 1, (detail) =>
        invalidPatch(detail.replace("items[0]", field("entry"))),
      );
      return { op: "add", entry: entry! };
    }
    if (operation?.op !== "set" && operation?.op !== "remove") throw invalidPatch(field("op"));
    if (typeof operation.itemId !== "string" || !FOUNDRY_ID.test(operation.itemId)) {
      throw invalidPatch(field("itemId"));
    }
    if (operation.op === "remove") return { op: "remove", itemId: operation.itemId };
    return {
      op: "set",
      itemId: operation.itemId,
      from: operation.from === null ? null : patchQuantity(operation.from, field("from")),
      quantity: patchQuantity(operation.quantity, field("quantity")),
    };
  });
}

export type PatchStatus = "applied" | "conflict" | "missing";

/**
 * Aplica no Lojista só as mudanças feitas no portal: muda a quantidade de um
 * item (se ela ainda for a que o portal leu), remove itens e acrescenta itens
 * do catálogo. O resto do estoque fica como está; reenviar não repete nada.
 */
export async function patchMerchantStock(payload: MerchantStockPatchPayload): Promise<CommandResult> {
  const operations = validatePatchPayload(payload);
  const merchant = requireMerchant();
  if (merchant.flags?.[MODULE_ID]?.lastStockPatchId === payload.patchId) {
    return { patchId: payload.patchId, alreadyApplied: true, statuses: "" };
  }

  const statuses: PatchStatus[] = [];
  const quantities = new Map<string, number>();
  const removals = new Set<string>();
  const creations: Record<string, unknown>[] = [];
  for (const operation of operations) {
    if (operation.op === "add") {
      // O mesmo item do catálogo, já enviado pelo portal, recebe a soma.
      const same = [...merchant.items].find(
        (item) =>
          isPortalItem(item) && portalCatalogItemId(item) === operation.entry.catalogItemId && !removals.has(item.id),
      );
      if (same) {
        quantities.set(same.id, (quantities.get(same.id) ?? itemQuantity(same)) + operation.entry.quantity);
      } else {
        creations.push(
          catalogItemData(operation.entry, {
            generatedBy: GENERATED_BY,
            drawId: payload.patchId,
            catalogItemId: operation.entry.catalogItemId,
          }),
        );
      }
      statuses.push("applied");
      continue;
    }
    const item = merchant.items.get(operation.itemId);
    if (!item || removals.has(item.id)) {
      statuses.push("missing");
      continue;
    }
    if (operation.op === "remove") {
      removals.add(item.id);
      quantities.delete(item.id);
      statuses.push("applied");
      continue;
    }
    // Se alguém comprou ou mudou o item no Foundry depois da leitura, nada muda.
    if (nullableQuantity(item.system?.quantity) !== operation.from) {
      statuses.push("conflict");
      continue;
    }
    quantities.set(item.id, operation.quantity);
    statuses.push("applied");
  }

  if (quantities.size > 0) {
    await merchant.updateEmbeddedDocuments(
      "Item",
      [...quantities].map(([id, quantity]) => ({ _id: id, "system.quantity": quantity })),
    );
  }
  if (removals.size > 0) await merchant.deleteEmbeddedDocuments("Item", [...removals]);
  if (creations.length > 0) await merchant.createEmbeddedDocuments("Item", creations);
  await merchant.update({ [`flags.${MODULE_ID}.lastStockPatchId`]: payload.patchId });
  scheduleMerchantSync(500);
  const count = (status: PatchStatus) => statuses.filter((value) => value === status).length;
  return {
    patchId: payload.patchId,
    alreadyApplied: false,
    // Um status por operação, na ordem recebida.
    statuses: statuses.join(","),
    applied: count("applied"),
    conflicts: count("conflict"),
    missing: count("missing"),
  };
}
