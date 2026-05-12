export type Tier = 'S' | 'A' | 'B' | 'C' | 'D';

export type ItemStatus = 'considering' | 'delayed' | 'bought' | 'cancelled';

export type Category =
  | 'Fashion'
  | 'Elektronik'
  | 'Skincare'
  | 'Rumah'
  | 'Hobi'
  | 'Makanan/Minuman'
  | 'Kerja'
  | 'Kesehatan'
  | 'Lainnya';

export type UsageFrequency = 'daily' | 'weekly' | 'sometimes' | 'not_sure';
export type UrgencyIfNotBought = 'problem' | 'minor' | 'no_problem';
export type AlreadyOwnSimilar = 'no' | 'yes_but_bad' | 'yes_still_ok';
export type BudgetSafety = 'safe' | 'slightly_heavy' | 'heavy';
export type MainMotivation = 'need' | 'productivity' | 'health_safety' | 'self_reward' | 'discount_fomo';

export interface ScoringAnswers {
  usageFrequency: UsageFrequency;
  urgencyIfNotBought: UrgencyIfNotBought;
  alreadyOwnSimilar: AlreadyOwnSimilar;
  budgetSafety: BudgetSafety;
  mainMotivation: MainMotivation;
}

export interface WishlistItem {
  id: string;
  name: string;
  price: number;
  category: Category;
  productLink?: string;
  userReason?: string;
  notes?: string;
  score: number;
  maxScore: number;
  tier: Tier;
  tierLabel: string;
  status: ItemStatus;
  answers: ScoringAnswers;
  reasonBreakdown: string[];
  cooldownDays: number;
  cooldownUntil: string | null;
  createdAt: string;
  updatedAt: string;
  boughtAt?: string;
  cancelledAt?: string;
  delayedAt?: string;
}

export interface WishlistState {
  schemaVersion: '0.1';
  items: WishlistItem[];
  aiTrialUsed: number;
  settings: {
    hasSeenOnboarding: boolean;
    currency: 'IDR';
    preferredView: 'groupedByTier' | 'flatList';
  };
}

export type AddItemDraft = {
  name: string;
  priceInput: string;
  category: Category;
  productLink: string;
  userReason: string;
  answers: Partial<ScoringAnswers>;
};
