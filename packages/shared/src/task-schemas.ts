import { z } from "zod";
import { DEADLINE_MINUTES_MAX, DEADLINE_MINUTES_MIN, MAX_QUESTION_LENGTH, MAX_SOURCE_TEXT_LENGTH } from "./constants";

// ISO 3166-1 alpha-2 country codes this project currently routes to.
// SPEC.md section 1: Nigeria, Chile, Costa Rica.
export const COUNTRY_CODE = z.enum(["NG", "CL", "CR"]);

// City membership against the live-cities list (SPEC.md section 12: a city
// is "live" when it has at least 2 active workers, computed from the DB)
// cannot be expressed statically in a zod schema. That check happens in
// the route handler against current worker data; this just enforces the
// lowercase, normalized string shape SPEC.md section 5 requires.
export const CITY = z
  .string()
  .min(1, { error: "city is required" })
  .regex(/^[a-z-]+$/, { error: "city must be lowercase, e.g. \"enugu\"" });

const locationSchema = z.object({
  country: COUNTRY_CODE,
  city: CITY,
  address: z.string().min(1).max(200).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

const deadlineMinutesSchema = z
  .number()
  .int()
  .min(DEADLINE_MINUTES_MIN, { error: `deadline_minutes must be at least ${DEADLINE_MINUTES_MIN}` })
  .max(DEADLINE_MINUTES_MAX, { error: `deadline_minutes must be at most ${DEADLINE_MINUTES_MAX}` });

const callbackUrlSchema = z
  .url({ protocol: /^https$/, error: "callback_url must be an https URL" })
  .optional();

export const verifyPlaceSchema = z.object({
  location: locationSchema,
  place_name: z.string().min(1).max(200),
  question: z.string().min(1).max(MAX_QUESTION_LENGTH),
  deadline_minutes: deadlineMinutesSchema,
  callback_url: callbackUrlSchema,
});

export const checkPriceSchema = z.object({
  location: locationSchema,
  item: z.string().min(1).max(200),
  deadline_minutes: deadlineMinutesSchema,
  callback_url: callbackUrlSchema,
});

export const translateSchema = z.object({
  location: locationSchema,
  source_text: z.string().min(1).max(MAX_SOURCE_TEXT_LENGTH),
  target_language: z.string().min(2).max(10),
  deadline_minutes: deadlineMinutesSchema,
  callback_url: callbackUrlSchema,
});

export type VerifyPlaceInput = z.infer<typeof verifyPlaceSchema>;
export type CheckPriceInput = z.infer<typeof checkPriceSchema>;
export type TranslateInput = z.infer<typeof translateSchema>;

export const taskSchemaByType = {
  verify_place: verifyPlaceSchema,
  check_price: checkPriceSchema,
  translate: translateSchema,
} as const;
