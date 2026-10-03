import type { CharacterItemsGrantPayload, CommandResult } from "../bridge/contracts";
import { MODULE_ID } from "../constants";
import { localize } from "../i18n";
import { scheduleCharacterSync } from "../sync/characters";
import { catalogItemData, validateCatalogEntries } from "./merchant-stock";

/** Marca dos itens entregues pela Vida na Sede no personagem. */
export const GRANT_MARK = "sede-grant";

const MAX_ITEMS = 20;
const ACTOR_ID = /^[A-Za-z0-9._-]{1,128}$/u;

function invalid(detail: string): Error {
  return new Error(
    `${localize("ORDEM_BRIDGE.Errors.GrantInvalid", "Os itens recebidos do portal são inválidos.")} (${detail})`,
  );
}

/**
 * Entrega no personagem os itens escolhidos com o Lojista na Vida na Sede.
 * Cada item leva a marca da atividade (`grantId`): reenviar a mesma entrega
 * não duplica nada.
 */
export async function grantCharacterItems(payload: CharacterItemsGrantPayload): Promise<CommandResult> {
  if (typeof payload?.grantId !== "string" || !payload.grantId) throw invalid("grantId");
  if (typeof payload.actorId !== "string" || !ACTOR_ID.test(payload.actorId)) throw invalid("actorId");
  let items: ReturnType<typeof validateCatalogEntries>;
  try {
    items = validateCatalogEntries(payload.items, MAX_ITEMS, invalid);
  } catch (error) {
    const detail = error instanceof Error ? /\(([^)]+)\)$/u.exec(error.message)?.[1] ?? "items" : "items";
    throw invalid(detail);
  }

  const actor = game.actors.get(payload.actorId);
  if (!actor || actor.type !== "character") {
    throw new Error(
      localize("ORDEM_BRIDGE.Errors.NotesActorMissing", "O personagem vinculado não está disponível neste mundo."),
    );
  }
  const already = [...actor.items].some((item) => {
    const flags = item.flags?.[MODULE_ID] as Readonly<{ generatedBy?: unknown; grantId?: unknown }> | undefined;
    return flags?.generatedBy === GRANT_MARK && flags.grantId === payload.grantId;
  });
  if (already) return { actorId: actor.id, created: 0, alreadyApplied: true };

  const created = await actor.createEmbeddedDocuments(
    "Item",
    items.map((entry) =>
      catalogItemData(entry, { generatedBy: GRANT_MARK, grantId: payload.grantId, catalogItemId: entry.catalogItemId }),
    ),
  );
  scheduleCharacterSync(500);
  return { actorId: actor.id, created: created.length, alreadyApplied: false };
}
