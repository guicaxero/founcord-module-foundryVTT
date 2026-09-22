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
import {
  documentUpdatedAt,
  nullableLongText,
  nullableQuantity,
  publicHttpsUrl,
  sanitizedPlainText,
} from "../sanitize";
import { merchantActorId, setSettings } from "../settings";
import { renderConnectionApplication } from "../ui/refresh";

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
            "O ator escolhido como Mercador não existe mais. Selecione outro ator.",
          )
        : localize(
            "ORDEM_BRIDGE.Errors.MerchantRequired",
            "Selecione um ator antes de sincronizar o Mercador.",
          ),
    );
  }

  const capturedAt = new Date().toISOString();
  const items = [...(actor.items ?? [])].slice(0, MAX_MERCHANT_ITEMS).map(merchantItemProjection);
  const response = await authenticatedRequest<SyncResponse>("/merchant/sync", {
    syncId: crypto.randomUUID(),
    capturedAt,
    catalog: {
      merchantActorId: String(actor.id).slice(0, 128),
      merchantName: String(actor.name ?? "").trim().slice(0, 160) || "Mercador",
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

export async function saveMerchantActor(actorId: string): Promise<void> {
  assertGameMaster();
  assertPrimaryGameMaster();
  const normalized = actorId.trim();
  if (normalized && !game.actors.get(normalized)) {
    throw new Error(
      localize(
        "ORDEM_BRIDGE.Errors.MerchantMissing",
        "O ator escolhido como Mercador não existe mais. Selecione outro ator.",
      ),
    );
  }
  await setSettings({
    merchantActorId: normalized,
    lastMerchantSyncAt: "",
    lastMerchantSyncCount: 0,
  });
  if (normalized && isCredentialedGameMaster()) await syncMerchantCatalog();
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

/** Projeção pública do item: texto sanitizado, preço como registrado e imagem só se HTTPS. */
export function merchantItemProjection(item: FoundryItem): MerchantItemProjection {
  return {
    itemId: String(item.id).slice(0, 128),
    name: String(item.name ?? "").trim().slice(0, 160) || "Item sem nome",
    description: sanitizedPlainText(item.system?.description, 4_000),
    category: merchantItemCategory(item),
    imageUrl: publicHttpsUrl(item.img),
    price: nullableLongText(item.system?.value, 64),
    quantity: nullableQuantity(item.system?.quantity),
    sourceUpdatedAt: documentUpdatedAt(item),
  };
}

function merchantItemCategory(item: FoundryItem): string | null {
  const labelKey = CONFIG.Item?.typeLabels?.[item.type];
  return nullableLongText(labelKey ? game.i18n.localize(labelKey) : String(item.type ?? ""), 80);
}
