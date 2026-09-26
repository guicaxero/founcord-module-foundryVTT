import { authenticatedRequest, bridgeRequest } from "../bridge/client";
import type {
  PairingCreateResponse,
  PairingPollResponse,
  WorldIdentity,
} from "../bridge/contracts";
import { BridgeRequestError, friendlyError } from "../bridge/errors";
import { DEFAULT_POLL_INTERVAL_MS } from "../constants";
import { assertGameMaster, assertPrimaryGameMaster, isPrimaryGameMaster } from "../gm";
import { localize } from "../i18n";
import { runtimeVersions } from "./versions";
import {
  connection,
  getSetting,
  pairing,
  setSetting,
  setSettings,
} from "../settings";
import { renderConnectionApplication } from "../ui/refresh";
import { clearConnection, clearLocalCredential } from "./credentials";
import { sendHeartbeat } from "./heartbeat";
import { startBridge, stopBridge } from "./lifecycle";

let pollTimer: ReturnType<typeof setTimeout> | null = null;

const TERMINAL_PAIRING_ERRORS = new Set(["pairing_expired", "pairing_cancelled", "pairing_consumed"]);

/** Inicia o pareamento por código temporário; a campanha é escolhida no portal. */
export async function startPairing(): Promise<void> {
  assertGameMaster();
  assertPrimaryGameMaster();
  if (game.system.id !== "demonlord") {
    throw new Error(
      localize(
        "ORDEM_BRIDGE.Errors.IncompatibleSystem",
        "Este módulo requer um mundo de Shadow of the Demon Lord.",
      ),
    );
  }
  stopPairingPoll();
  let worldInstanceId = getSetting("worldInstanceId");
  if (!worldInstanceId) {
    worldInstanceId = crypto.randomUUID();
    await setSetting("worldInstanceId", worldInstanceId);
  }
  const identity: WorldIdentity = {
    worldInstanceId,
    foundryWorldId: game.world.id,
    worldTitle: game.world.title,
    systemId: game.system.id,
    ...runtimeVersions(),
  };
  const response = await bridgeRequest<PairingCreateResponse>("/v1/pairings", {
    body: identity,
  });
  await setSettings({
    pairingId: response.pairingId,
    pairingDeviceCode: response.deviceCode,
    pairingUserCode: response.userCode,
    pairingVerificationUrl: response.verificationUriComplete,
    pairingExpiresAt: response.expiresAt,
    lastConnectionError: "",
    pairingTerminalStatus: "",
  });
  schedulePairingPoll(response.pollIntervalSeconds * 1_000);
}

export function schedulePairingPoll(delay = DEFAULT_POLL_INTERVAL_MS): void {
  stopPairingPoll();
  pollTimer = setTimeout(() => {
    pollTimer = null;
    void pollPairing();
  }, delay);
}

export function stopPairingPoll(): void {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

async function pollPairing(): Promise<void> {
  const current = pairing();
  const connectionGenerationAtStart = connection().connectionGeneration;
  if (!isPrimaryGameMaster()) {
    stopPairingPoll();
    await setSetting(
      "lastConnectionError",
      localize(
        "ORDEM_BRIDGE.Errors.PrimaryChanged",
        "O mestre ativo mudou. O pareamento foi pausado neste navegador.",
      ),
    );
    void renderConnectionApplication();
    return;
  }
  if (!current.pairingId || !current.deviceCode || current.expired) {
    void renderConnectionApplication();
    return;
  }
  try {
    const response = await bridgeRequest<PairingPollResponse>(
      `/v1/pairings/${current.pairingId}/poll`,
      { token: current.deviceCode, body: {} },
    );
    if (response.status === "pending") {
      schedulePairingPoll(response.pollIntervalSeconds * 1_000);
      return;
    }
    if (!isPrimaryGameMaster()) {
      // Outro mestre assumiu durante a autorização: a credencial recém-emitida é revogada.
      await bridgeRequest(`/v1/worlds/${response.worldId}/revoke`, {
        token: response.accessToken,
        body: {},
      }).catch(() => undefined);
      await clearPairing();
      await clearLocalCredential(connectionGenerationAtStart);
      throw new Error(
        localize(
          "ORDEM_BRIDGE.Errors.PrimaryChanged",
          "O mestre ativo mudou durante a autorização. Inicie um novo pareamento.",
        ),
      );
    }
    const connectionGeneration = crypto.randomUUID();
    await setSettings({
      accessToken: response.accessToken,
      accessTokenGeneration: connectionGeneration,
      lastConnectionError: "",
    });
    await setSetting("connectionRecord", {
      worldId: response.worldId,
      campaignId: response.campaignId,
      campaignName: response.campaignName,
      connectorName: game.user?.name ?? "",
      generation: connectionGeneration,
    });
    await clearPairing();
    startBridge();
    await sendHeartbeat();
    ui.notifications.info(
      localize(
        "ORDEM_BRIDGE.Notifications.Registered",
        "Mundo conectado com segurança ao portal da Ordem.",
      ),
    );
    void renderConnectionApplication();
  } catch (error) {
    const code = error instanceof BridgeRequestError ? error.code : "";
    await setSetting("lastConnectionError", friendlyError(error));
    if (TERMINAL_PAIRING_ERRORS.has(code)) {
      await setSetting("pairingTerminalStatus", code);
      stopPairingPoll();
    } else {
      schedulePairingPoll(DEFAULT_POLL_INTERVAL_MS * 2);
    }
    void renderConnectionApplication();
  }
}

export async function cancelPairing(): Promise<void> {
  assertGameMaster();
  const current = pairing();
  stopPairingPoll();
  if (current.pairingId && current.deviceCode && !current.expired) {
    await bridgeRequest(`/v1/pairings/${current.pairingId}`, {
      method: "DELETE",
      token: current.deviceCode,
    });
  }
  await clearPairing();
  await setSetting("lastConnectionError", "");
}

async function clearPairing(): Promise<void> {
  await setSettings({
    pairingId: "",
    pairingDeviceCode: "",
    pairingUserCode: "",
    pairingVerificationUrl: "",
    pairingExpiresAt: "",
    pairingTerminalStatus: "",
  });
}

export async function disconnect(): Promise<void> {
  assertGameMaster();
  const current = connection();
  if (current.worldId && current.accessToken) await authenticatedRequest("/revoke", {});
  stopBridge();
  await clearConnection();
}

export async function saveBridgeUrl(value: string): Promise<void> {
  assertGameMaster();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      localize("ORDEM_BRIDGE.Errors.InvalidUrl", "Informe um endereço HTTPS válido."),
    );
  }
  const localDevelopment =
    url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localDevelopment) {
    throw new Error(
      localize("ORDEM_BRIDGE.Errors.InvalidUrl", "Informe um endereço HTTPS válido."),
    );
  }
  await setSetting("bridgeUrl", url.toString().replace(/\/+$/u, ""));
}
