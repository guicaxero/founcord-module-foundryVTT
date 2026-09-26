import type { ChatEntry } from "./bridge/contracts";
import { DEFAULT_BRIDGE_URL, MODULE_ID } from "./constants";
import { isMerchantCoin, type MerchantCoin } from "./sync/merchant-item";

export type ConnectionRecord = Readonly<{
  worldId?: string;
  campaignId?: string;
  campaignName?: string;
  connectorName?: string;
  generation?: string;
}>;

/** Todas as configurações persistidas pelo módulo e seus tipos. */
type ModuleSettings = {
  bridgeUrl: string;
  worldInstanceId: string;
  connectionRecord: ConnectionRecord;
  accessToken: string;
  accessTokenGeneration: string;
  pairingId: string;
  pairingDeviceCode: string;
  pairingUserCode: string;
  pairingVerificationUrl: string;
  pairingExpiresAt: string;
  pairingTerminalStatus: string;
  lastHeartbeatAt: string;
  lastSyncAt: string;
  lastSyncCount: number;
  merchantActorId: string;
  merchantDefaultCoin: string;
  lastMerchantSyncAt: string;
  lastMerchantSyncCount: number;
  pendingChatEvents: readonly ChatEntry[];
  lastConnectionError: string;
};

export type SettingKey = keyof ModuleSettings;

type SettingDefinition<K extends SettingKey> = Readonly<{
  scope: "world" | "client";
  type: StringConstructor | NumberConstructor | ObjectConstructor;
  default: ModuleSettings[K];
}>;

const definitions: { [K in SettingKey]: SettingDefinition<K> } = {
  bridgeUrl: { scope: "world", type: String, default: DEFAULT_BRIDGE_URL },
  worldInstanceId: { scope: "world", type: String, default: "" },
  connectionRecord: { scope: "world", type: Object, default: {} },
  // A credencial operacional fica apenas no navegador do mestre que pareou.
  accessToken: { scope: "client", type: String, default: "" },
  accessTokenGeneration: { scope: "client", type: String, default: "" },
  pairingId: { scope: "client", type: String, default: "" },
  pairingDeviceCode: { scope: "client", type: String, default: "" },
  pairingUserCode: { scope: "client", type: String, default: "" },
  pairingVerificationUrl: { scope: "client", type: String, default: "" },
  pairingExpiresAt: { scope: "client", type: String, default: "" },
  pairingTerminalStatus: { scope: "client", type: String, default: "" },
  lastHeartbeatAt: { scope: "world", type: String, default: "" },
  lastSyncAt: { scope: "world", type: String, default: "" },
  lastSyncCount: { scope: "world", type: Number, default: 0 },
  merchantActorId: { scope: "world", type: String, default: "" },
  // Moeda aplicada a preços digitados só com número, como `22`.
  merchantDefaultCoin: { scope: "world", type: String, default: "cp" },
  lastMerchantSyncAt: { scope: "world", type: String, default: "" },
  lastMerchantSyncCount: { scope: "world", type: Number, default: 0 },
  pendingChatEvents: { scope: "world", type: Object, default: [] },
  lastConnectionError: { scope: "client", type: String, default: "" },
};

export function registerSettings(connectionMenu: unknown): void {
  game.settings.registerMenu(MODULE_ID, "connection", {
    name: "ORDEM_BRIDGE.Settings.Connection.Name",
    label: "ORDEM_BRIDGE.Settings.Connection.Label",
    hint: "ORDEM_BRIDGE.Settings.Connection.Hint",
    icon: "fa-solid fa-fire-flame-curved",
    type: connectionMenu,
    restricted: true,
  });
  for (const [key, definition] of Object.entries(definitions)) {
    game.settings.register(MODULE_ID, key, {
      scope: definition.scope,
      config: false,
      restricted: definition.scope === "world",
      type: definition.type,
      default: definition.default,
    });
  }
}

export function getSetting<K extends SettingKey>(key: K): ModuleSettings[K] {
  return (game.settings.get(MODULE_ID, key) ?? definitions[key].default) as ModuleSettings[K];
}

export async function setSetting<K extends SettingKey>(
  key: K,
  value: ModuleSettings[K],
): Promise<void> {
  await game.settings.set(MODULE_ID, key, value);
}

export async function setSettings(values: Partial<ModuleSettings>): Promise<void> {
  await Promise.all(
    Object.entries(values).map(([key, value]) => game.settings.set(MODULE_ID, key, value)),
  );
}

export function bridgeUrl(): string {
  return String(getSetting("bridgeUrl") || DEFAULT_BRIDGE_URL).replace(/\/+$/u, "");
}

export function merchantDefaultCoin(): MerchantCoin {
  const coin = String(getSetting("merchantDefaultCoin") ?? "").trim();
  return isMerchantCoin(coin) ? coin : "cp";
}

export function merchantActorId(): string {
  return String(getSetting("merchantActorId") ?? "").trim();
}

export type Connection = Readonly<{
  worldId: string;
  accessToken: string;
  campaignId: string;
  campaignName: string;
  connectorName: string;
  connectionGeneration: string;
  accessTokenGeneration: string;
}>;

export function connection(): Connection {
  const record = getSetting("connectionRecord");
  return {
    worldId: record.worldId ?? "",
    accessToken: getSetting("accessToken"),
    campaignId: record.campaignId ?? "",
    campaignName: record.campaignName ?? "",
    connectorName: record.connectorName ?? "",
    connectionGeneration: record.generation ?? "",
    accessTokenGeneration: getSetting("accessTokenGeneration"),
  };
}

export type Pairing = Readonly<{
  pairingId: string;
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: string;
  expired: boolean;
  terminal: string;
}>;

export function pairing(): Pairing {
  const expiresAt = getSetting("pairingExpiresAt");
  return {
    pairingId: getSetting("pairingId"),
    deviceCode: getSetting("pairingDeviceCode"),
    userCode: getSetting("pairingUserCode"),
    verificationUrl: getSetting("pairingVerificationUrl"),
    expiresAt,
    expired: Boolean(expiresAt && Date.parse(expiresAt) <= Date.now()),
    terminal: getSetting("pairingTerminalStatus"),
  };
}
