import { describe, expect, it } from "vitest";
import { hasPermission, SERVER_PERMISSIONS, RegisterInput, ServerCreateInput } from "./index.js";

describe("permissions", () => {
  it("grants direct permissions", () => {
    expect(hasPermission(["console.send"], "console.send")).toBe(true);
  });

  it("respects implications (stop implies start/stop)", () => {
    expect(hasPermission(["settings.reinstall"], "power.start")).toBe(true);
    expect(hasPermission(["settings.reinstall"], "files.write")).toBe(false);
  });

  it("denies unknown permissions", () => {
    expect(hasPermission([], "console.view")).toBe(false);
  });

  it("every permission constant is a valid string", () => {
    for (const p of SERVER_PERMISSIONS) expect(typeof p).toBe("string");
  });
});

describe("schemas", () => {
  it("registers a valid user", () => {
    const r = RegisterInput.safeParse({ email: "a@b.co", username: "owl", password: "longenough1" });
    expect(r.success).toBe(true);
  });

  it("rejects bad usernames and short passwords", () => {
    expect(RegisterInput.safeParse({ email: "a@b.co", username: "bad name!", password: "longenough1" }).success).toBe(false);
    expect(RegisterInput.safeParse({ email: "a@b.co", username: "ok", password: "short" }).success).toBe(false);
  });

  it("creates a server with defaults", () => {
    const r = ServerCreateInput.safeParse({
      name: "survival",
      nodeId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
      templateId: "paper",
      allocationId: "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6e",
      memoryMb: 2048,
      diskMb: 4096,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.cpuPercent).toBe(200);
      expect(r.data.variables).toEqual({});
    }
  });
});
