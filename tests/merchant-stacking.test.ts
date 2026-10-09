import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MerchantStockEntry, MerchantStockPatchPayload } from "../src/bridge/contracts";
import { MODULE_ID } from "../src/constants";
import { patchMerchantStock, validatePatchPayload } from "../src/commands/merchant-stock";
import { GENERATED_BY, stackKey } from "../src/sync/merchant-flags";
import { findStackTarget, mergeMerchantDuplicates, stackOnCreate } from "../src/sync/merchant-stacking";
import { collection, setWorld } from "./foundry-mocks";

vi.mock("../src/sync/merchant", () => ({ scheduleMerchantSync: vi.fn() }));

// Itens sintéticos; nenhum conteúdo dos livros.
const gm = { id: "gm1", name: "Mestre", isGM: true, active: true } as FoundryUser;
const patchId = "44444444-4444-4444-8444-444444444444";

function portal(id: string, name: string, quantity: number, catalogItemId = `cat-${id}`): FoundryItem {
  return {
    id,
    name,
    type: "weapon",
    system: { quantity },
    flags: { [MODULE_ID]: { generatedBy: GENERATED_BY, drawId: "sorteio", catalogItemId } },
    _stats: { createdTime: 1 },
  };
}

function manual(id: string, name: string, quantity: number | null, createdTime = 1): FoundryItem {
  return { id, name, type: "weapon", system: { quantity }, _stats: { createdTime } };
}

/** Lojista em memória: aplica criações, atualizações (`system.quantity`) e exclusões. */
function merchantActor(initial: FoundryItem[]) {
  let items = [...initial];
  let flags: Record<string, Record<string, unknown>> = {};
  const actor = {
    id: "lojista",
    name: "Lojista",
    type: "npc",
    get items() {
      return collection(items);
    },
    get flags() {
      return flags;
    },
    createEmbeddedDocuments: vi.fn(async (_name: "Item", data: readonly Readonly<Record<string, unknown>>[]) => {
      const created = data.map((document, index) => ({ id: `novo-${items.length + index}`, ...document }) as unknown as FoundryItem);
      items = [...items, ...created];
      return created;
    }),
    updateEmbeddedDocuments: vi.fn(async (_name: "Item", updates: readonly Readonly<Record<string, unknown>>[]) => {
      items = items.map((item) => {
        const update = updates.find((entry) => entry["_id"] === item.id);
        if (!update) return item;
        const moduleFlags = { ...(item.flags?.[MODULE_ID] ?? {}) };
        for (const key of ["generatedBy", "drawId"]) {
          if (`flags.${MODULE_ID}.${key}` in update) moduleFlags[key] = update[`flags.${MODULE_ID}.${key}`];
        }
        return {
          ...item,
          system: { ...item.system, quantity: (update["system.quantity"] as number | undefined) ?? item.system?.quantity },
          flags: { [MODULE_ID]: moduleFlags },
        } as FoundryItem;
      });
      return [];
    }),
    deleteEmbeddedDocuments: vi.fn(async (_name: "Item", ids: readonly string[]) => {
      items = items.filter((item) => !ids.includes(item.id));
      return [];
    }),
    update: vi.fn(async (data: Readonly<Record<string, unknown>>) => {
      flags = { [MODULE_ID]: { lastStockPatchId: data[`flags.${MODULE_ID}.lastStockPatchId`] } };
    }),
  };
  return { actor: actor as unknown as FoundryActor & typeof actor, list: () => items };
}

function entry(overrides: Partial<MerchantStockEntry> = {}): MerchantStockEntry {
  return {
    catalogItemId: "55555555-5555-4555-8555-555555555555",
    name: "Escudo pequeno",
    category: "Escudos",
    kind: "armor",
    availability: "common",
    price: "5 cc",
    damage: null,
    hands: null,
    agility: null,
    fixed: null,
    requirement: null,
    properties: null,
    description: null,
    icon: null,
    source: "lojista",
    quantity: 3,
    ...overrides,
  };
}

function patch(operations: MerchantStockPatchPayload["operations"], id = patchId): MerchantStockPatchPayload {
  return { patchId: id, campaignId: "11111111-1111-4111-8111-111111111111", operations, requestedAt: "2026-10-09T00:00:00.000Z" };
}

beforeEach(async () => {
  await game.settings.set(MODULE_ID, "merchantActorId", "lojista");
  await game.settings.set(MODULE_ID, "merchantStackDuplicates", true);
  setWorld({ user: gm, users: [gm] });
});

describe("itens repetidos no Lojista", () => {
  it("considera iguais o mesmo tipo e o mesmo nome, sem acento nem caixa", () => {
    expect(stackKey({ type: "weapon", name: " Espada  Curta " })).toBe(stackKey({ type: "weapon", name: "espada curta" }));
    expect(stackKey({ type: "weapon", name: "Maçã" })).toBe(stackKey({ type: "weapon", name: "maca" }));
    expect(stackKey({ type: "item", name: "Espada curta" })).not.toBe(stackKey({ type: "weapon", name: "Espada curta" }));
  });

  it("prefere somar no item colocado à mão", () => {
    const { actor } = merchantActor([portal("p", "Adaga", 2), manual("m", "Adaga", 1)]);
    expect(findStackTarget(actor, { type: "weapon", name: "adaga" })?.id).toBe("m");
  });

  it("arrastar um item repetido soma à quantidade e cancela a cópia", async () => {
    const { actor, list } = merchantActor([manual("m", "Adaga", 1)]);
    const dropped = { id: "", name: "Adaga", type: "weapon", system: { quantity: 1 }, parent: actor } as FoundryItem;

    expect(stackOnCreate(dropped, { name: "Adaga", type: "weapon", system: { quantity: 1 } }, gm.id)).toBe(false);
    await vi.waitFor(() => expect(list()[0]?.system?.quantity).toBe(2));
    expect(list()).toHaveLength(1);
  });

  it("um item do portal que recebe unidades à mão passa a ser à mão", async () => {
    const { actor, list } = merchantActor([portal("p", "Adaga", 2)]);
    const dropped = { id: "", name: "Adaga", type: "weapon", parent: actor } as FoundryItem;

    expect(stackOnCreate(dropped, { name: "Adaga", type: "weapon" }, gm.id)).toBe(false);
    await vi.waitFor(() => expect(list()[0]?.system?.quantity).toBe(3));
    expect(list()[0]?.flags?.[MODULE_ID]?.["generatedBy"]).toBeNull();
  });

  it("não interfere em item novo, em itens do portal, em outro ator, em jogador ou com a opção desligada", async () => {
    const { actor } = merchantActor([manual("m", "Adaga", 1)]);
    const novo = { id: "", name: "Arco", type: "weapon", parent: actor } as FoundryItem;
    expect(stackOnCreate(novo, { name: "Arco", type: "weapon" }, gm.id)).toBeUndefined();

    const fromPortal = { id: "", name: "Adaga", type: "weapon", parent: actor } as FoundryItem;
    const portalData = { name: "Adaga", type: "weapon", flags: { [MODULE_ID]: { generatedBy: GENERATED_BY } } };
    expect(stackOnCreate(fromPortal, portalData, gm.id)).toBeUndefined();

    const other = { ...actor, id: "outro" } as FoundryActor;
    expect(stackOnCreate({ id: "", name: "Adaga", type: "weapon", parent: other }, { name: "Adaga", type: "weapon" }, gm.id)).toBeUndefined();

    expect(stackOnCreate(fromPortal, { name: "Adaga", type: "weapon" }, "outro-usuario")).toBeUndefined();

    await game.settings.set(MODULE_ID, "merchantStackDuplicates", false);
    expect(stackOnCreate(fromPortal, { name: "Adaga", type: "weapon" }, gm.id)).toBeUndefined();
    expect(actor.updateEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("junta cópias da mesma origem e mantém o item mais antigo", async () => {
    const { actor, list } = merchantActor([
      manual("b", "Adaga", 1, 2),
      manual("a", "adaga", 2, 1),
      manual("c", "Arco", null, 3),
      portal("p", "Adaga", 4),
    ]);
    setWorld({ actors: [actor] });

    expect(await mergeMerchantDuplicates(actor)).toBe(1);
    expect(list().map((item) => [item.id, item.system?.quantity])).toEqual([
      ["a", 3],
      ["c", null],
      ["p", 4],
    ]);
  });
});

describe("merchant.stock.patch", () => {
  it("muda quantidades, remove e acrescenta sem tocar no resto do estoque", async () => {
    const { actor, list } = merchantActor([
      manual("arma", "Espada", 1),
      portal("escudo", "Escudo pequeno", 1, "55555555-5555-4555-8555-555555555555"),
      manual("pao", "Pão", 5),
      manual("velho", "Funda", 1),
    ]);
    setWorld({ actors: [actor], user: gm, users: [gm] });

    const result = await patchMerchantStock(
      patch([
        { op: "set", itemId: "arma", from: 1, quantity: 4 },
        { op: "remove", itemId: "velho" },
        { op: "add", entry: entry() },
        { op: "add", entry: entry({ catalogItemId: "66666666-6666-4666-8666-666666666666", name: "Corda", kind: "item" }) },
      ]),
    );

    expect(result).toMatchObject({ alreadyApplied: false, statuses: "applied,applied,applied,applied", applied: 4 });
    expect(list().map((item) => [item.name, item.system?.quantity])).toEqual([
      ["Espada", 4],
      ["Escudo pequeno", 4],
      ["Pão", 5],
      ["Corda", 3],
    ]);
    const corda = list().at(-1)!;
    expect(corda.flags?.[MODULE_ID]).toMatchObject({ generatedBy: GENERATED_BY, drawId: patchId });
  });

  it("não sobrescreve quantidade que mudou no Foundry e aponta item ausente", async () => {
    const { actor, list } = merchantActor([manual("arma", "Espada", 2)]);
    setWorld({ actors: [actor] });

    const result = await patchMerchantStock(
      patch([
        { op: "set", itemId: "arma", from: 1, quantity: 5 },
        { op: "remove", itemId: "sumiu" },
      ]),
    );

    expect(result).toMatchObject({ statuses: "conflict,missing", applied: 0, conflicts: 1, missing: 1 });
    expect(list()[0]?.system?.quantity).toBe(2);
  });

  it("reenviar a mesma edição não repete nada", async () => {
    const { actor } = merchantActor([manual("arma", "Espada", 1)]);
    setWorld({ actors: [actor] });

    await patchMerchantStock(patch([{ op: "add", entry: entry() }]));
    const again = await patchMerchantStock(patch([{ op: "add", entry: entry() }]));

    expect(again).toEqual({ patchId, alreadyApplied: true, statuses: "" });
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledTimes(1);
  });

  it("recusa edições fora do contrato", () => {
    expect(() => validatePatchPayload(patch([]))).toThrow();
    expect(() => validatePatchPayload(patch([{ op: "set", itemId: "../x", from: 1, quantity: 1 }]))).toThrow();
    expect(() => validatePatchPayload(patch([{ op: "set", itemId: "a", from: 1, quantity: -1 }]))).toThrow();
    expect(() => validatePatchPayload(patch([{ op: "set", itemId: "a", from: 1, quantity: 1.5 }]))).toThrow();
    expect(() => validatePatchPayload(patch([{ op: "macro" } as never]))).toThrow();
    expect(() => validatePatchPayload(patch([{ op: "add", entry: entry({ icon: "https://evil.example/x.webp" }) }]))).toThrow();
    expect(validatePatchPayload(patch([{ op: "set", itemId: "a", from: null, quantity: 0 }]))).toHaveLength(1);
  });
});
