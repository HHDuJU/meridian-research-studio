# Tests

Node's built-in runner (`node:test`) with a TypeScript loader. No test framework dependency.

```sh
# once the package manifest is restored:
npm i -D tsx
npx tsx --test tests/*.test.ts
```

Until `package.json` is back in the tree, the tests can be run from a sibling harness that provides
`tsx`, `zustand`, `react`, `clsx` and `tailwind-merge`, and that redirects `./seed` (absent from the
export at `e27921e`) to an empty, labelled test double:

```sh
NODE_PATH=../harness/node_modules node --import tsx --import ../harness/hooks/stub-seed.mjs --test tests/*.test.ts
```

`tests/fixtures/` holds real, dated provider responses (see its README). Live network calls are not
made by any test.
