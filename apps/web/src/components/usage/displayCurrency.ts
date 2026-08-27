import { useEffect, useMemo, useState } from "react";

import { formatUsd } from "@t3tools/shared/usageFormat";

/**
 * Optional local-currency display for the usage page.
 *
 * Costs are computed and stored in USD, because API list prices are USD.
 * When the viewer's locale region uses another currency, the display converts
 * at a daily ECB reference rate; the figures are estimates either way, so a
 * reference rate does not make them less honest. USD remains the canonical
 * number - it is shown alongside the conversion and is the fallback whenever
 * no rate is available (offline, blocked, unknown region).
 *
 * @module usage/displayCurrency
 */

/**
 * Currency by locale region for the regions likely to run this app. Not a
 * complete ISO table on purpose: an unlisted region simply keeps USD.
 */
const REGION_CURRENCY: Readonly<Record<string, string>> = {
  GB: "GBP",
  US: "USD",
  AT: "EUR",
  BE: "EUR",
  CY: "EUR",
  DE: "EUR",
  EE: "EUR",
  ES: "EUR",
  FI: "EUR",
  FR: "EUR",
  GR: "EUR",
  HR: "EUR",
  IE: "EUR",
  IT: "EUR",
  LT: "EUR",
  LU: "EUR",
  LV: "EUR",
  MT: "EUR",
  NL: "EUR",
  PT: "EUR",
  SI: "EUR",
  SK: "EUR",
  AU: "AUD",
  BR: "BRL",
  CA: "CAD",
  CH: "CHF",
  CN: "CNY",
  CZ: "CZK",
  DK: "DKK",
  HK: "HKD",
  HU: "HUF",
  ID: "IDR",
  IL: "ILS",
  IN: "INR",
  JP: "JPY",
  KR: "KRW",
  MX: "MXN",
  MY: "MYR",
  NO: "NOK",
  NZ: "NZD",
  PH: "PHP",
  PL: "PLN",
  RO: "RON",
  SE: "SEK",
  SG: "SGD",
  TH: "THB",
  TR: "TRY",
  ZA: "ZAR",
};

/** Currency code for a BCP 47 locale tag; USD when the region is unknown. */
export function resolveRegionCurrency(locale: string): string {
  try {
    const region = new Intl.Locale(locale).maximize().region;
    return (region !== undefined ? REGION_CURRENCY[region] : undefined) ?? "USD";
  } catch {
    return "USD";
  }
}

/** USD-amount formatter that renders in `currency` at `rate` units per USD. */
export function buildCostFormatter(
  locale: string,
  currency: string,
  rate: number,
): (usd: number) => string {
  const numberFormat = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (usd: number) => numberFormat.format(usd * rate);
}

export interface UsdCostDisplay {
  readonly format: (usd: number) => string;
  /** True when `format` converts away from USD, so USD should be shown too. */
  readonly converted: boolean;
}

const USD_DISPLAY: UsdCostDisplay = { format: formatUsd, converted: false };

const FX_CACHE_KEY = "usage-display-fx-v1";
const FX_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface CachedRate {
  readonly currency: string;
  readonly rate: number;
  readonly fetchedAt: number;
}

function readCachedRate(currency: string): CachedRate | null {
  try {
    const raw = window.localStorage.getItem(FX_CACHE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as Partial<CachedRate>;
    if (
      parsed.currency !== currency ||
      typeof parsed.rate !== "number" ||
      !Number.isFinite(parsed.rate) ||
      parsed.rate <= 0 ||
      typeof parsed.fetchedAt !== "number"
    ) {
      return null;
    }
    return parsed as CachedRate;
  } catch {
    return null;
  }
}

function writeCachedRate(value: CachedRate): void {
  try {
    window.localStorage.setItem(FX_CACHE_KEY, JSON.stringify(value));
  } catch {
    // Per-viewer convenience only; a blocked store just means USD next launch.
  }
}

/**
 * Cost formatter for the viewer's locale currency. Resolves to plain USD
 * until (and unless) a rate is available, so the page never waits on the
 * network and never shows converted figures it cannot back.
 */
export function useUsdCostDisplay(): UsdCostDisplay {
  const locale = typeof navigator === "undefined" ? "en-US" : navigator.language;
  const currency = useMemo(() => resolveRegionCurrency(locale), [locale]);
  const [rate, setRate] = useState<number | null>(() =>
    currency === "USD" ? null : (readCachedRate(currency)?.rate ?? null),
  );

  useEffect(() => {
    if (currency === "USD") return;
    const cached = readCachedRate(currency);
    if (cached !== null && Date.now() - cached.fetchedAt < FX_MAX_AGE_MS) {
      setRate(cached.rate);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${currency}`,
          { signal: controller.signal },
        );
        if (!response.ok) return;
        const body = (await response.json()) as { rates?: Record<string, number> };
        const fetched = body.rates?.[currency];
        if (typeof fetched !== "number" || !Number.isFinite(fetched) || fetched <= 0) return;
        writeCachedRate({ currency, rate: fetched, fetchedAt: Date.now() });
        setRate(fetched);
      } catch {
        // Stale cache (if any) or USD keeps the page working offline.
      }
    })();
    return () => controller.abort();
  }, [currency]);

  return useMemo(() => {
    if (currency === "USD" || rate === null) return USD_DISPLAY;
    return { format: buildCostFormatter(locale, currency, rate), converted: true };
  }, [currency, locale, rate]);
}
