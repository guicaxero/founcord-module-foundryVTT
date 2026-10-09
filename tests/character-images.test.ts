import { afterEach, describe, expect, it, vi } from "vitest";
import { withCharacterImages } from "../src/sync/characters";
import { clearThumbnailCache } from "../src/sync/thumbnail";
import { collection } from "./foundry-mocks";

function actor(overrides: Partial<FoundryActor>): FoundryActor {
  return {
    id: "aster",
    name: "Aster",
    type: "character",
    system: {},
    items: collection([]),
    createEmbeddedDocuments: async () => [],
    deleteEmbeddedDocuments: async () => [],
    updateEmbeddedDocuments: async () => [],
    update: async () => undefined,
    ...overrides,
  };
}

/** Imagem local que não carrega, como um arquivo ausente no servidor do Foundry. */
class FailingImage {
  decoding = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onerror?.());
  }
}

describe("imagens do personagem", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearThumbnailCache();
  });

  it("envia retrato e token, com null quando a imagem não existe ou não carrega", async () => {
    vi.stubGlobal("Image", FailingImage);
    const [withImages, withoutImages] = await withCharacterImages([
      actor({
        img: "https://cdn.example.test/aster.webp",
        prototypeToken: { texture: { src: "worlds/ordem/tokens/aster.webp" } },
      }),
      actor({ id: "vesper", name: "Vesper" }),
    ]);

    expect(withImages).toMatchObject({
      actorId: "aster",
      portraitUrl: "https://cdn.example.test/aster.webp",
      tokenUrl: null,
    });
    expect(withoutImages).toMatchObject({ actorId: "vesper", portraitUrl: null, tokenUrl: null });
  });
});
