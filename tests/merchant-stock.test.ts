import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MerchantStockEntry, MerchantStockReplacePayload } from "../src/bridge/contracts";
import { MODULE_ID } from "../src/constants";
import { GENERATED_BY, replaceMerchantStock, stockItemData, validateStockPayload } from "../src/commands/merchant-stock";
import { collection, setWorld } from "./foundry-mocks";

vi.mock("../src/sync/merchant", () => ({ scheduleMerchantSync: vi.fn() }));

const drawId = "22222222-2222-4222-8222-222222222222";

function entry(overrides: Partial<MerchantStockEntry> = {}): MerchantStockEntry {
  return {
    catalogItemId: "33333333-3333-4333-8333-333333333333",
    name: "Arco longo",
    category: "Armas à Distância",
    kind: "weapon",
    availability: "uncommon",
    price: "1 co",
    damage: "1d6+1",
    hands: "two",
    agility: null,
    fixed: null,
    requirement: { attribute: "strength", minimum: 9 },
    properties: "Tamanho 1, alcance (longo)",
    description: null,
    icon: "systems/demonlord/assets/icons/weapons/longbow.webp",
    source: "lojista",
    quantity: 2,
    ...overrides,
  };
}

function payload(items: MerchantStockEntry[] = [entry()], id = drawId): MerchantStockReplacePayload {
  return { drawId: id, campaignId: "11111111-1111-4111-8111-111111111111", items, requestedAt: "2026-09-25T00:00:00.000Z" };
}

/** Ator com itens em memória, que registra criações e exclusões. */
function merchantActor(initial: FoundryItem[]) {
  let items = [...initial];
  const actor = {
    id: "lojista",
    name: "Lojista",
    type: "npc",
    get items() {
      return collection(items);
    },
    createEmbeddedDocuments: vi.fn(async (_name: "Item", data: readonly Readonly<Record<string, unknown>>[]) => {
      const created = data.map((document, index) => ({ id: `novo-${items.length + index}`, ...document }) as unknown as FoundryItem);
      items = [...items, ...created];
      return created;
    }),
    deleteEmbeddedDocuments: vi.fn(async (_name: "Item", ids: readonly string[]) => {
      items = items.filter((item) => !ids.includes(item.id));
      return [];
    }),
  };
  return { actor: actor as unknown as FoundryActor & typeof actor, list: () => items };
}

const manual: FoundryItem = { id: "manual", name: "Pão", type: "item", system: { value: "1 cc" } };
const previous: FoundryItem = {
  id: "antigo",
  name: "Funda",
  type: "weapon",
  system: {},
  flags: { [MODULE_ID]: { generatedBy: GENERATED_BY, drawId: "sorteio-antigo", catalogItemId: "x" } },
};

describe("merchant.stock.replace", () => {
  beforeEach(async () => {
    await game.settings.set(MODULE_ID, "merchantActorId", "lojista");
  });

  it("troca só os itens sorteados antes e preserva os colocados à mão", async () => {
    const { actor, list } = merchantActor([manual, previous]);
    setWorld({ actors: [actor] });

    const result = await replaceMerchantStock(payload());

    expect(result).toEqual({ drawId, created: 1, removed: 1, alreadyApplied: false });
    expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["antigo"]);
    expect(list().map((item) => item.name)).toEqual(["Pão", "Arco longo"]);
  });

  it("não duplica ao receber o mesmo sorteio de novo", async () => {
    const { actor } = merchantActor([manual]);
    setWorld({ actors: [actor] });

    await replaceMerchantStock(payload());
    const repeated = await replaceMerchantStock(payload());

    expect(repeated).toEqual({ drawId, created: 0, removed: 0, alreadyApplied: true });
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
  });

  it("monta arma e armadura no formato do sistema Demon Lord", () => {
    const weapon = stockItemData(entry(), drawId);
    expect(weapon).toMatchObject({
      name: "Arco longo",
      type: "weapon",
      img: "systems/demonlord/assets/icons/weapons/longbow.webp",
      system: {
        value: "1 co",
        availability: "U",
        quantity: 2,
        properties: "Tamanho 1, alcance (longo)",
        action: { damage: "1d6+1" },
        hands: "two",
        requirement: { attribute: "strength", minvalue: 9 },
      },
      flags: { [MODULE_ID]: { generatedBy: GENERATED_BY, drawId } },
    });

    const armor = stockItemData(
      entry({ name: "Brigandina", kind: "armor", damage: null, hands: null, fixed: "13", icon: null, description: "Placas <rebitadas>" }),
      drawId,
    );
    expect(armor).not.toHaveProperty("img");
    expect(armor.system).toMatchObject({ fixed: "13", agility: "", isShield: false, description: "<p>Placas &lt;rebitadas&gt;</p>" });
  });

  it("recusa payloads fora do contrato e mundo sem Lojista", async () => {
    expect(() => validateStockPayload(payload([]))).toThrow();
    expect(() => validateStockPayload(payload([entry({ kind: "macro" as never })]))).toThrow();
    expect(() => validateStockPayload(payload([entry({ icon: "https://evil.example/x.webp" })]))).toThrow();
    expect(() => validateStockPayload(payload([entry({ quantity: 0 })]))).toThrow();

    await game.settings.set(MODULE_ID, "merchantActorId", "");
    setWorld({ actors: [] });
    await expect(replaceMerchantStock(payload())).rejects.toThrow();
  });
});
