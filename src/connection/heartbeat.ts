import { authenticatedRequest } from "../bridge/client";
import type { HeartbeatRequest, HeartbeatResponse } from "../bridge/contracts";
import { DEFAULT_HEARTBEAT_SECONDS } from "../constants";
import { isCredentialedGameMaster } from "../gm";
import { setSettings } from "../settings";
import { renderConnectionApplication } from "../ui/refresh";
import { handleOperationalError } from "./operational-errors";
import { runtimeVersions } from "./versions";

let active = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
/** O Bridge define a cadência em `nextHeartbeatSeconds`; o módulo apenas obedece. */
let intervalMs = DEFAULT_HEARTBEAT_SECONDS * 1_000;

export function startHeartbeat(): void {
  if (active) return;
  active = true;
  schedule(intervalMs);
}

export function stopHeartbeat(): void {
  active = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

export function sendHeartbeat(): Promise<void> {
  inFlight ??= performHeartbeat().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

function schedule(delay: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void sendHeartbeat()
      .catch(handleOperationalError)
      .finally(() => {
        if (active && isCredentialedGameMaster()) schedule(intervalMs);
      });
  }, delay);
}

/**
 * Presença do mundo. As versões vão junto para o portal saber o que está
 * instalado depois de uma atualização, e não só o que havia no pareamento.
 */
export function heartbeatPayload(): HeartbeatRequest {
  return {
    observedAt: new Date().toISOString(),
    activeUsers: game.users.filter((user) => user.active).length,
    actorCount: game.actors.filter((actor) => actor.type === "character").length,
    ...runtimeVersions(),
  };
}

async function performHeartbeat(): Promise<void> {
  if (!isCredentialedGameMaster()) return;
  const response = await authenticatedRequest<HeartbeatResponse>("/heartbeat", heartbeatPayload());
  const seconds = Number(response.nextHeartbeatSeconds);
  if (Number.isFinite(seconds)) intervalMs = Math.min(300, Math.max(15, seconds)) * 1_000;
  await setSettings({ lastHeartbeatAt: new Date().toISOString(), lastConnectionError: "" });
  void renderConnectionApplication();
}
