import { describe, expect, it } from "vite-plus/test";

import { selectVisibleProjectPickerEntries } from "./sidebarProjectGrouping";

/**
 * Hiding a project is a view preference on the picker, not a deletion, so the
 * rules that matter are which rows survive it and what can never be hidden.
 */
describe("selectVisibleProjectPickerEntries", () => {
  const entry = (projectKey: string) => ({ group: { projectKey } });
  const entries = [entry("alpha"), entry("beta"), entry("gamma")];
  const keys = (visible: ReadonlyArray<{ readonly group: { readonly projectKey: string } }>) =>
    visible.map(({ group }) => group.projectKey);

  it("drops the projects the user put away", () => {
    expect(
      keys(
        selectVisibleProjectPickerEntries({
          entries,
          hiddenProjectKeys: ["beta"],
          alwaysVisibleProjectKey: "alpha",
        }),
      ),
    ).toEqual(["alpha", "gamma"]);
  });

  it("keeps the project being worked in even once it is hidden", () => {
    // The picker is a radio group. Filtering out the checked row would render
    // as though no project were selected at all.
    expect(
      keys(
        selectVisibleProjectPickerEntries({
          entries,
          hiddenProjectKeys: ["alpha", "beta"],
          alwaysVisibleProjectKey: "alpha",
        }),
      ),
    ).toEqual(["alpha", "gamma"]);
  });

  it("returns every entry untouched when nothing is hidden", () => {
    const visible = selectVisibleProjectPickerEntries({
      entries,
      hiddenProjectKeys: [],
      alwaysVisibleProjectKey: "alpha",
    });
    expect(visible).toBe(entries);
  });

  it("hides a project that is not the active one down to an empty list", () => {
    expect(
      keys(
        selectVisibleProjectPickerEntries({
          entries,
          hiddenProjectKeys: ["alpha", "beta", "gamma"],
          alwaysVisibleProjectKey: "",
        }),
      ),
    ).toEqual([]);
  });
});
