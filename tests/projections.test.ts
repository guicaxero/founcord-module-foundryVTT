import { describe, expect, it } from "vitest";
import { chatMessageProjection, isPublicChatMessage } from "../src/capture/chat";
import { merchantPurchaseMessage } from "../src/commands/handlers";
import { failureDelay, nextIdleDelay } from "../src/commands/poller";
import { characterProjection } from "../src/sync/characters";
import { merchantItemProjection } from "../src/sync/merchant";
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
    };

    expect(characterProjection(actor)).toEqual({
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
  it("mantém o preço como registrado e descarta imagens locais", () => {
    const projection = merchantItemProjection(
      item({
        id: "espada",
        name: " Espada curta ",
        type: "weapon",
        img: "icons/weapons/sword.webp",
        system: { value: "5 cp", quantity: "2", description: "<p>Afiada</p><p class='secret'>x</p>" },
      }),
    );
    expect(projection).toMatchObject({
      itemId: "espada",
      name: "Espada curta",
      description: "Afiada",
      category: "TYPES.Item.weapon",
      imageUrl: null,
      price: "5 cp",
      quantity: 2,
    });
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
