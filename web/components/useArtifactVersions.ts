import { useEffect, useState } from "react";
import type { Artifact, ArtifactVersions } from "../../shared/types";
import { artifactEndpoint, artifactFetch } from "../artifacts";
export function useArtifactVersions(original: Artifact, enabled: boolean) {
  const [versions, setVersions] = useState<Artifact[]>([original]);
  const [next, setNext] = useState<number | null>(null);
  const [latest, setLatest] = useState(original.version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [request, setRequest] = useState({
    revision: 0,
    before: null as number | null,
  });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    void artifactFetch(
      artifactEndpoint(
        original.id,
        `versions${request.before ? `?before=${request.before}` : ""}`,
      ),
      { signal: controller.signal },
    )
      .then((r) => r.json())
      .then((page: ArtifactVersions) => {
        if (controller.signal.aborted) return;
        setVersions((previous) =>
          [
            ...new Map(
              [
                ...(request.before ? previous : [original]),
                ...page.versions,
              ].map((a) => [a.id, a]),
            ).values(),
          ].sort((a, b) => b.version - a.version),
        );
        setLatest(page.latestVersion);
        setNext(page.nextBefore);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [original.id, enabled, request]);
  return {
    versions,
    next,
    latest,
    busy,
    error,
    refresh: () =>
      setRequest((r) => ({ revision: r.revision + 1, before: null })),
    more: () => setRequest((r) => ({ revision: r.revision + 1, before: next })),
  };
}
