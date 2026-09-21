/**
 * Globais mínimos do Foundry para testes de funções puras do módulo.
 * Cada teste pode substituir `game.actors`/`game.users` via `setWorld`.
 */

type MockCollection<T extends { id: string }> = FoundryCollection<T>;

export function collection<T extends { id: string }>(values: readonly T[]): MockCollection<T> {
  return {
    size: values.length,
    get: (id: string) => values.find((value) => value.id === id),
    filter: (predicate: (value: T) => boolean) => values.filter(predicate),
    [Symbol.iterator]: () => values[Symbol.iterator](),
  };
}

const settings = new Map<string, unknown>();

const mockGame = {
  user: null as FoundryUser | null,
  users: collection<FoundryUser>([]),
  actors: collection<FoundryActor>([]),
  world: { id: "mundo-teste", title: "Mundo de teste" },
  system: { id: "demonlord", title: "Shadow of the Demon Lord", version: "6.1.4" },
  version: "14.320",
  modules: { get: () => ({ version: "0.0.0-test" }) },
  settings: {
    register: () => undefined,
    registerMenu: () => undefined,
    get: (namespace: string, key: string) => settings.get(`${namespace}.${key}`),
    set: async (namespace: string, key: string, value: unknown) => {
      settings.set(`${namespace}.${key}`, value);
      return value;
    },
  },
  i18n: {
    lang: "pt-BR",
    localize: (key: string) => key,
    format: (key: string) => key,
  },
};

export function setWorld(world: {
  actors?: readonly FoundryActor[];
  users?: readonly FoundryUser[];
  user?: FoundryUser | null;
}): void {
  if (world.actors) mockGame.actors = collection(world.actors);
  if (world.users) mockGame.users = collection(world.users);
  if (world.user !== undefined) mockGame.user = world.user;
}

const escapeHTML = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#x27;");

Object.assign(globalThis, {
  game: mockGame,
  ui: { notifications: { info: () => undefined, error: () => undefined } },
  CONFIG: { Item: { typeLabels: { weapon: "TYPES.Item.weapon" } } },
  CONST: { DOCUMENT_OWNERSHIP_LEVELS: { OWNER: 3 } },
  foundry: { utils: { escapeHTML } },
});
