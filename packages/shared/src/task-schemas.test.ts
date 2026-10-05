import { describe, expect, it } from "vitest";
import { checkPriceSchema, translateSchema, verifyPlaceSchema } from "./task-schemas.js";

describe("verifyPlaceSchema", () => {
  const validBody = {
    location: { country: "NG", city: "enugu", address: "12 Ogui Road", lat: 6.44, lng: 7.5 },
    place_name: "Mama Nkechi Provisions",
    question: "Is the shop open right now and does it look like an active business?",
    deadline_minutes: 60,
    callback_url: "https://agent.example.com/hooks/terreno",
  };

  it("accepts the spec's example body", () => {
    expect(verifyPlaceSchema.safeParse(validBody).success).toBe(true);
  });

  it("accepts a body without callback_url (optional)", () => {
    const { callback_url, ...rest } = validBody;
    expect(verifyPlaceSchema.safeParse(rest).success).toBe(true);
  });

  it("accepts a location without address/lat/lng (optional)", () => {
    const body = { ...validBody, location: { country: "NG", city: "enugu" } };
    expect(verifyPlaceSchema.safeParse(body).success).toBe(true);
  });

  it.each([14, 181, 0, -5])("rejects deadline_minutes = %i (outside 15-180)", (deadline_minutes) => {
    const result = verifyPlaceSchema.safeParse({ ...validBody, deadline_minutes });
    expect(result.success).toBe(false);
  });

  it.each([15, 180])("accepts deadline_minutes = %i (boundary)", (deadline_minutes) => {
    const result = verifyPlaceSchema.safeParse({ ...validBody, deadline_minutes });
    expect(result.success).toBe(true);
  });

  it("rejects a question over 500 characters", () => {
    const body = { ...validBody, question: "a".repeat(501) };
    expect(verifyPlaceSchema.safeParse(body).success).toBe(false);
  });

  it("accepts a question at exactly 500 characters", () => {
    const body = { ...validBody, question: "a".repeat(500) };
    expect(verifyPlaceSchema.safeParse(body).success).toBe(true);
  });

  it("rejects an empty question", () => {
    const body = { ...validBody, question: "" };
    expect(verifyPlaceSchema.safeParse(body).success).toBe(false);
  });

  it("rejects a non-https callback_url", () => {
    const body = { ...validBody, callback_url: "http://agent.example.com/hooks" };
    expect(verifyPlaceSchema.safeParse(body).success).toBe(false);
  });

  it("rejects a malformed callback_url", () => {
    const body = { ...validBody, callback_url: "not a url" };
    expect(verifyPlaceSchema.safeParse(body).success).toBe(false);
  });

  it("rejects an unknown country code", () => {
    const body = { ...validBody, location: { ...validBody.location, country: "US" } };
    expect(verifyPlaceSchema.safeParse(body).success).toBe(false);
  });

  it("rejects an uppercase city", () => {
    const body = { ...validBody, location: { ...validBody.location, city: "Enugu" } };
    expect(verifyPlaceSchema.safeParse(body).success).toBe(false);
  });

  it("rejects a missing place_name", () => {
    const { place_name, ...rest } = validBody;
    expect(verifyPlaceSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects extra top-level fields silently stripped or present", () => {
    // zod objects strip unknown keys by default; this should still pass
    // since no extra validation forbids them.
    const result = verifyPlaceSchema.safeParse({ ...validBody, unexpected: "field" });
    expect(result.success).toBe(true);
  });
});

describe("checkPriceSchema", () => {
  const validBody = {
    location: { country: "CL", city: "santiago", address: "Lider, Av. Providencia 1234" },
    item: "1 kg rice, cheapest brand",
    deadline_minutes: 90,
  };

  it("accepts the spec's example body", () => {
    expect(checkPriceSchema.safeParse(validBody).success).toBe(true);
  });

  it("rejects a missing item", () => {
    const { item, ...rest } = validBody;
    expect(checkPriceSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects deadline_minutes outside 15-180", () => {
    expect(checkPriceSchema.safeParse({ ...validBody, deadline_minutes: 200 }).success).toBe(false);
  });
});

describe("translateSchema", () => {
  const validBody = {
    location: { country: "NG", city: "enugu" },
    source_text: "Your order will arrive tomorrow before noon.",
    target_language: "ig",
    deadline_minutes: 30,
  };

  it("accepts the spec's example body", () => {
    expect(translateSchema.safeParse(validBody).success).toBe(true);
  });

  it("rejects a source_text over 500 characters", () => {
    const body = { ...validBody, source_text: "a".repeat(501) };
    expect(translateSchema.safeParse(body).success).toBe(false);
  });

  it("accepts a source_text at exactly 500 characters", () => {
    const body = { ...validBody, source_text: "a".repeat(500) };
    expect(translateSchema.safeParse(body).success).toBe(true);
  });

  it("rejects a missing target_language", () => {
    const { target_language, ...rest } = validBody;
    expect(translateSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an empty source_text", () => {
    expect(translateSchema.safeParse({ ...validBody, source_text: "" }).success).toBe(false);
  });
});
