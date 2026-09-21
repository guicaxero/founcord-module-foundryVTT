import { describe, expect, it } from "vitest";
import {
  htmlToPlainText,
  nullableIdentifier,
  nullableQuantity,
  publicHttpsUrl,
  safeInteger,
  sanitizedPlainText,
} from "../src/sanitize";

describe("htmlToPlainText", () => {
  it("remove scripts e conteúdo secreto ou exclusivo do mestre", () => {
    const html =
      '<p>Visível</p><script>alert(1)</script><section class="secret">oculto</section>' +
      '<div data-visibility="gm">só mestre</div><span class="gm-only">nota</span>';
    expect(htmlToPlainText(html)).toBe("Visível");
  });

  it("preserva quebras de linha de blocos e <br>", () => {
    expect(htmlToPlainText("<p>Linha 1<br>Linha 2</p><p>Linha 3</p>")).toBe(
      "Linha 1\nLinha 2\nLinha 3",
    );
  });

  it("limita o tamanho e devolve null para texto vazio", () => {
    expect(sanitizedPlainText("<p>abcdef</p>", 3)).toBe("abc");
    expect(sanitizedPlainText("<script>x</script>", 10)).toBeNull();
  });
});

describe("validações de dados enviados ao portal", () => {
  it("aceita somente imagens HTTPS", () => {
    expect(publicHttpsUrl("https://cdn.example.com/item.webp")).toBe(
      "https://cdn.example.com/item.webp",
    );
    expect(publicHttpsUrl("icons/svg/item-bag.svg")).toBeNull();
    expect(publicHttpsUrl("http://example.com/a.png")).toBeNull();
  });

  it("normaliza quantidades e inteiros", () => {
    expect(nullableQuantity("3")).toBe(3);
    expect(nullableQuantity(-2)).toBe(0);
    expect(nullableQuantity("")).toBeNull();
    expect(nullableQuantity("muitos")).toBeNull();
    expect(safeInteger("4.9")).toBe(4);
    expect(safeInteger(undefined)).toBe(0);
  });

  it("aceita apenas identificadores seguros", () => {
    expect(nullableIdentifier("abc123XYZ")).toBe("abc123XYZ");
    expect(nullableIdentifier("../etc")).toBeNull();
    expect(nullableIdentifier(42)).toBeNull();
  });
});
