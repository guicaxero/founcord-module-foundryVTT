import { getSetting, setSettings } from "../settings";

/** Remove a credencial deste navegador, exceto se outra geração já a substituiu. */
export async function clearLocalCredential(expectedGeneration: string | null = null): Promise<void> {
  const currentGeneration = getSetting("accessTokenGeneration");
  if (expectedGeneration && currentGeneration && currentGeneration !== expectedGeneration) return;
  await setSettings({ accessToken: "", accessTokenGeneration: "", lastConnectionError: "" });
}

export async function clearConnection(): Promise<void> {
  await setSettings({
    connectionRecord: {},
    accessToken: "",
    accessTokenGeneration: "",
    lastHeartbeatAt: "",
    lastSyncAt: "",
    lastSyncCount: 0,
    lastConnectionError: "",
  });
}
