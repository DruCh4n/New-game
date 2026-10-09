/** Country-specific money and price settings. Values are rough mid-density urban figures. */
export interface Region {
  currency: string;
  symbol: string;
  /** Land price per m² for an ordinary plot on a residential street. */
  landPerM2: number;
  /** Replacement cost per m² of floor area for an ordinary building. */
  buildPerM2: number;
  /** Rounding step for prices shown in negotiations. */
  priceStep: number;
}

const REGIONS: Record<string, Region> = {
  ID: { currency: 'IDR', symbol: 'Rp', landPerM2: 7_000_000, buildPerM2: 3_500_000, priceStep: 5_000_000 },
  MY: { currency: 'MYR', symbol: 'RM', landPerM2: 1_500, buildPerM2: 1_200, priceStep: 1_000 },
  TH: { currency: 'THB', symbol: '฿', landPerM2: 60_000, buildPerM2: 15_000, priceStep: 10_000 },
  PH: { currency: 'PHP', symbol: '₱', landPerM2: 60_000, buildPerM2: 25_000, priceStep: 10_000 },
  VN: { currency: 'VND', symbol: '₫', landPerM2: 60_000_000, buildPerM2: 7_000_000, priceStep: 10_000_000 },
  SG: { currency: 'SGD', symbol: 'S$', landPerM2: 15_000, buildPerM2: 3_000, priceStep: 5_000 },
};
const DEFAULT_REGION: Region = { currency: 'USD', symbol: '$', landPerM2: 1_500, buildPerM2: 1_500, priceStep: 1_000 };

export function regionFor(country: string | undefined): Region {
  return (country && REGIONS[country.toUpperCase()]) || DEFAULT_REGION;
}

/**
 * Compact money format: "Rp 1,25 M" / "Rp 850 jt" (Indonesian) or "Rp 1.25B" / "Rp 850M" (English).
 */
export function formatMoney(amount: number, region: Region, lang: string): string {
  const neg = amount < 0;
  const a = Math.abs(amount);
  const id = lang === 'id';
  const units: [number, string, string][] = [
    [1e12, 'T', ' T'],
    [1e9, 'B', ' M'],
    [1e6, 'M', ' jt'],
    [1e3, 'K', ' rb'],
  ];
  let body = '';
  for (const [v, en, ind] of units) {
    if (a >= v) {
      const n = a / v;
      const digits = n >= 100 ? 0 : n >= 10 ? 1 : 2;
      const s = n.toLocaleString(id ? 'id-ID' : 'en-US', { maximumFractionDigits: digits });
      body = s + (id ? ind : en);
      break;
    }
  }
  if (!body) body = Math.round(a).toLocaleString(id ? 'id-ID' : 'en-US');
  return `${neg ? '−' : ''}${region.symbol} ${body}`;
}
