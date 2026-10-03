import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CharacterNotesUpdatePayload } from "../src/bridge/contracts";
import { updateCharacterNotes, validateNotesPayload } from "../src/commands/character-notes";
import { textRevision } from "../src/sync/character-sheet";
import { collection, setWorld } from "./foundry-mocks";

const scheduleCharacterSync = vi.fn();
vi.mock("../src/sync/characters", () => ({ scheduleCharacterSync: (delay: number) => scheduleCharacterSync(delay) }));

const original = "<p>Veio do norte.</p>";

function character(description: string, type = "character") {
  let system: Record<string, unknown> = { description };
  const actor = {
    id: "aster",
    name: "Aster",
    type,
    items: collection([]),
    get system() {
      return system;
    },
    update: vi.fn(async (data: Record<string, unknown>) => {
      system = { ...system, description: data["system.description"] };
      return actor;
    }),
    createEmbeddedDocuments: async () => [],
    deleteEmbeddedDocuments: async () => [],
  };
  return actor as unknown as FoundryActor & typeof actor;
}

function payload(overrides: Partial<CharacterNotesUpdatePayload> = {}): CharacterNotesUpdatePayload {
  return {
    updateId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    campaignId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    actorId: "aster",
    text: "Veio do norte.\n\n<b>Procura</b> o irmão.",
    revision: textRevision(original),
    requestedBy: "Jogadora",
    requestedAt: "2026-10-03T12:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => scheduleCharacterSync.mockReset());

describe("updateCharacterNotes", () => {
  it("grava a descrição em parágrafos escapados e agenda a sincronização", async () => {
    const actor = character(original);
    setWorld({ actors: [actor] });
    const result = await updateCharacterNotes(payload());
    expect(result).toEqual({ actorId: "aster", applied: true, conflict: false });
    expect(actor.update).toHaveBeenCalledWith({
      "system.description": "<p>Veio do norte.</p><p>&lt;b&gt;Procura&lt;/b&gt; o irmão.</p>",
    });
    expect(scheduleCharacterSync).toHaveBeenCalledWith(500);
  });

  it("não grava quando a descrição mudou no Foundry", async () => {
    const actor = character("<p>Editado pelo mestre.</p>");
    setWorld({ actors: [actor] });
    const result = await updateCharacterNotes(payload());
    expect(result).toEqual({ actorId: "aster", applied: false, conflict: true });
    expect(actor.update).not.toHaveBeenCalled();
    expect(scheduleCharacterSync).not.toHaveBeenCalled();
  });

  it("recusa ator ausente ou que não é personagem", async () => {
    setWorld({ actors: [character(original, "npc")] });
    await expect(updateCharacterNotes(payload())).rejects.toThrow("O personagem vinculado não está disponível neste mundo.");
    setWorld({ actors: [] });
    await expect(updateCharacterNotes(payload())).rejects.toThrow();
  });

  it("valida o pedido antes de tocar no ator", () => {
    expect(() => validateNotesPayload(payload({ actorId: "../x" }))).toThrow("As anotações recebidas do portal são inválidas.");
    expect(() => validateNotesPayload(payload({ text: "x".repeat(8_001) }))).toThrow();
    expect(() => validateNotesPayload(payload({ revision: "" }))).toThrow();
  });
});
