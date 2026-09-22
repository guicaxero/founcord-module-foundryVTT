import { isCredentialedGameMaster, isPrimaryGameMaster, primaryGameMaster } from "../gm";
import { formatDateTime } from "../i18n";
import { connection, getSetting, merchantActorId, pairing } from "../settings";

/** Estado da conexão exposto à tela e à API pública do módulo. Nunca inclui credenciais. */
export function publicStatus() {
  const current = connection();
  const pending = pairing();
  const linked = Boolean(current.worldId);
  const pendingPairing = Boolean(pending.pairingId && pending.deviceCode && pending.userCode);
  const connected = linked && !pendingPairing;
  const lastHeartbeatAt = getSetting("lastHeartbeatAt");
  const lastSyncAt = getSetting("lastSyncAt");
  const lastError = getSetting("lastConnectionError");
  const selectedMerchantActorId = merchantActorId();
  const selectedMerchantActor = selectedMerchantActorId
    ? game.actors.get(selectedMerchantActorId)
    : null;
  const lastMerchantSyncAt = getSetting("lastMerchantSyncAt");
  return Object.freeze({
    connected,
    disconnected: !linked && !pendingPairing,
    pendingPairing,
    pairingExpired: pendingPairing && Boolean(pending.expired || pending.terminal),
    worldId: current.worldId || null,
    campaignId: current.campaignId || null,
    campaignName: current.campaignName || null,
    userCode: pending.userCode || null,
    verificationUrl: pending.verificationUrl || null,
    pairingExpiresAt: pending.expiresAt ? formatDateTime(pending.expiresAt) : null,
    worldTitle: game.world.title,
    foundryWorldId: game.world.id,
    isGameMaster: Boolean(game.user?.isGM),
    activeConnector: connected && isCredentialedGameMaster(),
    canTakeOver: connected && isPrimaryGameMaster() && !isCredentialedGameMaster(),
    connectorName: connected ? current.connectorName || primaryGameMaster()?.name || null : null,
    lastHeartbeatAt: lastHeartbeatAt ? formatDateTime(lastHeartbeatAt) : null,
    lastSyncAt: lastSyncAt ? formatDateTime(lastSyncAt) : null,
    lastSyncCount: getSetting("lastSyncCount"),
    merchantActorId: selectedMerchantActorId || null,
    merchantActorName: selectedMerchantActor?.name ?? null,
    merchantConfigured: Boolean(selectedMerchantActor),
    merchantMissing: Boolean(selectedMerchantActorId && !selectedMerchantActor),
    hasMerchantActors: (game.actors?.size ?? 0) > 0,
    lastMerchantSyncAt: lastMerchantSyncAt ? formatDateTime(lastMerchantSyncAt) : null,
    lastMerchantSyncCount: getSetting("lastMerchantSyncCount"),
    hasConnectionError: Boolean(lastError),
    lastConnectionError: lastError || null,
  });
}

export type PublicStatus = ReturnType<typeof publicStatus>;
