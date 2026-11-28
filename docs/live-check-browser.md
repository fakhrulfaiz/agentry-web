# Live check: browser cursor, recording, jobs, ports, task folders

Added 2026-11-27. About 15 minutes. Covers work from 2026-11-27: the agent cursor and larger live view, browser recording, background jobs in the Tasks tab, per-sandbox browser ports, task folders, and `.browser/` left out of changed files.

## 0. Prepare

1. In `~/code/dsh-agents-api`, make sure `develop` has `feat/browser-cursor`, `fix/browser-port-and-task-folders`, `feat/browser-recording` and `feat/session-jobs` (`git branch --merged develop`).
2. Restart the API (start `agentry-sandbox` first if it is not running). The web dev server can keep running.
3. Open http://localhost:3000. On Sandboxes, use an environment made from the **Web and browser** template (or create one).

## 1. Cursor and live view

New chat on that environment. Open the side panel's **Browser** tab before sending:

```
Open https://httpbin.org/forms/post. Fill in customer name "Ali", telephone "0123456789", email "ali@example.com", choose a Large pizza, tick bacon and cheese, write "Ring the bell twice" in the comments, then submit.
```

Expect:
- An arrow glides to each field, a ring appears on each click, and the field being typed into gets an outline.
- **Expand** opens a large, readable view, and the cursor works there too.
- The turn's changed files do not list anything under `.browser/`.

## 2. Recording

Same chat:

```
Record a video named "pizza-order" of you filling in that form again, then give me the file.
```

Expect:
- Tool cards "Started recording" and "Saved recording pizza-order.webm".
- `recordings/pizza-order.webm` plays in the side panel with the cursor drawn over it; seeking works.
- `recordings/pizza-order.cursor.jsonl` exists next to it.

## 3. Background jobs

Same chat (sandbox), then again in a local chat (no environment):

```
Start this in the background and don't wait for it: for i in $(seq 1 60); do echo tick $i; sleep 2; done. Then tell me it's running.
```

Expect:
- **Tasks** lists the job as Running with a ticking timer.
- Clicking it shows `tick 1`, `tick 2`, … updating live.
- **Stop** asks first; then the job shows Stopped and the agent gets a notice.

## 4. Browser ports (two chats, one sandbox)

Open a second chat on the same environment:

```
Open https://example.com in the browser and tell me the title.
```

While it runs, switch to the first chat's Browser tab. Expect each chat's Browser tab to show its own page, never the other chat's.

## 5. Task folders

```
Make a small sales report: a CSV of 10 fake sales, a chart PNG of them, and a short summary.md.
```

Expect the files in one folder (for example `sales-report/`), and the answer names the folder.

## 6. Clean up

Delete the test chats, and any environment made only for this check.

## If something fails

| Symptom | Likely cause |
|---|---|
| No cursor | The API is not running the new code (restart it), or see memory note "cursor arrow invisible in web app" |
| Video does not play | File over 100 MB (the API's serve limit), or the byte route's `Range` handling |
| No jobs listed | `feat/session-jobs` not merged in the API, or the API restarted (jobs live in memory only) |
| Another chat's page in the Browser tab | Port allocation not working; note both session ids |
| Files loose in the workspace root | Guidance only nudges the model; note the chat |
