import { z } from "zod";

const MAX_NOTES_LENGTH = 300;

// SPEC.md section 10's answer-form table. "Can't tell" is a real, valid
// answer per section 13 ("workers can always answer 'can't tell'"), not a
// missing-data placeholder, so it's a first-class enum value here, not
// something a required boolean would have to fake.
const YES_NO = z.enum(["yes", "no"]);
const YES_NO_CANT_TELL = z.enum(["yes", "no", "cant_tell"]);

export const verifyPlaceAnswerSchema = z.object({
  exists: YES_NO,
  open_now: YES_NO_CANT_TELL,
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
});
export type VerifyPlaceAnswer = z.infer<typeof verifyPlaceAnswerSchema>;

export const checkPriceAnswerSchema = z.object({
  found: YES_NO,
  price: z.number().nonnegative().optional(),
  currency: z.string().min(1).max(10).optional(),
  in_stock: YES_NO_CANT_TELL,
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
});
export type CheckPriceAnswer = z.infer<typeof checkPriceAnswerSchema>;

export const translateAnswerSchema = z.object({
  translation: z.string().min(1).max(1000),
  notes: z.string().max(MAX_NOTES_LENGTH).optional(),
});
export type TranslateAnswer = z.infer<typeof translateAnswerSchema>;

export const answerSchemaByType = {
  verify_place: verifyPlaceAnswerSchema,
  check_price: checkPriceAnswerSchema,
  translate: translateAnswerSchema,
} as const;

// SPEC.md section 10: verify_place and check_price require a photo;
// translate has none. R2 (the actual upload target) is not configured yet
// this session, so photo_key is accepted as optional input for now rather
// than enforced, with the route-level requirement documented at the call
// site; this schema still names the real field so it's ready once R2 is
// wired in, rather than needing a shape change later.
export const submitTaskSchema = z.object({
  answer: z.record(z.string(), z.unknown()),
  photo_key: z.string().min(1).optional(),
});
export type SubmitTaskInput = z.infer<typeof submitTaskSchema>;
