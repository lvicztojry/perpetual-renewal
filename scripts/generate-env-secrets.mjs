import { randomBytes } from "node:crypto";

const secretNames = [
  "USER_KEY_VAULT_SECRET",
  "SESSION_COOKIE_SECRET",
  "PROACTIVE_CRON_SECRET",
];

console.log("Generated local/deployment secrets");
console.log("Paste these values into .env.local or deployment secrets only.");
console.log("Do not commit the generated values.\n");

for (const name of secretNames) {
  console.log(`${name}="${randomBytes(48).toString("base64url")}"`);
}
