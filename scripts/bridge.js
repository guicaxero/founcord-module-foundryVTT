/* global ChatMessage, Hooks, game, foundry, ui */

const MODULE_ID = "ordem-foundry-bridge";
const DEFAULT_BRIDGE_URL =
  "https://ordem-foundry-bridge.ordem-da-ultima-luz.workers.dev";
const HEARTBEAT_INTERVAL = 30_000;
const DEFAULT_POLL_INTERVAL = 5_000;
const CHAT_BATCH_SIZE = 25;
const MAX_PENDING_CHAT_EVENTS = 500;

let heartbeatTimer = null;
let commandPollTimer = null;
let syncTimer = null;
let pairingPollTimer = null;
let pollingCommands = false;
let commandPollFailures = 0;
let connectionApplication = null;
let heartbeatInFlight = null;
let syncInFlight = null;
let renderingConnectionApplication = false;
let chatFlushTimer = null;
let chatFlushInFlight = null;
let chatFlushFailures = 0;
let chatQueueOperation = Promise.resolve();

const { ApplicationV2, DialogV2, HandlebarsApplicationMixin } =
  foundry.applications.api;

class BridgeConnectionApplication extends HandlebarsApplicationMixin(
  ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    id: "ordem-foundry-connection",
    classes: ["ordem-bridge-window"],
    window: {
      title: "ORDEM_BRIDGE.App.Title",
      icon: "fa-solid fa-fire-flame-curved",
      resizable: true,
    },
    position: { width: 720, height: "auto" },
    actions: {
      connect: this.connect,
      copyCode: this.copyCode,
      openPortal: this.openPortal,
      cancelPairing: this.cancelPairing,
      syncNow: this.syncNow,
      disconnect: this.disconnect,
      saveBridgeUrl: this.saveBridgeUrl,
      retry: this.retry,
    },
  };

  static PARTS = {
    main: {
      template: `modules/${MODULE_ID}/templates/connection.hbs`,
    },
  };

  busyAction = null;
  feedback = null;

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    return {
      ...context,
      ...publicStatus(),
      busy: Boolean(this.busyAction),
      connecting: this.busyAction === "connect",
      cancelling: this.busyAction === "cancel",
      syncing: this.busyAction === "sync",
      disconnecting: this.busyAction === "disconnect",
      savingUrl: this.busyAction === "save-url",
      feedback: this.feedback,
      feedbackIsError: this.feedback?.type === "error",
      bridgeUrlLocked: publicStatus().connected || publicStatus().pendingPairing,
      moduleVersion: game.modules.get(MODULE_ID)?.version ?? "0.3.0",
      foundryVersion: game.version,
      systemVersion: game.system.version,
      systemTitle: game.system.title,
      bridgeUrl: bridgeUrl(),
    };
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // The active application is refreshed by background bridge events.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    connectionApplication = this;
  }

  async _onClose(options) {
    if (connectionApplication === this) connectionApplication = null;
    await super._onClose(options);
  }

  async runOperation(action, operation, successMessage = null) {
    if (this.busyAction) return;
    this.busyAction = action;
    this.feedback = null;
    await this.render();
    try {
      await operation();
      if (successMessage) {
        this.feedback = { type: "success", message: successMessage };
      }
    } catch (error) {
      const message = friendlyError(error);
      this.feedback = { type: "error", message };
      ui.notifications.error(message);
    } finally {
      this.busyAction = null;
      await this.render();
    }
  }

  static async connect() {
    await this.runOperation("connect", startPairing);
  }

  static async copyCode() {
    const code = pairing().userCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      this.feedback = {
        type: "success",
        message: localize("ORDEM_BRIDGE.Feedback.CodeCopied", "Código copiado."),
      };
    } catch {
      this.feedback = {
        type: "error",
        message: localize(
          "ORDEM_BRIDGE.Feedback.CopyFailed",
          "Não foi possível copiar automaticamente. Selecione o código e copie manualmente.",
        ),
      };
    }
    await this.render();
  }

  static async openPortal() {
    const url = pairing().verificationUrl;
    if (url) globalThis.open(url, "_blank", "noopener,noreferrer");
  }

  static async cancelPairing() {
    await this.runOperation(
      "cancel",
      cancelPairing,
      localize("ORDEM_BRIDGE.Feedback.PairingCancelled", "Solicitação cancelada."),
    );
  }

  static async syncNow() {
    await this.runOperation(
      "sync",
      syncCharacters,
      localize(
        "ORDEM_BRIDGE.Feedback.SyncComplete",
        "Personagens sincronizados com o portal.",
      ),
    );
  }

  static async disconnect() {
    const campaignName = connection().campaignName || localize(
      "ORDEM_BRIDGE.Common.LinkedCampaign",
      "a campanha vinculada",
    );
    const confirmed = await DialogV2.confirm({
      window: {
        title: localize("ORDEM_BRIDGE.Disconnect.Title", "Desconectar este mundo"),
      },
      content: `<p>${foundry.utils.escapeHTML(
        formatLocalized(
          "ORDEM_BRIDGE.Disconnect.Body",
          { campaignName },
          `O portal deixará de receber presença, personagens e comandos deste mundo em ${campaignName}. Nenhum personagem será apagado.`,
        ),
      )}</p>`,
      yes: {
        label: localize("ORDEM_BRIDGE.Actions.Disconnect", "Desconectar mundo"),
        icon: "fa-solid fa-link-slash",
      },
      no: {
        label: localize("ORDEM_BRIDGE.Actions.KeepConnection", "Manter conexão"),
      },
      modal: true,
      rejectClose: false,
    });
    if (!confirmed) return;
    await this.runOperation(
      "disconnect",
      disconnect,
      localize("ORDEM_BRIDGE.Feedback.Disconnected", "Mundo desconectado do portal."),
    );
  }

  static async saveBridgeUrl() {
    const input = this.element.querySelector("[name='bridgeUrl']");
    const value = input instanceof HTMLInputElement ? input.value.trim() : "";
    await this.runOperation(
      "save-url",
      () => saveBridgeUrl(value),
      localize("ORDEM_BRIDGE.Feedback.UrlSaved", "Endereço do Bridge atualizado."),
    );
  }

  static async retry() {
    const current = pairing();
    if (current.pairingId && current.deviceCode && !current.expired && !current.terminal) {
      schedulePairingPoll(0);
      this.feedback = {
        type: "success",
        message: localize(
          "ORDEM_BRIDGE.Feedback.Retrying",
          "Nova tentativa iniciada. A tela será atualizada automaticamente.",
        ),
      };
      await this.render();
      return;
    }
    await this.runOperation("connect", startPairing);
  }
}

Hooks.once("init", () => registerSettings());

Hooks.once("ready", async () => {
  exposeApi();
  if (!game.user?.isGM) return;
  const pending = pairing();
  if (pending.pairingId && pending.deviceCode && !pending.expired) {
    schedulePairingPoll(0);
  }
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

Hooks.on("updateUser", () => {
  if (!isPrimaryGameMaster()) stopPairingPoll();
  else {
    const pending = pairing();
    if (pending.pairingId && pending.deviceCode && !pending.expired && !pending.terminal) {
      schedulePairingPoll(0);
    }
  }
  if (isCredentialedGameMaster()) startBridge();
  else stopBridge();
  renderConnectionApplication();
});

Hooks.on("updateSetting", (setting) => {
  if (!String(setting?.key ?? "").startsWith(`${MODULE_ID}.`)) return;
  if (setting.key === `${MODULE_ID}.pendingChatEvents`) return;
  if (isCredentialedGameMaster()) startBridge();
  else stopBridge();
  renderConnectionApplication();
});

for (const event of ["createActor", "updateActor", "deleteActor"]) {
  Hooks.on(event, (actor) => {
    if (actor?.type === "character") scheduleCharacterSync();
  });
}

Hooks.on("createChatMessage", (message) => {
  if (!isCredentialedGameMaster() || !isPublicChatMessage(message)) return;
  const projection = chatMessageProjection(message);
  if (!projection) return;
  void enqueueChatEvent(projection).catch(handleOperationalError);
});

Hooks.once("shutdown", () => {
  stopBridge();
  stopPairingPoll();
});

function registerSettings() {
  game.settings.registerMenu(MODULE_ID, "connection", {
    name: "ORDEM_BRIDGE.Settings.Connection.Name",
    label: "ORDEM_BRIDGE.Settings.Connection.Label",
    hint: "ORDEM_BRIDGE.Settings.Connection.Hint",
    icon: "fa-solid fa-fire-flame-curved",
    type: BridgeConnectionApplication,
    restricted: true,
  });
  registerSetting("bridgeUrl", { scope: "world", default: DEFAULT_BRIDGE_URL });
  registerSetting("worldInstanceId", { scope: "world", default: "" });
  registerSetting("connectionRecord", { scope: "world", default: {}, type: Object });
  registerSetting("accessToken", { scope: "client", default: "" });
  registerSetting("accessTokenGeneration", { scope: "client", default: "" });
  registerSetting("pairingId", { scope: "client", default: "" });
  registerSetting("pairingDeviceCode", { scope: "client", default: "" });
  registerSetting("pairingUserCode", { scope: "client", default: "" });
  registerSetting("pairingVerificationUrl", { scope: "client", default: "" });
  registerSetting("pairingExpiresAt", { scope: "client", default: "" });
  registerSetting("pairingTerminalStatus", { scope: "client", default: "" });
  registerSetting("lastHeartbeatAt", { scope: "world", default: "" });
  registerSetting("lastSyncAt", { scope: "world", default: "" });
  registerSetting("lastSyncCount", { scope: "world", default: 0, type: Number });
  registerSetting("pendingChatEvents", { scope: "world", default: [], type: Object });
  registerSetting("lastConnectionError", { scope: "client", default: "" });
}

function registerSetting(key, options) {
  game.settings.register(MODULE_ID, key, {
    scope: options.scope,
    config: false,
    restricted: options.scope === "world",
    type: options.type ?? String,
    default: options.default,
  });
}

function exposeApi() {
  const moduleEntry = game.modules.get(MODULE_ID);
  if (!moduleEntry) return;
  moduleEntry.api = Object.freeze({
    open: () => new BridgeConnectionApplication().render({ force: true }),
    startPairing,
    disconnect,
    syncNow: syncCharacters,
    status: publicStatus,
  });
}

async function startPairing() {
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
  let worldInstanceId = game.settings.get(MODULE_ID, "worldInstanceId");
  if (!worldInstanceId) {
    worldInstanceId = crypto.randomUUID();
    await game.settings.set(MODULE_ID, "worldInstanceId", worldInstanceId);
  }
  const moduleEntry = game.modules.get(MODULE_ID);
  const response = await bridgeRequest("/v1/pairings", {
    body: {
      worldInstanceId,
      foundryWorldId: game.world.id,
      worldTitle: game.world.title,
      systemId: game.system.id,
      foundryVersion: game.version,
      systemVersion: game.system.version,
      moduleVersion: moduleEntry?.version ?? "0.3.0",
    },
  });
  await Promise.all([
    game.settings.set(MODULE_ID, "pairingId", response.pairingId),
    game.settings.set(MODULE_ID, "pairingDeviceCode", response.deviceCode),
    game.settings.set(MODULE_ID, "pairingUserCode", response.userCode),
    game.settings.set(
      MODULE_ID,
      "pairingVerificationUrl",
      response.verificationUriComplete,
    ),
    game.settings.set(MODULE_ID, "pairingExpiresAt", response.expiresAt),
    game.settings.set(MODULE_ID, "lastConnectionError", ""),
    game.settings.set(MODULE_ID, "pairingTerminalStatus", ""),
  ]);
  schedulePairingPoll(response.pollIntervalSeconds * 1_000);
}

function schedulePairingPoll(delay = DEFAULT_POLL_INTERVAL) {
  stopPairingPoll();
  pairingPollTimer = globalThis.setTimeout(() => {
    pairingPollTimer = null;
    void pollPairing();
  }, delay);
}

function stopPairingPoll() {
  if (pairingPollTimer) globalThis.clearTimeout(pairingPollTimer);
  pairingPollTimer = null;
}

async function pollPairing() {
  const current = pairing();
  const connectionGenerationAtStart = connection().connectionGeneration;
  if (!isPrimaryGameMaster()) {
    stopPairingPoll();
    await game.settings.set(
      MODULE_ID,
      "lastConnectionError",
      localize(
        "ORDEM_BRIDGE.Errors.PrimaryChanged",
        "O mestre ativo mudou. O pareamento foi pausado neste navegador.",
      ),
    );
    renderConnectionApplication();
    return;
  }
  if (!current.pairingId || !current.deviceCode || current.expired) {
    renderConnectionApplication();
    return;
  }
  try {
    const response = await bridgeRequest(
      `/v1/pairings/${current.pairingId}/poll`,
      { token: current.deviceCode, body: {} },
    );
    if (response.status === "pending") {
      schedulePairingPoll(response.pollIntervalSeconds * 1_000);
      return;
    }
    if (!isPrimaryGameMaster()) {
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
    await Promise.all([
      game.settings.set(MODULE_ID, "accessToken", response.accessToken),
      game.settings.set(MODULE_ID, "accessTokenGeneration", connectionGeneration),
      game.settings.set(MODULE_ID, "lastConnectionError", ""),
    ]);
    await game.settings.set(MODULE_ID, "connectionRecord", {
      worldId: response.worldId,
      campaignId: response.campaignId,
      campaignName: response.campaignName,
      connectorName: game.user.name,
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
    renderConnectionApplication();
  } catch (error) {
    const code = error instanceof BridgeRequestError ? error.code : "";
    await game.settings.set(MODULE_ID, "lastConnectionError", friendlyError(error));
    if (["pairing_expired", "pairing_cancelled", "pairing_consumed"].includes(code)) {
      await game.settings.set(MODULE_ID, "pairingTerminalStatus", code);
      stopPairingPoll();
    } else {
      schedulePairingPoll(Math.min(30_000, DEFAULT_POLL_INTERVAL * 2));
    }
    renderConnectionApplication();
  }
}

async function cancelPairing() {
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
  await game.settings.set(MODULE_ID, "lastConnectionError", "");
}

async function clearPairing() {
  await Promise.all([
    game.settings.set(MODULE_ID, "pairingId", ""),
    game.settings.set(MODULE_ID, "pairingDeviceCode", ""),
    game.settings.set(MODULE_ID, "pairingUserCode", ""),
    game.settings.set(MODULE_ID, "pairingVerificationUrl", ""),
    game.settings.set(MODULE_ID, "pairingExpiresAt", ""),
    game.settings.set(MODULE_ID, "pairingTerminalStatus", ""),
  ]);
}

async function disconnect() {
  assertGameMaster();
  const current = connection();
  if (current.worldId && current.accessToken) {
    await authenticatedRequest("/revoke", {});
  }
  stopBridge();
  await clearConnection();
}

async function clearConnection() {
  await Promise.all([
    game.settings.set(MODULE_ID, "connectionRecord", {}),
    game.settings.set(MODULE_ID, "accessToken", ""),
    game.settings.set(MODULE_ID, "accessTokenGeneration", ""),
    game.settings.set(MODULE_ID, "lastHeartbeatAt", ""),
    game.settings.set(MODULE_ID, "lastSyncAt", ""),
    game.settings.set(MODULE_ID, "lastSyncCount", 0),
    game.settings.set(MODULE_ID, "lastConnectionError", ""),
  ]);
}

async function clearLocalCredential(expectedGeneration = null) {
  const currentGeneration = game.settings.get(MODULE_ID, "accessTokenGeneration");
  if (expectedGeneration && currentGeneration && currentGeneration !== expectedGeneration) return;
  await Promise.all([
    game.settings.set(MODULE_ID, "accessToken", ""),
    game.settings.set(MODULE_ID, "accessTokenGeneration", ""),
    game.settings.set(MODULE_ID, "lastConnectionError", ""),
  ]);
}

function startBridge() {
  if (!isCredentialedGameMaster()) return;
  if (!heartbeatTimer) {
    heartbeatTimer = globalThis.setInterval(() => {
      void sendHeartbeat().catch(handleOperationalError);
    }, HEARTBEAT_INTERVAL);
  }
  if (!commandPollTimer) scheduleCommandPoll(0);
  scheduleCharacterSync(500);
  scheduleChatFlush(500);
}

function stopBridge() {
  if (heartbeatTimer) globalThis.clearInterval(heartbeatTimer);
  if (commandPollTimer) globalThis.clearTimeout(commandPollTimer);
  if (syncTimer) globalThis.clearTimeout(syncTimer);
  if (chatFlushTimer) globalThis.clearTimeout(chatFlushTimer);
  heartbeatTimer = null;
  commandPollTimer = null;
  syncTimer = null;
  chatFlushTimer = null;
  pollingCommands = false;
}

async function sendHeartbeat() {
  if (heartbeatInFlight) return heartbeatInFlight;
  heartbeatInFlight = performHeartbeat().finally(() => {
    heartbeatInFlight = null;
  });
  return heartbeatInFlight;
}

async function performHeartbeat() {
  if (!isCredentialedGameMaster()) return;
  const characters = game.actors.filter((actor) => actor.type === "character");
  await authenticatedRequest("/heartbeat", {
    observedAt: new Date().toISOString(),
    activeUsers: game.users.filter((user) => user.active).length,
    actorCount: characters.length,
  });
  await Promise.all([
    game.settings.set(MODULE_ID, "lastHeartbeatAt", new Date().toISOString()),
    game.settings.set(MODULE_ID, "lastConnectionError", ""),
  ]);
  renderConnectionApplication();
}

function scheduleCharacterSync(delay = 2_000) {
  if (!isCredentialedGameMaster()) return;
  if (syncTimer) globalThis.clearTimeout(syncTimer);
  syncTimer = globalThis.setTimeout(() => {
    syncTimer = null;
    void syncCharacters().catch(handleOperationalError);
  }, delay);
}

async function syncCharacters() {
  if (syncInFlight) return syncInFlight;
  syncInFlight = performCharacterSync().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

async function performCharacterSync() {
  assertGameMaster();
  if (!isCredentialedGameMaster()) {
    throw new Error(localize("ORDEM_BRIDGE.Errors.PrimaryGmOnly", "Somente o mestre conector ativo pode sincronizar este mundo."));
  }
  const characters = game.actors
    .filter((actor) => actor.type === "character")
    .map(characterProjection);
  const response = await authenticatedRequest("/characters/sync", {
    syncId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
    characters,
  });
  await Promise.all([
    game.settings.set(MODULE_ID, "lastSyncAt", new Date().toISOString()),
    game.settings.set(MODULE_ID, "lastSyncCount", characters.length),
    game.settings.set(MODULE_ID, "lastConnectionError", ""),
  ]);
  renderConnectionApplication();
  return { ...response, synchronizedCharacters: characters.length };
}

function isPublicChatMessage(message) {
  const whisperRecipients = Array.isArray(message?.whisper) ? message.whisper : [];
  return !message?.blind && whisperRecipients.length === 0;
}

function chatMessageProjection(message) {
  const content = sanitizedChatContent(message);
  if (!message?.id || !content) return null;
  const author = message.author ?? game.users.get(message.user?.id ?? message.user);
  const speakerActorId = nullableIdentifier(message.speaker?.actor);
  const speakerActor = speakerActorId ? game.actors.get(speakerActorId) : null;
  const speakerName = nullableText(
    speakerActor?.name ?? message.speaker?.alias ?? message.alias,
  );
  const timestamp = Number(message.timestamp ?? message._stats?.createdTime ?? Date.now());
  return {
    messageId: String(message.id).slice(0, 128),
    createdAt: new Date(Number.isFinite(timestamp) ? timestamp : Date.now()).toISOString(),
    authorUserId: nullableIdentifier(author?.id),
    authorName: nullableText(author?.name) ?? "Foundry",
    speakerActorId,
    speakerName,
    content,
    kind: Array.isArray(message.rolls) && message.rolls.length > 0 ? "roll" : "message",
  };
}

function sanitizedChatContent(message) {
  const container = document.createElement("div");
  container.innerHTML = String(message?.content ?? "");
  for (const element of container.querySelectorAll(
    "script,style,template,noscript,iframe,object,embed,.secret,.gm-only,[data-secret],[data-gm-only],[data-visibility='gm'],[data-visibility='owner']",
  )) {
    element.remove();
  }
  for (const lineBreak of container.querySelectorAll("br")) {
    lineBreak.replaceWith("\n");
  }
  for (const block of container.querySelectorAll("p,div,li,section,article,header,footer")) {
    block.append("\n");
  }
  const visibleText = String(container.textContent ?? "")
    .replace(/\u00a0/gu, " ")
    .replace(/[ \t]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  const rollSummary = Array.isArray(message?.rolls)
    ? message.rolls
        .map((roll) => {
          const formula = String(roll?.formula ?? "").trim();
          const total = Number(roll?.total);
          if (!formula || !Number.isFinite(total)) return null;
          return `${formula} = ${total}`;
        })
        .filter(Boolean)
        .join("; ")
    : "";
  return [visibleText, rollSummary ? `Rolagem: ${rollSummary}` : ""]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4_000)
    .trim();
}

function nullableIdentifier(value) {
  const identifier = typeof value === "string" ? value.trim() : "";
  return identifier && /^[A-Za-z0-9._-]+$/u.test(identifier)
    ? identifier.slice(0, 128)
    : null;
}

async function enqueueChatEvent(event) {
  await updateChatQueue((pending) => {
    if (pending.some((candidate) => candidate.messageId === event.messageId)) return pending;
    return [...pending, event].slice(-MAX_PENDING_CHAT_EVENTS);
  });
  scheduleChatFlush(250);
}

function scheduleChatFlush(delay) {
  if (!isCredentialedGameMaster()) return;
  if (chatFlushTimer) globalThis.clearTimeout(chatFlushTimer);
  chatFlushTimer = globalThis.setTimeout(() => {
    chatFlushTimer = null;
    void flushChatEvents();
  }, delay);
}

async function flushChatEvents() {
  if (chatFlushInFlight || !isCredentialedGameMaster()) return chatFlushInFlight;
  chatFlushInFlight = performChatFlush().finally(() => {
    chatFlushInFlight = null;
  });
  return chatFlushInFlight;
}

async function performChatFlush() {
  await chatQueueOperation;
  const pending = pendingChatEvents();
  if (pending.length === 0) return;
  const batch = pending.slice(0, CHAT_BATCH_SIZE);
  try {
    await authenticatedRequest("/chat/batches", {
      batchId: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
      messages: batch,
    });
    const sentIds = new Set(batch.map((event) => event.messageId));
    await updateChatQueue((current) =>
      current.filter((event) => !sentIds.has(event.messageId)),
    );
    chatFlushFailures = 0;
    if (pendingChatEvents().length > 0) scheduleChatFlush(100);
  } catch (error) {
    chatFlushFailures += 1;
    await handleOperationalError(error);
    scheduleChatFlush(
      Math.min(60_000, DEFAULT_POLL_INTERVAL * 2 ** Math.min(chatFlushFailures, 4)),
    );
  }
}

function pendingChatEvents() {
  const stored = game.settings.get(MODULE_ID, "pendingChatEvents");
  return Array.isArray(stored) ? stored : [];
}

function updateChatQueue(updater) {
  chatQueueOperation = chatQueueOperation
    .catch(() => undefined)
    .then(async () => {
      const updated = updater(pendingChatEvents());
      await game.settings.set(MODULE_ID, "pendingChatEvents", updated);
    });
  return chatQueueOperation;
}

function scheduleCommandPoll(delay) {
  if (commandPollTimer) globalThis.clearTimeout(commandPollTimer);
  commandPollTimer = globalThis.setTimeout(() => {
    commandPollTimer = null;
    void pollCommands();
  }, delay);
}

async function pollCommands() {
  if (pollingCommands || !isCredentialedGameMaster()) return;
  pollingCommands = true;
  try {
    const response = await authenticatedRequest("/commands/poll", { limit: 10 });
    for (const command of response.commands ?? []) {
      await executeAndAcknowledge(command);
    }
    commandPollFailures = 0;
  } catch (error) {
    commandPollFailures += 1;
    await handleOperationalError(error);
  } finally {
    pollingCommands = false;
    if (connection().accessToken) {
      const delay = Math.min(
        60_000,
        DEFAULT_POLL_INTERVAL * 2 ** Math.min(commandPollFailures, 4),
      );
      scheduleCommandPoll(delay);
    }
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
    errorMessage = error instanceof Error
      ? error.message.slice(0, 1_000)
      : "Falha desconhecida.";
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
    const escaped = foundry.utils.escapeHTML(command.payload.content).replaceAll(
      "\n",
      "<br>",
    );
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
      .filter(
        ([userId, level]) =>
          userId !== "default" && Number(level) >= ownershipLevel,
      )
      .map(([userId]) => userId),
    level: safeInteger(system.level),
    ancestry: nullableText(system.ancestry),
    paths,
    statistics: {
      healthMax: safeInteger(health.max),
      damage: safeInteger(health.value),
      healingRate: safeInteger(health.healingRate ?? health.healingrate),
      insanity: safeInteger(
        characteristics.insanity?.value ?? characteristics.insanity,
      ),
      corruption: safeInteger(
        characteristics.corruption?.value ?? characteristics.corruption,
      ),
    },
    sourceUpdatedAt: new Date(
      Number.isFinite(modifiedTime) ? modifiedTime : Date.now(),
    ).toISOString(),
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
  if (!current.worldId || !current.accessToken) {
    throw new Error(
      localize("ORDEM_BRIDGE.Errors.NotConnected", "Este mundo ainda não está conectado."),
    );
  }
  try {
    return await bridgeRequest(`/v1/worlds/${current.worldId}${path}`, {
      token: current.accessToken,
      body,
    });
  } catch (error) {
    if (error && typeof error === "object") {
      error.connectionGeneration = current.connectionGeneration;
      error.worldId = current.worldId;
    }
    throw error;
  }
}

async function bridgeRequest(path, { token = null, body, method = "POST" } = {}) {
  const headers = new Headers({
    "x-correlation-id": crypto.randomUUID(),
  });
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  let response;
  try {
    const init = { method, headers };
    if (body !== undefined) init.body = JSON.stringify(body);
    response = await fetch(`${bridgeUrl()}${path}`, init);
  } catch {
    throw new BridgeRequestError(
      0,
      "bridge_unavailable",
      localize(
        "ORDEM_BRIDGE.Errors.PortalUnavailable",
        "Não foi possível alcançar o portal. Verifique sua conexão e tente novamente.",
      ),
    );
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new BridgeRequestError(
      response.status,
      payload.error ?? "bridge_request_failed",
      payload.message ?? `Foundry Bridge respondeu ${response.status}.`,
    );
  }
  return payload;
}

async function saveBridgeUrl(value) {
  assertGameMaster();
  let url;
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
  await game.settings.set(MODULE_ID, "bridgeUrl", url.toString().replace(/\/+$/u, ""));
}

function bridgeUrl() {
  return String(game.settings.get(MODULE_ID, "bridgeUrl") || DEFAULT_BRIDGE_URL)
    .replace(/\/+$/u, "");
}

function connection() {
  const record = game.settings.get(MODULE_ID, "connectionRecord") ?? {};
  return {
    worldId: record.worldId ?? "",
    accessToken: game.settings.get(MODULE_ID, "accessToken"),
    campaignId: record.campaignId ?? "",
    campaignName: record.campaignName ?? "",
    connectorName: record.connectorName ?? "",
    connectionGeneration: record.generation ?? "",
    accessTokenGeneration: game.settings.get(MODULE_ID, "accessTokenGeneration"),
  };
}

function pairing() {
  const expiresAt = game.settings.get(MODULE_ID, "pairingExpiresAt");
  return {
    pairingId: game.settings.get(MODULE_ID, "pairingId"),
    deviceCode: game.settings.get(MODULE_ID, "pairingDeviceCode"),
    userCode: game.settings.get(MODULE_ID, "pairingUserCode"),
    verificationUrl: game.settings.get(MODULE_ID, "pairingVerificationUrl"),
    expiresAt,
    expired: Boolean(expiresAt && Date.parse(expiresAt) <= Date.now()),
    terminal: game.settings.get(MODULE_ID, "pairingTerminalStatus"),
  };
}

function publicStatus() {
  const current = connection();
  const pending = pairing();
  const linked = Boolean(current.worldId);
  const pendingPairing = Boolean(
    pending.pairingId && pending.deviceCode && pending.userCode,
  );
  const connected = linked && !pendingPairing;
  const lastHeartbeatAt = game.settings.get(MODULE_ID, "lastHeartbeatAt");
  const lastSyncAt = game.settings.get(MODULE_ID, "lastSyncAt");
  const lastError = game.settings.get(MODULE_ID, "lastConnectionError");
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
    pairingExpiresAt: pending.expiresAt
      ? formatDateTime(pending.expiresAt)
      : null,
    worldTitle: game.world.title,
    foundryWorldId: game.world.id,
    isGameMaster: Boolean(game.user?.isGM),
    activeConnector: connected && isCredentialedGameMaster(),
    canTakeOver: connected && isPrimaryGameMaster() && !isCredentialedGameMaster(),
    connectorName: connected ? current.connectorName || primaryGameMaster()?.name : null,
    lastHeartbeatAt: lastHeartbeatAt ? formatDateTime(lastHeartbeatAt) : null,
    lastSyncAt: lastSyncAt ? formatDateTime(lastSyncAt) : null,
    lastSyncCount: game.settings.get(MODULE_ID, "lastSyncCount"),
    hasConnectionError: Boolean(lastError),
    lastConnectionError: lastError || null,
  });
}

function isCredentialedGameMaster() {
  return Boolean(
    game.user?.isGM &&
      connection().accessToken &&
      connection().connectionGeneration &&
      connection().connectionGeneration === connection().accessTokenGeneration &&
      primaryGameMaster()?.id === game.user.id,
  );
}

function primaryGameMaster() {
  const foundryPrimary = game.users?.activeGM;
  if (foundryPrimary) return foundryPrimary;
  return [...(game.users ?? [])]
    .filter((user) => user.active && user.isGM)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))[0] ?? null;
}

function isPrimaryGameMaster() {
  return Boolean(game.user?.isGM && primaryGameMaster()?.id === game.user.id);
}

function assertGameMaster() {
  if (!game.user?.isGM) {
    throw new Error(
      localize(
        "ORDEM_BRIDGE.Errors.GameMasterOnly",
        "Apenas um mestre pode operar a conexão deste mundo.",
      ),
    );
  }
}

function assertPrimaryGameMaster() {
  if (!isPrimaryGameMaster()) {
    throw new Error(
      localize(
        "ORDEM_BRIDGE.Errors.PrimaryGmOnly",
        "Somente o mestre ativo principal pode operar a conexão deste mundo.",
      ),
    );
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

function localize(key, fallback) {
  const translation = game.i18n.localize(key);
  return translation === key ? fallback : translation;
}

function formatLocalized(key, data, fallback) {
  const translation = game.i18n.format(key, data);
  return translation === key ? fallback : translation;
}

function formatDateTime(value) {
  try {
    return new Intl.DateTimeFormat(game.i18n.lang || "pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function friendlyError(error) {
  if (error instanceof BridgeRequestError) {
    if (error.code === "internal_error") {
      return localize(
        "ORDEM_BRIDGE.Errors.ServiceUpdate",
        "O portal não conseguiu concluir esta atualização. Tente novamente.",
      );
    }
    return error.message;
  }
  return error instanceof Error
    ? error.message
    : localize("ORDEM_BRIDGE.Errors.Unknown", "Não foi possível concluir a operação.");
}

async function handleOperationalError(error) {
  if (error?.connectionGeneration) {
    const current = connection();
    const obsolete =
      error.connectionGeneration !== current.connectionGeneration ||
      error.connectionGeneration !== current.accessTokenGeneration ||
      error.worldId !== current.worldId;
    if (obsolete) {
      console.warn(`${MODULE_ID} | Resposta obsoleta ignorada para a geração anterior.`);
      return;
    }
  }
  const message = friendlyError(error);
  if (
    error instanceof BridgeRequestError &&
    ["invalid_world_token", "world_revoked"].includes(error.code)
  ) {
    stopBridge();
    await clearLocalCredential(error.connectionGeneration ?? null);
    await game.settings.set(
      MODULE_ID,
      "lastConnectionError",
      error.code === "world_revoked"
        ? localize(
            "ORDEM_BRIDGE.Errors.Revoked",
            "A conexão deste mundo foi revogada. Inicie um novo pareamento.",
          )
        : localize(
            "ORDEM_BRIDGE.Errors.CredentialReplaced",
            "A credencial deste navegador foi substituída. Assuma a conexão novamente se necessário.",
          ),
    );
    ui.notifications.error(
      error.code === "world_revoked"
        ? localize(
            "ORDEM_BRIDGE.Errors.Revoked",
            "A conexão deste mundo foi revogada. Inicie um novo pareamento.",
          )
        : localize(
            "ORDEM_BRIDGE.Errors.CredentialReplaced",
            "A credencial deste navegador foi substituída. Assuma a conexão novamente se necessário.",
          ),
    );
  } else {
    await game.settings.set(MODULE_ID, "lastConnectionError", message);
  }
  renderConnectionApplication();
  console.warn(`${MODULE_ID} | ${message}`);
}

async function renderConnectionApplication() {
  if (!connectionApplication?.rendered || renderingConnectionApplication) return;
  renderingConnectionApplication = true;
  const element = connectionApplication.element;
  const focused = element?.contains(document.activeElement) ? document.activeElement : null;
  const focusSelector = focused?.id
    ? `#${CSS.escape(focused.id)}`
    : focused?.dataset?.action
      ? `[data-action="${CSS.escape(focused.dataset.action)}"]`
      : null;
  const selection = focused instanceof HTMLInputElement
    ? { start: focused.selectionStart, end: focused.selectionEnd }
    : null;
  const technicalOpen = Boolean(element?.querySelector(".ordem-bridge-technical")?.open);
  try {
    await connectionApplication.render();
    const nextElement = connectionApplication.element;
    const technical = nextElement?.querySelector(".ordem-bridge-technical");
    if (technical instanceof HTMLDetailsElement) technical.open = technicalOpen;
    const nextFocused = focusSelector ? nextElement?.querySelector(focusSelector) : null;
    if (nextFocused instanceof HTMLElement) {
      nextFocused.focus({ preventScroll: true });
      if (selection && nextFocused instanceof HTMLInputElement) {
        nextFocused.setSelectionRange(selection.start, selection.end);
      }
    }
  } finally {
    renderingConnectionApplication = false;
  }
}

class BridgeRequestError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "BridgeRequestError";
    this.status = status;
    this.code = code;
  }
}
