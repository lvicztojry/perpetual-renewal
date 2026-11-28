import assert from "node:assert/strict";
import { assertCompatibleUpdate, compareVersions } from "../scripts/prepare-native.mjs";
for (const [a, b] of [["1.0.1", "1.0.0"], ["1.0.0", "1.0.0-test.9"], ["1.0.0-test.10", "1.0.0-test.9"], ["2.0.0", "1.99.99"]]) {
  assert.equal(compareVersions(a, b), 1); assert.equal(compareVersions(b, a), -1);
}
assert.equal(compareVersions("1.0.0+build2", "1.0.0+build1"), 0);
for (const bad of ["1.0", "01.0.0", "1.0.0-test.01", "1.0.0-test..1"]) assert.throws(() => compareVersions(bad, "1.0.0"));
const previous = { productName: "fixture", androidVersionCode: 1, iosBuildNumber: 1, applicationId: "fixture.id", version: "0.1.0", dataFormat: 1, dataSchema: 1, migrations: [{ path: "1.sql", sha256: "old" }] };
const next = { ...previous, androidVersionCode: 2, iosBuildNumber: 2, version: "0.2.0", dataSchema: 2, migrations: [...previous.migrations, { path: "2.sql", sha256: "new" }] };
assert.doesNotThrow(() => assertCompatibleUpdate(next, previous));
for (const changed of [{ androidVersionCode: 1 }, { iosBuildNumber: 1 }, { productName: "new product" },{ applicationId: "different.id" }, { version: "0.0.9" }, { version: "0.1.0" }, { dataFormat: 2 }, { dataSchema: 0 }, { migrations: [] }, { migrations: [{ path: "1.sql", sha256: "rewritten" }] }]) {
  assert.throws(() => assertCompatibleUpdate({ ...next, ...changed }, previous));
}
console.log("Native release policy passed: stable identity, forward version ordering, immutable migration history, no implicit payload conversion or database downgrade.");
