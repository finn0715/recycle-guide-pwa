import { z } from "zod";
import { ITEMS, type ItemId, type Source } from "./index";

export const IdentificationSchema = z.strictObject({
  outcome: z.enum(["identified", "unclear", "unsupported"]),
  items: z.array(z.enum(Object.keys(ITEMS) as [ItemId, ...ItemId[]])).max(10),
  hasOtherItems: z.boolean(),
});
export const IdentificationResponseSchema = IdentificationSchema.extend({ requestId: z.uuid() })
  .refine(value => (value.outcome === "identified") === (value.items.length > 0))
  .refine(value => new Set(value.items).size === value.items.length);
export type Identification = z.infer<typeof IdentificationResponseSchema>;
export type QuickPart = { name: string; bin: string; note?: string };
export type QuickMethod = {
  id: string;
  label: string;
  scope: string;
  steps: string[];
  parts: QuickPart[];
  note: string;
  ruleIds: string[];
  sources: Source[];
};
export type QuickGuide = {
  id: ItemId;
  label: string;
  shortLabel: string;
  question?: string;
  methods: QuickMethod[];
};
