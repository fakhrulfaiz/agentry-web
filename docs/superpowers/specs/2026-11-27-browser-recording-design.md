# Browser recording (tool version): design

Date: 2026-11-27. Repos: `~/code/dsh-agents-api` (tools, recorder) and `~/code/agentry-web` (video preview, tool titles).
Builds on: `feat/browser-cursor` (relay `pointer`/`focus` events) and `fix/browser-port-and-task-folders` (per-sandbox CDP ports), both API branches not yet merged to `develop` when this was written.

## Goal

When the user asks ("record a video of you filling in this form"), the agent records what its browser shows and saves a video file in the workspace that the user can play in the side panel, with the agent's cursor drawn over it.

## Decisions

- **Tools, not a skill.** Two API function tools, registered per chat in `gateway.ts` `mountBrowser()` right after the browser MCP is mounted, under exactly the same conditions (sandbox with the browser image, agent browser Auto/On). No per-agent switch in v1.
  - `browser_recording_start({ name?: string })`: starts recording the page the live view follows. Answers with the target path. Refuses if already recording in this session (`already_recording`) or the browser has not started yet (`browser_not_started`, tell the agent to open a page first).
  - `browser_recording_stop()`: stops, finishes the file, answers `{ path, duration_seconds, size_bytes, cursor_path }`. `not_recording` when idle.
  - Auto-stop (file still saved and reported in the next tool result or a log line): when the turn ends, after 15 minutes, or at 200 MB.
- **Recording runs in the sandbox, from the relay's frames.** The relay (`src/sandbox/browser-live-relay.ts`) gets a stdin command `{"type":"record","on":true,"path":...,"cursorPath":...}` / `{"type":"record","on":false}` (added to the command parser's allow-list, path must be inside the workspace's `recordings/` folder). While on, it spawns Playwright's bundled ffmpeg (`/opt/ms-playwright/ffmpeg-*/ffmpeg-linux`, find it by glob) and writes frames into it the way Playwright's own video recorder does: `-f image2pipe -c:v mjpeg -i pipe:0`, fixed 10 fps (`-r 10`), the last frame repeated to fill gaps so pauses keep their real length, VP8 into `.webm` (check Playwright's `videoRecorder` arguments and copy them; verify with the image's ffmpeg that mjpeg decode + vp8 + webm work). Each `pointer`/`focus` event is appended to the cursor file as JSON lines with its time offset from the start. On stop: close ffmpeg stdin, wait for exit, report.
- **Keep the relay running while recording.** Today the relay runs only while a viewer is connected (`browser-live.ts`). A recording holds an internal reader on the session's relay so it keeps running with no viewer, and releases it on stop.
- **Cursor: drawn on top, not baked in.** The sandbox has no image library and Playwright's ffmpeg is minimal, so v1 saves `<name>.webm` plus `<name>.cursor.jsonl`. The web player draws the cursor from the sidecar. A downloaded file has no cursor (accepted for v1).
- **Files:** `recordings/<name>.webm` in the workspace (`name` sanitised, default `recording-<yyyymmdd-hhmmss>`, `-2`, `-3` on clash). They show in Files and in the turn's changed files (they are deliverables; only `.browser/` is excluded).
- **Guidance** (append to the browser guidance section when the tools are mounted): record only when the user asks for a video or recording; start before the steps, stop when done; mention the file path in the answer.

## Web

- File preview: a video kind for `.webm` and `.mp4` (`src/artifacts/kind.ts` and the preview components), shown with a native `<video controls>` element at the panel's width. If a sibling `<name>.cursor.jsonl` exists, draw `BrowserCursor` over the video driven by `currentTime` (reuse the overlay; map with the video's intrinsic size as the page size, same letterbox maths as `toFramePoint`). Works for any video file, with or without a sidecar.
- Tool titles in `src/chat/browser-tools.ts`: "Started recording" / "Saved recording <file>" (with a link that opens the file in the side panel, as other file links do).
- Bytes come through the existing session file/artifact route (check the allow-list; videos need range requests to seek: support `Range` in the BFF byte route if it does not already).

## Out of scope (v1)

Automatic per-turn recording, a Replay list in the Browser tab, a per-agent switch, baked-in cursor and mp4 export, retention rules beyond "lives in the workspace until deleted".

## Open points to settle while building

- Whether turn end is observable where the tools live (find the hook; otherwise stop on session idle).
- Whether Playwright's ffmpeg in the image accepts the arguments above (try it; adjust and record what worked in the API change doc).
