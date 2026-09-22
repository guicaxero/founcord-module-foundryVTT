/**
 * Gera `dist/ordem-foundry-bridge/`, a pasta pronta do módulo: o bundle ESM em
 * `scripts/bridge.js` (caminho declarado em module.json) mais manifesto,
 * traduções, estilos e templates. A release compacta essa pasta.
 */
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const outDir = new URL("dist/ordem-foundry-bridge/", root);

await rm(new URL("dist/", root), { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const result = await Bun.build({
  entrypoints: [fileURLToPath(new URL("src/main.ts", root))],
  outdir: fileURLToPath(new URL("scripts/", outDir)),
  naming: "bridge.js",
  target: "browser",
  format: "esm",
  sourcemap: "linked",
  minify: false,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

for (const entry of ["module.json", "README.md", "CHANGELOG.md", "lang", "styles", "templates"]) {
  await cp(new URL(entry, root), new URL(entry, outDir), { recursive: true });
}

console.log("Módulo gerado em dist/ordem-foundry-bridge/");
