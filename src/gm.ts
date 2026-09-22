import { localize } from "./i18n";
import { connection } from "./settings";

/** Mestre principal segundo o Foundry, ou o mestre ativo de menor ID. */
export function primaryGameMaster(): FoundryUser | null {
  const foundryPrimary = game.users?.activeGM;
  if (foundryPrimary) return foundryPrimary;
  return (
    [...(game.users ?? [])]
      .filter((user) => user.active && user.isGM)
      .sort((left, right) => String(left.id).localeCompare(String(right.id)))[0] ?? null
  );
}

export function isPrimaryGameMaster(): boolean {
  return Boolean(game.user?.isGM && primaryGameMaster()?.id === game.user.id);
}

/**
 * Só o mestre principal que possui a credencial atual mantém a conexão.
 * Sem esse mestre online, o mundo aparece offline e nenhuma requisição é feita.
 */
export function isCredentialedGameMaster(): boolean {
  const current = connection();
  return Boolean(
    game.user?.isGM &&
      current.accessToken &&
      current.connectionGeneration &&
      current.connectionGeneration === current.accessTokenGeneration &&
      primaryGameMaster()?.id === game.user.id,
  );
}

export function assertGameMaster(): void {
  if (!game.user?.isGM) {
    throw new Error(
      localize(
        "ORDEM_BRIDGE.Errors.GameMasterOnly",
        "Apenas um mestre pode operar a conexão deste mundo.",
      ),
    );
  }
}

export function assertPrimaryGameMaster(): void {
  if (!isPrimaryGameMaster()) {
    throw new Error(
      localize(
        "ORDEM_BRIDGE.Errors.PrimaryGmOnly",
        "Somente o mestre ativo principal pode operar a conexão deste mundo.",
      ),
    );
  }
}

export function assertCredentialedGameMaster(): void {
  assertGameMaster();
  if (!isCredentialedGameMaster()) {
    throw new Error(
      localize(
        "ORDEM_BRIDGE.Errors.PrimaryGmOnly",
        "Somente o mestre conector ativo pode sincronizar este mundo.",
      ),
    );
  }
}
