# Chrome Web Store listing

## Summary

Hibernate tabs, windows, or full sessions to free memory, then restore their
structure on demand.

## Prominent data-use disclosure

Hibernate Tabs, Windows, and Sessions reads the URLs, titles, window membership,
and browser-visible state of open tabs so it can show, protect, hibernate, log,
and restore the tabs the user chooses. Hibernation records and activity history
stay in local extension storage. Optional website access adds only yes-or-no
signals for playing media, active capture, Picture-in-Picture, and modified
forms; it does not read form values or page text. The extension has no developer
server, analytics, advertising, or sale or transfer of user data.

## Description

Hibernate Tabs, Windows, and Sessions is a hibernation-focused tab organizer. It
stores local restore records before closing eligible tabs so their page
processes can be reclaimed. Restore one tab, rebuild a complete window, or
recreate a multi-window session later. Browser-bookmark copies are created only
when you select Bookmark.

Features:

- Hibernate the current tab, a highlighted multi-tab selection, its full window,
  or the complete browser session from the popup or tab-strip right-click menu.
  The popup lists the complete highlighted selection.
- Hibernate the active tab's complete group as one restorable group from the
  popup or tab-strip right-click menu.
- Automatically hibernate inactive tabs after 60 minutes by default, or choose
  Never, a preset, or a custom duration in minutes, hours, or days. Existing
  protection and Never-Hibernate rules remain active.
- Hibernate every eligible tab across available regular and private windows as
  one named session.
- Compare open and hibernated tab counts in the popup.
- Name archived windows and sessions, and rename archived tabs, windows, or
  sessions. Saved bookmark titles stay synchronized.
- View and text-filter archived tabs beneath their window and windows beneath
  their session.
- Select archived sessions, windows, or tabs and reorganize them into a new
  window or session, or detach children from their current parent.
- Pin archived tabs, groups, windows, or sessions to keep them above unpinned
  entries while preserving the selected secondary sort.
- Select direct text-filter matches, then restore, duplicate, delete, merge, or
  regroup the selected hierarchy with Undo and Redo support.
- Save permanent browser bookmark copies for any selected combination with one
  **Bookmark Selected** action, without removing existing bookmark copies.
- Drag archived items to merge, move, detach, or reorder them, with persistent
  Undo and Redo for up to 50 archive changes.
- Manage the same restore, bookmark, and permanent erase actions from the popup
  or a full Hibernated page, with rename controls on the full page.
- Add or remove a hibernated tab, window, or session in a separate permanent
  bookmark folder without removing it from the hibernation archive.
- Restore window order, pinned tabs, groups, and active-tab state.
- Keep automatic tab groups intact by waiting until every member is inactive and
  unprotected, or choose individual grouped-tab hibernation in Settings.
- Preserve selected live groups as archived groups, then create, rename, recolor
  with a horizontal circular-swatch palette, and reorganize groups from the full
  Hibernated page.
- Open the Hibernated page with the newest saved entries first.
- Restore the complete hibernation archive with one confirmed action.
- Review an automatically updating local activity log, then filter, export, or
  recover entries with preset or custom retention and the URLs involved in every
  operation.
- Export or merge-import full hibernation archives, activity history, and
  Never-Hibernate site rules as local JSON files. Archive backups use a
  self-describing nested format with strict validation before import.
- Protect pinned, audible, media-playing, modified-form, captured,
  excluded-site, and prohibited-URL tabs. Private tabs stay open by default.
- Archive and restore supported internal browser pages locally by default,
  without showing bookmark actions that cannot work for those URLs.
- Optionally ignore protection for one user-initiated window or session
  hibernation while still leaving prohibited URL types open.
- Configure private tabs to stay open, archive locally for private restoration,
  or close with Activity-only logging. Private archive entries are visibly
  marked and excluded from browser bookmark actions.
- Keep real bookmark URLs that still work after extension removal.

The extension performs its processing on-device. Archive records, activity
history, site rules, and optional page-safety signals remain local. General
protection preferences may be synced by Chromium when browser profile sync is
enabled.

## Single purpose

Reduce browser memory use by durably recording and closing selected tabs, then
restoring them on demand.

## Permission justifications

- `alarms`: wakes the service worker once per minute to check whether inactive
  tabs have reached the user-selected automatic hibernation delay.
- `tabs`: reads tab URLs, titles, ordering, last-active time, pin/audio/capture
  state, and window membership; closes explicitly or automatically hibernated
  tabs; and recreates restored tabs. This is the extension's core purpose and
  cannot be implemented with `activeTab`, which covers only one user-invoked
  tab.
- `storage`: keeps protection settings, local archive records, activity history,
  and bounded undo/redo state across browser restarts.
- `bookmarks`: creates, reconciles, renames, and removes browser bookmark copies
  only in response to explicit bookmark actions. It also migrates the legacy
  bookmark-backed archive format.
- `contextMenus`: provides separate tab-strip actions for hibernating one tab, a
  highlighted tab selection, a window, or a session, plus a website page and
  tab-strip action for adding one site or every highlighted site to Never
  Hibernate.
- `tabGroups`: reads group names, colors, collapsed state, and membership;
  preserves whole groups during automatic hibernation; and reconstructs groups
  during restore.
- `scripting`: registers and refreshes the optional on-device media/form safety
  observer after the user grants website access.
- Optional `http://*/*` and `https://*/*` host access: enables boolean safety
  signals for media, capture, Picture-in-Picture, and modified forms. It is not
  required for basic hibernation and can be revoked at any time.

## Privacy dashboard answers

- Single purpose: use the wording in the **Single purpose** section above.
- Data categories: disclose **Web history** because tab URLs and titles are
  processed and stored locally; disclose **User activity** because optional page
  protection derives boolean media/form activity signals. Do not claim
  collection of form values, page text, authentication data, personal
  communications, financial data, health data, or location.
- Data use: functionality only. No analytics, personalization, advertising,
  credit decisions, or sale of user data.
- Data handling: the extension does not transmit data to the developer or a
  third-party service. General protection preferences may be carried by the
  browser's profile-sync feature. User-initiated JSON export writes a local
  file.
- Certifications: certify that data use complies with the Chrome Web Store User
  Data Policy, including Limited Use, and that data is not sold or used outside
  the disclosed single purpose.

Re-check the dashboard's exact category labels when submitting; Google may
revise the form independently of this repository.

## Store assets

- Icon: `public/icons/icon-128.png` (128 by 128 pixels).
- Screenshot 1: `store-assets/hibernated-1280x800.png` (1280 by 800 pixels).
  Caption: **Keep Tabs, Windows, And Sessions Organized**
- Screenshot 2: `store-assets/popup-1280x800.png` (1280 by 800 pixels). Caption:
  **Hibernate One Tab Or Your Entire Browsing Session**
- Screenshot 3: `store-assets/activity-1280x800.png` (1280 by 800 pixels).
  Caption: **Review And Recover From Local Activity History**
- Screenshot 4: `store-assets/options-1280x800.png` (1280 by 800 pixels).
  Caption: **Choose Exactly What Stays Protected**
- Small promotional tile: `store-assets/small-promo-440x280.png` (440 by 280
  pixels).
- Marquee promotional image: `store-assets/marquee-1400x560.png` (1400 by 560
  pixels).

## Public URLs

- Homepage: `https://ilobaak.github.io/htws-extension-site/`
- Privacy policy: `https://ilobaak.github.io/htws-extension-site/privacy.html`
- Support page: `https://ilobaak.github.io/htws-extension-site/support.html`
