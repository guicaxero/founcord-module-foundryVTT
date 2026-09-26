/**
 * Declarações mínimas da API do Foundry VTT 13/14 e do sistema `demonlord`
 * usadas pelo módulo. Cobrem apenas o que o código acessa; campos vindos do
 * sistema são opcionais porque o módulo trata dados ausentes ou legados.
 */

export {};

declare global {
  interface FoundryCollection<T> extends Iterable<T> {
    readonly size: number;
    get(id: string): T | undefined;
    filter(predicate: (value: T) => boolean): T[];
  }

  interface DocumentStats {
    readonly modifiedTime?: number | null;
    readonly createdTime?: number | null;
  }

  interface FoundryUser {
    readonly id: string;
    readonly name: string;
    readonly isGM: boolean;
    readonly active: boolean;
  }

  interface DemonLordCoins {
    readonly gc?: number | string | null;
    readonly ss?: number | string | null;
    readonly cp?: number | string | null;
    readonly bits?: number | string | null;
  }

  interface DemonLordActorSystem {
    readonly level?: number | string | null;
    readonly ancestry?: string | null;
    readonly wealth?: DemonLordCoins | null;
    readonly paths?: Readonly<{
      novice?: string | null;
      expert?: string | null;
      master?: string | null;
      legendary?: string | null;
    }> | null;
    readonly characteristics?: Readonly<{
      health?: Readonly<{
        max?: number | string | null;
        value?: number | string | null;
        healingRate?: number | string | null;
        healingrate?: number | string | null;
      }> | null;
      insanity?: number | string | Readonly<{ value?: number | string | null }> | null;
      corruption?: number | string | Readonly<{ value?: number | string | null }> | null;
    }> | null;
  }

  interface DemonLordRequirement {
    readonly attribute?: string | null;
    readonly minvalue?: number | string | null;
  }

  interface DemonLordItemSystem {
    readonly value?: string | number | null;
    readonly quantity?: number | string | null;
    readonly description?: string | null;
    readonly availability?: string | null;
    readonly consumabletype?: string | null;
    readonly properties?: string | null;
    readonly hands?: string | null;
    readonly action?: Readonly<{ damage?: string | null }> | null;
    readonly requirement?: DemonLordRequirement | null;
    readonly defense?: string | number | null;
    readonly agility?: string | number | null;
    readonly fixed?: string | number | null;
    readonly isShield?: boolean | null;
    readonly type?: string | null;
    readonly pathType?: string | null;
  }

  interface FoundryItem {
    readonly id: string;
    readonly name: string | null;
    readonly type: string;
    readonly img?: string | null;
    readonly system?: DemonLordItemSystem | null;
    readonly parent?: FoundryActor | null;
    readonly flags?: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>;
    readonly _stats?: DocumentStats;
  }

  interface FoundryActor {
    readonly id: string;
    readonly name: string | null;
    readonly type: string;
    readonly system?: DemonLordActorSystem | null;
    readonly items: FoundryCollection<FoundryItem>;
    readonly img?: string | null;
    readonly prototypeToken?: Readonly<{ texture?: Readonly<{ src?: string | null }> | null }> | null;
    readonly ownership?: Readonly<Record<string, number>>;
    readonly _stats?: DocumentStats;
    createEmbeddedDocuments(
      embeddedName: "Item",
      data: readonly Readonly<Record<string, unknown>>[],
    ): Promise<readonly FoundryItem[]>;
    deleteEmbeddedDocuments(embeddedName: "Item", ids: readonly string[]): Promise<unknown>;
  }

  interface FoundryRoll {
    readonly formula?: string;
    readonly total?: number;
  }

  interface FoundryChatMessage {
    readonly id: string | null;
    readonly content?: string | null;
    readonly whisper?: readonly string[];
    readonly blind?: boolean;
    readonly rolls?: readonly FoundryRoll[];
    readonly timestamp?: number;
    readonly alias?: string;
    readonly author?: FoundryUser | null;
    readonly user?: FoundryUser | string | null;
    readonly speaker?: Readonly<{ actor?: string | null; alias?: string | null }>;
    readonly _stats?: DocumentStats;
  }

  interface ChatMessageData {
    content: string;
    speaker: unknown;
    whisper?: readonly string[];
  }

  interface ChatMessageStatic {
    create(data: ChatMessageData): Promise<FoundryChatMessage>;
    getSpeaker(options: { actor: FoundryActor }): unknown;
  }

  interface SettingRegistration {
    scope: "world" | "client";
    config: boolean;
    restricted: boolean;
    type: unknown;
    default: unknown;
  }

  interface SettingMenuRegistration {
    name: string;
    label: string;
    hint: string;
    icon: string;
    type: unknown;
    restricted: boolean;
  }

  interface FoundryGame {
    readonly user: FoundryUser | null;
    readonly users: FoundryCollection<FoundryUser> & { readonly activeGM?: FoundryUser | null };
    readonly actors: FoundryCollection<FoundryActor>;
    readonly world: Readonly<{ id: string; title: string }>;
    readonly system: Readonly<{ id: string; title: string; version: string }>;
    readonly version: string;
    readonly modules: Readonly<{
      get(id: string): { version?: string; api?: unknown } | undefined;
    }>;
    readonly settings: Readonly<{
      register(namespace: string, key: string, data: SettingRegistration): void;
      registerMenu(namespace: string, key: string, data: SettingMenuRegistration): void;
      get(namespace: string, key: string): unknown;
      set(namespace: string, key: string, value: unknown): Promise<unknown>;
    }>;
    readonly i18n: Readonly<{
      lang: string;
      localize(key: string): string;
      format(key: string, data: Record<string, string>): string;
    }>;
  }

  interface ApplicationRenderOptions {
    force?: boolean;
  }

  class FoundryApplicationV2 {
    constructor(options?: object);
    readonly element: HTMLElement;
    readonly rendered: boolean;
    render(options?: ApplicationRenderOptions): Promise<this>;
    protected _prepareContext(options: unknown): Promise<Record<string, unknown>>;
    protected _onFirstRender(context: unknown, options: unknown): Promise<void>;
    protected _onClose(options: unknown): Promise<void>;
  }

  interface DialogConfirmOptions {
    window: { title: string };
    content: string;
    yes: { label: string; icon?: string };
    no: { label: string };
    modal: boolean;
    rejectClose: boolean;
  }

  const game: FoundryGame;
  const ui: Readonly<{
    notifications: Readonly<{
      info(message: string): void;
      error(message: string): void;
    }>;
  }>;
  const CONFIG: Readonly<{
    Item?: Readonly<{ typeLabels?: Readonly<Record<string, string>> }>;
  }>;
  const ChatMessage: ChatMessageStatic;
  const Hooks: Readonly<{
    on(event: string, callback: (...args: never[]) => unknown): number;
    once(event: string, callback: (...args: never[]) => unknown): number;
  }>;
  const foundry: Readonly<{
    utils: Readonly<{ escapeHTML(value: string): string }>;
    applications: Readonly<{
      api: Readonly<{
        ApplicationV2: typeof FoundryApplicationV2;
        HandlebarsApplicationMixin<T extends typeof FoundryApplicationV2>(base: T): T;
        DialogV2: Readonly<{ confirm(options: DialogConfirmOptions): Promise<boolean> }>;
      }>;
    }>;
  }>;
  var CONST: Readonly<{ DOCUMENT_OWNERSHIP_LEVELS?: Readonly<{ OWNER?: number }> }> | undefined;
}
