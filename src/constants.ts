export const MODULE_ID = "ordem-foundry-bridge";
export const DEFAULT_BRIDGE_URL = "https://ordem-foundry-bridge.ordem-da-ultima-luz.workers.dev";

/** Heartbeat usado até o Bridge informar `nextHeartbeatSeconds`. */
export const DEFAULT_HEARTBEAT_SECONDS = 60;
/** Poll de comandos logo após atividade; dobra a cada ciclo vazio até o máximo. */
export const MIN_COMMAND_POLL_MS = 5_000;
export const MAX_COMMAND_POLL_MS = 30_000;
/** Base do backoff de pareamento e da fila de chat. */
export const DEFAULT_POLL_INTERVAL_MS = 5_000;
export const MAX_BACKOFF_MS = 60_000;

export const CHAT_BATCH_SIZE = 25;
export const MAX_PENDING_CHAT_EVENTS = 500;
export const MAX_MERCHANT_ITEMS = 500;

/** Configurações que só alteram a tela; não reiniciam a conexão. */
export const PRESENTATION_ONLY_SETTINGS: ReadonlySet<string> = new Set([
  "lastHeartbeatAt",
  "lastSyncAt",
  "lastSyncCount",
  "merchantActorId",
  "merchantStackDuplicates",
  "lastMerchantSyncAt",
  "lastMerchantSyncCount",
  "lastConnectionError",
]);
