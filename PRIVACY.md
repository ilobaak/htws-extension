# Privacy policy

Last updated: November 14, 2026

Hibernate Tabs, Windows, and Sessions performs all hibernation decisions inside
the browser. It does not operate a server, sell data, transmit browsing data to
the developer, or include analytics.

## Chrome Web Store Limited Use

The use of information received from Google APIs adheres to the Chrome Web Store
User Data Policy, including the Limited Use requirements. Hibernate Tabs,
Windows, and Sessions uses browsing data only to provide its user-facing tab
hibernation, protection, activity-history, bookmark, and restore features. The
developer does not receive this data, allow humans to read it, use it for
advertising or credit decisions, or sell or transfer it to third parties.

Archive, activity, and Never-Hibernate site-rule exports are generated locally
as JSON files only when the user selects **Export**. Imports read user-selected
JSON files locally, validate their contents, and merge accepted records into
extension storage. Neither operation transmits the file or its contents.

## Data used

The extension reads tab URLs, titles, window membership, last-active time,
pin/group state, audio state, and limited browser-visible safety state. With
optional website access it records only boolean signals for playing media,
Picture-in-Picture, active streams, and modified forms. It never reads form
values or page text.

Hibernation stores restoration metadata locally. When the user selects
**Bookmark** or **Bookmark Selected**, the extension copies that tab, window, or
session into the separate **HTWS Saved Bookmarks** folder. Bookmarking a session
explicitly creates a real `Session / Window / Tab` hierarchy in that folder.
When the user selects **Remove bookmark**, the matching bookmark or folder tree
is removed. Local extension storage keeps archive reconstruction metadata and a
bounded activity log containing operation time, outcome, tab title, and URL.
Browser profile sync may sync protection settings; archive metadata and activity
history remain local.

Automatic hibernation keeps per-tab last-active timestamps in temporary
extension session storage so it can identify tabs that have reached the chosen
inactivity delay. These timestamps are cleared when the browser session ends.

## Permissions

- `alarms`: wakes the service worker periodically to check for inactive tabs
  that have reached the selected automatic hibernation delay.
- `bookmarks`: creates, reads, renames, and removes real-URL bookmark copies
  when the user selects **Bookmark** or **Remove bookmark**.
- `contextMenus`: adds **Hibernate this tab**, **Hibernate this window**, and
  **Hibernate this session** to the tab-strip menu, plus **Never hibernate this
  site** to website page and tab-strip menus.
- `tabs`: reads tab state and closes explicitly or automatically hibernated
  tabs, then recreates restored tabs.
- `tabGroups`: reads group names, colors, collapsed state, and membership so
  groups can be hibernated together, managed locally, and reconstructed during
  restore.
- `storage`: stores settings, archive metadata, safety signals, and activity
  history.
- `scripting` plus optional website access: observes boolean media/form safety
  signals when enabled.

The optional **Ignore protection** control for window and session hibernation
bypasses the extension's protection rules only for that user-initiated action.
It does not make prohibited URL types eligible and does not change the data the
extension reads or stores. Supported internal browser pages follow the user's
Internal Browser Pages setting.

Private/incognito access is optional and must be enabled by the user in the
browser's extension details. Private tabs stay open by default. If the user
chooses local private archiving or Activity-only logging, tab titles and URLs
are stored in extension storage that Chromium shares with the regular profile.
Private archive records restore into private windows and cannot be copied into
browser bookmarks by this extension.

Users may clear the activity log from its page, permanently erase individual
tabs, complete windows, or sessions from the Hibernated page or popup, remove
saved bookmarks through the browser, revoke website access, or remove the
extension. Real-URL bookmarks remain normal browser bookmarks after removal.
