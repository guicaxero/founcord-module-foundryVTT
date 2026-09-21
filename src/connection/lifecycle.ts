import { cancelChatFlush, scheduleChatFlush } from "../capture/chat";
import { startCommandPolling, stopCommandPolling } from "../commands/poller";
import { isCredentialedGameMaster } from "../gm";
import { cancelCharacterSync, scheduleCharacterSync } from "../sync/characters";
import { cancelMerchantSync, scheduleMerchantSync } from "../sync/merchant";
import { startHeartbeat, stopHeartbeat } from "./heartbeat";

let running = false;

/**
 * Liga as rotinas de conexão. Só roda no navegador do mestre conector: sem ele
 * online o mundo fica offline e nenhuma requisição é feita. É idempotente —
 * eventos frequentes (`updateUser`, `updateSetting`) não disparam novas
 * sincronizações enquanto a conexão já está ativa; alterações reais de atores e
 * itens continuam agendando sincronizações pelos hooks próprios.
 */
export function startBridge(): void {
  if (running || !isCredentialedGameMaster()) return;
  running = true;
  startHeartbeat();
  startCommandPolling();
  scheduleCharacterSync(500);
  scheduleMerchantSync(750);
  scheduleChatFlush(500);
}

export function stopBridge(): void {
  running = false;
  stopHeartbeat();
  stopCommandPolling();
  cancelCharacterSync();
  cancelMerchantSync();
  cancelChatFlush();
}
