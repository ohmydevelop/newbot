// Test-only discovered skills. Never imported by the product entry point.
import { mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { FakeCodex } from "./fixture.js";
import type { SkillMetadata } from "../generated/codex/v2/SkillMetadata.js";
import type { Method, Params, Result } from "../server/protocol.js";
export const skillSource = `---
name: code-review
description: Review code changes
---
# 审查流程

先阅读项目说明，再检查改动并报告风险。

| 检查项 | 方式 |
| --- | --- |
| 类型 | 编译检查 |
| 行为 | 有针对性的测试 |

## 输出格式

列出问题、原因与修复建议。

\`\`\`ts
const reviewed = true;
\`\`\`

![技能图片](http://127.0.0.1:9/skill-image-probe)

<script>globalThis.SKILL_XSS = true;</script>

[相对文件](references/checklist.md) · [本地 API](/api/config)

\`\`\`mermaid
flowchart LR
A --> B
\`\`\`
`;
export class SkillsCodex extends FakeCodex {
  skills: SkillMetadata[] = [];
  discoveryFailure = false;
  warnings = false;
  constructor(public directory: string) {
    super();
    for (const [name, description, content, scope, enabled] of [
      [
        "code-review",
        "检查改动并给出可执行建议。\n只读检查不会自动修改文件。",
        skillSource,
        "repo",
        true,
      ],
      [
        "disabled-skill",
        "这是已停用技能的完整说明，仍可阅读使用条件。",
        "# 停用技能说明\n\n查看说明不会启用此技能。",
        "user",
        false,
      ],
      ["empty-skill", "空说明文件", "", "system", true],
      [
        "invalid-skill",
        "无效文本文件",
        Buffer.from([0xff, 0xfe, 0xff]),
        "user",
        true,
      ],
      [
        "oversized-skill",
        "超出查看上限",
        "x".repeat(256 * 1024 + 1),
        "user",
        true,
      ],
      [
        "metadata-only",
        "只包含元数据",
        "---\nname: metadata-only\ndescription: metadata only\n---\n",
        "admin",
        true,
      ],
    ] as const) {
      const path = join(directory, "skills", name, "SKILL.md");
      mkdirSync(join(directory, "skills", name), { recursive: true });
      writeFileSync(path, content);
      this.skills.push({
        name,
        description,
        path,
        scope,
        enabled,
        pluginId: null,
        ...(name === "code-review"
          ? {
              interface: {
                displayName: "代码审查",
                shortDescription: "检查项目改动、风险与测试覆盖",
                iconSmallUrl: "https://example.com/should-not-load.svg",
                iconLargeUrl: null,
              },
            }
          : {}),
      });
    }
    const secret = join(directory, "unlisted-secret.txt");
    writeFileSync(secret, "SYNTHETIC_SKILL_SECRET_DO_NOT_EXPOSE");
    const path = join(directory, "skills", "linked-skill", "SKILL.md");
    mkdirSync(join(directory, "skills", "linked-skill"), { recursive: true });
    symlinkSync(secret, path);
    this.skills.push({
      name: "linked-skill",
      description: "链接文件不会被读取",
      path,
      scope: "user",
      enabled: true,
      pluginId: null,
    });
  }
  override async call<M extends Method>(
    method: M,
    params: Params<M>,
  ): Promise<Result<M>> {
    if (method === "skills/list") {
      this.calls.push({ method, params });
      if (this.discoveryFailure)
        throw new Error(
          "private native error: SYNTHETIC_SKILL_SECRET_DO_NOT_EXPOSE",
        );
      return {
        data: [
          {
            cwd: (params as { cwds: string[] }).cwds[0],
            skills: structuredClone(this.skills),
            errors: this.warnings
              ? [{ path: "/private/skill", message: "private native error" }]
              : [],
          },
        ],
      } as Result<M>;
    }
    if (method === "skills/config/write") {
      this.calls.push({ method, params });
      const p = params as { path: string; enabled: boolean };
      const skill = this.skills.find((s) => s.path === p.path);
      if (skill) skill.enabled = p.enabled;
      return {} as Result<M>;
    }
    return super.call(method, params);
  }
}
