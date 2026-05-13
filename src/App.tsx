import { useEffect, useMemo, useRef, useState } from 'react';
import type { AddItemDraft, ItemStatus, ScoringAnswers, Tier, WishlistItem, WishlistState } from './types';
import {
  buildWishlistItem,
  CATEGORIES,
  formatCooldown,
  formatIDR,
  getCooldownUntil,
  getMoneySaved,
  getPotentialSpend,
  initialState,
  loadState,
  parsePriceInput,
  saveState,
  STORAGE_KEY,
  TIER_CONFIG,
  TIER_ORDER,
} from './utils';

type Filter = 'all' | Tier | ItemStatus;
type AddStep = 1 | 2 | 3;

type Question<K extends keyof ScoringAnswers> = {
  key: K;
  title: string;
  helper: string;
  options: Array<{ value: ScoringAnswers[K]; label: string }>;
};

const questions: { [K in keyof ScoringAnswers]: Question<K> }[keyof ScoringAnswers][] = [
  {
    key: 'usageFrequency',
    title: 'Seberapa sering barang ini akan dipakai?',
    helper: 'Makin sering dipakai, makin kuat alasannya.',
    options: [
      { value: 'daily', label: 'Hampir tiap hari' },
      { value: 'weekly', label: 'Mingguan' },
      { value: 'sometimes', label: 'Kadang-kadang' },
      { value: 'not_sure', label: 'Tidak yakin' },
    ],
  },
  {
    key: 'urgencyIfNotBought',
    title: 'Kalau nggak beli sekarang, bakal masalah?',
    helper: 'Kalau hidup tetap jalan, mungkin belum urgent.',
    options: [
      { value: 'problem', label: 'Iya, mengganggu' },
      { value: 'minor', label: 'Sedikit' },
      { value: 'no_problem', label: 'Nggak masalah' },
    ],
  },
  {
    key: 'alreadyOwnSimilar',
    title: 'Sudah punya barang yang mirip?',
    helper: 'Barang kembar sering menyamar jadi kebutuhan baru.',
    options: [
      { value: 'no', label: 'Belum punya' },
      { value: 'yes_but_bad', label: 'Ada, tapi kurang' },
      { value: 'yes_still_ok', label: 'Ada dan masih oke' },
    ],
  },
  {
    key: 'budgetSafety',
    title: 'Harga ini aman buat budget kamu?',
    helper: 'Jawab sesuai kondisi, bukan sesuai keinginan.',
    options: [
      { value: 'safe', label: 'Aman' },
      { value: 'slightly_heavy', label: 'Agak berat' },
      { value: 'heavy', label: 'Berat' },
    ],
  },
  {
    key: 'mainMotivation',
    title: 'Alasan paling jujur?',
    helper: 'Tidak ada jawaban dosa. Kita cuma mau jujur dulu.',
    options: [
      { value: 'need', label: 'Kebutuhan' },
      { value: 'productivity', label: 'Produktivitas' },
      { value: 'health_safety', label: 'Kesehatan/keamanan' },
      { value: 'self_reward', label: 'Self-reward' },
      { value: 'discount_fomo', label: 'Diskon/FOMO' },
    ],
  },
];

const statusLabels: Record<ItemStatus, string> = {
  considering: 'Dipertimbangkan',
  delayed: 'Ditunda',
  bought: 'Dibeli',
  cancelled: 'Batal Beli',
};

const emptyDraft: AddItemDraft = {
  name: '',
  priceInput: '',
  category: 'Lainnya',
  productLink: '',
  userReason: '',
  answers: {},
};

function createEmptyDraft(): AddItemDraft {
  return { ...emptyDraft, answers: {} };
}

function draftFromItem(item: WishlistItem): AddItemDraft {
  return {
    name: item.name,
    priceInput: String(item.price),
    category: item.category,
    productLink: item.productLink ?? '',
    userReason: item.userReason ?? '',
    answers: { ...item.answers },
  };
}

function answersAreDifferent(previous: ScoringAnswers, next: ScoringAnswers): boolean {
  return (
    previous.usageFrequency !== next.usageFrequency ||
    previous.urgencyIfNotBought !== next.urgencyIfNotBought ||
    previous.alreadyOwnSimilar !== next.alreadyOwnSimilar ||
    previous.budgetSafety !== next.budgetSafety ||
    previous.mainMotivation !== next.mainMotivation
  );
}

function hasAllAnswers(answers: Partial<ScoringAnswers>): answers is ScoringAnswers {
  return Boolean(
    answers.usageFrequency &&
      answers.urgencyIfNotBought &&
      answers.alreadyOwnSimilar &&
      answers.budgetSafety &&
      answers.mainMotivation,
  );
}

function buildChatGptPrompt(item: WishlistItem): string {
  const productLink = item.productLink ? `\nLink produk: ${item.productLink}` : '';
  const userReason = item.userReason ? item.userReason : 'Belum ada alasan tertulis.';
  const reasons = item.reasonBreakdown.map((reason) => `- ${reason}`).join('\n');

  return `Kamu adalah asisten belanja yang jujur, kritis, dan hemat. Tolong audit keputusan belanja ini dengan gaya santai tapi tajam.\n\nData barang:\nNama: ${item.name}\nHarga: ${formatIDR(item.price)}\nKategori: ${item.category}${productLink}\nAlasan saya ingin beli: ${userReason}\n\nHasil scoring dari Wishlist Jujur:\nTier: ${item.tier} - ${item.tierLabel}\nSkor: ${item.score}/${item.maxScore}\nCooldown: ${formatCooldown(item.cooldownUntil)}\nStatus sekarang: ${statusLabels[item.status]}\n\nAlasan scoring:\n${reasons}\n\nTolong jawab dalam Bahasa Indonesia dengan format:\n1. Verdict singkat: beli sekarang / tunda / jangan beli dulu\n2. Risiko terbesar kalau saya beli\n3. Pertanyaan jujur yang harus saya jawab sebelum checkout\n4. Alternatif lebih hemat atau lebih masuk akal\n5. Kesimpulan maksimal 2 kalimat.`;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

function App() {
  const [state, setState] = useState<WishlistState>(() => loadState());
  const [isAdding, setIsAdding] = useState(false);
  const [editingItem, setEditingItem] = useState<WishlistItem | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [toast, setToast] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    try {
      saveState(state);
    } catch {
      setToast('Browser kamu tidak mengizinkan penyimpanan lokal. Data mungkin tidak tersimpan.');
    }
  }, [state]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const moneySaved = useMemo(() => getMoneySaved(state.items), [state.items]);
  const potentialSpend = useMemo(() => getPotentialSpend(state.items), [state.items]);
  const consideringCount = state.items.filter((item) => item.status === 'considering').length;
  const aiTrialRemaining = Math.max(0, 3 - state.aiTrialUsed);

  const filteredItems = useMemo(() => {
    return state.items
      .filter((item) => {
        if (filter === 'all') return true;
        if (TIER_ORDER.includes(filter as Tier)) return item.tier === filter;
        return item.status === filter;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [filter, state.items]);

  function addItem(item: WishlistItem) {
    setState((current) => ({ ...current, items: [item, ...current.items] }));
    setToast(`${item.name} masuk ke ${item.tier} Tier — ${item.tierLabel}.`);
  }

  function updateItem(updatedItem: WishlistItem) {
    setState((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === updatedItem.id ? updatedItem : item)),
    }));
    setToast(`${updatedItem.name} sudah diedit. Tier sekarang: ${updatedItem.tier} — ${updatedItem.tierLabel}.`);
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `wishlist-jujur-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setToast('Data wishlist diexport. Simpan baik-baik, ini cadangan lokal kamu.');
  }

  function importData(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = normalizeImportedState(JSON.parse(String(reader.result)));
        if (!imported) {
          setToast('File JSON tidak cocok dengan format Wishlist Jujur.');
          return;
        }
        const confirmed = window.confirm('Import JSON akan mengganti data Wishlist Jujur di browser ini. Lanjut?');
        if (!confirmed) return;
        setState(imported);
        setToast(`Import berhasil. ${imported.items.length} barang masuk ke browser ini.`);
      } catch {
        setToast('File tidak bisa dibaca. Pastikan formatnya JSON hasil export Wishlist Jujur.');
      }
    };
    reader.readAsText(file);
  }

  function resetData() {
    const confirmed = window.confirm('Reset akan menghapus semua barang Wishlist Jujur di browser ini. Yakin?');
    if (!confirmed) return;
    setState(initialState);
    setToast('Data lokal direset. Keranjang kedua mulai dari nol lagi.');
  }

  function useAiStub() {
    if (aiTrialRemaining <= 0) {
      setToast('AI Check Pro masih stub. Trial habis, tapi basic scoring tetap gratis.');
      return;
    }
    setState((current) => ({ ...current, aiTrialUsed: current.aiTrialUsed + 1 }));
    setToast('Simulasi AI Check dipakai. Belum memanggil API apa pun — aman dari biaya.');
  }

  async function copyPromptForItem(item: WishlistItem) {
    try {
      await copyTextToClipboard(buildChatGptPrompt(item));
      setToast(`Prompt ChatGPT untuk ${item.name} sudah dicopy.`);
    } catch {
      setToast('Gagal copy otomatis. Browser kamu memblokir clipboard.');
    }
  }

  function markStatus(itemId: string, status: ItemStatus) {
    const now = new Date().toISOString();
    let changedItem: WishlistItem | undefined;
    setState((current) => ({
      ...current,
      items: current.items.map((item) => {
        if (item.id !== itemId) return item;
        changedItem = item;
        return {
          ...item,
          status,
          updatedAt: now,
          boughtAt: status === 'bought' ? now : item.boughtAt,
          cancelledAt: status === 'cancelled' ? now : item.cancelledAt,
          delayedAt: status === 'delayed' ? now : item.delayedAt,
        };
      }),
    }));

    if (status === 'cancelled' && changedItem) setToast(`Mantap. ${formatIDR(changedItem.price)} masuk ke Uang Terselamatkan.`);
    if (status === 'bought') setToast('Dicatat sebagai dibeli. Semoga memang kepakai.');
    if (status === 'delayed') setToast('Ditunda. Checkout bisa menunggu.');
  }

  function deleteItem(itemId: string) {
    setState((current) => ({ ...current, items: current.items.filter((item) => item.id !== itemId) }));
    setToast('Barang dihapus dari wishlist.');
  }

  return (
    <main className="app-shell">
      <section className="hero-card card-ink">
        <div className="brand-row">
          <div>
            <p className="eyebrow">Wishlist Jujur</p>
            <h1>Cek dulu sebelum checkout.</h1>
          </div>
          <div className="hero-tools">
            <span className="sticker">MVP</span>
            <button className="tool-button" type="button" onClick={() => setIsSettingsOpen(true)}>Settings</button>
          </div>
        </div>
        <p className="hero-copy">Biar uang keluar karena butuh, bukan karena diskon teriak-teriak.</p>
        <button className="btn btn-primary btn-wide" type="button" onClick={() => setIsAdding(true)}>
          + Cek Barang Sebelum Checkout
        </button>
        <p className="trust-note">Tanpa login dulu. Data kamu tersimpan di browser ini.</p>
      </section>

      <section className="summary-grid" aria-label="Ringkasan wishlist">
        <SummaryCard label="Uang Terselamatkan" value={formatIDR(moneySaved)} helper={moneySaved ? `Dari ${state.items.filter((item) => item.status === 'cancelled').length} barang yang berhasil kamu tahan.` : 'Belum ada barang yang batal dibeli.'} tone="saved" />
        <SummaryCard label="Potensi Belanja" value={formatIDR(potentialSpend)} helper="Total barang yang masih kamu pertimbangkan." />
        <SummaryCard label="Lagi Dipertimbangkan" value={`${consideringCount}`} helper="Barang yang belum kamu putuskan." />
        <SummaryCard label="AI Check Gratis" value={`${aiTrialRemaining}/3`} helper={aiTrialRemaining ? 'AI belum aktif real; ini slot trial untuk Pro stub.' : 'AI trial habis. Basic scoring tetap bisa dipakai.'} tone="ai" />
      </section>

      <section className="pro-stub card-ink">
        <div>
          <p className="eyebrow">AI Bridge</p>
          <h2>AI-nya belum nyala. Tapi prompt-nya sudah siap.</h2>
          <p>Belum ada API berbayar. Pakai tombol <strong>Copy Prompt</strong> di tiap barang, lalu paste ke ChatGPT untuk second opinion yang lebih detail.</p>
        </div>
        <button className="btn btn-secondary" type="button" onClick={useAiStub}>Coba AI Check Stub</button>
      </section>

      <section className="wishlist-panel card-ink">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Keranjang kedua</p>
            <h2>Barang yang sudah dicek</h2>
          </div>
          <div className="header-actions">
            <button className="btn btn-secondary" type="button" onClick={exportData}>Export JSON</button>
            <button className="btn btn-secondary" type="button" onClick={() => importInputRef.current?.click()}>Import</button>
            <button className="btn btn-primary" type="button" onClick={() => setIsAdding(true)}>+ Cek Barang</button>
          </div>
        </div>

        <input
          ref={importInputRef}
          className="sr-only"
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            importData(event.currentTarget.files?.[0] ?? null);
            event.currentTarget.value = '';
          }}
        />

        <div className="filter-bar" aria-label="Filter barang">
          {(['all', 'S', 'A', 'B', 'C', 'D', 'considering', 'delayed', 'bought', 'cancelled'] as Filter[]).map((itemFilter) => (
            <button key={itemFilter} className={`chip ${filter === itemFilter ? 'chip-selected' : ''}`} type="button" onClick={() => setFilter(itemFilter)}>
              {filterLabel(itemFilter)}
            </button>
          ))}
        </div>

        {state.items.length === 0 ? (
          <EmptyState onAdd={() => setIsAdding(true)} />
        ) : filteredItems.length === 0 ? (
          <div className="empty-state compact">
            <h3>Tidak ada barang di filter ini.</h3>
            <p>Entah kamu sudah aman, atau barang impulsifnya lagi sembunyi di filter lain.</p>
            <button className="btn btn-secondary" type="button" onClick={() => setFilter('all')}>Lihat Semua Barang</button>
          </div>
        ) : state.settings.preferredView === 'flatList' ? (
          <div className="item-grid">
            {filteredItems.map((item) => (
              <ItemCard key={item.id} item={item} onEdit={() => setEditingItem(item)} onCopyPrompt={() => copyPromptForItem(item)} onBought={() => markStatus(item.id, 'bought')} onCancelled={() => markStatus(item.id, 'cancelled')} onDelayed={() => markStatus(item.id, 'delayed')} onDelete={() => deleteItem(item.id)} />
            ))}
          </div>
        ) : (
          <div className="tier-stack">
            {TIER_ORDER.map((tier) => {
              const items = filteredItems.filter((item) => item.tier === tier);
              if (!items.length) return null;
              return (
                <section className="tier-section" key={tier}>
                  <div className="tier-heading">
                    <TierBadge tier={tier} />
                    <span>{TIER_CONFIG[tier].label}</span>
                  </div>
                  <div className="item-grid">
                    {items.map((item) => (
                      <ItemCard key={item.id} item={item} onEdit={() => setEditingItem(item)} onCopyPrompt={() => copyPromptForItem(item)} onBought={() => markStatus(item.id, 'bought')} onCancelled={() => markStatus(item.id, 'cancelled')} onDelayed={() => markStatus(item.id, 'delayed')} onDelete={() => deleteItem(item.id)} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </section>

      <button className="mobile-fab" type="button" onClick={() => setIsAdding(true)}>
        + Cek Barang
      </button>

      {isAdding && <AddItemFlow onClose={() => setIsAdding(false)} onSave={addItem} onCopyPrompt={copyPromptForItem} />}
      {editingItem && <AddItemFlow mode="edit" initialItem={editingItem} onClose={() => setEditingItem(null)} onSave={updateItem} onCopyPrompt={copyPromptForItem} />}
      {isSettingsOpen && (
        <SettingsPanel
          state={state}
          onClose={() => setIsSettingsOpen(false)}
          onExport={exportData}
          onImport={() => importInputRef.current?.click()}
          onReset={resetData}
          onPreferredViewChange={(preferredView) => setState((current) => ({ ...current, settings: { ...current.settings, preferredView } }))}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function normalizeImportedState(value: unknown): WishlistState | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<WishlistState>;
  if (candidate.schemaVersion !== '0.1' || !Array.isArray(candidate.items)) return null;
  return {
    ...initialState,
    ...candidate,
    schemaVersion: '0.1',
    items: candidate.items,
    aiTrialUsed: Number.isFinite(candidate.aiTrialUsed) ? Number(candidate.aiTrialUsed) : 0,
    settings: {
      ...initialState.settings,
      ...candidate.settings,
      currency: 'IDR',
      preferredView: candidate.settings?.preferredView === 'flatList' ? 'flatList' : 'groupedByTier',
    },
  };
}

function SummaryCard({ label, value, helper, tone = 'default' }: { label: string; value: string; helper: string; tone?: 'default' | 'saved' | 'ai' }) {
  return (
    <article className={`summary-card ${tone}`}>
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{helper}</span>
    </article>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty-state">
      <div className="empty-receipt">?</div>
      <h3>Belum ada barang yang dicek.</h3>
      <p>Mulai dari barang yang paling menggoda sekarang. Yang ada timer diskon, yang viral, atau yang kamu bela dengan kalimat “kayaknya butuh”.</p>
      <button className="btn btn-primary" type="button" onClick={onAdd}>Cek Barang Pertama</button>
      <small>Cocok untuk barang yang hampir kamu checkout, bukan semua barang yang lewat di timeline.</small>
    </div>
  );
}

function SettingsPanel({
  state,
  onClose,
  onExport,
  onImport,
  onReset,
  onPreferredViewChange,
}: {
  state: WishlistState;
  onClose: () => void;
  onExport: () => void;
  onImport: () => void;
  onReset: () => void;
  onPreferredViewChange: (view: WishlistState['settings']['preferredView']) => void;
}) {
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Settings">
      <section className="bottom-sheet settings-sheet card-ink">
        <div className="sheet-header">
          <div>
            <p className="eyebrow">Local-first settings</p>
            <h2>Data tetap di browser.</h2>
          </div>
          <button className="close-button" type="button" onClick={onClose} aria-label="Tutup">×</button>
        </div>

        <div className="settings-grid">
          <article className="setting-box">
            <h3>Storage</h3>
            <p>Key: <code>{STORAGE_KEY}</code></p>
            <p>{state.items.length} barang tersimpan. Money saved dihitung dari status <strong>Batal Beli</strong>.</p>
          </article>

          <article className="setting-box">
            <h3>Tampilan wishlist</h3>
            <div className="choice-grid">
              <button className={`chip ${state.settings.preferredView === 'groupedByTier' ? 'chip-selected' : ''}`} type="button" onClick={() => onPreferredViewChange('groupedByTier')}>Group per tier</button>
              <button className={`chip ${state.settings.preferredView === 'flatList' ? 'chip-selected' : ''}`} type="button" onClick={() => onPreferredViewChange('flatList')}>Flat list</button>
            </div>
          </article>

          <article className="setting-box">
            <h3>Backup manual</h3>
            <p>Karena belum ada login/backend, export JSON adalah cadangan paling aman untuk pindah device atau bersih-bersih browser.</p>
            <div className="button-row compact-buttons">
              <button className="btn btn-secondary" type="button" onClick={onExport}>Export JSON</button>
              <button className="btn btn-secondary" type="button" onClick={onImport}>Import JSON</button>
            </div>
          </article>

          <article className="setting-box danger-box">
            <h3>Reset lokal</h3>
            <p>Hapus semua item dari browser ini. Tidak bisa undo kecuali kamu punya file export.</p>
            <button className="btn btn-danger" type="button" onClick={onReset}>Reset Data</button>
          </article>
        </div>
      </section>
    </div>
  );
}

function ItemCard({
  item,
  onEdit,
  onCopyPrompt,
  onBought,
  onCancelled,
  onDelayed,
  onDelete,
}: {
  item: WishlistItem;
  onEdit: () => void;
  onCopyPrompt: () => void;
  onBought: () => void;
  onCancelled: () => void;
  onDelayed: () => void;
  onDelete: () => void;
}) {
  return (
    <article className={`item-card tier-${item.tier.toLowerCase()}`}>
      <div className="item-topline">
        <TierBadge tier={item.tier} />
        <span className="price-tag">{formatIDR(item.price)}</span>
      </div>
      <h3>{item.name}</h3>
      <p className="item-reason">“{item.userReason || 'Belum ada alasan. Kadang ini sudah jadi sinyal.'}”</p>
      <div className="item-meta">
        <span>{statusLabels[item.status]}</span>
        <span>{formatCooldown(item.cooldownUntil)}</span>
      </div>
      <div className="reason-list">
        {item.reasonBreakdown.slice(0, 3).map((reason) => <span key={reason}>• {reason}</span>)}
      </div>
      <div className="card-actions">
        <button className="mini-button edit" type="button" onClick={onEdit}>Edit</button>
        <button className="mini-button ai-action" type="button" onClick={onCopyPrompt}>Copy Prompt</button>
        <button className="mini-button" type="button" onClick={onBought}>Dibeli</button>
        <button className="mini-button positive" type="button" onClick={onCancelled}>Batal Beli</button>
        <button className="mini-button" type="button" onClick={onDelayed}>Tunda</button>
        <button className="mini-button ghost" type="button" onClick={onDelete}>Hapus</button>
      </div>
    </article>
  );
}

function AddItemFlow({
  onClose,
  onSave,
  onCopyPrompt,
  mode = 'add',
  initialItem,
}: {
  onClose: () => void;
  onSave: (item: WishlistItem) => void;
  onCopyPrompt: (item: WishlistItem) => void;
  mode?: 'add' | 'edit';
  initialItem?: WishlistItem;
}) {
  const isEdit = mode === 'edit' && Boolean(initialItem);
  const [step, setStep] = useState<AddStep>(1);
  const [draft, setDraft] = useState<AddItemDraft>(() => (initialItem ? draftFromItem(initialItem) : createEmptyDraft()));
  const [error, setError] = useState<string | null>(null);

  const price = parsePriceInput(draft.priceInput);
  const result = hasAllAnswers(draft.answers) && price
    ? buildWishlistItem({
        name: draft.name,
        price,
        category: draft.category,
        productLink: draft.productLink,
        userReason: draft.userReason,
        answers: draft.answers,
      })
    : null;

  function setAnswer<K extends keyof ScoringAnswers>(key: K, value: ScoringAnswers[K]) {
    setDraft((current) => ({ ...current, answers: { ...current.answers, [key]: value } }));
  }

  function goNextFromStepOne() {
    if (!draft.name.trim()) {
      setError('Nama barang wajib diisi. App belum bisa membaca pikiran kamu.');
      return;
    }
    if (!price) {
      setError('Harga wajib diisi biar kita bisa hitung dampaknya.');
      return;
    }
    if (draft.productLink.trim()) {
      try {
        new URL(draft.productLink.trim());
      } catch {
        setError('Link-nya terlihat belum valid. Boleh dikosongkan dulu.');
        return;
      }
    }
    setError(null);
    setStep(2);
  }

  function goResult() {
    if (!hasAllAnswers(draft.answers)) {
      setError('Jawab semua dulu biar hasilnya nggak ngarang.');
      return;
    }
    setError(null);
    setStep(3);
  }

  function save() {
    if (!result) return;
    if (isEdit && initialItem) {
      const now = new Date().toISOString();
      const answersChanged = answersAreDifferent(initialItem.answers, result.answers);
      const tierChanged = initialItem.tier !== result.tier;
      onSave({
        ...initialItem,
        name: result.name,
        price: result.price,
        category: result.category,
        productLink: result.productLink,
        userReason: result.userReason,
        answers: result.answers,
        score: result.score,
        maxScore: result.maxScore,
        tier: result.tier,
        tierLabel: result.tierLabel,
        reasonBreakdown: result.reasonBreakdown,
        cooldownDays: result.cooldownDays,
        cooldownUntil: answersChanged || tierChanged ? getCooldownUntil(now, result.cooldownDays) : initialItem.cooldownUntil,
        updatedAt: now,
      });
    } else {
      onSave(result);
    }
    onClose();
  }

  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label={isEdit ? 'Edit barang' : 'Tambah barang'}>
      <section className="bottom-sheet card-ink">
        <div className="sheet-header">
          <div>
            <p className="eyebrow">{isEdit ? 'Edit produk' : 'Step'} {step} dari 3</p>
            <h2>{step === 1 ? (isEdit ? 'Edit Barang Ini' : 'Cek Barang Ini') : step === 2 ? (isEdit ? 'Sidang Ulang Jawaban' : 'Cek Kejujuran') : (isEdit ? 'Hasil Setelah Edit' : 'Hasil Cek')}</h2>
          </div>
          <button className="close-button" type="button" onClick={onClose} aria-label="Tutup">×</button>
        </div>

        {step === 1 && (
          <div className="form-grid">
            <p className="sheet-intro">{isEdit ? 'Ubah data produknya. Kalau jawabannya ikut berubah, tier dan cooldown akan dihitung ulang.' : 'Isi cepat aja. Ini bukan form pajak.'}</p>
            <label>
              <span>Barang apa yang mau dibeli?</span>
              <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Contoh: Hoodie oversize viral" />
            </label>
            <label>
              <span>Harganya berapa?</span>
              <input inputMode="numeric" value={draft.priceInput} onChange={(event) => setDraft((current) => ({ ...current, priceInput: event.target.value }))} placeholder="Rp299.000" />
            </label>
            <label>
              <span>Link produk <small>opsional</small></span>
              <input value={draft.productLink} onChange={(event) => setDraft((current) => ({ ...current, productLink: event.target.value }))} placeholder="Tempel link Shopee/TikTok/Lazada kalau ada" />
              <small>Untuk MVP, link hanya disimpan sebagai catatan.</small>
            </label>
            <label>
              <span>Kenapa kepikiran beli?</span>
              <textarea value={draft.userReason} onChange={(event) => setDraft((current) => ({ ...current, userReason: event.target.value }))} placeholder="Contoh: lucu, lagi diskon, keyboard lama rusak..." />
            </label>
            <div>
              <span className="field-label">Kategori</span>
              <div className="choice-grid compact-choice">
                {CATEGORIES.map((category) => (
                  <button key={category} className={`chip ${draft.category === category ? 'chip-selected' : ''}`} type="button" onClick={() => setDraft((current) => ({ ...current, category }))}>{category}</button>
                ))}
              </div>
            </div>
            {error && <p className="form-error">{error}</p>}
            <button className="btn btn-primary btn-wide" type="button" onClick={goNextFromStepOne}>{isEdit ? 'Lanjut Sidang Ulang' : 'Lanjut Cek Kejujuran'}</button>
          </div>
        )}

        {step === 2 && (
          <div className="form-grid">
            <p className="sheet-intro">{isEdit ? 'Cek lagi dengan kondisi terbaru. Jujur sedikit sekarang, hemat nyesel nanti.' : 'Jawab cepat aja. Ini bukan ujian, ini rem checkout.'}</p>
            {questions.map((question) => (
              <fieldset className="question-block" key={question.key}>
                <legend>{question.title}</legend>
                <small>{question.helper}</small>
                <div className="choice-grid">
                  {question.options.map((option) => (
                    <button key={option.value} className={`choice-chip ${draft.answers[question.key] === option.value ? 'selected' : ''}`} type="button" onClick={() => setAnswer(question.key, option.value)}>
                      {option.label}
                    </button>
                  ))}
                </div>
              </fieldset>
            ))}
            {error && <p className="form-error">{error}</p>}
            <div className="button-row">
              <button className="btn btn-secondary" type="button" onClick={() => setStep(1)}>Kembali</button>
              <button className="btn btn-primary" type="button" onClick={goResult}>{isEdit ? 'Lihat Tier Baru' : 'Lihat Tier Barang Ini'}</button>
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div className="result-wrap">
            <div className={`result-card tier-${result.tier.toLowerCase()}`}>
              <TierBadge tier={result.tier} size="large" />
              <h3>{TIER_CONFIG[result.tier].headline}</h3>
              <p>{TIER_CONFIG[result.tier].summary}</p>
              <div className="score-line">Score {result.score}/{result.maxScore} · {formatCooldown(result.cooldownUntil)}</div>
              {TIER_CONFIG[result.tier].roast && <div className="roast-note">{TIER_CONFIG[result.tier].roast}</div>}
            </div>
            <div className="reason-list expanded">
              <strong>Kenapa masuk tier ini?</strong>
              {result.reasonBreakdown.map((reason) => <span key={reason}>• {reason}</span>)}
            </div>
            <div className="button-row">
              <button className="btn btn-secondary" type="button" onClick={() => setStep(2)}>Ubah Jawaban</button>
              <button className="btn btn-secondary" type="button" onClick={() => onCopyPrompt(result)}>Copy Prompt ke ChatGPT</button>
              <button className="btn btn-primary" type="button" onClick={save}>{isEdit ? 'Simpan Perubahan' : 'Simpan ke Wishlist'}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function TierBadge({ tier, size = 'normal' }: { tier: Tier; size?: 'normal' | 'large' }) {
  return <span className={`tier-badge tier-${tier.toLowerCase()} ${size === 'large' ? 'large' : ''}`}>{tier} · {TIER_CONFIG[tier].label}</span>;
}

function filterLabel(filter: Filter): string {
  if (filter === 'all') return 'Semua';
  if (TIER_ORDER.includes(filter as Tier)) return `${filter} Tier`;
  return statusLabels[filter as ItemStatus];
}

export default App;
