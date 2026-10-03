import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterItemsGrantPayload, MerchantStockEntry } from "../src/bridge/contracts";
import { MODULE_ID } from "../src/constants";
import { GRANT_MARK, grantCharacterItems } from "../src/commands/character-items";
import { collection, setWorld } from "./foundry-mocks";

const scheduleCharacterSync = vi.fn();
vi.mock("../src/sync/characters", () => ({ scheduleCharacterSync: (delay: number) => scheduleCharacterSync(delay) }));

const grantId = "44444444-4444-4444-8444-444444444444";

function entry(overrides: Partial<MerchantStockEntry> = {}): MerchantStockEntry {
  return {
    catalogItemId: "33333333-3333-4333-8333-333333333333",
    name: "Dardo",
    category: "Armas Básicas Corpo a Corpo",
    kind: "weapon",
    availability: "common",
    price: "1 cp",
    damage: "1d3",
    hands: "one",
    agility: null,
    fixed: null,
    requirement: null,
    properties: null,
    description: null,
    icon: null,
    source: "lojista",
    quantity: 2,
    ...overrides,
  };
}

function payload(overrides: Partial<CharacterItemsGrantPayload> = {}): CharacterItemsGrantPayload {
  return {
    grantId,
    campaignId: "11111111-1111-4111-8111-111111111111",
    actorId: "aster",
    items: [entry(), entry({ catalogItemId: "55555555-5555-4555-8555-555555555555", name: "Corda", kind: "item", damage: null, hands: null, quantity: 1 })],
    requestedAt: "2026-10-03T12:00:00.000Z",
    ...overrides,
  };
}

function character(initial: FoundryItem[] = [], type = "character") {
  let items = [...initial];
  const actor = {
    id: "aster",
    name: "Aster",
    type,
    get items() {
      return collection(items);
    },
    createEmbeddedDocuments: vi.fn(async (_name: "Item", data: readonly Readonly<Record<string, unknown>>[]) => {
      const created = data.map((document, index) => ({ id: `novo-${items.length + index}`, ...document }) as unknown as FoundryItem);
      items = [...items, ...created];
      return created;
    }),
    deleteEmbeddedDocuments: vi.fn(async () => []),
    update: vi.fn(async () => undefined),
  };
  return { actor: actor as unknown as FoundryActor & typeof actor, list: () => items };
}

beforeEach(() => scheduleCharacterSync.mockReset());

describe("grantCharacterItems", () => {
  it("cria os itens no personagem com a marca da entrega", async () => {
    const { actor, list } = character();
    setWorld({ actors: [actor] });
    const result = await grantCharacterItems(payload());
    expect(result).toEqual({ actorId: "aster", created: 2, alreadyApplied: false });
    expect(list().map((item) => [item.name, item.type, item.system?.quantity])).toEqual([
      ["Dardo", "weapon", 2],
      ["Corda", "item", 1],
    ]);
    expect(list()[0]?.flags?.[MODULE_ID]).toMatchObject({ generatedBy: GRANT_MARK, grantId });
    expect(scheduleCharacterSync).toHaveBeenCalledWith(500);
  });

  it("não duplica uma entrega já feita", async () => {
    const { actor } = character();
    setWorld({ actors: [actor] });
    await grantCharacterItems(payload());
    const again = await grantCharacterItems(payload());
    expect(again).toEqual({ actorId: "aster", created: 0, alreadyApplied: true });
    expect(actor.createEmbeddedDocuments).toHaveBeenCalledOnce();
  });

  it("recusa itens inválidos e personagens ausentes", async () => {
    const { actor } = character();
    setWorld({ actors: [actor] });
    await expect(grantCharacterItems(payload({ items: [] }))).rejects.toThrow("Os itens recebidos do portal são inválidos.");
    await expect(grantCharacterItems(payload({ items: [entry({ icon: "../segredo.png" })] }))).rejects.toThrow(
      "Os itens recebidos do portal são inválidos.",
    );
    await expect(grantCharacterItems(payload({ actorId: "../x" }))).rejects.toThrow();
    setWorld({ actors: [character([], "npc").actor] });
    await expect(grantCharacterItems(payload())).rejects.toThrow("O personagem vinculado não está disponível neste mundo.");
    expect(actor.createEmbeddedDocuments).not.toHaveBeenCalled();
  });
});
