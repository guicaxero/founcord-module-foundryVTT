import { describe, expect, it, vi } from "vitest";
import { chatMessageProjection, isPublicChatMessage } from "../src/capture/chat";
import { merchantPurchaseMessage } from "../src/commands/handlers";
import { failureDelay, nextIdleDelay } from "../src/commands/poller";
import { characterProjection } from "../src/sync/characters";
import { merchantItemProjection, merchantPrice } from "../src/sync/merchant-item";
import { clearThumbnailCache, itemImage } from "../src/sync/thumbnail";
import { collection, setWorld } from "./foundry-mocks";

const stats = { modifiedTime: Date.UTC(2026, 8, 1) };

function item(overrides: Partial<FoundryItem> & { id: string }): FoundryItem {
  return { name: "Item", type: "item", system: {}, _stats: stats, ...overrides };
}

describe("characterProjection", () => {
  it("envia somente dados mecânicos mínimos e donos com permissão de proprietário", () => {
    const actor: FoundryActor = {
      id: "actor1",
      name: "Aster",
      type: "character",
      ownership: { default: 0, user1: 3, user2: 2 },
      _stats: stats,
      system: {
        level: "3",
        ancestry: "Humano",
        characteristics: {
          health: { max: 20, value: 4, healingrate: 5 },
          insanity: { value: 2 },
          corruption: 1,
        },
        wealth: { gc: 2, ss: "7", cp: 14, bits: null },
      },
      items: collection([item({ id: "path1", name: "Guerreiro", type: "path", system: { type: "novice" } })]),
      createEmbeddedDocuments: async () => [],
      deleteEmbeddedDocuments: async () => [],
      update: async () => undefined,
    };

    const { sheet, ...summary } = characterProjection(actor);
    expect(sheet?.inventory).toEqual([]);
    expect(summary).toEqual({
      actorId: "actor1",
      name: "Aster",
      type: "character",
      ownerUserIds: ["user1"],
      level: 3,
      ancestry: "Humano",
      paths: { novice: "Guerreiro", expert: null, master: null, legendary: null },
      statistics: { healthMax: 20, damage: 4, healingRate: 5, insanity: 2, corruption: 1 },
      wealth: { gc: 2, ss: 7, cp: 14, bits: 0 },
      sourceUpdatedAt: "2026-09-01T00:00:00.000Z",
    });
  });
});

describe("merchantItemProjection", () => {
  const options = { defaultCoin: "cp" as const, imageUrl: null, category: "Arma" };

  it("mantém o preço com moeda e completa números puros com a moeda padrão", () => {
    expect(merchantPrice("5 ss", "cp")).toBe("5 ss");
    expect(merchantPrice("22", "cp")).toBe("22 cp");
    expect(merchantPrice(22, "gc")).toBe("22 gc");
    expect(merchantPrice("2 gc e um favor", "cp")).toBe("2 gc e um favor");
    expect(merchantPrice("", "cp")).toBeNull();
  });

  it("projeta raridade, propriedades e dados de arma do sistema", () => {
    const projection = merchantItemProjection(
      item({
        id: "espada",
        name: " Espada curta ",
        type: "weapon",
        img: "icons/weapons/sword.webp",
        system: {
          value: "5",
          quantity: "2",
          description: "<p>Afiada</p><p class='secret'>x</p>",
          availability: "U",
          properties: "Precisa",
          hands: "one",
          action: { damage: "1d6" },
          requirement: { attribute: "agility", minvalue: 11 },
        },
      }),
      options,
    );
    expect(projection).toMatchObject({
      itemId: "espada",
      name: "Espada curta",
      description: "Afiada",
      category: "Arma",
      imageUrl: null,
      price: "5 cp",
      quantity: 2,
      availability: "uncommon",
      consumableType: null,
      properties: "Precisa",
      weapon: { damage: "1d6", hands: "one", requirement: { attribute: "agility", minimum: 11 } },
      armor: null,
    });
  });

  it("projeta armadura e consumível e ignora códigos desconhecidos", () => {
    const armor = merchantItemProjection(
      item({
        id: "malha",
        type: "armor",
        system: { defense: 15, isShield: false, availability: "x", requirement: { attribute: "", minvalue: 0 } },
      }),
      options,
    );
    expect(armor).toMatchObject({
      availability: null,
      armor: { defense: "15", agility: null, fixed: null, shield: false, requirement: null },
      weapon: null,
    });

    const potion = merchantItemProjection(
      item({ id: "pocao", type: "item", system: { consumabletype: "P", availability: "r" } }),
      options,
    );
    expect(potion).toMatchObject({ consumableType: "potion", availability: "rare" });
  });

  it("não publica caminhos locais quando a miniatura não pode ser gerada", async () => {
    clearThumbnailCache();
    // Ícone ausente no servidor do Foundry: a imagem falha ao carregar.
    class FailingImage {
      decoding = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("Image", FailingImage);
    await expect(itemImage("icons/weapons/sword.webp")).resolves.toBeNull();
    await expect(itemImage("https://cdn.example.test/sword.webp")).resolves.toBe(
      "https://cdn.example.test/sword.webp",
    );
    await expect(itemImage("http://foundry.local/sword.webp")).resolves.toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("captura de chat", () => {
  it("ignora sussurros e rolagens cegas", () => {
    expect(isPublicChatMessage({ id: "m1", whisper: ["gm"] })).toBe(false);
    expect(isPublicChatMessage({ id: "m2", blind: true })).toBe(false);
    expect(isPublicChatMessage({ id: "m3", whisper: [] })).toBe(true);
  });

  it("projeta texto simples com resumo de rolagens", () => {
    setWorld({ users: [{ id: "user1", name: "Mestre", isGM: true, active: true }], actors: [] });
    const projection = chatMessageProjection({
      id: "m4",
      content: "<p>Ataque!</p>",
      user: "user1",
      timestamp: Date.UTC(2026, 8, 1),
      speaker: { alias: "Aster" },
      rolls: [{ formula: "1d20+2", total: 17 }],
    });
    expect(projection).toEqual({
      messageId: "m4",
      createdAt: "2026-09-01T00:00:00.000Z",
      authorUserId: "user1",
      authorName: "Mestre",
      speakerActorId: null,
      speakerName: "Aster",
      content: "Ataque!\nRolagem: 1d20+2 = 17",
      kind: "roll",
    });
  });
});

describe("orçamento de requests do poll de comandos", () => {
  it("dobra o intervalo em ciclos vazios até 30s e volta a 5s com atividade", () => {
    const delays: number[] = [];
    let delay = 5_000;
    for (let cycle = 0; cycle < 5; cycle += 1) {
      delay = nextIdleDelay(delay, 0);
      delays.push(delay);
    }
    expect(delays).toEqual([10_000, 20_000, 30_000, 30_000, 30_000]);
    expect(nextIdleDelay(30_000, 2)).toBe(5_000);
  });

  it("aplica backoff limitado a falhas consecutivas", () => {
    expect([1, 2, 3, 4, 8].map(failureDelay)).toEqual([10_000, 20_000, 40_000, 60_000, 60_000]);
  });
});

describe("merchantPurchaseMessage", () => {
  it("escapa todo conteúdo vindo do portal", () => {
    const html = merchantPurchaseMessage(
      {
        requestId: "r1",
        campaignId: "c1",
        merchantActorId: "merchant",
        buyer: { userId: "u1", displayName: "<b>Ana</b>", actorId: "a1", actorName: "Aster" },
        item: { itemId: "i1", name: "Poção <script>", price: "5 cp", quantity: 1 },
        note: "linha 1\nlinha 2",
        requestedAt: "2026-09-01T00:00:00.000Z",
      },
      "5 cp",
      3,
    );
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>Ana</b>");
    expect(html).toContain("&lt;b&gt;Ana&lt;/b&gt;");
    expect(html).toContain("linha 1<br>linha 2");
  });
});
