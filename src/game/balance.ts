/**
 * All the main tuning knobs in one place. Change numbers here to make the game
 * easier, harder, faster or slower; nothing else needs to change.
 */

export type DifficultyId = 'easy' | 'normal' | 'hard';

export interface Difficulty {
  id: DifficultyId;
  /** Starting cash = country land price per m² × this. */
  startMoney: number;
  /** Added to every owner's hidden minimum-price factor (0.1 = they want 10% more of market value). */
  ownerPriceOffset: number;
  /** Multiplies all rent, lease and sales income. */
  income: number;
  /** Added to the annual loan rate. */
  loanRate: number;
  /** Multiplies building-permit waits. */
  permitDays: number;
}

export const DIFFICULTIES: Record<DifficultyId, Difficulty> = {
  easy: { id: 'easy', startMoney: 9000, ownerPriceOffset: -0.1, income: 1.25, loanRate: -0.015, permitDays: 0.6 },
  normal: { id: 'normal', startMoney: 6000, ownerPriceOffset: 0, income: 1, loanRate: 0, permitDays: 1 },
  hard: { id: 'hard', startMoney: 4000, ownerPriceOffset: 0.12, income: 0.85, loanRate: 0.02, permitDays: 1.4 },
};

export const BALANCE = {
  /** Real seconds per in-game day at 1× speed. */
  secondsPerDay: 1.5,
  /** Unsecured credit line = land price per m² × this. */
  unsecuredCredit: 1500,
  /** Banks lend this share of your land + buildings value. */
  loanToValue: 0.5,
  /** Annual loan rate at good reputation, and the extra per reputation point below 60. */
  loanBaseRate: 0.07,
  loanRatePerRepPoint: 0.0015,
  /** Apartment towers sell for this multiple of their construction cost in total. */
  apartmentSalesMultiple: 1.7,
  /** Share of an apartment tower's units sold per month at demand 1.0. */
  apartmentSalesPace: 0.05,
  /** Annual maintenance as a share of construction cost. */
  maintenance: 0.006,
  /** Annual land tax as a share of land value. */
  landTax: 0.002,
  /** Days before an unkept promise to a former owner is broken. */
  promiseDays: 730,
  /** Land you need (m², connected) to unlock district planning. */
  districtArea: 20000,
} as const;
