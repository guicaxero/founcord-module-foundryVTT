/* global ChatMessage, Hooks, game, foundry, ui */

const MODULE_ID = "ordem-foundry-bridge";
const DEFAULT_BRIDGE_URL =
  "https://ordem-foundry-bridge.ordem-da-ultima-luz.workers.dev";
const DEFAULT_CAMPAIGN_ID = "11111111-1111-4111-8111-111111111111";

let heartbeatTimer = null;
let pollTimer = null;
let syncTimer = null;
let polling = false;
let pollFailures = 0;

Hooks.once("init", () => {
  registerSettings();
});

Hooks.once("ready", async () => {
  exposeApi();
  if (!isPrimaryGameMaster()) return;
  if (!connection().accessToken || !connection().worldId) {
    ui.notifications.warn(
      game.i18n.localize("ORDEM_BRIDGE.Notifications.RegistrationRequired"),
    );
    return;
  }
  startBridge();
});

Hooks.on("updateUser", () => {
  if (isPrimaryGameMaster() && connection().accessToken) startBridge();
  else stopBridge();
});

for (const event of ["createActor", "updateActor", "deleteActor"]) {
  Hooks.on(event, (actor) => {
    if (actor?.type === "character") scheduleCharacterSync();
  });
}

Hooks.once("shutdown", () => {
  stopBridge();
});

function registerSettings() {
  game.settings.register(MODULE_ID, "bridgeUrl", {
    name: "ORDEM_BRIDGE.Settings.BridgeUrl.Name",
    hint: "ORDEM_BRIDGE.Settings.BridgeUrl.Hint",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    default: DEFAULT_BRIDGE_URL,
  });
  game.settings.register(MODULE_ID, "campaignId", {
    name: "ORDEM_BRIDGE.Settings.CampaignId.Name",
    hint: "ORDEM_BRIDGE.Settings.CampaignId.Hint",
    scope: "world",
    config: true,
    restricted: true,
    type: String,
    default: DEFAULT_CAMPAIGN_ID,
  });
  game.settings.register(MODULE_ID, "worldInstanceId", {
    scope: "world",
    config: false,
    restricted: true,
    type: String,
    default: "",
  });
  game.settings.register(MODULE_ID, "worldId", {
    scope: "client",
    config: false,
    type: String,
    default: "",
  });
  game.settings.register(MODULE_ID, "accessToken", {
    scope: "client",
    config: false,
    type: String,
    default: "",
  });
}

function exposeApi() {
  const moduleEntry = game.modules.get(MODULE_ID);
  if (!moduleEntry) return;
  moduleEntry.api = Object.freeze({
    registerWorld,
    disconnect,
    syncNow: syncCharacters,
    status: publicStatus,
  });
}

async function registerWorld(enrollmentToken) {
  assertPrimaryGameMaster();
  if (typeof enrollmentToken !== "string" || enrollmentToken.length < 32) {
    throw new Error("Informe um token de registro válido.");
  }
  let worldInstanceId = game.settings.get(MODULE_ID, "worldInstanceId");
  if (!worldInstanceId) {
    worldInstanceId = crypto.randomUUID();
    await game.settings.set(MODULE_ID, "worldInstanceId", worldInstanceId);
  }
  const moduleEntry = game.modules.get(MODULE_ID);
  const response = await bridgeRequest("/v1/worlds/register", {
    token: enrollmentToken,
    body: {
      campaignId: game.settings.get(MODULE_ID, "campaignId"),
      worldInstanceId,
      foundryWorldId: game.world.id,
      worldTitle: game.world.title,
      systemId: game.system.id,
      foundryVersion: game.version,
      systemVersion: game.system.version,
      moduleVersion: moduleEntry?.version ?? "0.1.0",
    },
  });
  await game.settings.set(MODULE_ID, "worldId", response.worldId);
  await game.settings.set(MODULE_ID, "accessToken", response.accessToken);
  pollFailures = 0;
  startBridge();
  await Promise.all([sendHeartbeat(), syncCharacters()]);
  ui.notifications.info(game.i18n.localize("ORDEM_BRIDGE.Notifications.Registered"));
  return publicStatus();
}

async function disconnect() {
  assertGameMaster();
  stopBridge();
  await game.settings.set(MODULE_ID, "worldId", "");
  await game.settings.set(MODULE_ID, "accessToken", "");
  return publicStatus();
}

function startBridge() {
  if (!isPrimaryGameMaster() || !connection().accessToken) return;
  if (!heartbeatTimer) {
    heartbeatTimer = globalThis.setInterval(() => {
      void sendHeartbeat().catch(logConnectionError);
    }, 30_000);
  }
  if (!pollTimer) schedulePoll(0);
  scheduleCharacterSync(500);
}

function stopBridge() {
  if (heartbeatTimer) globalThis.clearInterval(heartbeatTimer);
  if (pollTimer) globalThis.clearTimeout(pollTimer);
  if (syncTimer) globalThis.clearTimeout(syncTimer);
  heartbeatTimer = null;
  pollTimer = null;
  syncTimer = null;
  polling = false;
}

async function sendHeartbeat() {
  if (!isPrimaryGameMaster()) return;
  const characters = game.actors.filter((actor) => actor.type === "character");
  await authenticatedRequest("/heartbeat", {
    observedAt: new Date().toISOString(),
    activeUsers: game.users.filter((user) => user.active).length,
    actorCount: characters.length,
  });
}

function scheduleCharacterSync(delay = 2_000) {
  if (!isPrimaryGameMaster() || !connection().accessToken) return;
  if (syncTimer) globalThis.clearTimeout(syncTimer);
  syncTimer = globalThis.setTimeout(() => {
    syncTimer = null;
    void syncCharacters().catch(logConnectionError);
  }, delay);
}

async function syncCharacters() {
  assertGameMaster();
  const characters = game.actors
    .filter((actor) => actor.type === "character")
    .map(characterProjection);
  const response = await authenticatedRequest("/characters/sync", {
    syncId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    characters,
  });
  return { ...response, synchronizedCharacters: characters.length };
}

function schedulePoll(delay) {
  if (pollTimer) globalThis.clearTimeout(pollTimer);
  pollTimer = globalThis.setTimeout(() => {
    pollTimer = null;
    void pollCommands();
  }, delay);
}

async function pollCommands() {
  if (polling || !isPrimaryGameMaster() || !connection().accessToken) return;
  polling = true;
  try {
    const response = await authenticatedRequest("/commands/poll", { limit: 10 });
    for (const command of response.commands ?? []) {
      await executeAndAcknowledge(command);
    }
    pollFailures = 0;
  } catch (error) {
    pollFailures += 1;
    logConnectionError(error);
  } finally {
    polling = false;
    const delay = Math.min(60_000, 5_000 * 2 ** Math.min(pollFailures, 4));
    schedulePoll(delay);
  }
}

async function executeAndAcknowledge(command) {
  let outcome = "succeeded";
  let result = {};
  let errorMessage = null;
  try {
    result = await executeCommand(command);
  } catch (error) {
    outcome = "failed";
    errorMessage = error instanceof Error ? error.message.slice(0, 1_000) : "Falha desconhecida.";
  }
  await authenticatedRequest(`/commands/${command.id}/result`, {
    deliveryToken: command.deliveryToken,
    outcome,
    result,
    error: errorMessage,
  });
}

async function executeCommand(command) {
  if (command.type === "actor.sync.request") {
    const response = await syncCharacters();
    return { synchronizedCharacters: response.synchronizedCharacters };
  }
  if (command.type === "chat.message.create") {
    const actor = command.payload.speakerActorId
      ? game.actors.get(command.payload.speakerActorId)
      : null;
    if (command.payload.speakerActorId && !actor) {
      throw new Error("O personagem indicado como autor não existe neste mundo.");
    }
    const escaped = foundry.utils.escapeHTML(command.payload.content).replaceAll("\n", "<br>");
    const message = await ChatMessage.create({
      content: escaped,
      speaker: actor
        ? ChatMessage.getSpeaker({ actor })
        : { alias: "Ordem da Última Luz" },
      whisper: command.payload.whisperUserIds,
    });
    return { messageId: message.id };
  }
  throw new Error(`Tipo de comando não suportado: ${String(command.type)}`);
}

function characterProjection(actor) {
  const system = actor.system ?? {};
  const characteristics = system.characteristics ?? {};
  const health = characteristics.health ?? {};
  const paths = pathNames(actor, system.paths ?? {});
  const ownershipLevel = globalThis.CONST?.DOCUMENT_OWNERSHIP_LEVELS?.OWNER ?? 3;
  const modifiedTime = Number(actor._stats?.modifiedTime ?? Date.now());
  return {
    actorId: actor.id,
    name: actor.name,
    type: "character",
    ownerUserIds: Object.entries(actor.ownership ?? {})
      .filter(([userId, level]) => userId !== "default" && Number(level) >= ownershipLevel)
      .map(([userId]) => userId),
    level: safeInteger(system.level),
    ancestry: nullableText(system.ancestry),
    paths,
    statistics: {
      healthMax: safeInteger(health.max),
      damage: safeInteger(health.value),
      healingRate: safeInteger(health.healingRate ?? health.healingrate),
      insanity: safeInteger(characteristics.insanity?.value ?? characteristics.insanity),
      corruption: safeInteger(characteristics.corruption?.value ?? characteristics.corruption),
    },
    sourceUpdatedAt: new Date(Number.isFinite(modifiedTime) ? modifiedTime : Date.now()).toISOString(),
  };
}

function pathNames(actor, legacyPaths) {
  const result = {
    novice: nullableText(legacyPaths.novice),
    expert: nullableText(legacyPaths.expert),
    master: nullableText(legacyPaths.master),
    legendary: nullableText(legacyPaths.legendary),
  };
  for (const item of actor.items ?? []) {
    if (item.type !== "path") continue;
    const tier = String(item.system?.type ?? item.system?.pathType ?? "").toLowerCase();
    if (Object.hasOwn(result, tier)) result[tier] = nullableText(item.name);
  }
  return result;
}

async function authenticatedRequest(path, body) {
  const current = connection();
  if (!current.worldId || !current.accessToken) throw new Error("Mundo não registrado.");
  return bridgeRequest(`/v1/worlds/${current.worldId}${path}`, {
    token: current.accessToken,
    body,
  });
}

async function bridgeRequest(path, { token, body }) {
  const baseUrl = String(game.settings.get(MODULE_ID, "bridgeUrl")).replace(/\/+$/u, "");
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-correlation-id": crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message ?? `Foundry Bridge respondeu ${response.status}.`);
  }
  return payload;
}

function connection() {
  return {
    worldId: game.settings.get(MODULE_ID, "worldId"),
    accessToken: game.settings.get(MODULE_ID, "accessToken"),
  };
}

function publicStatus() {
  const current = connection();
  const registered = Boolean(current.worldId && current.accessToken);
  return Object.freeze({
    registered,
    worldId: current.worldId || null,
    activeConnector: registered && isPrimaryGameMaster(),
  });
}

function isPrimaryGameMaster() {
  if (!game.user?.isGM) return false;
  const activeGameMasters = game.users
    .filter((user) => user.active && user.isGM)
    .sort((left, right) => left.id.localeCompare(right.id));
  return activeGameMasters[0]?.id === game.user.id;
}

function assertGameMaster() {
  if (!game.user?.isGM) throw new Error("Apenas um mestre pode operar o Foundry Bridge.");
}

function assertPrimaryGameMaster() {
  assertGameMaster();
  if (!isPrimaryGameMaster()) {
    throw new Error("Apenas o mestre ativo principal pode registrar este mundo.");
  }
}

function safeInteger(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function nullableText(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, 120) : null;
}

function logConnectionError(error) {
  console.warn(`${MODULE_ID} |`, error);
}
