import { useEffect, useState } from "react";
import { createOperationScope } from "./operation-scope";

export function useOperationScope() {
  const [busy, setBusy] = useState("");
  const [scope] = useState(() => createOperationScope(setBusy));
  useEffect(() => {
    scope.activate();
    return () => scope.dispose();
  }, [scope]);
  return { busy, start: scope.start };
}
