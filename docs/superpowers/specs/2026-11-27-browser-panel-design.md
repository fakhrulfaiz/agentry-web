# Browser panel: browser-like live view (2026-11-27)

Status: proposed 2026-11-27. Awaiting approval.

## Why

The Browser tab is the agent's **sandboxed Chromium** (Playwright MCP running inside the sandbox). The API streams its newest frame; the tab also shows the current page, the latest tool screenshot, and the pages visited. "Take control" sends pointer, wheel and key events to that same page while the agent waits.

Today the tab reads like a generic panel: the page is a link in a header row, the frame is a plain `<img>` whose height follows each screenshot's aspect ratio, control/status banners sit above the frame, and visited pages are a permanent list. The viewport therefore shifts up and down as URLs, titles and control states change. The user asked for a conventional browser URL bar above a page that stays put.

## Goals / non-goals

- Goals:
  - A browser-like toolbar at the top: security icon, the current full URL (host plus path), an external-open action, one status language, and Take control / Hand back.
  - A fixed browser viewport: one stable aspect ratio, independent of URL, page title, frame dimensions and control state. Nothing above the page changes height.
  - Control, errors and history stay available, below the viewport, without pushing the page around.
  - Keep the existing Chromium/Playwright stream and takeover behavior, including Esc, 5-minute idle hand-back, and input mapping.
- Non-goals:
  - No new browser engine, navigation endpoint or address-bar typing. The URL field is a display with an external-open action; the agent drives navigation.
  - No change to `use-browser-live`, `useBrowserControl`, `browser-input` event shapes, or the panel's other tabs.
  - No new theme/font/palette; the Agentry theme and astryx components stay authoritative.

## Approaches considered

- **A. Browser chrome with a fixed viewport — chosen.** A real toolbar above a constant-ratio viewport; history becomes a disclosure below. Matches the request, keeps the page as the one memorable element, and leaves the input path intact.
- **B. Floating overlay.** A translucent toolbar over a near-full-bleed page. Rejected: it covers content, is awkward in a narrow panel, and makes keyboard focus/contrast harder.
- **C. Inspector console.** Toolbar, page, then a detail/timeline section below. Rejected: pushes the live page down and reads like devtools, not a browser.

## Design plan

### Compact token system

Project rules take precedence over a new palette: every value is an existing Agentry theme token, no raw hex or new font.

- Color (roles, using existing tokens): chrome `--color-background-surface`; viewport surround `--color-background-muted`; separators `--color-border`; URL/primary text `--color-text-primary`; secondary/label text `--color-text-secondary`; live/focus accent `--color-icon-accent` / `--color-accent`. Live/neutral dots keep their `StatusDot` variants.
- Type: Inter (`--font-family-body`) for the URL, buttons and labels; no new display face, no mono for small labels. JetBrains Mono keeps its existing code-only role elsewhere in the app.
- Layout: a single toolbar row, a fixed 16:10 viewport below it, then a quiet details area. All content is left aligned inside the panel; the viewport is centered on its surround.
- Principles: (1) the frame is the hero inside a deliberate browser window; (2) chrome is quiet and never changes height; (3) one state phrase per moment ("Live", "Watching", "You have control", "Control in another tab"); (4) only meaningful motion — the existing live dot pulse.

Self-critique against generic defaults: no gradient wash, no SaaS card kit, no all-caps eyebrow, no middle-dot meta strings, no numbered markers, no decorative arrow on actions, no mono labels, no fade-in-on-everything. The bold choice is the precise, fixed browser window; everything around it is disciplined.

### Toolbar

`BrowserView` renders one toolbar instead of the current header row, banners, and take-control row:

- left: `LockClosedIcon` for `https:`, `GlobeAltIcon` otherwise; the full current URL as text (`host` stronger, `path?query` secondary, ellipsized when narrow). The page title, when present, sits in a tooltip/accessible label rather than replacing the URL;
- right: `StatusDot` plus one short state text, `Spinner` only while a browser call runs, and the `Take control` / `Hand back` `Button`;
- the toolbar keeps one height in every state. Control-held and control-ended messages move below the viewport, never above it.

An external-open `Link` (new tab) sits at the end of the URL field. It is offered only for `http(s):` URLs.

### Fixed viewport

- A container with `aspectRatio: '16 / 10'`, `inlineSize: '100%'`, `overflow: 'hidden'`, a `--color-background-muted` surround, `--color-border` outline and `--radius-container` corners.
- Live frames and the latest tool screenshot both render inside it with `object-fit: contain`, filling the container box. Frame swaps already decode before replacing the image, so nothing flashes.
- Height now depends only on the panel's width, never on the URL, title, or screenshot dimensions. In a narrow panel the frame scales down; it never changes the toolbar's or viewport's position.
- While the user has control, `resize` targets the viewport's own ratio (clamped to the API's 320–1920 width range) instead of the screenshot's ratio, so the page fills the fixed viewport and input coordinates stay exact. `frameBox` keeps returning the element box; `toPagePoint` already subtracts letterboxing.

### Below the viewport

- Control explanation, control errors and the "you are watching" hint are `Text type="supporting"` lines under the viewport.
- "Pages visited" is a collapsed disclosure with a page count; expanding it shows the same page links in order. Default collapsed keeps the viewport high and the panel uncluttered.
- The existing empty/blocked `EmptyState`s stay for "no browsing yet" and the three reasons a chat cannot browse.

## Tests and verification

- Component tests: toolbar shows the full URL with the correct icon and external link; viewport has one stable box across live frames with different natural sizes and control states; control explanation and history appear below the viewport; takeover still sends input at the correct page coordinates.
- Keep `tests/component/browser-takeover.spec.tsx` green without weakening its assertions; add geometry/URL assertions there or in a sibling spec.
- Run `pnpm typecheck`, `pnpm test`, `astryx doctor --built src/ui/preview`, then a production build with the mock API and a browser screenshot check that the toolbar and viewport do not move between pages.
- Update `CHANGELOG.md` with a dated behavior-change bullet.

## Risks

- Letterboxing and resize while in control must agree with `toPagePoint`; covered by the existing coordinate tests plus a fixed-viewport case.
- The panel is narrow: the URL must ellipsize rather than wrap, and the toolbar must not wrap its buttons onto a second line.
- The disclosure must be keyboard accessible and must not trap focus inside the controlled frame.
