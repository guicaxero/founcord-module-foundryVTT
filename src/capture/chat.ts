import { authenticatedRequest } from "../bridge/client";
import type { ChatEntry } from "../bridge/contracts";
import {
  CHAT_BATCH_SIZE,
  DEFAULT_POLL_INTERVAL_MS,
  MAX_BACKOFF_MS,
  MAX_PENDING_CHAT_EVENTS,
} from "../constants";
import { handleOperationalError } from "../connection/operational-errors";
import { isCredentialedGameMaster } from "../gm";
import { htmlToPlainText, nullableIdentifier, nullableText } from "../sanitize";
import { getSetting, setSetting } from "../settings";

let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let failures = 0;
/** Serializa as escritas na fila persistida para não perder eventos concorrentes. */
let queueOperation: Promise<void> = Promise.resolve();

/** Sussurros e rolagens cegas nunca são capturados. */
export function isPublicChatMessage(message: FoundryChatMessage): boolean {
  const whisperRecipients = Array.isArray(message.whisper) ? message.whisper : [];
  return !message.blind && whisperRecipients.length === 0;
}

export function chatMessageProjection(message: FoundryChatMessage): ChatEntry | null {
  const content = sanitizedChatContent(message);
  if (!message.id || !content) return null;
  const author =
    message.author ??
    (typeof message.user === "string" ? game.users.get(message.user) : message.user) ??
    null;
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

/** Texto simples da mensagem mais um resumo das rolagens (`fórmula = total`). */
export function sanitizedChatContent(message: FoundryChatMessage): string {
  const visibleText = htmlToPlainText(message.content);
  const rollSummary = Array.isArray(message.rolls)
    ? message.rolls
        .map((roll) => {
          const formula = String(roll?.formula ?? "").trim();
          const total = Number(roll?.total);
          return formula && Number.isFinite(total) ? `${formula} = ${total}` : null;
        })
        .filter((summary): summary is string => Boolean(summary))
        .join("; ")
    : "";
  return [visibleText, rollSummary ? `Rolagem: ${rollSummary}` : ""]
    .filter(Boolean)
    .join("\n")
    .slice(0, 4_000)
    .trim();
}

export async function enqueueChatEvent(event: ChatEntry): Promise<void> {
  await updateChatQueue((pending) => {
    if (pending.some((candidate) => candidate.messageId === event.messageId)) return pending;
    return [...pending, event].slice(-MAX_PENDING_CHAT_EVENTS);
  });
  scheduleChatFlush(250);
}

export function scheduleChatFlush(delay: number): void {
  if (!isCredentialedGameMaster()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flushChatEvents();
  }, delay);
}

export function cancelChatFlush(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

function flushChatEvents(): Promise<void> {
  if (!isCredentialedGameMaster()) return inFlight ?? Promise.resolve();
  inFlight ??= performChatFlush().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function performChatFlush(): Promise<void> {
  await queueOperation;
  const pending = pendingChatEvents();
  if (pending.length === 0) return;
  const batch = pending.slice(0, CHAT_BATCH_SIZE);
  try {
    // Fora de uma sessão iniciada no portal o Bridge descarta o lote; a fila é limpa mesmo assim.
    await authenticatedRequest("/chat/batches", {
      batchId: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
      messages: batch,
    });
    const sentIds = new Set(batch.map((event) => event.messageId));
    await updateChatQueue((current) => current.filter((event) => !sentIds.has(event.messageId)));
    failures = 0;
    if (pendingChatEvents().length > 0) scheduleChatFlush(100);
  } catch (error) {
    failures += 1;
    await handleOperationalError(error);
    scheduleChatFlush(
      Math.min(MAX_BACKOFF_MS, DEFAULT_POLL_INTERVAL_MS * 2 ** Math.min(failures, 4)),
    );
  }
}

function pendingChatEvents(): readonly ChatEntry[] {
  const stored = getSetting("pendingChatEvents");
  return Array.isArray(stored) ? stored : [];
}

function updateChatQueue(
  updater: (pending: readonly ChatEntry[]) => readonly ChatEntry[],
): Promise<void> {
  queueOperation = queueOperation
    .catch(() => undefined)
    .then(() => setSetting("pendingChatEvents", updater(pendingChatEvents())));
  return queueOperation;
}
