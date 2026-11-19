import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, sanitizeSettings } from "../src/shared/settings";

describe("settings migration", () => {
  it("migrates older partial settings and retains protection choices", () => {
    expect(
      sanitizeSettings({ inactivityMinutes: -1, protectPinned: false }),
    ).toEqual({
      ...DEFAULT_SETTINGS,
      protectPinned: false,
    });
  });

  it("falls back when stored values are malformed", () => {
    expect(
      sanitizeSettings({
        activityRetentionDays: -14,
        inactivityMinutes: "soon",
      }),
    ).toEqual(DEFAULT_SETTINGS);
  });

  it.each([0, 1, 7, 30, 45, 90, 365, 36_500] as const)(
    "retains the valid %i-day activity setting",
    (activityRetentionDays) => {
      expect(sanitizeSettings({ activityRetentionDays })).toMatchObject({
        activityRetentionDays,
        schemaVersion: 9,
      });
    },
  );

  it.each(["archive", "keep-open", "close-and-log"] as const)(
    "retains the %s internal-page behavior",
    (internalPageBehavior) => {
      expect(sanitizeSettings({ internalPageBehavior })).toMatchObject({
        internalPageBehavior,
        schemaVersion: 9,
      });
    },
  );

  it.each(["archive", "keep-open", "close-and-log"] as const)(
    "retains the %s incognito behavior",
    (incognitoBehavior) => {
      expect(sanitizeSettings({ incognitoBehavior })).toMatchObject({
        incognitoBehavior,
        schemaVersion: 9,
      });
    },
  );

  it.each([-1, 1.5, 36_501, "90", Number.NaN])(
    "rejects the invalid activity retention value %s",
    (activityRetentionDays) => {
      expect(sanitizeSettings({ activityRetentionDays })).toEqual(
        DEFAULT_SETTINGS,
      );
    },
  );

  it.each([null, 1, 15, 60, 120, 1440, 525_600] as const)(
    "retains the valid automatic hibernation value %s",
    (autoHibernateMinutes) => {
      expect(sanitizeSettings({ autoHibernateMinutes })).toMatchObject({
        autoHibernateMinutes,
        schemaVersion: 9,
      });
    },
  );

  it.each(["minutes", "hours", "days"] as const)(
    "retains the %s automatic hibernation display unit",
    (autoHibernateUnit) => {
      expect(sanitizeSettings({ autoHibernateUnit })).toMatchObject({
        autoHibernateUnit,
        schemaVersion: 9,
      });
    },
  );

  it("retains automatic hibernation page-type scope", () => {
    expect(
      sanitizeSettings({
        autoHibernateIncludeIncognito: true,
        autoHibernateIncludeInternalPages: true,
      }),
    ).toMatchObject({
      autoHibernateIncludeIncognito: true,
      autoHibernateIncludeInternalPages: true,
    });
  });

  it.each(["together", "individually"] as const)(
    "retains the %s grouped-tab automatic behavior",
    (autoHibernateGroupedTabs) => {
      expect(sanitizeSettings({ autoHibernateGroupedTabs })).toMatchObject({
        autoHibernateGroupedTabs,
        schemaVersion: 9,
      });
    },
  );

  it("defaults invalid grouped-tab behavior to together", () => {
    expect(
      sanitizeSettings({ autoHibernateGroupedTabs: "sometimes" }),
    ).toMatchObject({ autoHibernateGroupedTabs: "together" });
  });

  it.each([true, false])(
    "retains the %s selected-deletion warning preference",
    (confirmSelectedDeletion) => {
      expect(sanitizeSettings({ confirmSelectedDeletion })).toMatchObject({
        confirmSelectedDeletion,
        schemaVersion: 9,
      });
    },
  );

  it.each([0, -1, 1.5, 525_601, "60", Number.NaN])(
    "rejects the invalid automatic hibernation value %s",
    (autoHibernateMinutes) => {
      expect(sanitizeSettings({ autoHibernateMinutes })).toEqual(
        DEFAULT_SETTINGS,
      );
    },
  );
});
