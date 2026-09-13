import { ourongxing, react } from "@ourongxing/eslint-config"

// The preset uses pre-v2 names; preserve each rule's severity and options.
// https://github.com/Rel1cx/eslint-react/releases/tag/v2.0.0
const reactRuleRenames = {
  "react-dom/no-children-in-void-dom-elements": "react-dom/no-void-elements-with-children",
  "react/ensure-forward-ref-using-ref": "react/no-useless-forward-ref",
  "react/no-comment-textnodes": "react/jsx-no-comment-textnodes",
  "react/no-nested-components": "react/no-nested-component-definitions",
  "react/prefer-shorthand-boolean": "react/jsx-shorthand-boolean",
  "react/prefer-shorthand-fragment": "react/jsx-shorthand-fragment",
}

export default ourongxing({
  type: "app",
  // 貌似不能 ./ 开头，
  ignores: ["src/routeTree.gen.ts", "imports.app.d.ts", "public/", ".vscode", "**/*.json"],
}).append(react({
  files: ["src/**"],
  tsconfigPath: "./tsconfig.app.json",
})).override("antfu/react/rules", config => ({
  ...config,
  rules: Object.fromEntries(Object.entries(config.rules).map(([name, value]) => [
    reactRuleRenames[name] ?? name,
    value,
  ])),
}))
