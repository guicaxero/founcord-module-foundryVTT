import { describe, expect, it } from "vitest";
import { heartbeatPayload } from "../src/connection/heartbeat";
import { setWorld } from "./foundry-mocks";

describe("heartbeat", () => {
  it("envia presença e as versões instaladas para o portal", () => {
    setWorld({
      users: [
        { id: "mestre", name: "Mestre", isGM: true, active: true },
        { id: "jogador", name: "Jogador", isGM: false, active: false },
      ],
      actors: [],
    });
    expect(heartbeatPayload()).toMatchObject({
      activeUsers: 1,
      actorCount: 0,
      foundryVersion: "14.320",
      systemVersion: "6.1.4",
      moduleVersion: "0.0.0-test",
    });
  });
});
