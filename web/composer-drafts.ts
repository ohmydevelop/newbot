import { useReducer, useRef } from "react";
import type { SkillReference } from "../shared/types";
export type DraftFile = {
  id: string;
  name: string;
  mime?: string;
  state?: "uploading" | "failed";
  error?: string;
  file?: File;
};
export type DraftSnapshot = {
  key: string;
  generation: number;
  text: string;
  textVersion: number;
  files: DraftFile[];
  plugins: { id: string; name: string; displayName: string }[];
  pluginsVersion: number;
  skills: SkillReference[];
  skillsVersion: number;
};
const empty = (key: string, generation = 0): DraftSnapshot => ({
  key,
  generation,
  text: "",
  textVersion: 0,
  files: [],
  plugins: [],
  pluginsVersion: 0,
  skills: [],
  skillsVersion: 0,
});
export class ComposerDrafts {
  private sequence = 0;
  private entries = new Map<string, DraftSnapshot>();
  get(key: string) {
    if (!this.entries.has(key))
      this.entries.set(key, empty(key, ++this.sequence));
    return this.entries.get(key)!;
  }
  setText(key: string, text: string) {
    const v = this.get(key);
    this.entries.set(key, { ...v, text, textVersion: v.textVersion + 1 });
  }
  setFiles(key: string, files: DraftFile[]) {
    const v = this.get(key);
    this.entries.set(key, { ...v, files });
  }
  setSkills(key: string, skills: SkillReference[]) {
    const v = this.get(key);
    this.entries.set(key, { ...v, skills, skillsVersion: v.skillsVersion + 1 });
  }
  setPlugins(key: string, plugins: DraftSnapshot["plugins"]) {
    const v = this.get(key);
    this.entries.set(key, {
      ...v,
      plugins,
      pluginsVersion: v.pluginsVersion + 1,
    });
  }
  reset(key: string) {
    this.entries.set(key, empty(key, ++this.sequence));
  }
  addFiles(scope: DraftSnapshot, files: DraftFile[]) {
    const v = this.get(scope.key);
    if (v.generation !== scope.generation) return;
    const known = new Set(v.files.map((f) => f.id));
    this.setFiles(scope.key, [
      ...v.files,
      ...files.filter((f) => !known.has(f.id)),
    ]);
  }
  acknowledge(sent: DraftSnapshot, destination?: string) {
    const current = this.get(sent.key);
    if (current.generation !== sent.generation) return;
    const ids = new Set(sent.files.map((f) => f.id));
    const remaining = {
      ...current,
      text: current.textVersion === sent.textVersion ? "" : current.text,
      files: current.files.filter((f) => !ids.has(f.id)),
      plugins:
        current.pluginsVersion === sent.pluginsVersion ? [] : current.plugins,
      skills:
        current.skillsVersion === sent.skillsVersion ? [] : current.skills,
    };
    this.entries.set(sent.key, remaining);
    if (
      destination &&
      destination !== sent.key &&
      !this.entries.has(destination)
    ) {
      this.entries.set(destination, { ...remaining, key: destination });
      this.reset(sent.key);
    }
  }
  pruneEmpty(keep: string) {
    for (const [key, value] of this.entries)
      if (
        key !== keep &&
        !value.text &&
        !value.files.length &&
        !value.skills.length &&
        !value.plugins.length
      )
        this.entries.delete(key);
  }
  clear() {
    this.entries.clear();
  }
}
export function useComposerDrafts(threadId: string | null) {
  const store = useRef(new ComposerDrafts()).current,
    [, render] = useReducer((v) => v + 1, 0);
  const key = threadId || "$new",
    value = store.get(key);
  return {
    key,
    value,
    store,
    refresh: render,
    setText: (text: string) => {
      store.setText(key, text);
      render();
    },
    setFiles: (next: DraftFile[] | ((prior: DraftFile[]) => DraftFile[])) => {
      store.setFiles(
        key,
        typeof next === "function" ? next(store.get(key).files) : next,
      );
      render();
    },
    setSkills: (
      next: SkillReference[] | ((prior: SkillReference[]) => SkillReference[]),
    ) => {
      store.setSkills(
        key,
        typeof next === "function" ? next(store.get(key).skills) : next,
      );
      render();
    },
  };
}
