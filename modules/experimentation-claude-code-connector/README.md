# @featbit/experimentation-claude-code-connector

A small local bridge that lets the FeatBit experimentation web app drive your
own Claude Code CLI. The hosted web UI talks to this process over
Server-Sent Events; this process talks to the `claude` binary on your
machine. No code, prompts, or credentials leave your computer.

## Requirements

- Node.js 20 or newer
- [Claude Code CLI](https://docs.claude.com/claude-code) installed and logged in
  (run `claude` once and finish the login flow)

## Quick start

```sh
npx @featbit/experimentation-claude-code-connector
```

The connector listens at `http://127.0.0.1:3100` on the loopback interface
only. Open the FeatBit experiment page, choose **Local agent** in the chat
panel, and the page will connect automatically.

## Configuration

Environment variables (all optional):

| Variable          | Default                                                                          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`            | `3100`                                                                           | Listen port                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `HOST`            | `127.0.0.1`                                                                      | Bind address. Keep on loopback unless you know what you are doing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `CORS_ORIGINS`    | `https://app.featbit.ai,https://featbit.ai,http://localhost:3000`                | Comma-separated list of web origins allowed to talk to the connector. `*` to allow any.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `PERMISSION_MODE` | `bypassPermissions`                                                              | SDK permission mode: `default` (interactive prompt — will block headless), `acceptEdits` (auto-approve file edits only), `bypassPermissions` (no prompts), `plan` (read-only). Default is `bypassPermissions` because the connector is loopback-only on your own machine — the trust boundary is identical to running `claude --dangerously-skip-permissions`. The FeatBit release-decision skill needs to run `npx tsx` to query its database, which requires either this default or an explicit allowlist in `~/.claude/settings.json`. |

## Endpoints

| Method | Path                  | Purpose                          |
| ------ | --------------------- | -------------------------------- |
| GET    | `/health`             | Liveness probe                   |
| POST   | `/query`              | Start a streaming agent run (SSE)|
| GET    | `/query/sessions`     | List active sessions             |
| DELETE | `/query/sessions/:id` | Abort a running session          |

`POST /query` body:

```json
{
  "experimentId": "exp_abc123",
  "prompt": "What does the data say so far?",
  "maxTurns": 50,
  "cwd": "/path/to/working/dir",
  "allowedTools": ["Bash", "Read", "Write"]
}
```

Empty `prompt` triggers a bootstrap that loads the `featbit-release-decision`
skill at `~/.claude/skills/featbit-release-decision/`.

SSE events emitted on the response:

| Event           | Meaning                                |
| --------------- | -------------------------------------- |
| `stream_event`  | Partial text or tool-use deltas        |
| `message`       | Complete assistant turn                |
| `result`        | Final agent result                     |
| `system`        | System / status / boundary message     |
| `tool_progress` | Tool execution updates                 |
| `error`         | `{ "message": string }`                |
| `done`          | Empty terminator                       |

## Tool permissions

The connector does not impose its own tool allowlist — it loads your
`~/.claude/settings.json` and `.claude/settings.json` (project-level),
exactly like running `claude` interactively. Restrict tools there if you
want a tighter sandbox.

## Security notes

- Loopback-only by default. The connector binds to `127.0.0.1`, so other
  devices on your LAN cannot reach it.
- CORS allowlists the FeatBit web origin. Browser pages from other origins
  are blocked.
- No request authentication beyond CORS — keep `HOST=127.0.0.1` to make this
  safe.

## Development

```sh
npm install
npm run dev          # tsx watch on src/bin/cli.ts
npm run typecheck
npm run build
```

## Publishing

> Notes for maintainers cutting a new release. This package lives under the
> `@featbit` npm scope; only org members can publish.

### One-time auth setup

The npm account that publishes must:

1. Be a member of the `@featbit` org with write access (`npm org ls featbit`).
2. Have a **Granular Access Token** in `~/.npmrc` (a "Classic Token" of type
   `Publish` will be rejected by npm's 2FA-on-write enforcement). Create one
   at <https://www.npmjs.com/settings/~/tokens>:
   - Permissions: **Read and write**
   - Packages and scopes: `@featbit/*`
   - Organizations: **Read only**
   - Token expiration: 90 days
3. Either:
   - Set the npm account's 2FA mode to **Authentication only**, *or*
   - Plan to pass `--otp=<6-digit>` on every `npm publish`.
   With "Authentication and write actions" enabled and no OTP, publish will
   fail with a 403 even when the granular token is correct.

Drop the token into `~/.npmrc`:

```
//registry.npmjs.org/:_authToken=npm_…
```

Verify with `npm whoami` — it should print the publishing account.

### Cutting a release

```sh
cd modules/experimentation-claude-code-connector

# 1. Bump version (also writes a git tag)
npm version patch        # 0.1.0 → 0.1.1, bug fix
# npm version minor      # 0.1.0 → 0.2.0, backwards-compatible feature
# npm version major      # 0.1.0 → 1.0.0, breaking change

# 2. Publish. The `prepublishOnly` script in package.json runs typecheck +
# build before the upload, so dist/ is always fresh.
npm publish
# If 2FA-on-write is enabled, add --otp=<your-current-6-digit-code>.

# 3. Push the version commit and tag
git push --follow-tags
```

### Verifying a published version

Run from a directory **outside** this repo so npx fetches the published
tarball instead of resolving a local link:

```sh
cd ~
npx @featbit/experimentation-claude-code-connector@latest
```

You should see the startup banner, ending with `Listening at
http://127.0.0.1:3100`.

### Common pitfalls

- **403 "Two-factor authentication or granular access token with bypass 2fa
  enabled is required"** — the auth token in `~/.npmrc` is a Classic Token
  without bypass-2FA, or your account has "Authentication and write actions"
  enabled but you didn't pass `--otp`. Switch to a Granular Access Token (or
  add `--otp`).
- **Cannot publish over an existing version** — npm rejects re-publishing the
  same version number. Bump first.
- **`unpublish` window is 72 hours** — after that the version is permanent;
  use `npm deprecate` to discourage installs instead.
- **Stale `dist/`** — `prepublishOnly` should prevent this, but if you
  bypass it (`npm publish --ignore-scripts`), users will install old code.

## License

MIT
