import { z } from "zod";
const skills = z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(8);
const plugins = z.array(z.string().min(1).max(300)).max(8);
const connectors = z.array(z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)).max(16);
export const expertMembers = z.strictObject({
  skillIds: skills,
  pluginIds: plugins,
  connectorIds: connectors,
});
export const expertSave = z
  .strictObject({
    id: z.string().uuid().optional(),
    expectedRevision: z.number().int().nonnegative().optional(),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500).default(""),
    ...expertMembers.shape,
  })
  .refine(
    (p) => p.skillIds.length + p.pluginIds.length + p.connectorIds.length > 0,
    { message: "请至少选择一个扩展" },
  );
export type ExpertMembers = z.infer<typeof expertMembers>;
export type ExpertReference = { id: string; name: string; revision: number };
export type Expert = ExpertMembers &
  ExpertReference & {
    description: string;
    available: boolean;
    problems: string[];
  };
export type SessionExtensions = {
  revision: number;
  expertId: string | null;
  expert: ExpertReference | null;
  missing: boolean;
};
