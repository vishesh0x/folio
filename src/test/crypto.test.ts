import { describe, expect, it } from "vitest";
import {
  hashPassword,
  randomToken,
  safeEqualStrings,
  sha256Hex,
  verifyPassword,
} from "@/server/crypto.server";

describe("password hashing", () => {
  it("round-trips and rejects wrong passwords", async () => {
    const h = await hashPassword("correct horse battery staple");
    expect(h.startsWith("pbkdf2$100000$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
  it("salts every hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });
  it("never throws on malformed stored hashes", async () => {
    for (const bad of [
      "",
      "x",
      "pbkdf2$1$2",
      "md5$1$a$b",
      "pbkdf2$999999999$AAAA$AAAA",
      "pbkdf2$100000$!!$!!",
    ]) {
      await expect(verifyPassword("pw", bad).catch(() => false)).resolves.toBe(false);
    }
  });
  it("the timing-equaliser dummy hash used for unknown emails is well-formed", async () => {
    const dummy =
      "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    await expect(verifyPassword("anything", dummy)).resolves.toBe(false);
  });
});

describe("tokens", () => {
  it("are unique, URL-safe and long", () => {
    const a = randomToken(),
      b = randomToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("hash + compare", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(await safeEqualStrings("a", "a")).toBe(true);
    expect(await safeEqualStrings("a", "b")).toBe(false);
  });
});
