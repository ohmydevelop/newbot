import { lazy, Suspense, useRef, useState } from "react";
import { useApp } from "../store";
const CredentialInput = lazy(() => import("./CredentialProbe"));
export default function SudoSettings() {
  const capability = useApp((state) => state.sudoIdentity);
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  if (!capability?.available || !capability.policy) return null;
  return (
    <section aria-label="受控 sudo 检查" className="managed-credential">
      <h4>单次提权检查</h4>
      <p className="muted">
        以 root 执行一次 <code>/usr/bin/id -u</code>，确认本机受控执行通道。
        每次单独输入，仅返回检查状态。
      </p>
      <button ref={opener} className="secondary" onClick={() => setOpen(true)}>
        发起单次提权检查
      </button>
      {open && (
        <Suspense fallback={<p role="status">正在加载私密输入…</p>}>
          <CredentialInput
            providerId=""
            revision=""
            sudoPolicy={capability.policy}
            onClose={() => setOpen(false)}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              opener.current?.focus();
            }}
          />
        </Suspense>
      )}
    </section>
  );
}
