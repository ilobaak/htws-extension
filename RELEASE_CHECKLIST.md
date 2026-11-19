# Release checklist

- [x] Run formatting, lint, unit tests, build, packaging, and store-asset
      validation.
- [ ] Load the production `dist` directory in a clean Brave profile.
- [ ] Hibernate the current tab and verify its complete local archive record is
      persisted before closure.
- [ ] Right-click a tab and verify **Hibernate this tab** closes it after
      archival.
- [ ] Highlight multiple tabs and verify the popup lists the complete selection,
      says **Hibernate tabs**, and archives only the eligible selected tabs.
- [ ] Right-click a highlighted multi-tab selection, choose **Hibernate selected
      tabs**, and verify selected group names, colors, membership, and order
      appear as groups on the Hibernated page.
- [ ] On a grouped tab, verify **Hibernate group** appears in the popup and
      tab-strip menu, saves every member as one group, and keeps the entire
      group open when any member is protected unless Ignore protection is
      selected.
- [ ] With multiple website tabs highlighted, verify **Hibernate this tab** is
      hidden and **Never hibernate these sites** adds every selected hostname.
- [ ] Right-click a tab and verify **Hibernate this window** archives eligible
      tabs in that window.
- [ ] Right-click a website page and its tab, choose **Never hibernate this
      site**, and verify the hostname appears in Settings.
- [ ] Export Never-Hibernate site rules, import the backup, and verify new rules
      merge while duplicates are skipped.
- [ ] Export the archive in portable v2 format, re-import it without creating
      duplicates, and verify deprecated identities and v1 files are rejected
      without changing the current archive.
- [ ] Verify **Ignore protection** includes a protected supported tab for window
      and session hibernation, while prohibited tabs remain open and private
      tabs follow the selected Settings behavior.
- [ ] With browser incognito access enabled, verify all three private-tab
      behaviors. Archived private tabs must show a hover-explained **Private**
      indicator, omit bookmark actions, and restore into private windows.
- [ ] Verify the popup open-versus-hibernated meter and archive summary resolve
      without remaining on **Checking**.
- [ ] Hibernate a named multi-tab window and verify tabs appear nested beneath
      it.
- [ ] Rename an archived window and verify the bookmark folder and popup update.
- [ ] Restore one tab and verify its entry disappears immediately.
- [ ] Restore the last tab in a window and verify the empty window entry
      disappears.
- [ ] Restore a whole window and verify order, pins, groups, active tab, and
      archive removal.
- [ ] Verify restore buttons do not remain stuck on **Restoring…**.
- [ ] Verify activity entries contain every URL for window hibernation and
      restoration.
- [ ] Verify popup and Hibernated page can erase one tab, preserve remaining
      tabs, and remove a complete archived window after confirmation.
- [ ] Bookmark one hibernated tab and one window from both archive surfaces;
      verify yellow controls create copies under **Hibernate Tabs, Windows, and
      Sessions Saved Bookmarks** without consuming hibernated entries.
- [ ] Select each yellow bookmark control again and verify the exact browser
      bookmark or folder is removed while the hibernated entry remains.
- [ ] Select nested and top-level entries, choose **Bookmark Selected**, verify
      parents deduplicate their selected children, then verify Undo and Redo.
- [ ] Force a restore post-processing failure and verify the partial live
      tab/window is removed while the local archive remains available for retry.
- [ ] Disable the extension and verify archived bookmarks still open the
      original sites.
- [ ] Test with pinned, audible, media-playing, modified-form, excluded-site,
      and unsupported tabs.
- [ ] Verify automatic hibernation defaults to 60 minutes, archives only
      inactive eligible tabs, leaves active and protected tabs open, supports
      Never and custom minute/hour/day durations, and excludes internal and
      private tabs until their scope controls are enabled.
- [ ] Verify the default grouped-tab mode waits for every member to become
      inactive and leaves the whole group open when any member is active or
      protected; verify individual mode evaluates each grouped tab separately.
- [ ] Switch the automatic grouped-tab behavior between Together and
      Individually and verify its explanatory copy updates immediately to the
      selected mode.
- [ ] Create, rename, recolor, move into, and ungroup an archived group; export
      and re-import it and verify title, color, collapsed state, membership, and
      tab order survive. Verify group colors use one horizontal row of solid
      circular swatches with no arrow, and indigo group rows remain distinct
      from tab, window, and session rows.
- [ ] Recolor an unnamed archived group and verify the new color persists
      without assigning a synthetic name. Repeat with a legacy blank group key
      and with an empty-string browser group title; verify both are repaired
      without losing membership.
- [ ] Inject an unsupported archived/imported group color and verify it becomes
      neutral grey. Simulate browser color rejection during restore and verify
      the group still restores using the browser's default color.
- [ ] Expand nested popup sessions and windows and verify their left and right
      container walls remain continuous beside indented child rows. Verify each
      left wall begins at its own child-container indentation rather than the
      parent entry's outer edge, and that its color matches the nested window or
      tab entry border it contains.
- [ ] Verify the popup archive action row starts with the left-aligned **View**
      button and its three overlapping windows, followed by Export and Import.
- [ ] Verify the popup footer starts with the matching icon-only View control,
      followed by Activity and Settings, and the Settings gear is blue-neutral.
- [ ] Open a group color palette while its group row is collapsed and verify the
      complete nine-color palette remains visible above all archive containers.
- [ ] Reload the Hibernated page and verify the newest entries appear first.
- [ ] Pin and unpin tabs, groups, windows, and sessions. Verify pinned entries
      stay above unpinned entries under every secondary sort and survive archive
      export/import.
- [ ] Filter the archive, toggle **Select Matched**, duplicate and delete a
      mixed hierarchy selection, and merge equal-level and mixed-level entries.
- [ ] Select one archive entry, Shift-click another visible entry, and verify
      the complete inclusive range is selected in the current sorted and
      filtered order.
- [ ] Click non-interactive date-cell space, type cells, counts, and row
      backgrounds to toggle selection. Verify clicking date/URL text, entry
      names, disclosure arrows, and action controls does not toggle selection.
- [ ] With archive entries selected, verify Delete and Backspace open the same
      confirmation as **Delete Selected**, do nothing while editing the text
      filter, and erase only after confirmation.
- [ ] Verify every row erase uses that same confirmation. A single tab must be
      named; a single window or session must show its name and contained counts;
      mixed selections must show centered-dot-separated hierarchy totals.
- [ ] Select **Don't show this message again** in the deletion warning, verify
      the next selected deletion proceeds without the dialog, then re-enable
      **Confirm archive deletion** in Settings and verify the dialog returns for
      both row and selected-entry deletion.
- [ ] Select overlapping parent and child entries, choose **Restore Selected**,
      and verify every selected tab restores exactly once. Verify Undo and Redo
      restore the complete structure.
- [ ] Verify each group row keeps its color picker, rename, restore, and delete
      controls on one line without horizontal overflow.
- [ ] Click and keyboard-activate every archive entry name and verify the shared
      name-and-icon target restores the correct entry, does not toggle a
      disclosure row, and still permits dragging from the name.
- [ ] Run the 1,000-tab scale test.
- [ ] Confirm every visible button has an accurate hover explanation and every
      icon-only action has an accessible name.
- [x] Host the current privacy policy at a stable public HTTPS URL and verify
      the Limited Use statement is reachable from the submitted homepage.
- [ ] Reconcile the dashboard privacy answers, permission justifications,
      package behavior, and store description before submission.
