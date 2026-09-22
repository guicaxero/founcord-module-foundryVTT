type RenderableApplication = Readonly<{
  element: HTMLElement | null | undefined;
  rendered: boolean;
  render(): Promise<unknown>;
}>;

let activeApplication: RenderableApplication | null = null;
let rendering = false;

export function setActiveConnectionApplication(application: RenderableApplication | null): void {
  activeApplication = application;
}

export function isActiveConnectionApplication(application: RenderableApplication): boolean {
  return activeApplication === application;
}

/**
 * Atualiza a tela de conexão aberta após eventos em segundo plano, preservando
 * foco, seleção de texto e o estado do painel técnico.
 */
export async function renderConnectionApplication(): Promise<void> {
  const application = activeApplication;
  if (!application?.rendered || rendering) return;
  rendering = true;
  const element = application.element;
  const focused =
    element && document.activeElement instanceof HTMLElement && element.contains(document.activeElement)
      ? document.activeElement
      : null;
  const focusSelector = focused?.id
    ? `#${CSS.escape(focused.id)}`
    : focused?.dataset.action
      ? `[data-action="${CSS.escape(focused.dataset.action)}"]`
      : null;
  const selection =
    focused instanceof HTMLInputElement
      ? { start: focused.selectionStart, end: focused.selectionEnd }
      : null;
  const technicalOpen = Boolean(
    element?.querySelector<HTMLDetailsElement>(".ordem-bridge-technical")?.open,
  );
  try {
    await application.render();
    const nextElement = application.element;
    const technical = nextElement?.querySelector(".ordem-bridge-technical");
    if (technical instanceof HTMLDetailsElement) technical.open = technicalOpen;
    const nextFocused = focusSelector ? nextElement?.querySelector(focusSelector) : null;
    if (nextFocused instanceof HTMLElement) {
      nextFocused.focus({ preventScroll: true });
      if (selection && nextFocused instanceof HTMLInputElement) {
        nextFocused.setSelectionRange(selection.start, selection.end);
      }
    }
  } finally {
    rendering = false;
  }
}
