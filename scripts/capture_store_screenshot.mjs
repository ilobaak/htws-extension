/* global chrome, document, getComputedStyle, HTMLElement */

import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

import puppeteer from "puppeteer-core";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = resolve(root, "dist");
const outputDirectory = resolve(root, "store-assets");
const popupSource = resolve(tmpdir(), "htws-store-popup-source.png");
const bravePath =
  process.env.BRAVE_PATH ??
  "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";

await mkdir(outputDirectory, { recursive: true });

const browser = await puppeteer.launch({
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
  executablePath: bravePath,
  headless: true,
});

try {
  const worker = await browser.waitForTarget(
    (target) =>
      target.type() === "service_worker" &&
      target.url().startsWith("chrome-extension://"),
    { timeout: 15_000 },
  );
  const extensionId = new URL(worker.url()).host;
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error));
  await page.setViewport({ height: 800, width: 1280 });
  await page.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: "networkidle0",
  });
  const optionsWidth = await page.evaluate(
    'document.querySelector(".options-shell")?.getBoundingClientRect().width',
  );
  if (typeof optionsWidth !== "number" || optionsWidth < 1230) {
    throw new Error("The settings page did not fill the desktop viewport.");
  }
  const settingsContract = await page.evaluate(() => ({
    customRetentionAvailable:
      document.querySelector('#activity-retention option[value="custom"]') !==
        null &&
      document.querySelector("#activity-retention-custom")?.max === "36500",
    internalPageBehavior:
      document.querySelector("#internal-page-behavior")?.value === "archive" &&
      document.querySelectorAll("#internal-page-behavior option").length ===
        3 &&
      document
        .querySelector("#internal-page-behavior-help")
        ?.textContent?.includes("Bookmark controls are hidden"),
    incognitoBehavior:
      document.querySelector("#incognito-behavior")?.value === "keep-open" &&
      document.querySelectorAll("#incognito-behavior option").length === 3 &&
      document
        .querySelector("#incognito-behavior-help")
        ?.textContent?.includes("Allow in Incognito"),
    compactSections:
      Number.parseFloat(
        getComputedStyle(
          document.querySelector(".protection-settings .toggle-row"),
        ).paddingTop,
      ) <= 14 &&
      Number.parseFloat(
        getComputedStyle(document.querySelector(".retention-section"))
          .paddingTop,
      ) <= 17,
    headingsProminent: [
      ".protection-settings legend",
      ".retention-section h2",
      ".internal-pages-section h2",
      ".rules-section h2",
      ".reset-row h2",
    ].every(
      (selector) =>
        Number.parseFloat(
          getComputedStyle(document.querySelector(selector)).fontSize,
        ) >= 21,
    ),
    mainTitleMatches:
      Number.parseFloat(
        getComputedStyle(document.querySelector("h1")).fontSize,
      ) === 48,
    protectionTypography:
      Number.parseFloat(
        getComputedStyle(document.querySelector(".toggle-row strong")).fontSize,
      ) >= 17 &&
      Number.parseFloat(
        getComputedStyle(document.querySelector(".toggle-row small")).fontSize,
      ) >= 16 &&
      Number.parseFloat(
        getComputedStyle(document.querySelector(".retention-section p"))
          .fontSize,
      ) >= 17,
    protectionLabelHasNoColon:
      document
        .querySelector(".protection-settings legend")
        ?.textContent?.trim()
        .endsWith(":") === false,
    protectionRows: [
      ...document.querySelectorAll(".protection-options .toggle-row"),
    ].every(
      (row) =>
        getComputedStyle(row).display === "flex" &&
        Number.parseFloat(getComputedStyle(row).borderTopWidth) >= 1 &&
        Number.parseFloat(getComputedStyle(row).borderRightWidth) >= 1 &&
        Number.parseFloat(getComputedStyle(row).borderBottomWidth) >= 1 &&
        Number.parseFloat(getComputedStyle(row).borderLeftWidth) >= 1,
    ),
    protectionHeadingGap:
      document
        .querySelector(".protection-options .toggle-row")
        ?.getBoundingClientRect().top -
        document
          .querySelector(".protection-settings legend")
          ?.getBoundingClientRect().bottom >=
      32,
    titleCase:
      document.querySelector("h1")?.textContent?.trim() === "Settings" &&
      document.querySelector("#auto-hibernate-title")?.textContent?.trim() ===
        "Automatic Hibernation" &&
      document
        .querySelector(".protection-settings legend")
        ?.textContent?.trim() === "Do Not Hibernate These Tabs" &&
      document.querySelector("#retention-title")?.textContent?.trim() ===
        "Activity History" &&
      document.querySelector("#internal-pages-title")?.textContent?.trim() ===
        "Internal Browser Pages" &&
      document.querySelector("#incognito-pages-title")?.textContent?.trim() ===
        "Private And Incognito Tabs",
    autoHibernateControls:
      document
        .querySelector('#auto-hibernate-delay option[value="never"]')
        ?.textContent?.trim() === "Never" &&
      document
        .querySelector('#auto-hibernate-delay option[value="custom"]')
        ?.textContent?.trim() === "Custom" &&
      document.querySelectorAll("#auto-hibernate-unit option").length === 3 &&
      document.querySelectorAll("#auto-hibernate-grouped-tabs option")
        .length === 2 &&
      document.querySelector("#auto-hibernate-custom")?.getAttribute("min") ===
        "1" &&
      document
        .querySelector(".auto-hibernate-copy #auto-hibernate-grouped-tabs")
        ?.matches("select") === true &&
      document
        .querySelector(".auto-hibernate-scope > p")
        ?.textContent?.trim() === "Include in hibernation:" &&
      document
        .querySelector("#auto-hibernate-internal")
        ?.matches('input[type="checkbox"]') === true &&
      document
        .querySelector("#auto-hibernate-incognito")
        ?.matches('input[type="checkbox"]') === true,
    groupedTabHelpDynamic: (() => {
      const select = document.querySelector("#auto-hibernate-grouped-tabs");
      const help = document.querySelector("#auto-hibernate-grouped-tabs-help");
      if (select?.tagName !== "SELECT" || help === null) return false;
      const together =
        "Waits until every tab in the group is inactive and unprotected to hibernate. The group name, color, collapsed state, order, and membership of grouped tabs are preserved.";
      const individually =
        "Individually applies the inactivity and protection checks to each grouped tab separately. The group name, color, collapsed state, order, and membership of grouped tabs are preserved.";
      const initialMatches = help.textContent === together;
      select.value = "individually";
      select.dispatchEvent(new globalThis.Event("change", { bubbles: true }));
      const changed = help.textContent === individually;
      select.value = "together";
      select.dispatchEvent(new globalThis.Event("change", { bubbles: true }));
      return initialMatches && changed && help.textContent === together;
    })(),
    retentionChoices:
      document.querySelectorAll("#activity-retention option").length === 7,
    ruleTransferControls:
      document.querySelector("#export-site-rules")?.textContent?.trim() ===
        "Export" &&
      document.querySelector("#import-site-rules")?.textContent?.trim() ===
        "Import" &&
      document.querySelector("#export-site-rules .transfer-action-icon") !==
        null &&
      document.querySelector("#import-site-rules .transfer-action-icon") !==
        null &&
      document
        .querySelector("#site-rule-import-file")
        ?.matches('input[type="file"][accept*=".json"]') &&
      document
        .querySelector("#export-site-rules svg path")
        ?.getAttribute("d") === "M12 15V4" &&
      document
        .querySelector("#import-site-rules svg path")
        ?.getAttribute("d") === "M12 3v11",
    savesAutomatically:
      document.querySelector('#settings-form button[type="submit"]') === null,
    sectionsBoxed: [...document.querySelectorAll(".settings-panel")].every(
      (panel) => {
        const style = getComputedStyle(panel);
        return (
          style.borderTopWidth === "1px" &&
          style.borderRightWidth === "1px" &&
          style.borderRadius !== "0px"
        );
      },
    ),
  }));
  if (Object.values(settingsContract).some((value) => value !== true)) {
    throw new Error(
      `The settings layout contract is incomplete: ${JSON.stringify(settingsContract)}`,
    );
  }
  await page.screenshot({
    path: resolve(outputDirectory, "options-1280x800.png"),
    type: "png",
  });
  if (pageErrors.length > 0) throw pageErrors[0];

  const seededAt = Date.now();
  await page.evaluate(async (now) => {
    const tab = (bookmarkId, title, url, index, options = {}) => ({
      active: options.active === true,
      bookmarkId,
      createdAt: now - options.ageMinutes * 60_000,
      ...(options.groupKey ? { groupKey: options.groupKey } : {}),
      ...(options.incognito ? { incognito: true } : {}),
      index,
      pinned: options.pinned === true,
      title,
      url,
    });
    await chrome.storage.local.set({
      hibernateActivityLog: [
        {
          action: "hibernate",
          archiveId: "store-session",
          detail: "Archived 4 tabs across 2 windows.",
          id: "store-activity-1",
          occurredAt: now - 4 * 60_000,
          outcome: "success",
          tabs: [
            {
              title: "Extension Architecture",
              url: "https://docs.example.com/architecture",
              windowKey: "research",
            },
            {
              title: "Release Checklist",
              url: "https://docs.example.com/release-checklist",
              windowKey: "research",
            },
            {
              title: "Design References",
              url: "https://design.example.com/references",
              windowKey: "private",
            },
            {
              title: "Issue Triage",
              url: "https://work.example.com/issues",
              windowKey: "private",
            },
          ],
          target: "session",
          windowName: "Release Research",
        },
        {
          action: "restore",
          detail: "Restored from the hibernation archive.",
          id: "store-activity-2",
          occurredAt: now - 52 * 60_000,
          outcome: "success",
          tabs: [
            {
              title: "Project Dashboard",
              url: "https://app.example.com/dashboard",
              windowKey: "1",
            },
          ],
          target: "tab",
        },
        {
          action: "hibernate",
          detail: "One protected pinned tab stayed open.",
          id: "store-activity-3",
          occurredAt: now - 3 * 60 * 60_000,
          outcome: "partial",
          tabs: [
            {
              title: "Sprint Planning",
              url: "https://work.example.com/sprint",
              windowKey: "1",
            },
            {
              title: "Team Notes",
              url: "https://notes.example.com/team",
              windowKey: "1",
            },
          ],
          target: "window",
          windowName: "Planning Window",
        },
      ],
      hibernateArchiveStore: {
        schemaVersion: 4,
        sessions: {
          "store-session": {
            createdAt: now - 4 * 60_000,
            name: "Release Research",
            windowIds: ["store-window-1", "store-window-2"],
          },
        },
        topLevelOrder: [
          "session:store-session",
          "window:store-window-3",
          "window:store-window-4",
        ],
        windows: {
          "store-window-1": {
            createdAt: now - 4 * 60_000,
            entryType: "window",
            groups: {
              research: {
                collapsed: false,
                color: "blue",
                title: "Research",
              },
            },
            name: "Reference Window",
            sessionId: "store-session",
            sourceWindowId: 101,
            tabs: {
              "store-tab-1": tab(
                "store-tab-1",
                "Extension Architecture",
                "https://docs.example.com/architecture",
                0,
                {
                  active: true,
                  ageMinutes: 4,
                  groupKey: "research",
                  pinned: true,
                },
              ),
              "store-tab-2": tab(
                "store-tab-2",
                "Release Checklist",
                "https://docs.example.com/release-checklist",
                1,
                { ageMinutes: 4, groupKey: "research" },
              ),
            },
          },
          "store-window-2": {
            createdAt: now - 4 * 60_000,
            entryType: "window",
            groups: {},
            incognito: true,
            name: "Private Review",
            sessionId: "store-session",
            sourceWindowId: 102,
            tabs: {
              "store-tab-3": tab(
                "store-tab-3",
                "Design References",
                "https://design.example.com/references",
                0,
                { active: true, ageMinutes: 4, incognito: true },
              ),
              "store-tab-4": tab(
                "store-tab-4",
                "Issue Triage",
                "https://work.example.com/issues",
                1,
                { ageMinutes: 4, incognito: true },
              ),
            },
          },
          "store-window-3": {
            createdAt: now - 71 * 60_000,
            entryType: "window",
            groups: {},
            name: "Planning Window",
            sourceWindowId: 103,
            tabs: {
              "store-tab-5": tab(
                "store-tab-5",
                "Sprint Planning",
                "https://work.example.com/sprint",
                0,
                { active: true, ageMinutes: 71 },
              ),
              "store-tab-6": tab(
                "store-tab-6",
                "Team Notes",
                "https://notes.example.com/team",
                1,
                { ageMinutes: 71 },
              ),
            },
          },
          "store-window-4": {
            createdAt: now - 2 * 24 * 60 * 60_000,
            entryType: "group",
            groups: {
              "": { collapsed: false, color: "orange", title: "" },
            },
            sourceWindowId: 104,
            tabs: {
              "store-tab-7": {
                ...tab(
                  "store-tab-7",
                  "Project Dashboard",
                  "https://app.example.com/dashboard",
                  0,
                  { active: true, ageMinutes: 2 * 24 * 60 },
                ),
                groupKey: "",
              },
            },
          },
        },
      },
    });
  }, seededAt);

  const popup = await browser.newPage();
  const popupErrors = [];
  popup.on("pageerror", (error) => popupErrors.push(error));
  await popup.setViewport({ height: 600, width: 370 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`, {
    waitUntil: "networkidle0",
  });
  await popup.waitForFunction(
    'document.querySelector("#archive-summary")?.textContent !== "Checking"',
  );
  const popupContract = await popup.evaluate(`(() => ({
    actionButtonsEnabled:
      !document.querySelector("#hibernate-current")?.disabled &&
      !document.querySelector("#hibernate-window")?.disabled &&
      !document.querySelector("#hibernate-session")?.disabled,
    activityUsesDocumentIcon:
      document.querySelector("#open-activity .popup-nav-icon-paper") !== null &&
      document.querySelector("#open-activity .popup-nav-icon-fill--orange") !==
        null,
    archiveResolved:
      document.querySelector("#archive-summary")?.textContent !== "Checking",
    archiveHeadingVisible: (() => {
      const heading = document.querySelector("#archive-title");
      const content = document.querySelector(".popup-content");
      return (
        heading !== null &&
        content !== null &&
        heading.getBoundingClientRect().bottom <=
          content.getBoundingClientRect().bottom
      );
    })(),
    hibernationControls:
      document.querySelector("#hibernate-current") !== null &&
      document.querySelector("#hibernate-group") !== null &&
      document.querySelector("#hibernate-window") !== null &&
      document.querySelector("#hibernate-session") !== null &&
      document.querySelector("#archive-list") !== null,
    hibernatedPageUsesLayeredWorkspaceIcon:
      document.querySelectorAll("#open-hibernated .archive-view-window")
        .length === 3 &&
      document.querySelector("#open-hibernated")?.textContent?.trim().startsWith(
        "View",
      ) === true &&
      document.querySelector(".popup-archive-transfer-actions")?.firstElementChild
        ?.id === "open-hibernated" &&
      Number.parseFloat(
        getComputedStyle(document.querySelector("#open-hibernated svg")).width,
      ) >= 40,
    settingsUsesSimpleGear:
      document.querySelector("#open-options .popup-nav-icon-gear") !== null &&
      document.querySelector("#open-options .popup-nav-icon-center") !== null &&
      getComputedStyle(
        document.querySelector("#open-options .popup-nav-icon-center"),
      ).fill === "rgb(100, 185, 223)" &&
      getComputedStyle(
        document.querySelector("#open-options .popup-nav-icon-gear"),
      ).fill === "rgb(210, 228, 238)" &&
      document
        .querySelector("#open-options .popup-nav-icon-center")
        ?.getAttribute("r") === "2.4" &&
      document.querySelectorAll("#open-options svg path").length === 1,
    currentTabContext:
      !document.querySelector(".current-tab-heading h1")?.textContent?.startsWith(
        "Current tab:",
      ) &&
      document.querySelector("#current-tab-title")?.getAttribute("title") ===
        document.querySelector("#current-tab-title")?.textContent &&
      document.querySelector("#current-tab-url")?.getAttribute("title") ===
        document.querySelector("#current-tab-url")?.textContent &&
      Number.parseFloat(
        getComputedStyle(document.querySelector("#current-tab-url")).fontSize,
      ) <
        Number.parseFloat(
          getComputedStyle(document.querySelector("#current-tab-title"))
            .fontSize,
        ) &&
      document
        .querySelector(".current-tab-heading")
        ?.compareDocumentPosition(document.querySelector(".current-tab-panel")) &
        Node.DOCUMENT_POSITION_FOLLOWING &&
      document.querySelector(".current-tab-panel .eyebrow") === null &&
      document.querySelector("#readiness") === null &&
      !document.body.textContent?.includes("Grant site access to detect"),
    windowActionBelowTabAction:
      document.querySelector("#hibernate-current")?.compareDocumentPosition(
        document.querySelector("#hibernate-group-section"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING &&
      document
        .querySelector("#hibernate-group-section")
        ?.compareDocumentPosition(
        document.querySelector("#hibernate-window"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    meterPresent:
      document.querySelector("#open-count") !== null &&
      document.querySelector("#hibernated-count") !== null &&
      document.querySelector("#meter-open") !== null &&
      document.querySelector(".meter-copy strong")?.textContent?.includes(
        "open tabs",
      ),
    primaryInCurrentTab: document.querySelector(".current-tab-panel")?.contains(
      document.querySelector("#hibernate-current"),
    ),
    siteProtectionIsCheckbox:
      document.querySelector("#protect-site")?.matches('input[type="checkbox"]') &&
      document.querySelector("#hibernate-current")?.compareDocumentPosition(
        document.querySelector("#protect-site-row"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    activityProtectionIsCheckbox:
      document.querySelector("#protect-activity")?.matches('input[type="checkbox"]') &&
      document.querySelector("#protect-site-row")?.compareDocumentPosition(
        document.querySelector("#protect-activity-row"),
      ) & Node.DOCUMENT_POSITION_FOLLOWING &&
      document.querySelector("#grant-site-access") === null,
    activityProtectionExplained:
      document.querySelector("#protect-activity-row")?.getAttribute("title")?.includes(
        "unsaved changes",
      ),
    protectionOverrides:
      document.querySelector("#ignore-group-protection")?.matches(
        'input[type="checkbox"]',
      ) &&
      document.querySelector("#ignore-window-protection")?.matches(
        'input[type="checkbox"]',
      ) &&
      document.querySelector("#ignore-session-protection")?.matches(
        'input[type="checkbox"]',
      ) &&
      document
        .querySelector("#ignore-group-protection")
        ?.closest("label")
        ?.getAttribute("title")
        ?.trim() ===
        "Forces hibernation ignoring any protection settings." &&
      document
        .querySelector("#ignore-window-protection")
        ?.closest("label")
        ?.getAttribute("title")
        ?.trim() ===
        "Forces hibernation ignoring any protection settings." &&
      document
        .querySelector("#ignore-session-protection")
        ?.closest("label")
        ?.getAttribute("title")
        ?.trim() ===
        "Forces hibernation ignoring any protection settings.",
    protectionCopy:
      document.querySelector("#protect-activity-row span")?.textContent?.trim() ===
        "Protect site's media and forms" &&
      document.querySelector("#protect-site-row")?.getAttribute("title")
        ?.length > 0,
    largerNavigationIcons:
      Number.parseFloat(
        getComputedStyle(
          document.querySelector("#open-hibernated-footer svg"),
        ).width,
      ) >= 27 &&
      Number.parseFloat(
        getComputedStyle(document.querySelector("#open-activity svg")).width,
      ) >= 27 &&
      Number.parseFloat(
        getComputedStyle(document.querySelector("#open-options svg")).width,
      ) >= 27,
    navigationGlyphsCentered: [
      "#open-hibernated-footer svg",
      "#open-activity svg",
      "#open-options svg",
    ].every((selector) => {
      const bounds = document.querySelector(selector).getBBox();
      return (
        Math.abs(bounds.x + bounds.width / 2 - 12) <= 0.15 &&
        Math.abs(bounds.y + bounds.height / 2 - 12) <= 0.15
      );
    }),
    navigationIconsCenteredInButtons: [
      "open-hibernated-footer",
      "open-activity",
      "open-options",
    ].every((id) => {
      const button = document.getElementById(id).getBoundingClientRect();
      const icon = document
        .querySelector("#" + id + " svg")
        .getBoundingClientRect();
      const expectedHorizontalOffset = id === "open-activity" ? 2 : 0;
      return (
        Math.abs(
          icon.x +
            icon.width / 2 -
            (button.x + button.width / 2) -
            expectedHorizontalOffset,
        ) <= 0.05 &&
        Math.abs(button.y + button.height / 2 - (icon.y + icon.height / 2)) <=
          0.05
      );
    }),
    tableShellPresent:
      document.querySelector(".archive-table-shell #archive-list") !== null,
    nestedArchiveWalls: [
      [
        ".archive-session",
        ".archive-session-windows",
        ".archive-window > summary",
      ],
      [".archive-window", ".archive-tabs", ".archive-tab"],
    ].every(([parentSelector, childSelector, entrySelector]) => {
      const parent = document.querySelector(parentSelector);
      const child = parent?.querySelector(":scope > " + childSelector);
      const entry = child?.querySelector(entrySelector);
      if (parent === null || child === null || entry === null) return false;
      const childStyle = getComputedStyle(child);
      const entryStyle = getComputedStyle(entry);
      return (
        childStyle.borderLeftWidth === "2px" &&
        childStyle.borderLeftStyle === "solid" &&
        childStyle.borderLeftColor === entryStyle.borderTopColor &&
        child.getBoundingClientRect().left >
          parent.getBoundingClientRect().left + 20
      );
    }),
    contentScrollable:
      getComputedStyle(document.querySelector(".popup-content")).overflowY ===
      "auto",
    meterUnboxed:
      getComputedStyle(document.querySelector(".tab-meter")).borderStyle ===
      "none",
    popupHeight: document.querySelector(".popup-shell").getBoundingClientRect().height,
    footerFixedToPopup:
      Math.abs(
        document.querySelector(".popup-nav").getBoundingClientRect().bottom -
          document.body.getBoundingClientRect().bottom,
      ) < 1,
    recentEventInFooter:
      document.querySelector(".popup-nav .recent-event #action-note") !== null,
    footerViewBeforeActivity:
      document
        .querySelector("#open-hibernated-footer")
        ?.compareDocumentPosition(document.querySelector("#open-activity")) ===
      Node.DOCUMENT_POSITION_FOLLOWING,
    windowNameInline: (() => {
      const labelBounds = document
        .querySelector('.window-name-row label')
        .getBoundingClientRect();
      const inputBounds = document
        .querySelector("#window-name")
        .getBoundingClientRect();
      return (
        labelBounds.right < inputBounds.left &&
        Math.abs(
          labelBounds.top + labelBounds.height / 2 -
            (inputBounds.top + inputBounds.height / 2),
        ) < 4 &&
      document.querySelector("#window-name")?.getAttribute("placeholder") ===
        "(Optional)" &&
      !document.querySelector(".window-name-row")?.textContent?.includes(
        "optional",
      )
      );
    })(),
    settingsIsIconButton: document.querySelector("#open-options svg") !== null,
    staleMruCopy: document.body.textContent?.includes(
      "The most recently used tab will open first",
    ),
    staleSavedCopy: document.body.textContent?.includes("Saved for later"),
  }))()`);
  if (
    !popupContract.actionButtonsEnabled ||
    !popupContract.activityUsesDocumentIcon ||
    !popupContract.archiveResolved ||
    !popupContract.archiveHeadingVisible ||
    !popupContract.hibernationControls ||
    !popupContract.hibernatedPageUsesLayeredWorkspaceIcon ||
    !popupContract.settingsUsesSimpleGear ||
    !popupContract.currentTabContext ||
    !popupContract.windowActionBelowTabAction ||
    !popupContract.meterPresent ||
    !popupContract.primaryInCurrentTab ||
    !popupContract.siteProtectionIsCheckbox ||
    !popupContract.activityProtectionIsCheckbox ||
    !popupContract.activityProtectionExplained ||
    !popupContract.protectionOverrides ||
    !popupContract.protectionCopy ||
    !popupContract.largerNavigationIcons ||
    !popupContract.navigationGlyphsCentered ||
    !popupContract.navigationIconsCenteredInButtons ||
    !popupContract.tableShellPresent ||
    !popupContract.nestedArchiveWalls ||
    !popupContract.contentScrollable ||
    !popupContract.meterUnboxed ||
    popupContract.popupHeight < 590 ||
    !popupContract.footerFixedToPopup ||
    !popupContract.recentEventInFooter ||
    !popupContract.footerViewBeforeActivity ||
    !popupContract.windowNameInline ||
    !popupContract.settingsIsIconButton ||
    popupContract.staleMruCopy ||
    popupContract.staleSavedCopy
  ) {
    throw new Error(
      `The popup layout contract is not satisfied: ${JSON.stringify(popupContract)}`,
    );
  }
  const popupScrollContract = await popup.evaluate(() => {
    const content = document.querySelector(".popup-content");
    if (!(content instanceof HTMLElement)) return false;
    const spacer = document.createElement("div");
    spacer.style.height = "800px";
    content.append(spacer);
    content.scrollTop = 80;
    const scrolls =
      content.scrollHeight > content.clientHeight && content.scrollTop > 0;
    spacer.remove();
    content.scrollTop = 0;
    return scrolls;
  });
  if (!popupScrollContract) {
    throw new Error("The popup content does not scroll in a shorter viewport.");
  }
  await popup.evaluate(() => {
    const setText = (id, value) => {
      const element = document.getElementById(id);
      if (element !== null) {
        element.textContent = value;
        element.setAttribute("title", value);
      }
    };
    setText("current-tab-title", "Project Dashboard");
    setText("current-tab-url", "https://app.example.com/dashboard");
    setText("protection-line", "Basic protection - eligible");
    setText("action-note", "Hibernate session - Release Research");
  });
  await popup.screenshot({
    path: popupSource,
    type: "png",
  });
  if (popupErrors.length > 0) throw popupErrors[0];

  const hibernated = await browser.newPage();
  const hibernatedErrors = [];
  hibernated.on("pageerror", (error) => hibernatedErrors.push(error));
  await hibernated.setViewport({ height: 800, width: 1280 });
  await hibernated.goto(`chrome-extension://${extensionId}/hibernated.html`, {
    waitUntil: "networkidle0",
  });
  await hibernated.waitForFunction(
    'document.querySelector("#archive-summary")?.textContent !== "Checking"',
  );
  await hibernated.$eval(".archive-group-color-dropdown", (picker) => {
    const group = picker.closest(".archive-group");
    group?.removeAttribute("open");
    picker.open = true;
  });
  const archivePageContract = await hibernated.evaluate(`(() => ({
    archiveList: document.querySelector("#archive-list") !== null,
    archiveResolved:
      document.querySelector("#archive-summary")?.textContent !== "Checking",
    title:
      document.querySelector("h1")?.innerText ===
      "Hibernated Tabs, Windows, And Sessions",
    coloredTitleTypes:
      document.querySelectorAll("h1 [class^='archive-color-']").length === 3,
    tableShell:
      document.querySelector(".archive-table-shell #archive-list") !== null &&
      document.querySelector("header #archive-summary") !== null,
    matchingArchiveStyles:
      getComputedStyle(document.querySelector(".archive-table-shell"))
        .borderBottomStyle === "solid" &&
      getComputedStyle(document.querySelector(".archive-table-head")).boxShadow !==
        "none",
    tableHeadingRemoved:
      document.querySelector(".archive-table-shell h2") === null,
    transferButtonsUseIcons:
      document.querySelector("#export-archives")?.textContent?.trim() ===
        "Export" &&
      document.querySelector("#import-archives")?.textContent?.trim() ===
        "Import" &&
      document.querySelector("#export-archives .transfer-action-icon") !==
        null &&
      document.querySelector("#import-archives .transfer-action-icon") !==
        null &&
      document
        .querySelector("#export-archives svg path")
        ?.getAttribute("d") === "M12 15V4" &&
      document
        .querySelector("#import-archives svg path")
        ?.getAttribute("d") === "M12 3v11",
    groupControls:
      document.querySelector(".archive-group") !== null &&
      document.querySelector(".archive-group-color-dropdown") !== null &&
      document.querySelector(".archive-group-color-trigger") !== null &&
      document.querySelector(".archive-group-color-menu") !== null &&
      document.querySelector(".archive-group-color") === null &&
      document.querySelectorAll(
        ".archive-group .archive-group-color-choice",
      ).length === 9 &&
      document.querySelector("#create-tab-group") === null &&
      document.querySelector("#group-creator-color-dropdown") !== null &&
      document.querySelector("#move-tabs-to-group") !== null &&
      document.querySelector("#merge-selected") !== null &&
      document.querySelector("#ungroup-tabs") !== null,
    stickySelectionToolbar: (() => {
      const toolbar = document.querySelector(".selection-toolbar");
      if (toolbar === null) return false;
      const style = getComputedStyle(toolbar);
      return style.position === "sticky" && style.top === "8px";
    })(),
    groupColorPickerMatchesReference: (() => {
      const menu = document.querySelector(".archive-group-color-menu");
      const choices = [
        ...document.querySelectorAll(
          ".archive-group .archive-group-color-choice",
        ),
      ];
      if (menu === null || choices.length !== 9) return false;
      const columnTemplate = getComputedStyle(menu).gridTemplateColumns;
      const columns = columnTemplate.split(" ").filter(Boolean);
      const menuRect = menu.getBoundingClientRect();
      return (
        document.querySelector(".archive-group-color-chevron") === null &&
        getComputedStyle(menu).position === "fixed" &&
        menuRect.top >= 0 &&
        menuRect.bottom <= globalThis.innerHeight &&
        (columns.length === 9 || columnTemplate.startsWith("repeat(9,")) &&
        choices.every((choice) => {
          const style = getComputedStyle(choice);
          return (
            style.width === style.height &&
            style.borderRadius === "50%" &&
            style.backgroundColor !== "rgba(0, 0, 0, 0)"
          );
        })
      );
    })(),
    groupColorPickerDetails: (() => {
      const picker = document.querySelector(".archive-group-color-dropdown");
      const menu = document.querySelector(".archive-group-color-menu");
      const choice = document.querySelector(
        ".archive-group .archive-group-color-choice",
      );
      return {
        choice:
          choice === null
            ? null
            : {
                background: getComputedStyle(choice).backgroundColor,
                borderRadius: getComputedStyle(choice).borderRadius,
                height: getComputedStyle(choice).height,
                width: getComputedStyle(choice).width,
              },
        columns:
          menu === null ? null : getComputedStyle(menu).gridTemplateColumns,
        open: picker?.open,
      };
    })(),
    groupMetadata: [...document.querySelectorAll(".archive-tab-meta")].some(
      (element) =>
        element.textContent?.includes("Group:") &&
        element.textContent?.includes("“Research”") &&
        element.querySelector(
          '.archive-tab-group-dot[data-group-color="blue"]',
        ) !== null &&
        !element.textContent?.includes("Blue"),
    ),
    distinctGroupScheme: (() => {
      const group = document.querySelector(".archive-group > summary");
      const window = document.querySelector(
        ".archive-window:not(.archive-window--group) > summary",
      );
      const tab = document.querySelector(".archive-tab");
      if (group === null || window === null || tab === null) return false;
      const groupBackground = getComputedStyle(group).backgroundColor;
      return (
        groupBackground !== getComputedStyle(window).backgroundColor &&
        groupBackground !== getComputedStyle(tab).backgroundColor
      );
    })(),
    unnamedTopLevelGroup:
      document.querySelector(
        '.archive-window--group[data-group-color="orange"]',
      ) !== null &&
      document
        .querySelector('.archive-window--group[data-group-color="orange"]')
        ?.querySelector("summary .archive-window-title")
        ?.textContent?.trim() === "Group",
  }))()`);
  if (
    !archivePageContract.archiveList ||
    !archivePageContract.archiveResolved ||
    !archivePageContract.title ||
    !archivePageContract.coloredTitleTypes ||
    !archivePageContract.tableShell ||
    !archivePageContract.matchingArchiveStyles ||
    !archivePageContract.tableHeadingRemoved ||
    !archivePageContract.transferButtonsUseIcons ||
    !archivePageContract.groupControls ||
    !archivePageContract.stickySelectionToolbar ||
    !archivePageContract.groupColorPickerMatchesReference ||
    !archivePageContract.groupMetadata ||
    !archivePageContract.distinctGroupScheme ||
    !archivePageContract.unnamedTopLevelGroup
  ) {
    throw new Error(
      `The hibernated page contract is not satisfied: ${JSON.stringify(archivePageContract)}`,
    );
  }
  await hibernated.$eval(".archive-group", (group) => {
    group.open = false;
  });
  await hibernated.$eval(
    '.archive-group .archive-group-color-choice[data-group-color="purple"]',
    (choice) => choice.click(),
  );
  await hibernated.waitForFunction(
    'document.querySelector(".archive-group")?.dataset.groupColor === "purple"',
  );
  const groupDisclosurePreserved = await hibernated.$eval(
    ".archive-group",
    (group) => group.open === false,
  );
  if (!groupDisclosurePreserved) {
    throw new Error("Changing a group color expanded the group.");
  }
  const invalidColorFallback = await hibernated.evaluate(async () => {
    const group = document.querySelector(".archive-group");
    const folder = group?.closest(".archive-window");
    if (!(group instanceof HTMLElement) || !(folder instanceof HTMLElement)) {
      return false;
    }
    const response = await chrome.runtime.sendMessage({
      color: "future-browser-color",
      folderId: folder.dataset.folderId,
      groupKey: group.dataset.groupKey,
      title: group.querySelector("summary strong")?.textContent ?? "Group",
      type: "UPDATE_ARCHIVE_GROUP",
    });
    return typeof response?.movedTabs === "number";
  });
  if (!invalidColorFallback) {
    throw new Error("An unsupported archived-group color was not normalized.");
  }
  await hibernated.waitForFunction(
    'document.querySelector(".archive-group")?.dataset.groupColor === "grey"',
  );
  await hibernated.evaluate(async () => {
    const group = document.querySelector(".archive-group");
    const folder = group?.closest(".archive-window");
    if (!(group instanceof HTMLElement) || !(folder instanceof HTMLElement)) {
      return;
    }
    await chrome.runtime.sendMessage({
      color: "blue",
      folderId: folder.dataset.folderId,
      groupKey: group.dataset.groupKey,
      title: group.querySelector("summary strong")?.textContent ?? "Group",
      type: "UPDATE_ARCHIVE_GROUP",
    });
  });
  await hibernated.waitForFunction(
    'document.querySelector(".archive-group")?.dataset.groupColor === "blue"',
  );
  await hibernated.$eval(
    '.archive-window--group .archive-group-color-choice[data-group-color="purple"]',
    (choice) => choice.click(),
  );
  await hibernated.waitForFunction(
    'document.querySelector(".archive-window--group")?.dataset.groupColor === "purple"',
  );
  const unnamedGroupPersisted = await hibernated.evaluate(async () => {
    const snapshot = await chrome.runtime.sendMessage({ type: "GET_ARCHIVES" });
    const groupEntry = snapshot.windows?.find(
      (entry) => entry.entryType === "group" && entry.name === undefined,
    );
    return (
      groupEntry?.groups?.[0]?.color === "purple" &&
      groupEntry.groups[0].title === undefined
    );
  });
  if (!unnamedGroupPersisted) {
    throw new Error(
      "The unnamed top-level group did not retain its selected color.",
    );
  }
  await hibernated.$$eval(
    "details.archive-session, details.archive-window, details.archive-group",
    (entries) => {
      entries.forEach((entry) => (entry.open = true));
    },
  );
  await hibernated.screenshot({
    path: resolve(outputDirectory, "hibernated-1280x800.png"),
    type: "png",
  });
  if (hibernatedErrors.length > 0) throw hibernatedErrors[0];

  const activity = await browser.newPage();
  const activityErrors = [];
  activity.on("pageerror", (error) => activityErrors.push(error));
  await activity.setViewport({ height: 800, width: 1280 });
  await activity.goto(`chrome-extension://${extensionId}/activity.html`, {
    waitUntil: "networkidle0",
  });
  await activity.waitForFunction(
    'document.querySelectorAll("#activity-list .activity-entry").length >= 3',
  );
  const activityContract = await activity.evaluate(() => ({
    entries: document.querySelectorAll("#activity-list .activity-entry").length,
    filter: document.querySelector("#activity-text-filter") !== null,
    retention: document
      .querySelector("#retention-summary")
      ?.textContent?.includes("90 days"),
    title: document.querySelector("h1")?.textContent?.trim() === "Activity",
  }));
  if (
    activityContract.entries < 3 ||
    !activityContract.filter ||
    !activityContract.retention ||
    !activityContract.title
  ) {
    throw new Error(
      `The activity page contract is not satisfied: ${JSON.stringify(activityContract)}`,
    );
  }
  await activity.screenshot({
    path: resolve(outputDirectory, "activity-1280x800.png"),
    type: "png",
  });
  if (activityErrors.length > 0) throw activityErrors[0];
} finally {
  await browser.close();
}
