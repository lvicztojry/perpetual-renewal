import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "miniprogram/vendor/**",
      "native/dist/**",
      "native/src-tauri/target/**",
      "native/src-tauri/gen/**",
      ".tmp-native-qa/**",
      "dist/**",
      "coverage/**",
      "prisma/dev.db"
    ]
  }
];

export default config;
