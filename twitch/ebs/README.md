# Twitch EBS (Extension Backend Service)

One AWS Lambda behind its own HTTP API (`r8xvmhusi7`, eu-north-1, stack `adplus-twitch-ebs`) under `/twitch/*`,
one DynamoDB table, secrets in SSM. The desktop app POSTs draft states here; the Lambda
stores them and relays the compact state to viewers via Twitch Extension PubSub.

Protocol types come from `src/shared/types/twitch.ts` (type-only imports). The router
(`src/router.ts`) is pure and fully covered by `test/router.test.ts`.

## Routes

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/twitch/pair/start` | Twitch extension JWT, role `broadcaster` | Issue an 8-char pairing code (10 min, single use) |
| POST | `/twitch/pair/complete` | none (code) | Exchange the code for a channel token |
| POST | `/twitch/channels/{id}/publish` | channel token | Store compact (+ rich), relay compact via PubSub |
| GET | `/twitch/channels/{id}/state` | none | Rich state (`ETag: "<draftId>-<rr>"`, 304 supported) |
| GET | `/twitch/channels/{id}/compact` | none | Latest compact for late joiners |
| GET | `/twitch/channels/{id}/status` | none | Pairing/publish status for the config page |
| POST | `/twitch/channels/{id}/unpair` | channel token | Revoke |

Refusals on publish use the shared `TwitchPublishResponse` codes: `unauthorized` (401),
`version` (400), `bad_request` (400), `too_large` (413), `stale` (409), `rate_limited`
(429 + `Retry-After`).

## Local development

```bash
cd twitch/ebs
npm install
npm run dev            # http://127.0.0.1:8787/twitch, in-memory store, PubSub logged
npm test
npm run typecheck
```

Dev-only helpers on the dev server: `GET /dev/pair-code?channelId=123`,
`GET /dev/jwt?channelId=123&role=broadcaster`, `GET /dev/dump`.

Point the desktop app at it: `TWITCH_EBS_URL=http://127.0.0.1:8787/twitch` in the repo's
`.env`. Set `TWITCH_EXT_SECRET`, `TWITCH_CLIENT_ID`, `TWITCH_OWNER_ID` (and optionally
`TWITCH_CLIENT_SECRET`) to have the dev server talk to Helix for real.

## Deploy (first time)

1. Create the extension in the [Twitch developer console](https://dev.twitch.tv/console/extensions);
   note the **Client ID**, the **Extension Secret** (base64) and your **owner user id**.
2. Store the secrets (SecureString) once:
   ```bash
   aws ssm put-parameter --region eu-north-1 --type SecureString --name /twitch-ext/secret --value '<base64 secret>'
   aws ssm put-parameter --region eu-north-1 --type SecureString --name /twitch-ext/client-id --value '<client id>'
   aws ssm put-parameter --region eu-north-1 --type SecureString --name /twitch-ext/owner-id --value '<owner user id>'
   # optional, enables channel display-name lookup on pairing:
   aws ssm put-parameter --region eu-north-1 --type SecureString --name /twitch-ext/client-secret --value '<client secret>'
   ```
3. Install the [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
   and deploy:
   ```bash
   npm run deploy     # esbuild bundle -> sam build -> sam deploy (settings in samconfig.toml)
   ```
   The stack owns its HTTP API (`ADPlus-Twitch-EBS`), the DynamoDB table and the Lambda;
   the website admin API is untouched (its gateway-level CORS is restricted to
   tiarinhino.com origins, which is why the Twitch routes cannot live there).
4. Verify: `curl https://r8xvmhusi7.execute-api.eu-north-1.amazonaws.com/twitch/channels/1/compact`
   → `404 {"error":"none"}`.

Throttling: the template sets API-wide defaults (100 rps, burst 200) and tighter
`RouteSettings` on the two pairing routes (5 rps, burst 10) as a brute-force guard; the
per-channel rate limit in the router (`MIN_PUBLISH_INTERVAL_MS`) bounds publish traffic.
CORS is handled at the gateway (`AllowOrigins: *`, no credentials).

## DynamoDB layout

Single table `TwitchExtensionTable` (pk/sk, TTL attribute `ttl`):

- `PAIR#<code>` / `PAIR` — pairing codes (TTL = expiry)
- `CHANNEL#<id>` / `TOKEN` — sha256 of the channel token, pairedAt, appVersion, channelName, lastPublishAt
- `CHANNEL#<id>` / `COMPACT` — latest compact JSON (small, ~1/s while drafting)
- `CHANNEL#<id>` / `RICH` — latest rich JSON (tens of KB, once per draft)
