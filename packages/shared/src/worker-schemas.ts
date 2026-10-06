import { z } from "zod";
import { COUNTRY_CODE, CITY } from "./task-schemas";

const MAX_DISPLAY_NAME_LENGTH = 60;

// Loosely an ISO 639-1/639-2 code (SPEC.md section 5 example: "en", "ig").
// Shape-only, not membership in a fixed list: the project explicitly
// doesn't constrain which languages workers may speak.
const LANGUAGE_CODE = z
  .string()
  .regex(/^[a-z]{2,3}$/, { error: "language must be a lowercase 2-3 letter code, e.g. \"en\"" });

export const workerJoinSchema = z.object({
  invite_code: z.string().min(1, { error: "invite_code is required" }),
  contract_id: z
    .string()
    .regex(/^C[A-Z0-9]{55}$/, { error: "contract_id must be a valid C... address" }),
  signed_tx: z.string().min(1, { error: "signed_tx is required" }),
});

export type WorkerJoinInput = z.infer<typeof workerJoinSchema>;

export const workerConfirmSchema = z.object({
  contract_id: z
    .string()
    .regex(/^C[A-Z0-9]{55}$/, { error: "contract_id must be a valid C... address" }),
  display_name: z.string().min(1).max(MAX_DISPLAY_NAME_LENGTH),
  country: COUNTRY_CODE,
  city: CITY,
  languages: z.array(LANGUAGE_CODE).min(1, { error: "at least one language is required" }),
  key_id_base64: z.string().min(1, { error: "key_id_base64 is required" }),
});

export type WorkerConfirmInput = z.infer<typeof workerConfirmSchema>;
