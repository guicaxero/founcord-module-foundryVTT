import { BridgeRequestError, friendlyError } from "../bridge/errors";
import { MODULE_ID } from "../constants";
import { localize } from "../i18n";
import { connection, setSetting } from "../settings";
import { renderConnectionApplication } from "../ui/refresh";
import { clearLocalCredential } from "./credentials";
import { stopBridge } from "./lifecycle";

/**
 * Trata falhas das operações em segundo plano. Respostas de uma credencial
 * anterior são ignoradas; credencial revogada ou substituída encerra a conexão
 * deste navegador.
 */
export async function handleOperationalError(error: unknown): Promise<void> {
  if (error instanceof BridgeRequestError && error.connectionGeneration) {
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
    await clearLocalCredential(error.connectionGeneration);
    const reason =
      error.code === "world_revoked"
        ? localize(
            "ORDEM_BRIDGE.Errors.Revoked",
            "A conexão deste mundo foi revogada. Inicie um novo pareamento.",
          )
        : localize(
            "ORDEM_BRIDGE.Errors.CredentialReplaced",
            "A credencial deste navegador foi substituída. Assuma a conexão novamente se necessário.",
          );
    await setSetting("lastConnectionError", reason);
    ui.notifications.error(reason);
  } else {
    await setSetting("lastConnectionError", message);
  }
  void renderConnectionApplication();
  console.warn(`${MODULE_ID} | ${message}`);
}
