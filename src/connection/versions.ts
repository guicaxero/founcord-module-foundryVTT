import { MODULE_ID } from "../constants";

/** Versões do ambiente, limitadas ao tamanho aceito pelo Bridge. */
export function runtimeVersions(): Readonly<{
  foundryVersion: string;
  systemVersion: string;
  moduleVersion: string;
}> {
  const clip = (value: unknown, fallback: string) => String(value ?? "").trim().slice(0, 40) || fallback;
  return {
    foundryVersion: clip(game.version, "desconhecida"),
    systemVersion: clip(game.system.version, "desconhecida"),
    moduleVersion: clip(game.modules.get(MODULE_ID)?.version, "0.0.0"),
  };
}
