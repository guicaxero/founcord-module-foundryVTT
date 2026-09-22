import { authenticatedRequest } from "../bridge/client";
import type { BridgeCommand, CommandPollResponse, CommandResult } from "../bridge/contracts";
import {
  DEFAULT_POLL_INTERVAL_MS,
  MAX_BACKOFF_MS,
  MAX_COMMAND_POLL_MS,
  MIN_COMMAND_POLL_MS,
} from "../constants";
import { handleOperationalError } from "../connection/operational-errors";
import { isCredentialedGameMaster } from "../gm";
import { connection } from "../settings";
import { executeCommand } from "./handlers";

let active = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let polling = false;
let failures = 0;
let idleDelay = MIN_COMMAND_POLL_MS;

/**
 * Próximo intervalo do poll: volta ao mínimo quando chegaram comandos e dobra a
 * cada ciclo vazio até o máximo. Assim um mundo ocioso faz ~120 polls por hora
 * em vez de 720, e um pedido novo ainda chega ao mestre em até 30 segundos.
 */
export function nextIdleDelay(previousDelay: number, receivedCommands: number): number {
  if (receivedCommands > 0) return MIN_COMMAND_POLL_MS;
  return Math.min(MAX_COMMAND_POLL_MS, Math.max(MIN_COMMAND_POLL_MS, previousDelay * 2));
}

/** Backoff de falhas de rede: 10s, 20s, 40s e no máximo 60s. */
export function failureDelay(consecutiveFailures: number): number {
  return Math.min(
    MAX_BACKOFF_MS,
    DEFAULT_POLL_INTERVAL_MS * 2 ** Math.min(consecutiveFailures, 4),
  );
}

export function startCommandPolling(): void {
  if (active) return;
  active = true;
  idleDelay = MIN_COMMAND_POLL_MS;
  schedule(0);
}

export function stopCommandPolling(): void {
  active = false;
  if (timer) clearTimeout(timer);
  timer = null;
  polling = false;
}

function schedule(delay: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void pollCommands();
  }, delay);
}

async function pollCommands(): Promise<void> {
  if (polling || !isCredentialedGameMaster()) return;
  polling = true;
  let delay: number;
  try {
    const response = await authenticatedRequest<CommandPollResponse>("/commands/poll", {
      limit: 10,
    });
    const commands = response.commands ?? [];
    for (const command of commands) await executeAndAcknowledge(command);
    failures = 0;
    idleDelay = nextIdleDelay(idleDelay, commands.length);
    delay = idleDelay;
  } catch (error) {
    failures += 1;
    await handleOperationalError(error);
    delay = failureDelay(failures);
  } finally {
    polling = false;
  }
  if (active && connection().accessToken) schedule(delay);
}

async function executeAndAcknowledge(command: BridgeCommand): Promise<void> {
  let outcome: "succeeded" | "failed" = "succeeded";
  let result: CommandResult = {};
  let errorMessage: string | null = null;
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
