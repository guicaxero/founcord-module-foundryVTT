import { localize } from "../i18n";
import { bridgeUrl, connection } from "../settings";
import { BridgeRequestError } from "./errors";

type RequestOptions = Readonly<{
  token?: string | null;
  body?: unknown;
  method?: "POST" | "DELETE";
}>;

/** Única saída de rede do módulo: HTTPS para o Foundry Bridge. */
export async function bridgeRequest<T>(
  path: string,
  { token = null, body, method = "POST" }: RequestOptions = {},
): Promise<T> {
  const headers = new Headers({ "x-correlation-id": crypto.randomUUID() });
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("content-type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${bridgeUrl()}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
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
  const payload: unknown = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = (payload ?? {}) as { error?: unknown; message?: unknown };
    throw new BridgeRequestError(
      response.status,
      typeof error.error === "string" ? error.error : "bridge_request_failed",
      typeof error.message === "string"
        ? error.message
        : `Foundry Bridge respondeu ${response.status}.`,
    );
  }
  return payload as T;
}

/** Requisição autenticada com a credencial operacional do mundo conectado. */
export async function authenticatedRequest<T>(path: string, body: unknown): Promise<T> {
  const current = connection();
  if (!current.worldId || !current.accessToken) {
    throw new Error(
      localize("ORDEM_BRIDGE.Errors.NotConnected", "Este mundo ainda não está conectado."),
    );
  }
  try {
    return await bridgeRequest<T>(`/v1/worlds/${current.worldId}${path}`, {
      token: current.accessToken,
      body,
    });
  } catch (error) {
    if (error instanceof BridgeRequestError) {
      error.connectionGeneration = current.connectionGeneration;
      error.worldId = current.worldId;
    }
    throw error;
  }
}
