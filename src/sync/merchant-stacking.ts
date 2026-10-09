import { MODULE_ID } from "../constants";
import { isPrimaryGameMaster } from "../gm";
import { formatLocalized } from "../i18n";
import { merchantActorId, merchantStackDuplicates } from "../settings";
import { isPortalItem, itemQuantity, portalCatalogItemId, stackKey, type ItemLike } from "./merchant-flags";

/** Atualização que soma `amount` ao item e o torna "colocado à mão". */
export function stackUpdate(target: FoundryItem, amount: number): Record<string, unknown> {
  const update: Record<string, unknown> = { _id: target.id, "system.quantity": itemQuantity(target) + amount };
  if (isPortalItem(target)) {
    update[`flags.${MODULE_ID}.generatedBy`] = null;
    update[`flags.${MODULE_ID}.drawId`] = null;
  }
  return update;
}

/**
 * Item já existente no Lojista onde um item novo deve somar. Prefere o colocado
 * à mão; sem ele, usa o do portal, que passa a ser "à mão".
 */
export function findStackTarget(actor: FoundryActor, incoming: ItemLike): FoundryItem | null {
  const key = stackKey(incoming);
  const matches = [...actor.items].filter((item) => stackKey(item) === key);
  return matches.find((item) => !isPortalItem(item)) ?? matches[0] ?? null;
}

/**
 * `preCreateItem`: arrastar ao Lojista um item que ele já tem soma à quantidade
 * em vez de criar uma cópia. Roda só no cliente do mestre que criou o item;
 * itens criados pelo próprio portal seguem o comando que os criou.
 */
export function stackOnCreate(item: FoundryItem, data: ItemLike, userId: string): boolean | void {
  const actor = item.parent;
  if (!actor || actor.id !== merchantActorId() || !merchantStackDuplicates()) return;
  if (userId !== game.user?.id || !game.user?.isGM) return;
  if (isPortalItem(data) || isPortalItem(item)) return;
  const target = findStackTarget(actor, { name: data.name ?? item.name, type: data.type ?? item.type });
  if (!target) return;
  const amount = Math.max(1, itemQuantity({ system: data.system ?? item.system ?? null }));
  void actor.updateEmbeddedDocuments("Item", [stackUpdate(target, amount)]).then(() =>
    ui.notifications.info(
      formatLocalized(
        "ORDEM_BRIDGE.Notifications.MerchantStacked",
        { name: String(target.name ?? ""), amount: String(amount) },
        `${String(target.name ?? "")}: +${amount} no estoque do Lojista.`,
      ),
    ),
  );
  return false;
}

/**
 * Junta cópias que já existiam no Lojista: mesmo tipo, mesmo nome e mesma
 * origem (portal ou à mão). Fica o item mais antigo, com a soma.
 */
export async function mergeMerchantDuplicates(actor: FoundryActor): Promise<number> {
  if (!merchantStackDuplicates() || !isPrimaryGameMaster()) return 0;
  const groups = new Map<string, FoundryItem[]>();
  for (const item of actor.items) {
    const key = `${isPortalItem(item) ? `portal:${portalCatalogItemId(item) ?? ""}` : "manual"}|${stackKey(item)}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const updates: Record<string, unknown>[] = [];
  const removed: string[] = [];
  for (const items of groups.values()) {
    if (items.length < 2) continue;
    const [keep, ...rest] = [...items].sort(
      (left, right) => (left._stats?.createdTime ?? 0) - (right._stats?.createdTime ?? 0),
    );
    updates.push({ _id: keep!.id, "system.quantity": items.reduce((total, item) => total + itemQuantity(item), 0) });
    removed.push(...rest.map((item) => item.id));
  }
  if (removed.length === 0) return 0;
  await actor.updateEmbeddedDocuments("Item", updates);
  await actor.deleteEmbeddedDocuments("Item", removed);
  return removed.length;
}
