/** Localize browser constraint feedback without changing its validation rules.
 * No values are inspected; custom business validation remains authoritative. */
export function installFormValidation(doc: Document) {
  const owned = new Map<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
    string
  >();
  const clear = () => {
    for (const [field, message] of owned) {
      if (field.validationMessage === message) field.setCustomValidity("");
    }
    owned.clear();
  };
  const invalid = (event: Event) => {
    const field = event.target;
    if (
      !(
        field instanceof HTMLInputElement ||
        field instanceof HTMLSelectElement ||
        field instanceof HTMLTextAreaElement
      )
    )
      return;
    const state = field.validity;
    if (state.customError) return;
    let message = "";
    if (state.valueMissing)
      message =
        field instanceof HTMLSelectElement ? "请选择一项。" : "请填写此项。";
    else if (state.typeMismatch)
      message =
        field instanceof HTMLInputElement && field.type === "email"
          ? "请填写有效的邮箱地址。"
          : "请填写完整、有效的地址。";
    else if (state.badInput) message = "请填写有效的数字。";
    else if (state.rangeUnderflow)
      message = `数值不能小于 ${field.getAttribute("min")}。`;
    else if (state.rangeOverflow)
      message = `数值不能大于 ${field.getAttribute("max")}。`;
    else if (state.tooLong)
      message = `最多填写 ${field.getAttribute("maxlength")} 个字符。`;
    else if (state.tooShort)
      message = `至少填写 ${field.getAttribute("minlength")} 个字符。`;
    else if (state.patternMismatch || state.stepMismatch)
      message = "请按要求填写有效的格式。";
    if (!message) return;
    field.setCustomValidity(message);
    owned.set(field, message);
  };
  doc.addEventListener("invalid", invalid, true);
  // Keep the message until Chrome has displayed its native validation UI.
  // Clear only our messages before the next interaction or constraint change.
  const events = ["input", "change", "click", "keydown"];
  for (const type of events) doc.addEventListener(type, clear, true);
  const observer = new MutationObserver(clear);
  observer.observe(doc, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      "required",
      "disabled",
      "type",
      "min",
      "max",
      "step",
      "minlength",
      "maxlength",
      "pattern",
    ],
  });
  return () => {
    clear();
    observer.disconnect();
    doc.removeEventListener("invalid", invalid, true);
    for (const type of events) doc.removeEventListener(type, clear, true);
  };
}
