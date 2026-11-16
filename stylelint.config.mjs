export default {
  rules: {
    "declaration-block-no-duplicate-properties": true,
    "block-no-empty": true,
    "color-no-invalid-hex": true,
    "declaration-property-value-disallowed-list": {
      "/^(transition|animation)(-duration)?$/": ["/\\b[0-9.]+m?s\\b/"],
      "/^(color|background-color|border-color)$/": ["/^#[0-9a-f]+$/i"],
    },
    "selector-disallowed-list": [
      "/\\.(plugins-modal|extension-tabs|sidebar-plugins)\\b/",
    ],
  },
};
