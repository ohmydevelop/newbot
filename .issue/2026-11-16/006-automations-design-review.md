disposition: fix

Inputs not supplied: a separate QUALITY BAR card and motion captures. No approved comp is expected for this inherited, pinned, code-led extension. App.tsx and ConversationNavigation.tsx were not reread; their rendered navigation was inspected. This is a screenshot/source review, not a live Grok pixel comparison, physical-phone verification, or mail-service compatibility test.

## persistence

Pass. PRODUCT.md, the existing DESIGN.md, and .impeccable/surfaces/automations.md exist and preserve the previously confirmed Grok-aligned Newbot world. FORM's `seed: none (pinned)` is supported by the supplied user instruction to preserve the original UI and place this entry immediately below New Chat; no new visual concept or comp approval is required. All 15 named captures under .impeccable/review/automations/ were opened and inspected. Their content and viewport widths match their names; editor and mail captures intentionally show the internal scroller near its bottom, with fixed headings/actions. They are valid evidence for those states, not first-open captures. 320px is represented by the required mail capture. The supplied fixture labels and example.test addresses disclose the demonstration data. No raster production or asset-provenance obligation arises from this UI.

## fidelity

| Element / promise | Finding | Evidence |
| --- | --- | --- |
| TYPE / OWN-WORLD | match | The modest sans-serif headings, compact Chinese control text and subdued secondary labels continue the established app. No replacement display face. The detector's 12/13/18/22/24px advisories are already covered in DESIGN.md's component prose; they do not establish a new typography system. |
| MATERIAL | match | Flat lists, thin dividers, functional SVG icons and opaque modal surfaces are native to this product. No imitation physical material, gratuitous illustration or decorative effect. |
| GROUND / OWN-WORLD | match | The inspected light and dark captures maintain the documented white and warm-black fields, neutral supporting surfaces and monochrome primary controls. This is a visual comparison with DESIGN.md, not measured fidelity to live Grok. |
| Navigation / FIRST VIEWPORT | match | Desktop captures show the original sidebar proportions and Automatic Tasks directly below New Chat; mobile keeps the existing topbar/drawer entry. |
| List composition / FIRST VIEWPORT | match | An approximately 800px content region, title and creation action, restrained task rows and ample empty space preserve the compact Operate layout without a new dashboard. |
| Search field / OWN-WORLD | contradicted | All list captures show an inner rounded input border inside the search pill. At 390px the editable region is especially cramped. Automations.tsx uses .catalog-query but omits input.catalog-search, which is required by web/plugins.css for the shared field reset and sizing. |
| Notification settings / FIRST VIEWPORT | contradicted | In both themes and viewport sizes, the mail-settings label runs directly into the following bell icon. The container has no layout gap; gap on each individual button cannot separate siblings. These are two distinct controls visually joined as one phrase. |
| Editor hierarchy / STORY | match | Trigger, instruction with existing capabilities, model and notification follow the official evidence's hierarchy. Modal header and actions stay visible while the body scrolls. The supplied official-ui-structure.json supports this hierarchy, not exact login-product geometry. |
| Mail configuration / STORY | adaptation | Local SMTP configuration is warranted by the user's explicit email-notification answer and the private Newbot product. The observed connection rejection is visible beside the fixed actions; no successful delivery is fabricated. |
| Mail form finish / OWN-WORLD | contradicted | Each new field label nearly touches the previous field, while its own input is farther away. The raw “Choose File / No file chosen” control interrupts the Chinese form and the inherited control treatment in all mail captures. AutomationMailSettings.tsx has no localized file-picker presentation; .automation-mail-fields has no inter-field rhythm. |
| Execution results / THESIS | match | Runs remain a sparse history with a clear Open Conversation action, rather than becoming an unrelated analytics dashboard. |
| Tabs / accessible operation | contradicted | Both filter and detail groups declare role=tablist/role=tab but implement only ordinary onClick buttons: no roving focus/arrow navigation or associated tabpanels. The source does not honor the keyboard interaction promised by those roles. |
| FORM / memory test | match | The first viewport is recognizably the existing Newbot app with a task list. The inheritance is the intended identity; no invented signature motif is necessary. |

## ceiling

The inherited world's appropriate devices are present: sparse rows, strong/quiet action contrast, compact icons, neutral dividers and restrained floating panels. No additional ornament, display lettering, hero imagery or depth would improve this extension. The remaining ceiling gap is control integration: the search field, adjacent notification actions and mail form do not yet look like the same finished control system. Motion, drag behavior and real keyboard/phone operation cannot be scored from these captures. The detector's isolated 8px choice radius is a minor documentation/consistency advisory, not a material direction failure. No craft-floor banned decoration was observed.

## material_fixes

1. **Shared search control / OWN-WORLD:** give the automation search input the existing catalog-search treatment, ensure the child can shrink inside its pill, and verify focused/unfocused, empty/filled search at 390px and 1280px in both themes; there must be one field boundary and one focus treatment, without the nested input box.
2. **Distinct notification actions / FIRST VIEWPORT:** add explicit inter-control spacing and wrapping to .automation-notification-setting, preserving concise text; the mail-settings action and browser-reminder bell/action must read and focus as separate controls at every supplied width.
3. **Mail form / craft-floor spacing and browser surfaces:** establish consistent space between field groups, with labels closer to their own controls; replace the visible native English upload presentation with a localized, keyboard-accessible certificate picker and filename/status using inherited control styles. Preserve the fixed footer, visible error and single body scroller; verify 320px/390px/1280px after the spacing change.
4. **Tabs / accessible operation:** use the app's tab primitive or implement the expected tab focus and panel relationships for Overview/Runs; for list filters, either implement complete tabs or use accurately labeled pressed filter buttons. Verify keyboard navigation and selection without changing the compact visual design.

## keep

Keep the original navigation/font/color/icon language, flat task rows, trigger → instruction → notification order, fixed modal controls, conversation-based results, visible failure feedback and explicitly limited official-reference claims.

---

## verdict

Verdict pass, 2026-11-16. All original 15 captures were reopened at their original paths, together with the 12 additional search-state captures and three mail-top captures. All 30 are valid for their named viewport/state. This pass scores the four findings above; it does not reopen the surface review.

1. **Resolved — shared search control.** The 390px and 1280px light/dark captures now show a single coherent search pill in all four filled/empty and focused/unfocused combinations. The inner input box is gone; mobile uses a full-width row with readable input content. Source applies catalog-search and shrinking flex sizing; tests/browser/automations.spec.ts asserts the input border is zero.
2. **Resolved — distinct notification actions.** All four list variants show clear space between 邮件通知设置 and the browser-reminder bell/action. The source supplies sibling layout, wrapping and an explicit gap; the controls no longer merge into one phrase.
3. **Resolved — mail form.** Top and bottom captures at 320px, 390px and 1280px show labels grouped with their own fields, consistent separation between groups, and the localized 选择证书 / 未选择 control. The error and fixed footer remain visible at the bottom; the top captures retain the fixed heading and actions while the form scrolls. The native English file control is hidden and the replacement is a real button with an accessible name.
4. **Resolved — tabs and filters.** Source now implements roving focus, Home/End/left/right selection and labeled tabpanel relationships; list filters use aria-pressed buttons. The recaptured runs retain the compact visual layout. The current tests assert End moves focus to Runs and reveals its named panel, then ArrowLeft selects Overview; the four corresponding lifecycle cases pass in /tmp/automation-browser-reviewed.log. Static captures alone do not prove keyboard behavior; source and recorded browser assertions provide that evidence.

## remaining

Clear. No regression introduced by this fix batch was observed. This ship verdict covers the scored fixes, not the whole surface. The original limitations on live Grok comparison, physical-phone verification and real mail delivery remain unchanged. Full-regression completion is outside this verdict pass.

disposition: ship
