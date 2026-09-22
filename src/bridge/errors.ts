import { localize } from "../i18n";

export class BridgeRequestError extends Error {
  /** Geração da credencial usada na requisição; permite ignorar respostas obsoletas. */
  connectionGeneration: string | null = null;
  worldId: string | null = null;

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "BridgeRequestError";
  }
}

export function friendlyError(error: unknown): string {
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
