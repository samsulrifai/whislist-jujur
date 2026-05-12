import type { Category, ScoringAnswers, Tier, WishlistItem, WishlistState } from './types';

export const STORAGE_KEY = 'wishlist-jujur:v0.1';
export const MAX_SCORE = 13;

export const CATEGORIES: Category[] = [
  'Fashion',
  'Elektronik',
  'Skincare',
  'Rumah',
  'Hobi',
  'Makanan/Minuman',
  'Kerja',
  'Kesehatan',
  'Lainnya',
];

export const TIER_ORDER: Tier[] = ['S', 'A', 'B', 'C', 'D'];

export const TIER_CONFIG: Record<Tier, { label: string; cooldownDays: number; headline: string; summary: string; roast?: string }> = {
  S: {
    label: 'Wajib / Penting',
    cooldownDays: 0,
    headline: 'Ini masuk akal. Kalau budget aman, boleh lanjut beli.',
    summary: 'Barang ini punya alasan kuat: sering dipakai, cukup penting, dan bukan sekadar impuls diskon.',
  },
  A: {
    label: 'Layak Beli',
    cooldownDays: 1,
    headline: 'Layak beli, tapi kasih jeda sebentar.',
    summary: 'Barang ini cukup masuk akal, tapi jeda 1 hari bisa bantu memastikan ini bukan impuls sesaat.',
  },
  B: {
    label: 'Boleh, Tapi Nanti',
    cooldownDays: 7,
    headline: 'Boleh, tapi belum harus sekarang.',
    summary: 'Ada manfaatnya, tapi urgensinya belum tinggi. Simpan dulu dan cek lagi setelah beberapa hari.',
    roast: 'Barang ini bukan musuh, cuma belum waktunya naik pelaminan checkout.',
  },
  C: {
    label: 'Lapar Mata',
    cooldownDays: 14,
    headline: 'Tunda dulu. Ini lebih kelihatan seperti lapar mata daripada kebutuhan.',
    summary: 'Sinyalnya banyak datang dari rasa pengen, diskon, tren, atau alasan yang belum terlalu kuat.',
    roast: 'Ini bukan kebutuhan darurat. Ini racun diskon pakai baju rapi.',
  },
  D: {
    label: 'Jangan Beli',
    cooldownDays: 30,
    headline: 'Jangan checkout dulu. Sinyalnya lebih banyak merah daripada hijau.',
    summary: 'Barang ini punya risiko tinggi jadi pembelian yang kamu sesali: alasan lemah, pemakaian belum jelas, atau terlalu berat untuk budget.',
    roast: 'Kalau masih kepikiran 30 hari lagi, baru kita sidang ulang.',
  },
};

export const initialState: WishlistState = {
  schemaVersion: '0.1',
  items: [],
  aiTrialUsed: 0,
  settings: {
    hasSeenOnboarding: false,
    currency: 'IDR',
    preferredView: 'groupedByTier',
  },
};

export function formatIDR(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value).replace(/\s/g, '');
}

export function parsePriceInput(input: string): number | null {
  const normalized = input.replace(/rp/gi, '').replace(/\s/g, '').replace(/[.,]/g, '');
  if (!normalized || !/^\d+$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function calculateScore(answers: ScoringAnswers): number {
  const usage = { daily: 3, weekly: 2, sometimes: 1, not_sure: 0 }[answers.usageFrequency];
  const urgency = { problem: 3, minor: 1, no_problem: 0 }[answers.urgencyIfNotBought];
  const similar = { no: 2, yes_but_bad: 1, yes_still_ok: -3 }[answers.alreadyOwnSimilar];
  const budget = { safe: 2, slightly_heavy: -1, heavy: -3 }[answers.budgetSafety];
  const motivation = { need: 3, productivity: 3, health_safety: 3, self_reward: 0, discount_fomo: -2 }[answers.mainMotivation];
  return usage + urgency + similar + budget + motivation;
}

export function mapScoreToTier(score: number): Tier {
  if (score >= 10) return 'S';
  if (score >= 7) return 'A';
  if (score >= 4) return 'B';
  if (score >= 1) return 'C';
  return 'D';
}

export function buildReasonBreakdown(answers: ScoringAnswers): string[] {
  const usage = {
    daily: 'Dipakai hampir tiap hari.',
    weekly: 'Ada peluang dipakai rutin.',
    sometimes: 'Frekuensi pemakaian belum terlalu kuat.',
    not_sure: 'Kamu belum yakin bakal sering dipakai.',
  }[answers.usageFrequency];
  const urgency = {
    problem: 'Kalau tidak dibeli, ada masalah nyata.',
    minor: 'Ada gangguan kecil, tapi belum darurat.',
    no_problem: 'Kalau tidak dibeli sekarang, hidup tetap aman.',
  }[answers.urgencyIfNotBought];
  const similar = {
    no: 'Belum ada barang serupa.',
    yes_but_bad: 'Barang lama ada, tapi kurang mendukung.',
    yes_still_ok: 'Kamu sudah punya barang mirip yang masih berfungsi.',
  }[answers.alreadyOwnSimilar];
  const budget = {
    safe: 'Harga masih aman menurut kamu.',
    slightly_heavy: 'Harga mulai terasa agak berat.',
    heavy: 'Harga ini cukup menekan budget.',
  }[answers.budgetSafety];
  const motivation = {
    need: 'Motivasi utama adalah kebutuhan.',
    productivity: 'Ada alasan produktivitas.',
    health_safety: 'Ada alasan kesehatan atau keamanan.',
    self_reward: 'Ada unsur self-reward.',
    discount_fomo: 'Ada sinyal diskon/FOMO.',
  }[answers.mainMotivation];
  return [usage, urgency, similar, budget, motivation];
}

export function getCooldownUntil(createdAt: string, cooldownDays: number): string | null {
  if (cooldownDays <= 0) return null;
  const date = new Date(createdAt);
  date.setDate(date.getDate() + cooldownDays);
  return date.toISOString();
}

export function formatCooldown(cooldownUntil: string | null): string {
  if (!cooldownUntil) return 'Boleh diputuskan sekarang';
  const now = new Date();
  const target = new Date(cooldownUntil);
  const ms = target.getTime() - now.getTime();
  const days = Math.ceil(ms / 86_400_000);
  if (days <= 0) return 'Cooldown selesai. Cek ulang sebelum checkout.';
  return `Cooldown: ${days} hari lagi`;
}

export function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `item_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function buildWishlistItem(input: {
  name: string;
  price: number;
  category: Category;
  productLink?: string;
  userReason?: string;
  answers: ScoringAnswers;
}): WishlistItem {
  const createdAt = new Date().toISOString();
  const score = calculateScore(input.answers);
  const tier = mapScoreToTier(score);
  const config = TIER_CONFIG[tier];
  return {
    id: createId(),
    name: input.name.trim(),
    price: input.price,
    category: input.category,
    productLink: input.productLink?.trim() || undefined,
    userReason: input.userReason?.trim() || undefined,
    score,
    maxScore: MAX_SCORE,
    tier,
    tierLabel: config.label,
    status: 'considering',
    answers: input.answers,
    reasonBreakdown: buildReasonBreakdown(input.answers),
    cooldownDays: config.cooldownDays,
    cooldownUntil: getCooldownUntil(createdAt, config.cooldownDays),
    createdAt,
    updatedAt: createdAt,
  };
}

export function loadState(): WishlistState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as WishlistState;
    if (parsed?.schemaVersion !== '0.1' || !Array.isArray(parsed.items)) return initialState;
    return { ...initialState, ...parsed, settings: { ...initialState.settings, ...parsed.settings } };
  } catch {
    return initialState;
  }
}

export function saveState(state: WishlistState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getMoneySaved(items: WishlistItem[]): number {
  return items.filter((item) => item.status === 'cancelled').reduce((sum, item) => sum + item.price, 0);
}

export function getPotentialSpend(items: WishlistItem[]): number {
  return items.filter((item) => item.status === 'considering' || item.status === 'delayed').reduce((sum, item) => sum + item.price, 0);
}
