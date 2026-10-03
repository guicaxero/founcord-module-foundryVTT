import { chatMessageProjection, enqueueChatEvent, isPublicChatMessage } from "./capture/chat";
import { MODULE_ID, PRESENTATION_ONLY_SETTINGS } from "./constants";
import { sendHeartbeat } from "./connection/heartbeat";
import { startBridge, stopBridge } from "./connection/lifecycle";
import { handleOperationalError } from "./connection/operational-errors";
import { disconnect, schedulePairingPoll, startPairing, stopPairingPoll } from "./connection/pairing";
import { isCredentialedGameMaster, isPrimaryGameMaster } from "./gm";
import { localize } from "./i18n";
import { connection, merchantActorId, pairing, registerSettings } from "./settings";
import { scheduleCharacterSync, syncCharacters } from "./sync/characters";
import { scheduleMerchantSync, syncMerchantCatalog } from "./sync/merchant";
import { BridgeConnectionApplication } from "./ui/connection-app";
import { renderConnectionApplication } from "./ui/refresh";
import { publicStatus } from "./ui/status";

Hooks.once("init", () => registerSettings(BridgeConnectionApplication));

Hooks.once("ready", () => {
  exposeApi();
  if (!game.user?.isGM) return;
  const pending = pairing();
  if (pending.pairingId && pending.deviceCode && !pending.expired) schedulePairingPoll(0);
  if (connection().accessToken && connection().worldId) {
    startBridge();
    void sendHeartbeat().catch(handleOperationalError);
    return;
  }
  ui.notifications.info(
    localize(
      "ORDEM_BRIDGE.Notifications.RegistrationRequired",
      "Módulo ativado. Abra a tela da Ordem nas configurações para conectar este mundo.",
    ),
  );
});

// A conexão acompanha o mestre conector: se ele sair ou perder a primazia, tudo para.
Hooks.on("updateUser", () => {
  if (!isPrimaryGameMaster()) stopPairingPoll();
  else {
    const pending = pairing();
    if (pending.pairingId && pending.deviceCode && !pending.expired && !pending.terminal) {
      schedulePairingPoll(0);
    }
  }
  refreshBridgeState();
});

Hooks.on("updateSetting", (setting: { key?: unknown }) => {
  const settingKey = String(setting?.key ?? "");
  if (!settingKey.startsWith(`${MODULE_ID}.`)) return;
  const localKey = settingKey.slice(MODULE_ID.length + 1);
  if (localKey === "pendingChatEvents") return;
  if (PRESENTATION_ONLY_SETTINGS.has(localKey)) {
    void renderConnectionApplication();
    return;
  }
  refreshBridgeState();
});

for (const event of ["createActor", "updateActor", "deleteActor"]) {
  Hooks.on(event, (actor: FoundryActor) => {
    if (actor?.type === "character") scheduleCharacterSync();
    if (actor?.id === merchantActorId()) {
      if (event !== "deleteActor") scheduleMerchantSync();
      void renderConnectionApplication();
    }
  });
}

for (const event of ["createItem", "updateItem", "deleteItem"]) {
  Hooks.on(event, (item: FoundryItem) => {
    if (item?.parent?.id === merchantActorId()) scheduleMerchantSync();
    // A ficha do portal inclui inventário, magias e talentos.
    if (item?.parent?.type === "character") scheduleCharacterSync();
  });
}

Hooks.on("createChatMessage", (message: FoundryChatMessage) => {
  if (!isCredentialedGameMaster() || !isPublicChatMessage(message)) return;
  const projection = chatMessageProjection(message);
  if (projection) void enqueueChatEvent(projection).catch(handleOperationalError);
});

Hooks.once("shutdown", () => {
  stopBridge();
  stopPairingPoll();
});

function refreshBridgeState(): void {
  if (isCredentialedGameMaster()) startBridge();
  else stopBridge();
  void renderConnectionApplication();
}

function exposeApi(): void {
  const moduleEntry = game.modules.get(MODULE_ID);
  if (!moduleEntry) return;
  moduleEntry.api = Object.freeze({
    open: () => new BridgeConnectionApplication().render({ force: true }),
    startPairing,
    disconnect,
    syncNow: syncCharacters,
    syncMerchant: syncMerchantCatalog,
    status: publicStatus,
  });
}
