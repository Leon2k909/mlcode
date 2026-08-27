import { describe, expect, it } from "vite-plus/test";

import { buildCostFormatter, resolveRegionCurrency } from "./displayCurrency";

describe("resolveRegionCurrency", () => {
  it("maps a UK locale to pounds", () => {
    expect(resolveRegionCurrency("en-GB")).toBe("GBP");
  });

  it("keeps US and unknown regions on the canonical dollar", () => {
    expect(resolveRegionCurrency("en-US")).toBe("USD");
    // Regions outside the map fall back rather than guessing.
    expect(resolveRegionCurrency("is-IS")).toBe("USD");
    expect(resolveRegionCurrency("not a locale !!")).toBe("USD");
  });

  it("resolves a bare language through likely-subtags maximization", () => {
    expect(resolveRegionCurrency("ja")).toBe("JPY");
    expect(resolveRegionCurrency("de")).toBe("EUR");
  });
});

describe("buildCostFormatter", () => {
  it("converts the USD amount at the given rate into the target currency", () => {
    const format = buildCostFormatter("en-GB", "GBP", 0.75);
    expect(format(100)).toBe("£75.00");
  });

  it("renders the viewer's own number conventions", () => {
    const format = buildCostFormatter("de-DE", "EUR", 0.9);
    // de-DE places the symbol after the amount with comma decimals. Intl uses
    // a non-breaking space before the symbol; normalize it for the assertion.
    expect(format(1000).replace(/ | /g, " ")).toBe("900,00 €");
  });
});
