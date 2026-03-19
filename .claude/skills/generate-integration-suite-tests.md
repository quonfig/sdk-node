# generate-integration-suite-tests

Generate static Vitest integration tests from the shared cross-SDK test suite.

## Context

Quonfig has a shared integration test suite in `integration-test-data/` that defines:
- **Test data**: JSON config/flag/segment files in `integration-test-data/data/integration-tests/`
- **Test definitions**: YAML files in `integration-test-data/tests/eval/` specifying inputs, contexts, and expected outputs

Every SDK must pass the same tests to guarantee behavioral consistency across 10+ languages. This skill generates **static, idiomatic Vitest test files** from the YAML definitions — no YAML parsing at runtime.

## What to generate

For each YAML file in `integration-test-data/tests/eval/`, generate a corresponding test file in `sdk-node/test/integration/`. For example, `get.yaml` → `get.generated.test.ts`.

Each test case in the YAML becomes its own `it()` block with explicit assertions. The test names come directly from the YAML test case names (no numbering — names are the cross-SDK identifier).

### Generated test structure

```typescript
// Code generated from integration-test-data/tests/eval/get.yaml. DO NOT EDIT.

import { describe, it, expect } from "vitest";
import { store, evaluator, resolver } from "./setup";

describe("get", () => {
  it("get returns a found value for key", () => {
    const cfg = store.get("my-test-key");
    expect(cfg).toBeDefined();
    const match = evaluator.evaluateConfig(cfg!, "Production", {});
    expect(match.isMatch).toBe(true);
    const { resolved } = resolver.resolveValue(
      match.value!, cfg!.key, cfg!.valueType, "Production", {}
    );
    const value = resolver.unwrapValue(resolved);
    expect(value).toBe("my-test-value");
  });
});
```

### Shared test setup

Create a non-generated `test/integration/setup.ts` that:
1. Reads all JSON config files from `integration-test-data/data/integration-tests/` (configs/, feature-flags/, segments/ subdirs)
2. Reads `environments.json` to get environment ID mapping
3. Assembles a `ConfigEnvelope` and loads it into a `ConfigStore`
4. Creates an `Evaluator` and `Resolver`
5. Exports `store`, `evaluator`, `resolver` for use by generated tests
6. Sets environment variables:
   ```typescript
   process.env.PREFAB_INTEGRATION_TEST_ENCRYPTION_KEY = "c87ba22d8662282abe8a0e4651327b579cb64a454ab0f4c170b45b15f049a221";
   process.env.IS_A_NUMBER = "1234";
   process.env.NOT_A_NUMBER = "not_a_number";
   delete process.env.MISSING_ENV_VAR;
   ```

The setup file reads JSON data files at runtime (so config data changes don't require regeneration), but the test cases themselves are static generated code.

## Step-by-step

1. **Read all YAML files** in `integration-test-data/tests/eval/`.

2. **Read the SDK source** to understand the API:
   - `src/store.ts` — `ConfigStore`, `store.get(key)`, `store.update(envelope)`
   - `src/evaluator.ts` — `Evaluator`, `evaluator.evaluateConfig(cfg, envID, contexts)`
   - `src/resolver.ts` — `Resolver`, `resolver.resolveValue(...)`, `resolver.unwrapValue(...)`
   - `src/context.ts` — `mergeContexts(a, b)`
   - `src/types.ts` — `ConfigResponse`, `ConfigEnvelope`, `Contexts`, `EvalMatch`, `Value`

3. **Read the Go reference implementation** at `sdk-go/internal/fixtures/runner_test.go` to understand edge cases and special handling.

4. **Create the setup file** (`test/integration/setup.ts`) that loads data and exports shared instances.

5. **For each YAML file**, generate a `<name>.generated.test.ts` file containing describe/it blocks. Each test case `name` from the YAML becomes the `it()` description.

6. **Each generated test should**:
   - Look up the config by key (from `input.key` or `input.flag`)
   - Build context as a `Contexts` object from the three-level hierarchy (merge local over block over global)
   - Call `evaluator.evaluateConfig(cfg, "Production", contexts)`
   - Call `resolver.resolveValue(match.value, ...)` then `resolver.unwrapValue(resolved)`
   - Assert the expected result

7. **Handle special cases**:
   - `get_or_raise` with `expected.status: raise` → wrap in `expect(() => ...).toThrow()`
   - `initialization_timeout` → `it.skip("requires network timing", ...)`
   - Duration → `expect(value).toBe(expectedMillis)` (unwrapValue already converts to millis)
   - JSON → `expect(value).toEqual(expectedObject)` (deep equality)
   - Missing config with `input.default` → assert default value
   - `client_overrides.on_no_default: 2` → handle undefined result gracefully
   - Configs with `prefab-api-key.*` criteria → skip if test doesn't provide that context AND the ALWAYS_TRUE fallback doesn't produce the expected result
   - String lists → `expect(value).toEqual(["a", "b", "c"])`

8. **Run tests**: `cd sdk-node && npm test`

9. **Add `// Code generated ... DO NOT EDIT.` header** to all generated files.

## YAML format reference

```yaml
function: get|enabled|get_or_raise|get_feature_flag|get_weighted_values
tests:
  - name: optional group name
    cases:
      - name: test case description    # THIS IS THE CROSS-SDK IDENTIFIER
        client: config_client|feature_flag_client|client
        function: get|enabled|get_or_raise
        type: STRING|INT|DOUBLE|BOOLEAN|STRING_LIST|JSON|DURATION
        input:
          key: "config-key"
          flag: "flag-key"
          default: <value>
        contexts:
          global: { contextType: { prop: value } }
          block:  { contextType: { prop: value } }
          local:  { contextType: { prop: value } }
        expected:
          value: <expected>
          millis: <number>
          status: raise
          error: <error_type>
          message: <string>
        client_overrides:
          on_no_default: 2
```

## Paths (relative to repo root)

- YAML test definitions: `integration-test-data/tests/eval/*.yaml`
- Test data (loaded at runtime): `integration-test-data/data/integration-tests/`
- Generated output: `sdk-node/test/integration/*.generated.test.ts`
- Shared setup: `sdk-node/test/integration/setup.ts` (non-generated)
- Reference implementation: `sdk-go/internal/fixtures/runner_test.go`
