# Hibernate Tabs, Windows, and Sessions

Hibernate Tabs, Windows, and Sessions is a memory-saving browser extension. It
was built because Chromium's tab suspension behavior did not reduce memory
reliably enough for the workflow it was meant to solve. Instead of leaving tabs
suspended, HTWS saves complete local restore records and closes the
corresponding tabs, allowing Chromium to reclaim their live page resources and
reduce browser memory pressure.

Users can later restore one tab, a complete window, or a multi-window session,
including its order, pins, groups, names, and active state. The yellow bookmark
control creates real browser bookmarks with the original site URLs when a copy
should remain available independently of the extension. Hibernating a session
remains local until the user explicitly selects its yellow bookmark control.

## Why HTWS closes tabs

Suspending or discarding a tab does not always produce the memory reduction a
user expects. HTWS uses a more direct lifecycle: persist the restore record
first, verify that it was saved, then close the selected tab. The browser no
longer has to keep that live page open, while HTWS retains the information
needed to reconstruct it later. HTWS does not claim an exact number of megabytes
saved because stable extension APIs do not expose reliable per-tab memory
measurements.

## Measured memory savings

A controlled Windows 10 benchmark compared HTWS with Chromium's native tab
discard across 10, 30, 60, and 100 tabs. Each condition used three fresh Brave
profiles, for 24 runs total. At the 10-second measurement point, HTWS released
11.7 to 13.2 times more median process working set than native discard. HTWS
also reduced the Brave process tree to eight processes after every workload,
while native discard retained the pre-action process count in these tests.

Read the complete
[memory savings benchmark](benchmark-results/HTWS-memory-savings-benchmark.pdf),
including the raw results, graphs, method, and limitations. These are controlled
synthetic results, not a promise of fixed savings. Real results vary by website,
browser version, system, and time after hibernation.

## Features

- Reduce browser memory pressure by closing hibernated tabs after their restore
  records are safely stored, rather than relying on native suspension alone.
- Hibernate the current tab, a highlighted multi-tab selection, its entire
  window, or the full browser session from either the popup or the tab-strip
  context menu. The popup lists every highlighted tab before the action runs.
- Hibernate the active tab's complete group as one restorable unit from the
  popup or tab-strip context menu. The group stays open when any member is
  protected unless the popup's Ignore protection option is selected.
- Automatically hibernate inactive tabs after 60 minutes by default, or choose
  Never, a preset, or a custom duration in minutes, hours, or days. Existing
  protection and Never-Hibernate rules still apply; internal and private tabs
  require separate opt-in scope controls.
- Hibernate every eligible tab across available windows as one named session,
  then optionally create a real `Session / Window / Tab` browser-bookmark
  hierarchy.
- Compare the number of open tabs with the number currently hibernated.
- Name a window or session before hibernating it and rename any archived tab,
  window, or session later. Renaming an explicitly saved item also updates its
  browser bookmark or bookmark-folder title.
- Derive an unnamed hibernated window's label from its first archived tab, with
  a site-hostname fallback when that tab has no title.
- Archive and restore supported `chrome://` and `brave://` pages locally by
  default without offering invalid browser-bookmark actions. Settings can keep
  these pages open or close and log them without an archive instead.
- Restore individual tabs, complete windows, or multi-window sessions, including
  order, pins, groups, and active-tab state.
- Automatically hibernate a tab group only after every member is inactive and
  unprotected, keeping the whole group open when any member is protected. A
  setting can instead evaluate grouped tabs individually.
- Preserve selected live-tab groups as real archived groups. On the Hibernated
  page, create groups, move or ungroup selected tabs, rename groups, and choose
  their browser group color from a horizontal palette of circular swatches.
  Recoloring an unnamed group keeps it unnamed, and legacy unnamed groups with
  blank internal identifiers are repaired automatically when loaded. Unsupported
  or future color values safely fall back to neutral grey; if a browser rejects
  color during restore, HTWS restores the group without forcing a color instead
  of failing the restore.
- Restore the complete archive at once after confirming the affected tab and
  window counts.
- Browse tabs nested under their archived window and windows nested under their
  session, with full-entry text filtering and sortable date/time, name, type,
  and bookmark columns on the dedicated Hibernated page. The page opens with the
  newest hibernations first.
- Manage the color-coded archive from a dedicated Hibernated page or directly in
  the popup, with matching restore, bookmark, and permanent erase controls.
  Rename controls remain on the full Hibernated page.
- Toggle a hibernated tab, window, or session in the permanent **Hibernate Tabs,
  Windows, and Sessions Saved Bookmarks** folder without consuming its
  hibernated entry. Turning the button off removes the exact browser bookmark or
  folder created by the extension.
- Bookmark any selected combination of archived sessions, windows, and tabs in
  one deduplicated, undoable action.
- Keep a bounded local activity log with date sorting, action/target/text
  filters, automatic live refresh, preset or custom retention, nested JSON
  export, and restore controls only for entries with recoverable data.
- Export and merge-import full hibernation archives, activity history, and
  Never-Hibernate site rules through validated local JSON files without
  replacing existing records. New archive exports use the documented,
  self-describing [portable archive format](ARCHIVE_FORMAT.md). Imports accept
  only the current HTWS identity and v2 archive format.
- Keep expanded archive rows and their visible positions stable while bookmark
  or rename updates refresh the page; re-sort only on a header click or reload.
- Select any combination of sessions, windows, or tabs, then merge them into a
  new window or session, move tabs out of windows, or move windows out of
  sessions. Empty parents are removed automatically.
- Shift-click archive checkboxes to select the inclusive visible range. Delete
  selected entries with Delete or Backspace, with a confirmation warning that
  can be disabled from the dialog and re-enabled in Settings. Row erases use the
  same warning. Single-entry warnings show the saved name and contained
  hierarchy totals; mixed selections show aggregate entry counts.
- Click a non-interactive part of an archive row to select or deselect that
  entry. Date and URL text remain selectable, and existing controls keep their
  original actions.
- Click an archived entry name to restore it. Hover or keyboard focus highlights
  the name and reveals its window-shaped restore icon without disabling row
  drag-and-drop.
- Drag tabs, windows, and sessions onto compatible targets to move or merge
  them; drop before/after to reorder, or drop on any non-entry page space to
  detach a tab or window into its own top-level row.
- Undo and redo up to 50 archive changes across browser restarts. Restore
  actions are excluded so Undo never closes live tabs; hibernating or restoring
  starts a fresh history baseline.
- Offer to merge same-scope windows or sessions when a rename conflicts; a
  declined merge leaves the original name and hierarchy unchanged.
- Clear every local hibernation record through a warned Clear All action without
  deleting permanent browser bookmark copies.
- Protect pinned, audible, media-playing, form-modified, captured,
  excluded-site, and prohibited-URL tabs. Private tabs stay open by default.
- Force one window or session hibernation past protection rules with an explicit
  **Ignore protection** checkbox; prohibited URL types still remain open.
- Choose whether private/incognito tabs stay open, archive locally for private
  restoration, or close with Activity-only logging. Private archive rows are
  marked and never expose bookmark controls. The browser must grant incognito
  access, and archived private URLs persist in extension storage shared with the
  regular profile.
- Use the page or tab-strip context menu to add the current website directly to
  Never Hibernate. With multiple highlighted tabs, add every selected website at
  once with **Never hibernate these sites**.
- Handle inventories of at least 1,000 tabs without keeping per-tab extension
  pages alive.

## Development

```powershell
npm install
npm test
npm run build
npm run acceptance:auto-hibernate
npm run acceptance:hibernation
npm run verify:store
```

Load `dist` as an unpacked extension in Brave or another Chromium browser.
Architecture and data flow are documented in
[`docs/architecture.d2`](docs/architecture.d2).
