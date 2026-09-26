import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CreatureDraft, CreatureUpsertPayload } from "../src/bridge/contracts";
import { MODULE_ID } from "../src/constants";
import {
  CREATURE_FOLDER,
  CREATURE_ITEM_MARK,
  creatureItemData,
  creatureSystemData,
  paragraphs,
  upsertCreature,
  validateCreaturePayload,
} from "../src/commands/creatures";
import { collection, setWorld } from "./foundry-mocks";

const creatureId = "44444444-4444-4444-8444-444444444444";

// Criatura sintética; nenhum conteúdo dos livros.
function draft(overrides: Partial<CreatureDraft> = {}): CreatureDraft {
  return {
    name: "Fera de Teste",
    descriptor: "Criatura média (fera)",
    description: "Primeiro parágrafo.\n\n<b>Segundo</b> parágrafo.",
    difficulty: 10,
    size: "1",
    image: "tokenizer/fera/token.webp",
    attributes: { strength: 12, agility: 11, intellect: 6, will: 9, perception: 10 },
    defense: 13,
    health: 22,
    speed: 12,
    power: 0,
    insanity: 0,
    corruption: 1,
    perceptionSenses: "visão no escuro",
    speedTraits: "",
    armor: "",
    frightening: true,
    horrifying: false,
    items: [
      {
        id: "a1",
        kind: "attack",
        name: "Mordida",
        description: "",
        image: null,
        bonus: "+2",
        against: "defense",
        boons: 1,
        damage: "1d6",
        properties: "",
      },
      { id: "t1", kind: "trait", name: "Faro", description: "Sente cheiros.", image: null },
      {
        id: "s1",
        kind: "spell",
        name: "Clarão",
        description: "",
        image: null,
        tradition: "Teste",
        rank: 1,
        attribute: "will",
        spellType: "attack",
        target: "uma criatura",
        area: "",
        duration: "1 rodada",
      },
    ],
    ...overrides,
  };
}

function payload(version = 1, creature = draft()): CreatureUpsertPayload {
  return {
    creatureId,
    campaignId: "11111111-1111-4111-8111-111111111111",
    version,
    creature,
    requestedAt: "2026-09-26T00:00:00.000Z",
  };
}

/** Ator em memória que registra atualizações e itens. */
function creatureActor(initial: FoundryItem[], version: number) {
  let items = [...initial];
  let flags: Record<string, unknown> = { [MODULE_ID]: { creatureId, version } };
  const actor = {
    id: "ator-criatura",
    name: "Fera de Teste",
    type: "creature",
    get flags() {
      return flags;
    },
    get items() {
      return collection(items);
    },
    update: vi.fn(async (data: Record<string, unknown>) => {
      flags = (data.flags as Record<string, unknown>) ?? flags;
      return actor;
    }),
    createEmbeddedDocuments: vi.fn(async (_name: "Item", data: readonly Readonly<Record<string, unknown>>[]) => {
      const created = data.map((document, index) => ({ id: `novo-${index}`, ...document }) as unknown as FoundryItem);
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

const manual: FoundryItem = { id: "manual", name: "Garra extra", type: "weapon" };
const generated: FoundryItem = {
  id: "gerado",
  name: "Mordida antiga",
  type: "weapon",
  flags: { [MODULE_ID]: { generatedBy: CREATURE_ITEM_MARK, creatureId } },
};

const actorCreate = vi.fn();
const folderCreate = vi.fn();

beforeEach(() => {
  actorCreate.mockReset().mockImplementation(async (data: Record<string, unknown>) => ({ id: "ator-novo", ...data }));
  folderCreate.mockReset().mockImplementation(async (data: Record<string, unknown>) => ({ id: "pasta-nova", ...data }));
  vi.stubGlobal("Actor", { create: actorCreate });
  vi.stubGlobal("Folder", { create: folderCreate });
  setWorld({ actors: [], folders: [] });
});

describe("validação da criatura", () => {
  it("aceita a criatura do contrato", () => {
    expect(validateCreaturePayload(payload()).creature.items).toHaveLength(3);
  });

  it.each([
    ["dificuldade fora da lista", { difficulty: 7 }],
    ["atributo acima de 30", { attributes: { ...draft().attributes, strength: 31 } }],
    ["imagem com ..", { image: "../segredo.png" }],
    ["imagem com outro esquema", { image: "javascript:alert(1)" }],
    ["caminho absoluto", { image: "/etc/passwd" }],
    ["nome curto", { name: "A" }],
  ])("recusa %s", (_label, overrides) => {
    expect(() => validateCreaturePayload(payload(1, draft(overrides as Partial<CreatureDraft>)))).toThrow(
      "A criatura recebida do portal é inválida.",
    );
  });

  it("recusa tipos de item desconhecidos", () => {
    const items = [{ id: "x", kind: "macro", name: "Macro", description: "", image: null }];
    expect(() => validateCreaturePayload(payload(1, draft({ items } as unknown as Partial<CreatureDraft>)))).toThrow();
  });
});

describe("mapeamento para o Demon Lord", () => {
  it("escapa a descrição em parágrafos", () => {
    expect(paragraphs("Um.\n\n<b>Dois</b>\nlinha")).toBe("<p>Um.</p><p>&lt;b&gt;Dois&lt;/b&gt;<br>linha</p>");
  });

  it("preenche valores base e atuais", () => {
    const system = creatureSystemData(draft());
    expect(system.attributes).toMatchObject({ strength: { base: 12, value: 12 } });
    expect(system.characteristics).toMatchObject({
      defense: 13,
      defenseBase: 13,
      health: { max: 22, maxBase: 22, value: 22 },
      corruption: { value: 1 },
      speedBase: 12,
    });
    expect(system).toMatchObject({ difficulty: 10, difficultyBase: 10, perceptionsenses: "visão no escuro" });
  });

  it("converte ataques e magias nos tipos do sistema", () => {
    const [attack, trait, spell] = draft().items.map((item) => creatureItemData(item, creatureId));
    expect(attack).toMatchObject({
      type: "weapon",
      system: { action: { attack: "+2", against: "defense", damage: "1d6", boonsbanes: "1", boonsbanesactive: true } },
      flags: { [MODULE_ID]: { generatedBy: CREATURE_ITEM_MARK, creatureId, itemId: "a1" } },
    });
    expect(trait).toMatchObject({ type: "talent", system: { description: "<p>Sente cheiros.</p>" } });
    expect(spell).toMatchObject({ type: "spell", system: { tradition: "Teste", rank: 1, attribute: "will", spelltype: "attack" } });
  });
});

describe("upsertCreature", () => {
  it("cria o ator na pasta das criaturas", async () => {
    const result = await upsertCreature(payload());
    expect(folderCreate).toHaveBeenCalledWith({ name: CREATURE_FOLDER, type: "Actor" });
    const data = actorCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(data).toMatchObject({
      name: "Fera de Teste",
      type: "creature",
      folder: "pasta-nova",
      img: "tokenizer/fera/token.webp",
      prototypeToken: { texture: { src: "tokenizer/fera/token.webp" } },
      flags: { [MODULE_ID]: { creatureId, version: 1 } },
    });
    expect(data.items).toHaveLength(3);
    expect(result).toEqual({ actorId: "ator-novo", created: true, alreadyApplied: false });
  });

  it("reaproveita a pasta existente", async () => {
    setWorld({ folders: [{ id: "pasta", name: CREATURE_FOLDER, type: "Actor" }] });
    await upsertCreature(payload());
    expect(folderCreate).not.toHaveBeenCalled();
    expect(actorCreate.mock.calls[0]![0]).toMatchObject({ folder: "pasta" });
  });

  it("atualiza o mesmo ator e troca só os itens do portal", async () => {
    const { actor, list } = creatureActor([manual, generated], 1);
    setWorld({ actors: [actor] });
    const result = await upsertCreature(payload(2, draft({ name: "Fera Alfa", health: 30 })));
    expect(actorCreate).not.toHaveBeenCalled();
    expect(actor.update).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Fera Alfa", flags: { [MODULE_ID]: expect.objectContaining({ version: 2 }) } }),
    );
    expect(actor.deleteEmbeddedDocuments).toHaveBeenCalledWith("Item", ["gerado"]);
    expect(list().map((item) => item.name)).toEqual(["Garra extra", "Mordida", "Faro", "Clarão"]);
    expect(result).toEqual({ actorId: "ator-criatura", created: false, alreadyApplied: false });
  });

  it("não reaplica uma versão já aplicada", async () => {
    const { actor } = creatureActor([generated], 3);
    setWorld({ actors: [actor] });
    const result = await upsertCreature(payload(2));
    expect(result).toEqual({ actorId: "ator-criatura", created: false, alreadyApplied: true });
    expect(actor.update).not.toHaveBeenCalled();
    expect(actor.deleteEmbeddedDocuments).not.toHaveBeenCalled();
  });

  it("não toca em nada com payload inválido", async () => {
    const { actor } = creatureActor([generated], 1);
    setWorld({ actors: [actor] });
    await expect(upsertCreature(payload(2, draft({ image: "../x.png" })))).rejects.toThrow();
    expect(actor.update).not.toHaveBeenCalled();
  });
});
