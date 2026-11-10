// Zod's v3 compatibility API matches the pinned SDK's catalog contract. All
// externally supplied payloads must pass a2ui-policy BEFORE these schemas.
import { z } from "zod3";
import { CommonSchemas, Catalog } from "@a2ui/web_core/v0_9";
import { A2UI_LIMITS, A2UI_CATALOG_ID, isA2uiPointer } from "./a2ui-policy.js";

const string = z.string().max(A2UI_LIMITS.string);
const label = string
  .min(1)
  .max(160)
  .refine((value) => value.trim().length > 0);
const binding = z
  .object({ path: z.string().refine(isA2uiPointer) })
  .strict()
  .describe("REF:#/$defs/DataBinding");
const dynamicString = z
  .union([string, binding])
  .describe("REF:#/$defs/DynamicString");
const componentId = CommonSchemas.ComponentId;
const children = z.array(componentId).max(24).describe("REF:#/$defs/ChildList");
const parent = ["Surface", "Column", "Row"];
export const a2uiApis = {
  Text: {
    name: "Text",
    allowedParents: [...parent, "Button"],
    schema: z
      .object({
        text: dynamicString,
        variant: z.enum(["body", "h3", "caption"]).optional(),
      })
      .strict(),
  },
  Column: {
    name: "Column",
    allowedParents: parent,
    schema: z.object({ children }).strict(),
  },
  Row: {
    name: "Row",
    allowedParents: parent,
    schema: z.object({ children }).strict(),
  },
  TextField: {
    name: "TextField",
    allowedParents: ["Column", "Row"],
    schema: z
      .object({
        label,
        value: dynamicString,
        variant: z.enum(["shortText", "longText"]).optional(),
      })
      .strict(),
  },
  ChoicePicker: {
    name: "ChoicePicker",
    allowedParents: ["Column", "Row"],
    schema: z
      .object({
        label,
        options: z
          .array(
            z
              .object({
                label,
                value: string.min(1).max(128),
              })
              .strict(),
          )
          .min(1)
          .max(24),
        value: z
          .union([z.array(string.max(128)).max(24), binding])
          .describe("REF:#/$defs/DynamicStringList"),
        variant: z.enum(["mutuallyExclusive", "multipleSelection"]).optional(),
      })
      .strict(),
  },
  Button: {
    name: "Button",
    allowedParents: parent,
    allowedChildren: ["Text"],
    schema: z
      .object({
        child: componentId,
        variant: z.enum(["default", "primary", "borderless"]).optional(),
        action: z
          .object({
            event: z
              .object({
                name: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/),
                context: z.record(
                  z.union([
                    string,
                    z.number().finite(),
                    z.boolean(),
                    z.null(),
                    binding,
                  ]),
                ),
              })
              .strict(),
          })
          .strict()
          .describe("REF:#/$defs/Action"),
      })
      .strict(),
  },
};
export const createA2uiSchemaCatalog = () =>
  new Catalog(A2UI_CATALOG_ID, "0.9", Object.values(a2uiApis), []);
