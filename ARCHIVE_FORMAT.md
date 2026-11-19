# Hibernate Tabs, Windows, and Sessions Archive Format

Hibernate Tabs, Windows, and Sessions exports hibernated tabs, windows, and
sessions as a portable JSON document. The current interchange format is
version 2.

## Compatibility Policy

- New exports use the latest format version.
- Imports support only the current HTWS product identity and format version 2.
  Files produced under the deprecated product identity or older format versions
  are intentionally rejected.
- Readers must ignore unknown object fields within a supported version. This
  permits additive metadata in future extension releases.
- Readers must reject an unknown `formatVersion` instead of guessing. The file
  remains intact and can be imported by a newer extension release.
- Export files never contain browser bookmark IDs or extension-local archive
  IDs. Importers generate new local IDs and merge without replacing existing
  records.
- Import is atomic: the complete file is validated before the local archive is
  changed. Exact duplicate top-level entries are skipped.

## Version 2 structure

The document root identifies the product and format:

```json
{
  "kind": "htws-archive",
  "product": "Hibernate Tabs, Windows, and Sessions",
  "formatVersion": 2,
  "exportedAt": "2026-11-11T20:00:00.000Z",
  "description": "Portable Hibernate Tabs, Windows, and Sessions archive...",
  "formatNotes": {},
  "archive": {
    "summary": { "sessions": 1, "windows": 1, "tabs": 2 },
    "entries": []
  }
}
```

`archive.entries` is the authoritative top-level display order. Every entry has
one of three discriminated shapes:

- `type: "tab"` — one standalone tab.
- `type: "window"` — one window with an ordered `tabs` array.
- `type: "session"` — one session with an ordered `windows` array; every window
  contains its own ordered `tabs` array.

A tab contains:

- `url` and `title` — the page to recreate and its saved display title.
- `position` — the original zero-based tab-strip position. Array order remains
  authoritative if another implementation does not preserve sparse positions.
- `active` and `pinned` — browser state to restore.
- `createdAt` — an ISO 8601 UTC timestamp.
- `private: true` — present only for private/incognito entries.
- `group` — optional `{ key, title?, color, collapsed }` metadata. Tabs sharing
  one `group.key` inside the same window belong to the same browser tab group.

Windows and sessions have `createdAt`, an optional `name`, and their nested
arrays. A private window has `private: true`, and every contained tab also has
`private: true`. Private and regular tabs are never mixed in one window.

A top-level window-shaped entry may include `kind: "group"`. Its tabs belong to
one preserved browser tab group, and their shared `group` metadata carries the
group name, color, collapsed state, membership, and order. Import retains that
entry as a first-class group on the Hibernated page. The field is additive
within format version 2, so readers following the compatibility policy may treat
it as an ordinary window while still preserving the nested group data.

## Reconstruction algorithm

1. Read `archive.entries` in order.
2. For a standalone tab, open its URL and then apply pinned, active, private,
   and optional group state.
3. For a window, create one browser window, create its `tabs` in array order,
   then apply positions, pinning, groups, and the active tab.
4. For a session, repeat the window procedure for each nested window in array
   order.
5. Treat `private: true` as a request for a private/incognito window. The
   browser must already allow the extension or importing application to create
   private windows.

`archive.summary` and `formatNotes` are descriptive. Reconstruction depends on
`archive.entries`, not on the summary counts.
