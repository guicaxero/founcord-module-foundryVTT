import { friendlyError } from "../bridge/errors";
import { MODULE_ID } from "../constants";
import {
  cancelPairing,
  disconnect,
  saveBridgeUrl,
  schedulePairingPoll,
  startPairing,
} from "../connection/pairing";
import { formatLocalized, localize } from "../i18n";
import { bridgeUrl, connection, pairing } from "../settings";
import { syncCharacters } from "../sync/characters";
import { merchantActorOptions, saveMerchantActor, syncMerchantCatalog } from "../sync/merchant";
import { isActiveConnectionApplication, setActiveConnectionApplication } from "./refresh";
import { publicStatus } from "./status";

type BusyAction =
  | "connect"
  | "cancel"
  | "sync"
  | "merchant-save"
  | "merchant-sync"
  | "disconnect"
  | "save-url";

type Feedback = Readonly<{ type: "success" | "error"; message: string }>;

const { ApplicationV2, DialogV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Tela "Gerenciar conexão": pareamento, sincronização, Mercador e diagnóstico. */
export class BridgeConnectionApplication extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ordem-foundry-connection",
    classes: ["ordem-bridge-window"],
    window: {
      title: "ORDEM_BRIDGE.App.Title",
      icon: "fa-solid fa-fire-flame-curved",
      resizable: true,
    },
    position: { width: 720, height: "auto" },
    actions: {
      connect: BridgeConnectionApplication.connect,
      copyCode: BridgeConnectionApplication.copyCode,
      openPortal: BridgeConnectionApplication.openPortal,
      cancelPairing: BridgeConnectionApplication.cancelPairing,
      syncNow: BridgeConnectionApplication.syncNow,
      saveMerchant: BridgeConnectionApplication.saveMerchant,
      syncMerchant: BridgeConnectionApplication.syncMerchant,
      disconnect: BridgeConnectionApplication.disconnect,
      saveBridgeUrl: BridgeConnectionApplication.saveBridgeUrl,
      retry: BridgeConnectionApplication.retry,
    },
  };

  static PARTS = {
    main: { template: `modules/${MODULE_ID}/templates/connection.hbs` },
  };

  private busyAction: BusyAction | null = null;
  private feedback: Feedback | null = null;

  protected override async _prepareContext(options: unknown): Promise<Record<string, unknown>> {
    const context = await super._prepareContext(options);
    const status = publicStatus();
    return {
      ...context,
      ...status,
      busy: Boolean(this.busyAction),
      connecting: this.busyAction === "connect",
      cancelling: this.busyAction === "cancel",
      syncing: this.busyAction === "sync",
      savingMerchant: this.busyAction === "merchant-save",
      syncingMerchant: this.busyAction === "merchant-sync",
      disconnecting: this.busyAction === "disconnect",
      savingUrl: this.busyAction === "save-url",
      feedback: this.feedback,
      feedbackIsError: this.feedback?.type === "error",
      bridgeUrlLocked: status.connected || status.pendingPairing,
      moduleVersion: game.modules.get(MODULE_ID)?.version ?? "",
      foundryVersion: game.version,
      systemVersion: game.system.version,
      systemTitle: game.system.title,
      bridgeUrl: bridgeUrl(),
      merchantActors: merchantActorOptions(),
    };
  }

  protected override async _onFirstRender(context: unknown, options: unknown): Promise<void> {
    await super._onFirstRender(context, options);
    // A tela ativa é atualizada pelos eventos da conexão em segundo plano.
    setActiveConnectionApplication(this);
  }

  protected override async _onClose(options: unknown): Promise<void> {
    if (isActiveConnectionApplication(this)) setActiveConnectionApplication(null);
    await super._onClose(options);
  }

  private async runOperation(
    action: BusyAction,
    operation: () => Promise<unknown>,
    successMessage: string | null = null,
  ): Promise<void> {
    if (this.busyAction) return;
    this.busyAction = action;
    this.feedback = null;
    await this.render();
    try {
      await operation();
      if (successMessage) this.feedback = { type: "success", message: successMessage };
    } catch (error) {
      const message = friendlyError(error);
      this.feedback = { type: "error", message };
      ui.notifications.error(message);
    } finally {
      this.busyAction = null;
      await this.render();
    }
  }

  static async connect(this: BridgeConnectionApplication): Promise<void> {
    await this.runOperation("connect", startPairing);
  }

  static async copyCode(this: BridgeConnectionApplication): Promise<void> {
    const code = pairing().userCode;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      this.feedback = {
        type: "success",
        message: localize("ORDEM_BRIDGE.Feedback.CodeCopied", "Código copiado."),
      };
    } catch {
      this.feedback = {
        type: "error",
        message: localize(
          "ORDEM_BRIDGE.Feedback.CopyFailed",
          "Não foi possível copiar automaticamente. Selecione o código e copie manualmente.",
        ),
      };
    }
    await this.render();
  }

  static async openPortal(): Promise<void> {
    const url = pairing().verificationUrl;
    if (url) globalThis.open(url, "_blank", "noopener,noreferrer");
  }

  static async cancelPairing(this: BridgeConnectionApplication): Promise<void> {
    await this.runOperation(
      "cancel",
      cancelPairing,
      localize("ORDEM_BRIDGE.Feedback.PairingCancelled", "Solicitação cancelada."),
    );
  }

  static async syncNow(this: BridgeConnectionApplication): Promise<void> {
    await this.runOperation(
      "sync",
      syncCharacters,
      localize("ORDEM_BRIDGE.Feedback.SyncComplete", "Personagens sincronizados com o portal."),
    );
  }

  static async saveMerchant(this: BridgeConnectionApplication): Promise<void> {
    const select = this.element.querySelector("[name='merchantActorId']");
    const actorId = select instanceof HTMLSelectElement ? select.value : "";
    await this.runOperation(
      "merchant-save",
      () => saveMerchantActor(actorId),
      actorId
        ? localize(
            "ORDEM_BRIDGE.Feedback.MerchantSaved",
            "Mercador selecionado. O primeiro catálogo será sincronizado agora.",
          )
        : localize("ORDEM_BRIDGE.Feedback.MerchantCleared", "Seleção do Mercador removida."),
    );
  }

  static async syncMerchant(this: BridgeConnectionApplication): Promise<void> {
    await this.runOperation(
      "merchant-sync",
      syncMerchantCatalog,
      localize(
        "ORDEM_BRIDGE.Feedback.MerchantSyncComplete",
        "Catálogo do Mercador sincronizado com o portal.",
      ),
    );
  }

  static async disconnect(this: BridgeConnectionApplication): Promise<void> {
    const campaignName =
      connection().campaignName ||
      localize("ORDEM_BRIDGE.Common.LinkedCampaign", "a campanha vinculada");
    const confirmed = await DialogV2.confirm({
      window: { title: localize("ORDEM_BRIDGE.Disconnect.Title", "Desconectar este mundo") },
      content: `<p>${foundry.utils.escapeHTML(
        formatLocalized(
          "ORDEM_BRIDGE.Disconnect.Body",
          { campaignName },
          `O portal deixará de receber presença, personagens e comandos deste mundo em ${campaignName}. Nenhum personagem será apagado.`,
        ),
      )}</p>`,
      yes: {
        label: localize("ORDEM_BRIDGE.Actions.Disconnect", "Desconectar mundo"),
        icon: "fa-solid fa-link-slash",
      },
      no: { label: localize("ORDEM_BRIDGE.Actions.KeepConnection", "Manter conexão") },
      modal: true,
      rejectClose: false,
    });
    if (!confirmed) return;
    await this.runOperation(
      "disconnect",
      disconnect,
      localize("ORDEM_BRIDGE.Feedback.Disconnected", "Mundo desconectado do portal."),
    );
  }

  static async saveBridgeUrl(this: BridgeConnectionApplication): Promise<void> {
    const input = this.element.querySelector("[name='bridgeUrl']");
    const value = input instanceof HTMLInputElement ? input.value.trim() : "";
    await this.runOperation(
      "save-url",
      () => saveBridgeUrl(value),
      localize("ORDEM_BRIDGE.Feedback.UrlSaved", "Endereço do Bridge atualizado."),
    );
  }

  static async retry(this: BridgeConnectionApplication): Promise<void> {
    const current = pairing();
    if (current.pairingId && current.deviceCode && !current.expired && !current.terminal) {
      schedulePairingPoll(0);
      this.feedback = {
        type: "success",
        message: localize(
          "ORDEM_BRIDGE.Feedback.Retrying",
          "Nova tentativa iniciada. A tela será atualizada automaticamente.",
        ),
      };
      await this.render();
      return;
    }
    await this.runOperation("connect", startPairing);
  }
}
