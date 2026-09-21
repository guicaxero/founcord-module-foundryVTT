/**
 * Espelho tipado dos contratos do Foundry Bridge definidos em
 * `guicaxero/founcord` (`packages/contracts/src/foundry.ts` e `merchant.ts`).
 * Mudanças aqui exigem PR correspondente e retrocompatível no portal.
 */

export type WorldIdentity = Readonly<{
  worldInstanceId: string;
  foundryWorldId: string;
  worldTitle: string;
  systemId: string;
  foundryVersion: string;
  systemVersion: string;
  moduleVersion: string;
}>;

export type PairingCreateResponse = Readonly<{
  pairingId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresAt: string;
  pollIntervalSeconds: number;
}>;

export type PairingPollResponse =
  | Readonly<{ status: "pending"; expiresAt: string; pollIntervalSeconds: number }>
  | Readonly<{
      status: "authorized";
      worldId: string;
      campaignId: string;
      campaignName: string;
      accessToken: string;
      heartbeatIntervalSeconds: number;
      pollIntervalSeconds: number;
    }>;

export type HeartbeatRequest = Readonly<{
  observedAt: string;
  activeUsers: number;
  actorCount: number;
}>;

export type HeartbeatResponse = Readonly<{
  status: "online";
  serverTime: string;
  nextHeartbeatSeconds: number;
}>;

export type CoinPurse = Readonly<{
  gc: number;
  ss: number;
  cp: number;
  bits: number;
}>;

export type CharacterProjection = Readonly<{
  actorId: string;
  name: string;
  type: "character";
  ownerUserIds: readonly string[];
  level: number;
  ancestry: string | null;
  paths: Readonly<{
    novice: string | null;
    expert: string | null;
    master: string | null;
    legendary: string | null;
  }>;
  statistics: Readonly<{
    healthMax: number;
    damage: number;
    healingRate: number;
    insanity: number;
    corruption: number;
  }>;
  /** Saldo em `system.wealth`; aceito pelo portal a partir do contrato com moedas. */
  wealth: CoinPurse;
  sourceUpdatedAt: string;
}>;

export type SyncResponse = Readonly<{
  syncId: string;
  accepted: number;
  duplicate: boolean;
  stale: boolean;
}>;

export type MerchantItemProjection = Readonly<{
  itemId: string;
  name: string;
  description: string | null;
  category: string | null;
  imageUrl: string | null;
  price: string | null;
  quantity: number | null;
  sourceUpdatedAt: string;
}>;

export type ChatEntry = Readonly<{
  messageId: string;
  createdAt: string;
  authorUserId: string | null;
  authorName: string;
  speakerActorId: string | null;
  speakerName: string | null;
  content: string;
  kind: "message" | "roll";
}>;

export type MerchantPurchasePayload = Readonly<{
  requestId: string;
  campaignId: string;
  merchantActorId: string;
  buyer: Readonly<{
    userId: string;
    displayName: string;
    actorId: string;
    actorName: string;
  }>;
  item: Readonly<{
    itemId: string;
    name: string;
    price: string;
    quantity: number;
  }>;
  note: string | null;
  requestedAt: string;
}>;

type CommandEnvelope = Readonly<{
  id: string;
  deliveryToken: string;
  createdAt: string;
  expiresAt: string | null;
}>;

export type BridgeCommand = CommandEnvelope &
  (
    | Readonly<{ type: "actor.sync.request"; payload: Readonly<Record<string, never>> }>
    | Readonly<{
        type: "chat.message.create";
        payload: Readonly<{
          content: string;
          speakerActorId: string | null;
          whisperUserIds: readonly string[];
        }>;
      }>
    | Readonly<{ type: "merchant.purchase.request"; payload: MerchantPurchasePayload }>
  );

export type CommandPollResponse = Readonly<{ commands?: readonly BridgeCommand[] }>;

export type CommandResultValue = string | number | boolean | null;
export type CommandResult = Readonly<Record<string, CommandResultValue>>;
