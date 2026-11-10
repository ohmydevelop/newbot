import { useEffect, useRef, useState, type DragEvent } from "react";

export function useChatDrop({
  disabled,
  scope,
  upload,
  begin,
  blocked,
}: {
  disabled: boolean;
  scope: string;
  upload: (files: FileList) => void;
  begin: () => void;
  blocked: () => void;
}) {
  const [dragging, setDragging] = useState(false),
    depth = useRef(0);
  const reset = () => {
    depth.current = 0;
    setDragging(false);
  };
  const files = (e: DragEvent) => e.dataTransfer.types.includes("Files");
  const ignored = (e: DragEvent) =>
    !!document.querySelector('.modal[data-state="open"]') ||
    (e.target instanceof Element &&
      !!e.target.closest("[data-chat-drop-ignore], iframe"));
  useEffect(() => {
    const preventNavigation = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
      if (event.type === "drop" || event.type === "dragend") reset();
    };
    const leaveWindow = (event: globalThis.DragEvent) => {
      if (
        (event.target === document.documentElement ||
          event.target === document) &&
        !event.relatedTarget
      )
        reset();
    };
    window.addEventListener("dragover", preventNavigation);
    window.addEventListener("drop", preventNavigation);
    window.addEventListener("dragend", preventNavigation);
    window.addEventListener("dragleave", leaveWindow);
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("dragover", preventNavigation);
      window.removeEventListener("drop", preventNavigation);
      window.removeEventListener("dragend", preventNavigation);
      window.removeEventListener("dragleave", leaveWindow);
      window.removeEventListener("blur", reset);
    };
  }, []);
  useEffect(reset, [scope]);
  const handlers = {
    onDragEnter(e: DragEvent) {
      if (!files(e) || ignored(e)) return;
      e.preventDefault();
      if (depth.current++ === 0) begin();
      setDragging(true);
    },
    onDragOver(e: DragEvent) {
      if (!files(e) || ignored(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = disabled ? "none" : "copy";
    },
    onDragLeave() {
      if (depth.current > 0 && --depth.current === 0) setDragging(false);
    },
    onDrop(e: DragEvent) {
      if (!files(e) || ignored(e)) return;
      e.preventDefault();
      e.stopPropagation();
      reset();
      if (disabled) blocked();
      else if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
      else blocked();
    },
  };
  return { dragging, handlers };
}
