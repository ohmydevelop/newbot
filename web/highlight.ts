import { createHighlighter, type BundledLanguage } from "shiki/bundle/web";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
const promise = createHighlighter({
  langs: [],
  themes: ["github-light", "github-dark"],
  engine: createJavaScriptRegexEngine(),
});
export async function highlight(code: string, language: string) {
  const highlighter = await promise;
  let lang = language || "text";
  if (!["text", "txt", "plaintext"].includes(lang)) {
    try {
      await highlighter.loadLanguage(lang as BundledLanguage);
    } catch {
      lang = "text";
    }
  }
  return highlighter.codeToHtml(code, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });
}
