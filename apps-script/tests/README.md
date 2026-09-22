# Reconciler tests

Plain node, no framework, no install. Apps Script globals are stubbed and
`ZendeskSync.gs` is `eval`'d, so the tests run against the exact file that
gets pasted into the Apps Script editor.

```bash
cd apps-script/tests
for f in *.test.cjs; do node "$f"; done
```

`.cjs` because the dashboard's `package.json` sets `"type": "module"`.

| Suite | Covers |
|---|---|
| `mapping.test.cjs` | Zendesk ticket → sheet columns; status map; `Parent::Child` leaf extraction; the boolean-`false` escalation case (`false \|\| ''` silently blanked it) |
| `reconcile.test.cjs` | audit writes nothing; stale status, solved-before-created and backfilled created dates corrected; sub-second drift **not** flagged; Summary/Remarks preserved; missing ticket appended |
| `dedupe.test.cjs` | `19` / `#19` / ` #19 ` collapse to one row; hand-written Remarks survive; other rows' writing merged in first; deletion bottom-up; circuit breaker refuses a bulk wipe |
