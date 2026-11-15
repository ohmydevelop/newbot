import { FormActions, FormSubmit } from "./FormActions";
import { useRef, useState } from "react";
import { CatalogDetail } from "./CatalogNavigation";
import { importApi } from "./SkillImport";
import { loadDiscovery, loadSettings } from "../store";
import type { ImportSession } from "../../shared/imports";
export default function SkillCreate({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [instructions, setInstructions] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const attempt = useRef<{
    signature: string;
    session?: ImportSession;
    operationId: string;
  } | null>(null);
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const signature = JSON.stringify({ name, description, instructions });
    try {
      if (attempt.current?.signature !== signature) {
        if (attempt.current?.session?.retained)
          await importApi(
            "/" + attempt.current.session.id,
            undefined,
            "DELETE",
          );
        attempt.current = { signature, operationId: crypto.randomUUID() };
      }
      const current = attempt.current!;
      if (!current.session)
        current.session = await importApi("", { kind: "files", name });
      if (current.session!.state === "uploading") {
        const text = `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\n---\n\n${instructions}\n`;
        await importApi(
          `/${current.session!.id}/file?path=${encodeURIComponent(name + "/SKILL.md")}`,
          new File([text], "SKILL.md", { type: "text/markdown" }),
          "PUT",
        );
        current.session = await importApi(`/${current.session!.id}/scan`, {});
      }
      const session = current.session!;
      if (session.state === "failed")
        throw new Error(session.error || "技能检查失败，请修改后重试");
      const result: ImportSession = await importApi(`/${session.id}/install`, {
        operationId: current.operationId,
        digest: session.digest,
        choices: session.entries.map((entry) => ({
          id: entry.id,
          skills: entry.skills.map((s) => s.id),
          replace: false,
          confirmPackage: false,
        })),
      });
      current.session = result;
      if (
        result.state !== "complete" ||
        result.entries.some((e) => e.state === "failed")
      )
        throw new Error(
          result.error ||
            result.entries.find((e) => e.error)?.error ||
            "创建未完成，可在导入记录中继续",
        );
      await loadSettings();
      await loadDiscovery("skills");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建失败，请重试");
    } finally {
      setBusy(false);
    }
  }
  return (
    <CatalogDetail
      open
      title="新技能"
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      dismissible={!busy}
      className="catalog-form-step"
    >
      <form className="catalog-form skill-create" onSubmit={create}>
        <label className="field-label">
          名称
          <input
            autoFocus
            required
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={64}
            title="使用小写字母、数字和连字符"
            placeholder="weekly-report"
            disabled={busy}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field-label">
          描述
          <textarea
            required
            maxLength={1024}
            placeholder="何时使用这个技能"
            disabled={busy}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="field-label">
          指令
          <textarea
            className="skill-instructions"
            required
            maxLength={100000}
            placeholder="写下需要遵循的步骤"
            disabled={busy}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="inline-error">
            {error}
          </p>
        )}
        <FormActions layout="catalog">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={onClose}
          >
            取消
          </button>
          <FormSubmit busy={busy} busyLabel="正在创建…">
            创建
          </FormSubmit>
        </FormActions>
      </form>
    </CatalogDetail>
  );
}
