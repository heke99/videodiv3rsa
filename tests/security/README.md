# Security tests

## RLS (`rls.sql`)

Verified against a real Postgres, because what is being tested is how Postgres
applies the policies rather than how we believe it does.

```bash
psql "$DATABASE_URL" -f tests/security/rls.sql
```

Every row of the output must show `passed = true`. The script runs inside a
transaction it rolls back, so it is safe against a live database and leaves
nothing behind.

**Last run:** 29 checks, all passing, against the `videodiv3rsa` project.

### What it covers

| Series | Question |
|---|---|
| A | Can an ordinary user reach outside their organisation, or write anything they should not? |
| B | Can a second tenant see or change the first tenant's work? |
| C | Can platform staff operate the platform without reading customer projects? |
| D | Does an unauthenticated caller see anything at all? |
| E | Did anything a denial reported actually stay unchanged? |

### The subtlety that matters

An `UPDATE` or `DELETE` filtered by RLS **succeeds having touched nothing**
rather than raising. A naive harness reads that as success and reports a policy
hole where there is none — which is exactly what the first version of this
suite did on three checks. `try_write` therefore checks the row count for
anything that is not an insert, and the E series confirms independently that
the underlying data is unchanged.

## Other security tests

- `no-external-ai.spec.ts` — asserts the count of external generation providers
  is zero across source, lockfiles and Python requirements.
- `uploads.spec.ts` — content typing by magic bytes, size limits, and filename
  handling.
