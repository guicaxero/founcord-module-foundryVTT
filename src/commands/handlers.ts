import type { BridgeCommand, CommandResult, MerchantPurchasePayload } from "../bridge/contracts";
import { localize } from "../i18n";
import { nullableLongText, nullableQuantity } from "../sanitize";
import { merchantActorId, merchantDefaultCoin } from "../settings";
import { syncCharacters } from "../sync/characters";
import { merchantPrice } from "../sync/merchant-item";
import { grantCharacterItems } from "./character-items";
import { updateCharacterNotes } from "./character-notes";
import { upsertCreature } from "./creatures";
import { patchMerchantStock, replaceMerchantStock } from "./merchant-stock";

/**
 * Executa somente os tipos de comando do contrato. Nenhum código ou macro
 * recebido do portal é executado.
 */
export async function executeCommand(command: BridgeCommand): Promise<CommandResult> {
  switch (command.type) {
    case "actor.sync.request": {
      const response = await syncCharacters();
      return { synchronizedCharacters: response.synchronizedCharacters };
    }
    case "chat.message.create": {
      const { content, speakerActorId, whisperUserIds } = command.payload;
      const actor = speakerActorId ? game.actors.get(speakerActorId) : null;
      if (speakerActorId && !actor) {
        throw new Error("O personagem indicado como autor não existe neste mundo.");
      }
      const message = await ChatMessage.create({
        content: foundry.utils.escapeHTML(content).replaceAll("\n", "<br>"),
        speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: "Ordem da Última Luz" },
        whisper: whisperUserIds,
      });
      return { messageId: message.id };
    }
    case "merchant.purchase.request":
      return createMerchantPurchaseNotification(command.payload);
    case "merchant.stock.replace":
      return replaceMerchantStock(command.payload);
    case "merchant.stock.patch":
      return patchMerchantStock(command.payload);
    case "creature.upsert":
      return upsertCreature(command.payload);
    case "character.notes.update":
      return updateCharacterNotes(command.payload);
    case "character.items.grant":
      return grantCharacterItems(command.payload);
    default: {
      const unsupported: never = command;
      throw new Error(
        `Tipo de comando não suportado: ${String((unsupported as { type?: unknown }).type)}`,
      );
    }
  }
}

/**
 * Revalida Lojista, personagem, item, preço e estoque no mundo e avisa os
 * mestres por sussurro. Nenhuma moeda, item ou quantidade é alterada.
 */
async function createMerchantPurchaseNotification(
  payload: MerchantPurchasePayload,
): Promise<CommandResult> {
  const merchant = game.actors.get(payload.merchantActorId);
  if (!merchant || merchant.id !== merchantActorId()) {
    throw new Error(
      localize(
        "ORDEM_BRIDGE.Errors.PurchaseMerchantChanged",
        "O Lojista configurado mudou. Atualize o catálogo antes de reenviar o pedido.",
      ),
    );
  }
  const buyer = game.actors.get(payload.buyer.actorId);
  if (!buyer || buyer.type !== "character") {
    throw new Error(
      localize(
        "ORDEM_BRIDGE.Errors.PurchaseBuyerMissing",
        "O personagem vinculado ao pedido não está disponível neste mundo.",
      ),
    );
  }
  const item = merchant.items?.get(payload.item.itemId);
  if (!item) {
    throw new Error(
      localize(
        "ORDEM_BRIDGE.Errors.PurchaseItemMissing",
        "O item solicitado não está mais no estoque do Lojista.",
      ),
    );
  }
  // O catálogo envia o preço com a moeda padrão (`22` vira `22 cp`); pedidos
  // feitos antes dessa normalização ainda trazem o texto original.
  const recordedPrice = nullableLongText(item.system?.value, 64);
  const observedPrice = merchantPrice(item.system?.value, merchantDefaultCoin());
  const observedQuantity = nullableQuantity(item.system?.quantity);
  if (!observedPrice || (observedPrice !== payload.item.price && recordedPrice !== payload.item.price)) {
    throw new Error(
      localize(
        "ORDEM_BRIDGE.Errors.PurchasePriceChanged",
        "O preço do item mudou. Sincronize o catálogo e peça ao jogador para revisar o pedido.",
      ),
    );
  }
  if (observedQuantity === null || observedQuantity < payload.item.quantity) {
    throw new Error(
      localize(
        "ORDEM_BRIDGE.Errors.PurchaseStockChanged",
        "O estoque atual não atende à quantidade solicitada.",
      ),
    );
  }
  const gmUserIds = [...game.users].filter((user) => user.isGM).map((user) => user.id);
  if (gmUserIds.length === 0) {
    throw new Error(
      localize(
        "ORDEM_BRIDGE.Errors.PurchaseNoGm",
        "Nenhum usuário mestre está disponível para receber a solicitação.",
      ),
    );
  }

  const message = await ChatMessage.create({
    content: merchantPurchaseMessage(payload, observedPrice, observedQuantity),
    speaker: ChatMessage.getSpeaker({ actor: merchant }),
    whisper: gmUserIds,
  });
  return {
    messageId: message.id,
    observedPrice,
    observedQuantity,
    notifiedGameMasters: gmUserIds.length,
  };
}

export function merchantPurchaseMessage(
  payload: MerchantPurchasePayload,
  observedPrice: string,
  observedQuantity: number,
): string {
  const escape = (value: unknown) => foundry.utils.escapeHTML(String(value ?? ""));
  const note = payload.note
    ? `<div class="ordem-purchase-note"><strong>${escape(localize("ORDEM_BRIDGE.Purchase.Note", "Observação do jogador"))}</strong><p>${escape(payload.note).replaceAll("\n", "<br>")}</p></div>`
    : "";
  return `<section class="ordem-purchase-request">
    <header>
      <span>${escape(localize("ORDEM_BRIDGE.Purchase.State", "Precisa de ação"))}</span>
      <h2>${escape(localize("ORDEM_BRIDGE.Purchase.Title", "Solicitação de compra"))}</h2>
    </header>
    <p>${escape(payload.buyer.displayName)} ${escape(localize("ORDEM_BRIDGE.Purchase.RequestedFor", "solicitou para"))} <strong>${escape(payload.buyer.actorName)}</strong>.</p>
    <dl>
      <div><dt>${escape(localize("ORDEM_BRIDGE.Purchase.Item", "Item"))}</dt><dd>${escape(payload.item.name)}</dd></div>
      <div><dt>${escape(localize("ORDEM_BRIDGE.Purchase.Quantity", "Quantidade"))}</dt><dd>${escape(payload.item.quantity)}</dd></div>
      <div><dt>${escape(localize("ORDEM_BRIDGE.Purchase.Price", "Preço registrado"))}</dt><dd>${escape(observedPrice)}</dd></div>
      <div><dt>${escape(localize("ORDEM_BRIDGE.Purchase.Stock", "Estoque observado"))}</dt><dd>${escape(observedQuantity)}</dd></div>
    </dl>
    ${note}
    <p class="ordem-purchase-warning"><strong>${escape(localize("ORDEM_BRIDGE.Purchase.NoMutationTitle", "Nenhuma alteração automática"))}</strong><br>${escape(localize("ORDEM_BRIDGE.Purchase.NoMutation", "Moedas, itens e estoque permanecem como estavam. Faça o acerto no Foundry e registre a decisão no portal."))}</p>
  </section>`;
}
