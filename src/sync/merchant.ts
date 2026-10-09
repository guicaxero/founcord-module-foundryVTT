import { authenticatedRequest } from "../bridge/client";
import type { MerchantItemProjection, SyncResponse } from "../bridge/contracts";
import { MAX_MERCHANT_ITEMS } from "../constants";
import { handleOperationalError } from "../connection/operational-errors";
import {
  assertCredentialedGameMaster,
  assertGameMaster,
  assertPrimaryGameMaster,
  isCredentialedGameMaster,
} from "../gm";
import { localize } from "../i18n";
import { documentUpdatedAt, nullableLongText } from "../sanitize";
import { merchantActorId, merchantDefaultCoin, setSettings } from "../settings";
import { renderConnectionApplication } from "../ui/refresh";
import {
  MERCHANT_COINS,
  isMerchantCoin,
  merchantItemProjection,
  type MerchantCoin,
} from "./merchant-item";
import { mergeMerchantDuplicates } from "./merchant-stacking";
import { MAX_CATALOG_THUMBNAIL_CHARS, itemImage } from "./thumbnail";

let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<MerchantSyncResult> | null = null;

export type MerchantSyncResult = SyncResponse & Readonly<{ synchronizedMerchantItems: number }>;

export function scheduleMerchantSync(delay = 2_000): void {
  if (!isCredentialedGameMaster() || !merchantActorId()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncMerchantCatalog().catch(handleOperationalError);
  }, delay);
}

export function cancelMerchantSync(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

export function syncMerchantCatalog(): Promise<MerchantSyncResult> {
  inFlight ??= performMerchantSync().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function performMerchantSync(): Promise<MerchantSyncResult> {
  assertCredentialedGameMaster();
  const actorId = merchantActorId();
  const actor = actorId ? game.actors.get(actorId) : null;
  if (!actor) {
    throw new Error(
      actorId
        ? localize(
            "ORDEM_BRIDGE.Errors.MerchantMissing",
            "O ator escolhido como Lojista não existe mais. Selecione outro ator.",
          )
        : localize(
            "ORDEM_BRIDGE.Errors.MerchantRequired",
            "Selecione um ator antes de sincronizar o Lojista.",
          ),
    );
  }

  // Cópias do mesmo item viram uma linha só, com a soma; a exclusão agenda outra sincronização.
  if ((await mergeMerchantDuplicates(actor)) > 0) cancelMerchantSync();
  const capturedAt = new Date().toISOString();
  const items = await merchantItems([...(actor.items ?? [])].slice(0, MAX_MERCHANT_ITEMS));
  const response = await authenticatedRequest<SyncResponse>("/merchant/sync", {
    syncId: crypto.randomUUID(),
    capturedAt,
    catalog: {
      merchantActorId: String(actor.id).slice(0, 128),
      merchantName: String(actor.name ?? "").trim().slice(0, 160) || "Lojista",
      sourceUpdatedAt: documentUpdatedAt(actor),
      items,
    },
  });
  await setSettings({
    lastMerchantSyncAt: capturedAt,
    lastMerchantSyncCount: items.length,
    lastConnectionError: "",
  });
  void renderConnectionApplication();
  return { ...response, synchronizedMerchantItems: items.length };
}

export async function saveMerchantActor(actorId: string, defaultCoin?: MerchantCoin): Promise<void> {
  assertGameMaster();
  assertPrimaryGameMaster();
  const normalized = actorId.trim();
  if (defaultCoin !== undefined && !isMerchantCoin(defaultCoin)) {
    throw new Error(localize("ORDEM_BRIDGE.Errors.MerchantCoinInvalid", "Escolha uma moeda válida."));
  }
  if (normalized && !game.actors.get(normalized)) {
    throw new Error(
      localize(
        "ORDEM_BRIDGE.Errors.MerchantMissing",
        "O ator escolhido como Lojista não existe mais. Selecione outro ator.",
      ),
    );
  }
  await setSettings({
    merchantActorId: normalized,
    ...(defaultCoin ? { merchantDefaultCoin: defaultCoin } : {}),
    lastMerchantSyncAt: "",
    lastMerchantSyncCount: 0,
  });
  if (normalized && isCredentialedGameMaster()) await syncMerchantCatalog();
}

export type MerchantCoinOption = Readonly<{ value: MerchantCoin; label: string; selected: boolean }>;

/** Opções da moeda padrão, com o nome do livro na língua do mundo. */
export function merchantCoinOptions(): MerchantCoinOption[] {
  const selected = merchantDefaultCoin();
  const labels: Readonly<Record<MerchantCoin, [string, string]>> = {
    gc: ["ORDEM_BRIDGE.Merchant.CoinGc", "Coroas de ouro (gc)"],
    ss: ["ORDEM_BRIDGE.Merchant.CoinSs", "Xelins de prata (ss)"],
    cp: ["ORDEM_BRIDGE.Merchant.CoinCp", "Centavos de cobre (cp)"],
    bits: ["ORDEM_BRIDGE.Merchant.CoinBits", "Trocados (bits)"],
  };
  return MERCHANT_COINS.map((value) => ({
    value,
    label: localize(labels[value][0], labels[value][1]),
    selected: value === selected,
  }));
}

export type MerchantActorOption = Readonly<{ id: string; name: string; selected: boolean }>;

export function merchantActorOptions(): MerchantActorOption[] {
  const selectedId = merchantActorId();
  return [...(game.actors ?? [])]
    .map((actor) => ({
      id: actor.id,
      name: String(actor.name ?? "").trim() || "Ator sem nome",
      selected: actor.id === selectedId,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, game.i18n.lang));
}

/**
 * Projeta os itens com as miniaturas já geradas. As imagens entram até o
 * orçamento do catálogo; depois dele, os itens seguem sem ícone.
 */
export async function merchantItems(items: readonly FoundryItem[]): Promise<MerchantItemProjection[]> {
  const defaultCoin = merchantDefaultCoin();
  const images = await Promise.all(items.map((item) => itemImage(item.img)));
  let budget = MAX_CATALOG_THUMBNAIL_CHARS;
  return items.map((item, index) => {
    const image = images[index] ?? null;
    const imageUrl = image && image.length <= budget ? image : null;
    if (imageUrl) budget -= imageUrl.length;
    return merchantItemProjection(item, { defaultCoin, imageUrl, category: merchantItemCategory(item) });
  });
}

function merchantItemCategory(item: FoundryItem): string | null {
  const labelKey = CONFIG.Item?.typeLabels?.[item.type];
  return nullableLongText(labelKey ? game.i18n.localize(labelKey) : String(item.type ?? ""), 80);
}
