import { authenticatedRequest } from "../bridge/client";
import type { CharacterProjection, SyncResponse } from "../bridge/contracts";
import { handleOperationalError } from "../connection/operational-errors";
import { assertCredentialedGameMaster, isCredentialedGameMaster } from "../gm";
import { nullableText, safeInteger } from "../sanitize";
import { setSettings } from "../settings";
import { renderConnectionApplication } from "../ui/refresh";

let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<CharacterSyncResult> | null = null;

export type CharacterSyncResult = SyncResponse & Readonly<{ synchronizedCharacters: number }>;

/** Agrupa alterações próximas em uma única sincronização integral. */
export function scheduleCharacterSync(delay = 2_000): void {
  if (!isCredentialedGameMaster()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncCharacters().catch(handleOperationalError);
  }, delay);
}

export function cancelCharacterSync(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

export function syncCharacters(): Promise<CharacterSyncResult> {
  inFlight ??= performCharacterSync().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function performCharacterSync(): Promise<CharacterSyncResult> {
  assertCredentialedGameMaster();
  const characters = game.actors
    .filter((actor) => actor.type === "character")
    .map(characterProjection);
  const response = await authenticatedRequest<SyncResponse>("/characters/sync", {
    syncId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    characters,
  });
  await setSettings({
    lastSyncAt: new Date().toISOString(),
    lastSyncCount: characters.length,
    lastConnectionError: "",
  });
  void renderConnectionApplication();
  return { ...response, synchronizedCharacters: characters.length };
}

/** Projeção sanitizada: somente identidade, nível, caminhos e recursos mecânicos mínimos. */
export function characterProjection(actor: FoundryActor): CharacterProjection {
  const system = actor.system ?? {};
  const characteristics = system.characteristics ?? {};
  const health = characteristics.health ?? {};
  const ownershipLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  const modifiedTime = Number(actor._stats?.modifiedTime ?? Date.now());
  return {
    actorId: actor.id,
    name: String(actor.name ?? ""),
    type: "character",
    ownerUserIds: Object.entries(actor.ownership ?? {})
      .filter(([userId, level]) => userId !== "default" && Number(level) >= ownershipLevel)
      .map(([userId]) => userId),
    level: safeInteger(system.level),
    ancestry: nullableText(system.ancestry),
    paths: pathNames(actor, system.paths ?? {}),
    statistics: {
      healthMax: safeInteger(health.max),
      damage: safeInteger(health.value),
      healingRate: safeInteger(health.healingRate ?? health.healingrate),
      insanity: safeInteger(characteristicValue(characteristics.insanity)),
      corruption: safeInteger(characteristicValue(characteristics.corruption)),
    },
    sourceUpdatedAt: new Date(
      Number.isFinite(modifiedTime) ? modifiedTime : Date.now(),
    ).toISOString(),
  };
}

function characteristicValue(
  value: number | string | Readonly<{ value?: number | string | null }> | null | undefined,
): unknown {
  return typeof value === "object" && value !== null ? value.value : value;
}

type PathTier = "novice" | "expert" | "master" | "legendary";

/** Caminhos vêm de itens `path` (sistema atual), com fallback para os campos legados. */
function pathNames(
  actor: FoundryActor,
  legacyPaths: NonNullable<DemonLordActorSystem["paths"]>,
): Record<PathTier, string | null> {
  const result: Record<PathTier, string | null> = {
    novice: nullableText(legacyPaths.novice),
    expert: nullableText(legacyPaths.expert),
    master: nullableText(legacyPaths.master),
    legendary: nullableText(legacyPaths.legendary),
  };
  for (const item of actor.items ?? []) {
    if (item.type !== "path") continue;
    const tier = String(item.system?.type ?? item.system?.pathType ?? "").toLowerCase();
    if (isPathTier(tier)) result[tier] = nullableText(item.name);
  }
  return result;
}

function isPathTier(value: string): value is PathTier {
  return value === "novice" || value === "expert" || value === "master" || value === "legendary";
}
