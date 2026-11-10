import { useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import type { SkillReference } from "../../shared/types";
import { useApp } from "../store";
import { Modal } from "./ui";
import SkillReader from "./SkillReader";
export default function SkillReferences({
  references,
}: {
  references: SkillReference[];
}) {
  const readable = useApp((s) => s.skillDocuments);
  const [selected, setSelected] = useState<SkillReference | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <div className="message-skill-refs" aria-label="本条消息指定的技能">
        {references.map((ref) => (
          <button
            key={ref.id}
            type="button"
            disabled={!readable}
            aria-label={`查看已指定技能 ${ref.displayName}`}
            onClick={(event) => {
              opener.current = event.currentTarget;
              setSelected(ref);
            }}
          >
            <BookOpen size={14} aria-hidden="true" />
            {ref.displayName}
          </button>
        ))}
      </div>
      {selected && (
        <Modal
          open
          wide
          title="指定的技能"
          className="skill-reference-modal"
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            opener.current?.focus();
          }}
        >
          <div className="skill-reference-content">
            <SkillReader
              skill={selected}
              reference={selected}
              onBack={() => setSelected(null)}
              backLabel="返回对话"
            />
          </div>
        </Modal>
      )}
    </>
  );
}
