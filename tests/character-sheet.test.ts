import { describe, expect, it } from "vitest";
import { characterSheet, fitSheet, textRevision } from "../src/sync/character-sheet";
import { collection } from "./foundry-mocks";

// Personagem sintético; nenhum conteúdo dos livros.
function item(id: string, type: string, name: string, system: Record<string, unknown> = {}): FoundryItem {
  return { id, type, name, system: system as DemonLordItemSystem };
}

function actor(items: FoundryItem[], system: Record<string, unknown> = {}): FoundryActor {
  return {
    id: "aster",
    name: "Aster",
    type: "character",
    items: collection(items),
    system: {
      attributes: {
        strength: { value: 12 },
        agility: { value: 11 },
        intellect: { value: 10 },
        will: { value: 9 },
        perception: { value: "13" },
      },
      characteristics: { defense: 14, speed: 10, power: 1, size: "1", fortune: 1 },
      appearance: { age: "27", eyes: "Verdes", hair: "" },
      religion: { value: "Velhos Deuses" },
      description: "<p>Veio do norte.</p><p class=\"secret\">Segredo do mestre</p>",
      ...system,
    } as DemonLordActorSystem,
    createEmbeddedDocuments: async () => [],
    deleteEmbeddedDocuments: async () => [],
    update: async () => undefined,
  };
}

const items = [
  item("w1", "weapon", "Espada", { wear: true, quantity: 1, value: "1 co", action: { damage: "1d6" }, hands: "one", description: "<b>Afiada</b>" }),
  item("a1", "armor", "Couro", { wear: false, fixed: "", agility: "2", value: "2 co" }),
  item("i1", "item", "Poção", { quantity: "3", consumabletype: "P" }),
  item("s1", "spell", "Clarão", { tradition: "Teste", rank: 1, spelltype: "attack", castings: { value: "2", max: "3" }, duration: "1 rodada" }),
  item("t1", "talent", "Golpe Firme", { groupname: "Guerreiro", uses: { value: "", max: "" } }),
  item("f1", "feature", "Visão no escuro"),
  item("an", "ancestry", "Humano", { description: "<p>Gente comum.</p>" }),
  item("pr", "profession", "Ferreiro"),
  item("lg", "language", "Comum", { speak: true, read: true, write: false }),
  item("pa", "path", "Guerreiro"),
];

describe("characterSheet", () => {
  it("projeta atributos, características, aparência e raízes", () => {
    const sheet = characterSheet(actor(items));
    expect(sheet.attributes).toEqual({ strength: 12, agility: 11, intellect: 10, will: 9, perception: 13 });
    expect(sheet.characteristics).toEqual({ defense: 14, speed: 10, power: 1, size: "1", fortune: 1 });
    expect(sheet.appearance).toMatchObject({ age: "27", eyes: "Verdes", hair: null, sex: null });
    expect(sheet.religion).toBe("Velhos Deuses");
    expect(sheet.roots).toEqual({
      ancestry: { name: "Humano", description: "Gente comum." },
      professions: [{ name: "Ferreiro", description: "" }],
      languages: [{ name: "Comum", speak: true, read: true, write: false }],
    });
  });

  it("separa inventário, magias e talentos com texto simples", () => {
    const sheet = characterSheet(actor(items));
    expect(sheet.inventory.map((entry) => [entry.name, entry.type, entry.quantity, entry.equipped])).toEqual([
      ["Espada", "weapon", 1, true],
      ["Couro", "armor", 1, false],
      ["Poção", "item", 3, false],
    ]);
    expect(sheet.inventory[0]).toMatchObject({ damage: "1d6", hands: "one", price: "1 co", description: "Afiada" });
    expect(sheet.inventory[1]?.defense).toBe("Agilidade +2");
    expect(sheet.inventory[2]?.consumableType).toBe("potion");
    expect(sheet.spells).toEqual([
      {
        id: "s1",
        name: "Clarão",
        description: "",
        tradition: "Teste",
        rank: 1,
        spellType: "attack",
        attribute: null,
        castings: { value: 2, max: 3 },
        target: null,
        area: null,
        duration: "1 rodada",
      },
    ]);
    expect(sheet.talents.map((entry) => [entry.name, entry.kind, entry.group, entry.uses])).toEqual([
      ["Golpe Firme", "talent", "Guerreiro", { value: null, max: null }],
      ["Visão no escuro", "feature", null, { value: null, max: null }],
    ]);
  });

  it("envia a descrição sem trechos secretos e marca a versão", () => {
    const sheet = characterSheet(actor(items));
    expect(sheet.notes.text).toBe("Veio do norte.");
    const changed = characterSheet(actor(items, { description: "<p>Veio do sul.</p>" }));
    expect(changed.notes.revision).not.toBe(sheet.notes.revision);
    expect(textRevision("<p>Veio do norte.</p>")).toBe(textRevision("<p>Veio do norte.</p>"));
  });

  it("corta descrições quando a ficha passa do orçamento", () => {
    const long = Array.from({ length: 50 }, (_, index) =>
      item(`t${index}`, "talent", `Talento ${index}`, { description: "x".repeat(1_400) }),
    );
    const sheet = characterSheet(actor(long));
    const fitted = fitSheet(sheet, 40_000);
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(40_000);
    expect(fitted.talents).toHaveLength(50);
  });
});
