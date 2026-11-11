# dms-pages: live pages

Part of [REFERENCE.md](REFERENCE.md). A `docs/<path>` link is `https://dms.antelopejs.com/docs/<path>`.

- A monitoring page that must not refetch on every event declares `live: { maxRate }` in its page
  options (`slowRateAfter: { period: "7d", maxRate: 60 }` for long periods, `rememberKey: "<module>"`
  to share the choice; `maxRate` is also the polling interval while the stream is down) and places a
  `LiveToggle()` (Live / Pause, L key; `variant: "pill"`, `missedLabel` for "N new requests").
- A page with a period or live data starts with `pageToolbar({ leading, live, period })`
  (`base/page-toolbar`): the same bar on every page — leading blocks, then "Updated N s ago",
  Live / Pause, the window and the 1H / 24H / 7D / 30D presets, at one `size` and one height
  (24 / 28 / 32 px, with live or not). `live: false` or `period: false` drops a control; without
  `live` it shows the last read and a refresh button. A module's leading chip takes the toolbar's
  height from `usePageToolbarSize().heightClass`. More than one comparison offered
  (`comparisons: ["previous-period", "previous-year", "none"]`) draws a menu naming the compared window ("vs 16 – 17 Oct ▾", the range label then
  without its "vs …"); a single one
  stays on without a control. A `custom` preset shows as a calendar icon, named in full.
  `live` / `period` also take `childId` (keep an id roles already grant, `live` / `period` by
  default) and `meta` (roles-editor name), so a page never builds the toolbar by hand for that;
  `transformOptions` changes a child's options at each registration (a setting read in
  `construct()`) — never patch the toolbar's children afterwards;
  an editor reads the default children from the block type's `initialChildren`.
  A component may draw `<DmsPageToolbarBlock>` and `<DmsLiveToggleBlock>` itself, around controls
  of its own: neither needs a `componentId` or `pageId` there.
- `liveHold: true` keeps a table's rows while paused, and in Direct while they are on screen unless `whileOnScreen: false` (new
  rows wait behind a "N new · Show" pill over the rows, counting the rows the table's query matches now beyond those held, through its count route); `liveHold: { whileRowOpen, whileScrolled,
whileSearching, whileSorted }` also holds the table alone; `liveHold.missedLabel` words its "N new".
  Paused, an event counts as its `payload.ids` rows or its `payload.count`, so a module may batch
  publishes with `{ count }`. A hidden tab and `?live=0` pause the page too.
- A custom component follows that state with `usePageLive()` (`hold(reason)` / `release()`,
  `setMissedDetail()`); one that reads its own data on a topic calls
  `usePageLiveRefresh(refresh, { realtimeTopic, idleRefresh })` — never a throttle of its own.
  `refreshPageBlocks()` (user actions) always reads; `refreshLivePageBlocks()` (timers, feeds) is
  held while paused. A table view's write (row/bulk action, its form saved) already
  calls `refreshPageBlocks()`: KPIs and badges of the page need no wiring of their own.
- Making a block live: a built-in data block names a `realtimeTopic` (its builder registers the
  topic on the page) and the backend calls `PublishMessage`; a table view follows its controller's
  row events by itself. A block without a topic reads only on `refreshLivePageBlocks()`, the
  polling while the stream is down and `refreshPageBlocks()` — no timer while the stream is up. A
  custom component's own topic needs `RegisterPageTopic(pageId, topic)` in the backend.
- Pause (user, hold, hidden tab) freezes every block of the page at once: realtime events, row
  events, page-topic events behind `useApiData`, `refreshLivePageBlocks()`, `idleRefresh`, the
  stream-down polling and a component's `useApiData` `refreshInterval`. Each block that missed
  something reads once on resume. User actions and inputs (period, filter, search, sort, page)
  still read; notifications, presence and the menu are not the page and keep updating.
