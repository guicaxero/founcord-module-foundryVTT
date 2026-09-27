import type {
  CommandResult,
  MerchantStockEntry,
  MerchantStockReplacePayload,
} from "../bridge/contracts";
import { MODULE_ID } from "../constants";
import { localize } from "../i18n";
import { merchantActorId } from "../settings";
import { scheduleMerchantSync } from "../sync/merchant";

/** Marca dos itens criados pelo sorteio; só eles são trocados no próximo envio. */
export const GENERATED_BY = "merchant-stock";

const MAX_ITEMS = 100;
const KINDS = ["weapon", "armor", "item"] as const;
const AVAILABILITY_CODES = { common: "C", uncommon: "U", rare: "R", exotic: "E" } as const;
const HANDS = ["one", "two", "off"] as const;
const ATTRIBUTES = ["strength", "agility", "intellect", "will", "perception"] as const;
const ICON_PATH = /^(systems|icons|modules)\/[A-Za-z0-9 %._/-]+\.(webp|png|jpe?g|svg)$/u;

type GeneratedFlags = Readonly<{ generatedBy?: unknown; drawId?: unknown; catalogItemId?: unknown }>;

function generatedFlags(item: FoundryItem): GeneratedFlags | null {
  const flags = item.flags?.[MODULE_ID] as GeneratedFlags | undefined;
  return flags?.generatedBy === GENERATED_BY ? flags : null;
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
  if (!Array.isArray(payload.items) || payload.items.length === 0 || payload.items.length > MAX_ITEMS) {
    throw invalid("items");
  }
  return payload.items.map((entry, index) => {
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
    flags: { [MODULE_ID]: { generatedBy: GENERATED_BY, drawId, catalogItemId: entry.catalogItemId } },
  };
}

/**
 * Troca o estoque sorteado no ator do Lojista. Itens colocados à mão ficam;
 * reenviar o mesmo sorteio não duplica nada.
 */
export async function replaceMerchantStock(payload: MerchantStockReplacePayload): Promise<CommandResult> {
  const items = validateStockPayload(payload);
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
