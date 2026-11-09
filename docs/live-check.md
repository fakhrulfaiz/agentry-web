# Live check: Agentry Web against a local Agentry

Run this once backend Tasks 5 (history and replay) and 6 (approvals and questions) are merged. It checks the F1 chat against the real API instead of the mock.

## 1. Start Agentry

In `~/code/dsh-agents-api`, start the `agents` profile with the development API key (see that repo's `AGENTS.md` and `docs/http-api.md`). The API listens on `http://127.0.0.1:3080`. Note the dev key (`agk_…`).

Check it answers:

```bash
curl -s -H "Authorization: Bearer $AGENTRY_DEV_KEY" -H 'OpenAI-Beta: agents=v1' http://127.0.0.1:3080/v1/agents?limit=1
```

## 2. Start the web app

```bash
export PATH=$HOME/.nvm/versions/node/v24.19.0/bin:$PATH
cd ~/code/agentry-web
AGENTRY_API_URL=http://127.0.0.1:3080 \
AGENTRY_WEB_AUTH=apikey \
AGENTRY_WEB_SESSION_SECRET="$(openssl rand -base64 32)" \
AGENTRY_WEB_MODELS=<a model the agents profile serves> \
pnpm dev
```

## 3. Check

Open `http://localhost:3000`.

1. You land on `/login`. Sign in with the dev key. You land on `/` with the model picker filled.
2. Send a message that makes the agent call a tool (for example "List the files in the workspace"). The page moves to `/c/<id>`, the reply streams, a tool card shows the tool name and an argument summary, and expanding it shows the full input and output.
3. Reload the page. The whole history shows once: your message, the tool card, and the reply, with no duplicated text.
4. Send a long request, then press Stop. The turn ends with a "Stopped" notice.
5. If the agent asks for approval or asks a question, the card appears with focus on its first control; answering resumes the turn.
6. Restart the Agentry API while a reply streams. The "Reconnecting…" pill shows, and the reply completes without duplicated text once the API is back.
7. Rename and delete a chat from the sidebar. Sign out from the user menu; you return to `/login`.
8. In the browser dev tools, check that no request, response, cookie or storage entry contains the dev key (the key is only sent once, in the sign-in form post).

Record the date, the backend commit, and any differences from the mock in the PR description.
