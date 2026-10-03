import type { CharacterNotesUpdatePayload, CommandResult } from "../bridge/contracts";
import { localize } from "../i18n";
import { textRevision } from "../sync/character-sheet";
import { scheduleCharacterSync } from "../sync/characters";
import { paragraphs } from "./creatures";

const MAX_TEXT = 8_000;
const ACTOR_ID = /^[A-Za-z0-9._-]{1,128}$/u;

function invalid(detail: string): Error {
  return new Error(
    `${localize("ORDEM_BRIDGE.Errors.NotesInvalid", "As anotações recebidas do portal são inválidas.")} (${detail})`,
  );
}

/** Confere o pedido antes de tocar no ator: só os campos e limites do contrato. */
export function validateNotesPayload(payload: CharacterNotesUpdatePayload): CharacterNotesUpdatePayload {
  if (typeof payload?.updateId !== "string" || !payload.updateId) throw invalid("updateId");
  if (typeof payload.actorId !== "string" || !ACTOR_ID.test(payload.actorId)) throw invalid("actorId");
  if (typeof payload.text !== "string" || payload.text.length > MAX_TEXT) throw invalid("text");
  if (typeof payload.revision !== "string" || !payload.revision || payload.revision.length > 64) {
    throw invalid("revision");
  }
  return payload;
}

/**
 * Grava as anotações do jogador na descrição do personagem. Se a descrição
 * mudou no Foundry desde a versão que o jogador viu, nada é gravado e o
 * portal recebe o conflito para o jogador recarregar a ficha.
 */
export async function updateCharacterNotes(input: CharacterNotesUpdatePayload): Promise<CommandResult> {
  const payload = validateNotesPayload(input);
  const actor = game.actors.get(payload.actorId);
  if (!actor || actor.type !== "character") {
    throw new Error(
      localize(
        "ORDEM_BRIDGE.Errors.NotesActorMissing",
        "O personagem vinculado não está disponível neste mundo.",
      ),
    );
  }
  const current = (actor.system as Readonly<{ description?: unknown }> | null | undefined)?.description;
  if (textRevision(current) !== payload.revision) {
    return { actorId: actor.id, applied: false, conflict: true };
  }
  await actor.update({ "system.description": paragraphs(payload.text) });
  scheduleCharacterSync(500);
  return { actorId: actor.id, applied: true, conflict: false };
}
