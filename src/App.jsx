import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Bell,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Download,
  Eye,
  EyeOff,
  FileImage,
  FileText,
  Filter,
  Home,
  Inbox,
  KeyRound,
  Link2,
  LogOut,
  Menu,
  MessageCircle,
  Plus,
  ReceiptText,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Upload,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import {
  analyzeMessage,
  applyReviewCorrection,
  calculateMonthlyTotals,
  calculateSnapshot,
  formatDate,
  formatMonth,
  formatRelativeDate,
  formatZar,
  isConfirmedEvent,
  localDateISO,
  projectMonthlyFlow,
} from './core/intelligence.js';
import { makeAssistantReply } from './core/assistant.js';
import {
  clearLocalVault,
  createInitialState,
  createLocalAccount,
  downloadJson,
  getStoredAccount,
  isValidPin,
  PIN_LENGTH,
  saveEncryptedState,
  unlockLocalAccount,
} from './core/storage.js';

const NAV_GROUPS = [
  {
    label: 'YOUR MONEY',
    items: [
      { id: 'today', label: 'Today', icon: Home },
      { id: 'money', label: 'Money', icon: Wallet },
      { id: 'insights', label: 'Insights', icon: Activity },
      { id: 'forecast', label: 'Forecast', icon: TrendingUp },
    ],
  },
  {
    label: 'YOUR INFORMATION',
    items: [
      { id: 'inbox', label: 'AI Inbox', icon: Inbox },
      { id: 'scan', label: 'Scan & share', icon: FileImage },
      { id: 'ask', label: 'Ask MoneyLens', icon: MessageCircle },
    ],
  },
];

const SOURCES = [
  'Bank notification', 'SMS', 'WhatsApp', 'Email', 'Screenshot', 'Receipt', 'Bill', 'Other',
];
const CATEGORIES = [
  'Income', 'Housing', 'Groceries', 'Transport', 'Utilities', 'Insurance', 'Subscriptions',
  'Education', 'Mobile & internet', 'Debt', 'Shopping', 'Safety', 'Other',
];
const SUGGESTED_QUESTIONS = [
  'How much did I spend this month?',
  'Compare this month with last month',
  'What confirmed payments are upcoming?',
  'Show subscriptions in my records',
];

function needsGuidedReview(event) {
  return event.inboxState === 'open'
    || (event.state === 'posted' && (!event.transactionDate || event.amount == null))
    || (event.state === 'upcoming' && (event.amount == null || !event.dueDate));
}

function getTodayLabel() {
  return new Intl.DateTimeFormat('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date());
}

function getTodayEyebrow() {
  return new Intl.DateTimeFormat('en-ZA', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).toUpperCase();
}

function IconBadge({ icon: Icon, tone = 'mint', size = 42 }) {
  return <span className={`icon-badge icon-badge--${tone}`} style={{ width: size, height: size }}><Icon size={20} strokeWidth={1.8} /></span>;
}

function Logo({ compact = false }) {
  return (
    <div className={`brand ${compact ? 'brand--compact' : ''}`}>
      <span className="brand-mark" aria-hidden="true"><span /><i /></span>
      {!compact && <span className="brand-name">Money<span>Lens</span><small>FINANCIAL INTELLIGENCE</small></span>}
    </div>
  );
}

function App() {
  const [storedAccount, setStoredAccount] = useState(() => getStoredAccount());
  const [account, setAccount] = useState(null);
  const [vaultKey, setVaultKey] = useState(null);
  const [guestPreview, setGuestPreview] = useState(false);
  const [guestUses, setGuestUses] = useState(() => {
    try {
      const uses = Number(sessionStorage.getItem('moneylens.preview-uses') || 0);
      return Number.isFinite(uses) ? Math.min(3, Math.max(0, uses)) : 0;
    } catch { return 0; }
  });
  const [appState, setAppState] = useState(() => createInitialState());
  const [saveStateLabel, setSaveStateLabel] = useState('locked');
  const [view, setView] = useState('today');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [detailEvent, setDetailEvent] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [toast, setToast] = useState('');
  const [captureResult, setCaptureResult] = useState(null);

  const events = appState.events;
  const settings = appState.settings;
  const snapshot = useMemo(() => calculateSnapshot(events), [events]);
  const openInbox = useMemo(() => events.filter((event) => event.inboxState === 'open'), [events]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 3600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!vaultKey) {
      setSaveStateLabel('locked');
      return undefined;
    }
    setSaveStateLabel('saving');
    const timer = window.setTimeout(async () => {
      const saved = await saveEncryptedState(appState, vaultKey);
      setSaveStateLabel(saved ? 'saved' : 'error');
      if (!saved) setToast('The encrypted local save failed. Export or copy your latest work before leaving this page.');
    }, 350);
    return () => window.clearTimeout(timer);
  }, [appState, vaultKey]);

  useEffect(() => {
    const handleKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === 'Escape') {
        setCaptureOpen(false);
        setCaptureResult(null);
        setDetailEvent(null);
        setSearchOpen(false);
        setConfirmDelete(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const navigate = (nextView) => {
    if (!vaultKey) {
      const guestViews = ['today', 'money', 'insights'];
      if (!guestPreview || !guestViews.includes(nextView) || guestUses >= 3) {
        setGuestPreview(false);
        return;
      }
      const nextUseCount = Math.min(3, guestUses + 1);
      setGuestUses(nextUseCount);
      try { sessionStorage.setItem('moneylens.preview-uses', String(nextUseCount)); } catch {}
    }
    setView(nextView);
    setMobileNavOpen(false);
    setCaptureResult(null);
  };

  const startPreview = () => {
    if (guestUses >= 3) return;
    const nextUseCount = Math.min(3, guestUses + 1);
    setGuestUses(nextUseCount);
    try { sessionStorage.setItem('moneylens.preview-uses', String(nextUseCount)); } catch {}
    setGuestPreview(true);
    setView('today');
  };

  const acceptLocalAccount = ({ account: nextAccount, key, state }) => {
    setAccount(nextAccount);
    setStoredAccount(nextAccount);
    setVaultKey(key);
    setAppState(state);
    setGuestPreview(false);
    setView('today');
  };

  const lockAccount = async () => {
    if (vaultKey) {
      const saved = await saveEncryptedState(appState, vaultKey);
      if (!saved) {
        setSaveStateLabel('error');
        setToast('MoneyLens could not save the encrypted vault, so it remains unlocked. Export your records before leaving.');
        return;
      }
    }
    setVaultKey(null);
    setAccount(null);
    setAppState(createInitialState());
    setGuestPreview(false);
    setView('today');
  };

  const deleteLocalAccount = async () => {
    if (!window.confirm('Permanently delete this local account and its encrypted MoneyLens records from this browser? This cannot be undone.')) return;
    await clearLocalVault();
    setStoredAccount(null);
    setVaultKey(null);
    setAccount(null);
    setAppState(createInitialState());
    setGuestPreview(false);
    setView('today');
  };

  const requireLocalAccount = () => {
    setGuestPreview(false);
    setCaptureOpen(false);
    setSearchOpen(false);
    setDetailEvent(null);
  };

  const updateEvent = (id, changes) => {
    setAppState((current) => ({
      ...current,
      events: current.events.map((event) => event.id === id ? { ...event, ...changes } : event),
    }));
    setDetailEvent((current) => current?.id === id ? { ...current, ...changes } : current);
  };

  const addCapture = (text, source = 'Shared message') => {
    if (!vaultKey) {
      requireLocalAccount();
      return null;
    }
    const normalizedSource = source || 'Shared message';
    if (settings.monitoringPaused) {
      setToast('New captures are paused. Resume them in Settings to continue.');
      return null;
    }
    if (settings.excludedSources.includes(normalizedSource)) {
      setToast(`${normalizedSource} is on your exclusion list. Nothing was saved.`);
      return null;
    }
    const result = analyzeMessage(text, normalizedSource, { existingEvents: events });
    if (result.ignored) {
      setToast(result.reason);
      return null;
    }
    if (result.duplicate) {
      setToast(result.reason);
      return null;
    }
    setAppState((current) => ({ ...current, events: [result, ...current.events] }));
    setCaptureResult(result);
    setToast(result.inboxState === 'open' ? 'Added to your AI Inbox for a quick review.' : 'Understood and added to your money picture.');
    return result;
  };

  const answerQuestion = async (question, useCloudAI = false) => {
    const cleanQuestion = question.trim();
    if (!cleanQuestion) return;
    if (!vaultKey) {
      requireLocalAccount();
      return;
    }
    const userMessage = { id: `chat-${Date.now()}`, role: 'user', content: cleanQuestion, time: new Date().toISOString() };
    let reply;
    let sources = [];
    let provider = 'local';
    try {
      if (useCloudAI) {
        const confirmedRecords = events.filter(isConfirmedEvent);
        const response = await fetch('/api/ai/ask', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-moneylens-request': '1' },
          body: JSON.stringify({
            question: cleanQuestion,
            records: confirmedRecords.map((record) => ({
              id: record.id,
              merchant: record.merchant || record.title,
              transactionDate: record.transactionDate,
              dueDate: record.dueDate,
              date: record.date,
              amount: record.amount,
              flow: record.flow,
              category: record.category,
              kind: record.kind,
            })),
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `AI request failed (${response.status}).`);
        reply = { content: payload.answer, sources: [] };
        sources = events.filter((record) => payload.sourceIds?.includes(record.id)).map((record) => ({
          id: record.id,
          title: record.title,
          merchant: record.merchant,
          source: record.source,
          amount: record.amount,
          date: record.transactionDate || record.dueDate || record.date || null,
          kind: record.kind,
        }));
        provider = `cloud:${payload.model || 'LLM'}`;
      } else {
        reply = makeAssistantReply(cleanQuestion, events);
        sources = reply.sources;
      }
      const assistantMessage = {
        id: `reply-${Date.now()}`,
        role: 'assistant',
        content: reply.content,
        sources,
        provider,
        time: new Date().toISOString(),
      };
      setAppState((current) => ({ ...current, chatMessages: [...current.chatMessages, userMessage, assistantMessage] }));
    } catch (error) {
      setAppState((current) => ({
        ...current,
        chatMessages: [...current.chatMessages, userMessage, {
          id: `reply-${Date.now()}`,
          role: 'assistant',
          content: `Cloud AI could not answer: ${error.message} Your question and records remain in this browser; try again or turn cloud AI off for an on-device answer.`,
          sources: [],
          provider: 'error',
          time: new Date().toISOString(),
        }],
      }));
    }
    setView('ask');
  };

  const changeSetting = (key, value) => {
    if (!vaultKey) { requireLocalAccount(); return; }
    setAppState((current) => ({ ...current, settings: { ...current.settings, [key]: value } }));
  };

  const toggleExcludedSource = (source) => {
    const excluded = settings.excludedSources.includes(source)
      ? settings.excludedSources.filter((item) => item !== source)
      : [...settings.excludedSources, source];
    changeSetting('excludedSources', excluded);
  };

  const clearHistory = () => {
    setAppState((current) => ({ ...current, events: [], chatMessages: [] }));
    setConfirmDelete(false);
    setDetailEvent(null);
    setToast('Captured records and chat history deleted. Your local account remains.');
  };

  const exportHistory = () => {
    if (!vaultKey) { requireLocalAccount(); return; }
    downloadJson(events, settings);
    setToast('An unencrypted export of your confirmed and pending local records was downloaded. Store it safely.');
  };

  const openCapture = () => {
    if (!vaultKey) { requireLocalAccount(); return; }
    setCaptureResult(null);
    setCaptureOpen(true);
  };

  const navGroups = guestPreview
    ? NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => ['today', 'money', 'insights'].includes(item.id)) })).filter((group) => group.items.length)
    : NAV_GROUPS;
  const displayName = account?.email?.split('@')[0] || 'Preview';
  const profileInitials = displayName.slice(0, 2).toUpperCase();

  const screenProps = {
    events,
    snapshot,
    openInbox,
    settings,
    account,
    saveStateLabel,
    guestPreview,
    guestViewsRemaining: Math.max(0, 3 - guestUses),
    onNavigate: navigate,
    onOpenCapture: openCapture,
    onOpenEvent: setDetailEvent,
    onAnswer: answerQuestion,
    onUpdateEvent: updateEvent,
    onChangeSetting: changeSetting,
    onToggleSource: toggleExcludedSource,
    onDelete: () => setConfirmDelete(true),
    onDeleteAccount: deleteLocalAccount,
    onExport: exportHistory,
    onLogout: lockAccount,
    toast,
  };

  if (!vaultKey && !guestPreview) {
    return <AuthGate account={storedAccount} previewAvailable={guestUses < 3} onAuthenticated={acceptLocalAccount} onPreview={startPreview} onDeleteVault={deleteLocalAccount} />;
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar-brand-row">
          <Logo />
          <button className="icon-button sidebar-close" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation"><X size={19} /></button>
        </div>
        <div className="workspace-switcher">
          <div className="workspace-avatar">{profileInitials.slice(0, 1)}</div>
          <div><strong>{account ? `${displayName}’s local vault` : 'Limited preview'}</strong><span>{account ? 'Encrypted on this browser' : 'No data is being saved'}</span></div>
          <ChevronDown size={15} />
        </div>
        <nav className="side-nav" aria-label="Main navigation">
          {navGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <p className="nav-label">{group.label}</p>
              {group.items.map(({ id, label, icon: Icon }) => (
                <button className={`nav-link ${view === id ? 'nav-link--active' : ''}`} key={id} onClick={() => navigate(id)}>
                  <Icon size={18} strokeWidth={view === id ? 2.1 : 1.8} />
                  <span>{label}</span>
                  {id === 'inbox' && openInbox.length > 0 && <span className="nav-count">{openInbox.length}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="privacy-mini-card">
          <div className="privacy-mini-icon"><ShieldCheck size={17} /></div>
          <div><strong>{account ? 'PIN-protected vault' : 'No preview data is saved'}</strong><span>{account ? 'Encrypted on this device' : 'Sign up to start capturing'}</span></div>
          <button aria-label="Open privacy centre" onClick={() => navigate('settings')}><ChevronRight size={16} /></button>
        </div>
        {!guestPreview && <button className={`nav-link settings-link ${view === 'settings' ? 'nav-link--active' : ''}`} onClick={() => navigate('settings')}>
          <Settings size={18} /><span>Settings & privacy</span>
        </button>}
        <div className="profile-mini">
          <div className="profile-avatar">{profileInitials}</div>
          <div><strong>{account?.email || 'Preview mode'}</strong><span>{account ? 'Local account' : `${Math.max(0, 3 - guestUses)} preview views left`}</span></div>
          {account && <button className="icon-button icon-button--small" aria-label="Lock local account" onClick={lockAccount}><LogOut size={16} /></button>}
        </div>
      </aside>

      {mobileNavOpen && <button className="nav-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}

      <main className="main-column">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Menu size={20} /></button>
            <div className="breadcrumb"><span>MoneyLens</span><ChevronRight size={14} /><strong>{viewTitle(view)}</strong></div>
          </div>
          <div className="topbar-actions">
            <span className="top-date"><CalendarDays size={15} />{getTodayLabel()}</span>
            <button className="icon-button top-search" aria-label="Search MoneyLens" onClick={() => setSearchOpen(true)}><Search size={18} /></button>
            <button className="icon-button notification-button" aria-label={`AI Inbox, ${openInbox.length} items`} onClick={() => navigate('inbox')}>
              <Bell size={18} />{openInbox.length > 0 && <i />}
            </button>
            <button className="top-avatar" aria-label={account ? 'Open settings' : 'Create local account'} onClick={() => account ? navigate('settings') : requireLocalAccount()}>{profileInitials}</button>
            <button className={`button button--primary top-capture ${settings.monitoringPaused ? 'button--resume' : ''}`} onClick={() => settings.monitoringPaused ? changeSetting('monitoringPaused', false) : openCapture()}>
              {settings.monitoringPaused ? <Check size={17} /> : <Plus size={17} />}{settings.monitoringPaused ? 'Resume capture' : guestPreview ? 'Unlock capture' : 'Capture info'}
            </button>
          </div>
        </header>

        <div className="page-scroll">
          {guestPreview && <div className="guest-preview-banner"><ShieldCheck size={16} /><span>Limited preview · no personal data is saved · {Math.max(0, 3 - guestUses)} preview views remaining</span><button onClick={requireLocalAccount}>Create a local account</button></div>}
          {settings.monitoringPaused && view !== 'settings' && (
            <div className="paused-banner"><AlertCircle size={16} />New captures are paused. <button onClick={() => changeSetting('monitoringPaused', false)}>Resume</button></div>
          )}
          {view === 'today' && <TodayScreen {...screenProps} onOpenSearch={() => setSearchOpen(true)} />}
          {view === 'money' && <MoneyScreen {...screenProps} />}
          {view === 'insights' && <InsightsScreen {...screenProps} />}
          {view === 'forecast' && <ForecastScreen {...screenProps} onAnswer={answerQuestion} />}
          {view === 'inbox' && <InboxScreen {...screenProps} />}
          {view === 'scan' && <ScanScreen {...screenProps} onCapture={addCapture} />}
          {view === 'ask' && <AskScreen {...screenProps} messages={appState.chatMessages} />}
          {view === 'settings' && <SettingsScreen {...screenProps} />}
          <footer className="app-footer">
            <span><ShieldCheck size={14} /> {account ? 'Encrypted local vault · confirmed records only' : 'Preview · no records saved'}</span>
            <span>This browser cannot read other apps. MoneyLens never makes payments or verifies a live balance.</span>
          </footer>
        </div>
      </main>

      {captureOpen && (
        <CaptureModal
          onClose={() => { setCaptureOpen(false); setCaptureResult(null); }}
          onAnalyze={(text, source) => addCapture(text, source)}
          result={captureResult}
          settings={settings}
          onOpenEvent={setDetailEvent}
        />
      )}
      {detailEvent && (
        <EventDetailModal
          key={detailEvent.id}
          event={detailEvent}
          events={events}
          onClose={() => setDetailEvent(null)}
          onUpdate={updateEvent}
        />
      )}
      {searchOpen && (
        <SearchModal
          events={events}
          value={searchTerm}
          onChange={setSearchTerm}
          onClose={() => { setSearchOpen(false); setSearchTerm(''); }}
          onOpenEvent={(event) => { setSearchOpen(false); setDetailEvent(event); }}
        />
      )}
      {confirmDelete && (
        <ConfirmModal onCancel={() => setConfirmDelete(false)} onConfirm={clearHistory} />
      )}
      {toast && <div className="toast" role="status"><CheckCircle2 size={17} />{toast}</div>}
    </div>
  );
}

function AuthGate({ account, previewAvailable, onAuthenticated, onPreview, onDeleteVault }) {
  const [email, setEmail] = useState(account?.email || '');
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isSignup = !account;

  useEffect(() => {
    setEmail(account?.email || '');
    setPin('');
    setConfirmation('');
    setError('');
  }, [account?.email]);

  // The PIN is numeric only: strip anything else as it is typed or pasted.
  const acceptPinDigits = (value) => String(value ?? '').replace(/\D/g, '').slice(0, PIN_LENGTH);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!isValidPin(pin)) {
      setError(`Your PIN must be exactly ${PIN_LENGTH} digits, using numbers only.`);
      return;
    }
    if (isSignup && pin !== confirmation) {
      setError('The PINs do not match.');
      return;
    }
    setBusy(true);
    try {
      const unlocked = isSignup
        ? await createLocalAccount(email, pin)
        : await unlockLocalAccount(email, pin);
      onAuthenticated(unlocked);
    } catch (authError) {
      setError(authError.message || 'The local vault could not be opened.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <Logo />
        <p className="eyebrow">MONEYLENS · CAPTURE-BASED MONEY CLARITY</p>
        <h1>Only say what your records can prove.</h1>
        <p className="auth-lede">Capture a message, confirm its amount and transaction date, then see exact totals from those records. No fictional account data. No hidden bank balance.</p>
        <div className="auth-principles">
          <div><CheckCircle2 size={18} /><span><strong>Review before totals</strong><small>New captures stay out of calculations until you confirm them.</small></span></div>
          <div><CalendarDays size={18} /><span><strong>Dates matter</strong><small>Month comparisons use the transaction date you confirm—not the day you pasted a message.</small></span></div>
          <div><KeyRound size={18} /><span><strong>Encrypted on this device</strong><small>Your 6-digit PIN unlocks a local encrypted vault; it is not uploaded or recoverable.</small></span></div>
        </div>
        <div className="auth-platform-note"><AlertCircle size={17} /><span><strong>About phone permissions</strong><br />This browser cannot read SMS, WhatsApp, or bank-app notifications. It will not pretend to request that access. Use intentional paste/image sharing here; automatic notification access requires a separate Android app and explicit OS approval.</span></div>
      </section>

      <section className="auth-panel">
        <div className="auth-panel-mark"><span><KeyRound size={19} /></span><div><p className="eyebrow">{account ? 'LOCAL ACCOUNT' : 'CREATE YOUR LOCAL VAULT'}</p><h2>{account ? 'Unlock your records' : 'Start with a private vault'}</h2></div></div>
        <p className="auth-panel-copy">{account ? 'Enter the 6-digit PIN you created on this browser.' : 'Create an account label and a 6-digit PIN before adding personal records.'}</p>
        <form className="auth-form" onSubmit={submit}>
          <label className="form-label" htmlFor="local-email">Email address <span>used as a local label only</span></label>
          <input id="local-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required placeholder="you@example.com" />
          <label className="form-label" htmlFor="local-password">{PIN_LENGTH}-digit PIN {isSignup && <span>numbers only, exactly {PIN_LENGTH} digits</span>}</label>
          <div className="auth-password-wrap"><input id="local-password" type={showPin ? 'text' : 'password'} inputMode="numeric" pattern="[0-9]*" maxLength={PIN_LENGTH} autoComplete={isSignup ? 'new-password' : 'current-password'} value={pin} onChange={(event) => setPin(acceptPinDigits(event.target.value))} required placeholder={isSignup ? `Create a ${PIN_LENGTH}-digit PIN` : `Enter your ${PIN_LENGTH}-digit PIN`} /><button type="button" onClick={() => setShowPin((value) => !value)} aria-label={showPin ? 'Hide PIN' : 'Show PIN'}>{showPin ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
          {isSignup && <><label className="form-label" htmlFor="local-password-confirm">Confirm PIN</label><input id="local-password-confirm" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={PIN_LENGTH} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(acceptPinDigits(event.target.value))} required placeholder="Type the same digits" /></>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="button button--primary auth-submit" disabled={busy}>{busy ? 'Opening your encrypted vault…' : isSignup ? 'Create local account' : 'Unlock MoneyLens'} <ArrowRight size={16} /></button>
        </form>
        <div className="auth-disclosure"><ShieldCheck size={15} /><p><strong>Device-only account.</strong> Email is not verified; there is no cloud sync, recovery service or cross-device login. Records are AES-GCM encrypted before storage; the email label and encryption metadata remain visible to this browser. Forgetting the PIN means the vault cannot be recovered. A 6-digit PIN has only 1,000,000 possible values, so anyone who copies this browser's stored vault could guess it: keep evaluation data fictional or redacted.</p></div>
        {!account && (previewAvailable ? <button className="auth-preview-link" onClick={onPreview}>Explore up to 3 empty preview pages first</button> : <p className="auth-preview-exhausted">The preview limit for this browser tab has been reached. Create a local account to continue.</p>)}
        {account && <button className="auth-reset-link" onClick={onDeleteVault}>Forgot your PIN? Delete this vault and start over</button>}
      </section>
    </main>
  );
}

function viewTitle(view) {
  return ({ today: 'Today', money: 'Money', insights: 'Insights', forecast: 'Forecast', inbox: 'AI Inbox', scan: 'Scan & share', ask: 'Ask MoneyLens', settings: 'Settings & privacy' })[view] || 'Today';
}

function PageTitle({ eyebrow, title, description, action, className = '' }) {
  return (
    <div className={`page-title ${className}`}>
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {action && <div className="page-title-action">{action}</div>}
    </div>
  );
}

function TodayScreen({ events, snapshot, openInbox, onNavigate, onOpenCapture, onOpenEvent, onAnswer, account, guestPreview }) {
  const upcoming = events.filter((event) => event.state === 'upcoming' && event.flow === 'out' && (event.inboxState === 'reviewed' || event.inboxState === 'resolved'))
    .sort((a, b) => String(a.dueDate || '9999-12-31').localeCompare(String(b.dueDate || '9999-12-31'))).slice(0, 4);
  const attention = [...openInbox].sort((a, b) => {
    const priority = (event) => event.kind === 'scam' ? 0 : event.isAnomaly ? 1 : event.kind === 'premium_increase' ? 2 : 3;
    return priority(a) - priority(b);
  }).slice(0, 3);
  const topSpend = Object.entries(snapshot.categories).sort((a, b) => b[1] - a[1])[0];
  const displayName = account?.email?.split('@')[0] || 'there';

  return (
    <div className="page-content today-page">
      <div className="welcome-row">
        <div>
          <p className="eyebrow eyebrow--with-dot"><span /> {getTodayEyebrow()}</p>
          <h1>{guestPreview ? 'A clear view starts with your records' : `Welcome, ${displayName}`} <span className="wave">✳</span></h1>
          <p className="page-description">Only records you capture and confirm appear in the totals below.</p>
        </div>
        <div className="demo-chip"><span className="demo-chip-dot" /> {guestPreview ? 'Empty preview' : 'Confirmed captures only'} <span className="demo-chip-divider" /> No live bank balance</div>
      </div>

      <div className="today-hero-grid">
        <section className="balance-card">
          <div className="balance-card-glow" />
          <div className="balance-card-top">
            <div><p className="balance-label">NET CAPTURED FLOW <span className="info-dot" title="Confirmed inflows minus confirmed outflows with transaction dates">i</span></p><p className="balance-context">Only reviewed, dated records in this month</p></div>
            <div className="balance-card-icon"><CircleDollarSign size={20} /></div>
          </div>
          <div className="balance-amount">{snapshot.eventsThisMonth ? formatZar(snapshot.netFlow) : '—'}</div>
          <div className="balance-foot">
            <span className="balance-note"><span className="balance-pulse" /> {snapshot.eventsThisMonth} confirmed dated record{snapshot.eventsThisMonth === 1 ? '' : 's'}</span>
            <button className="dark-link-button" onClick={() => onNavigate('forecast')}>Compare months <ArrowRight size={15} /></button>
          </div>
          <p className="balance-disclaimer">This is a calculation over saved captures, not your current bank balance or available cash.</p>
        </section>

        <div className="snapshot-column">
          <MetricCard icon={ArrowDownLeft} tone="green" label="Confirmed inflow" value={snapshot.incomeEvents ? formatZar(snapshot.income) : '—'} foot={`${snapshot.incomeEvents} dated income record${snapshot.incomeEvents === 1 ? '' : 's'}`} />
          <MetricCard icon={CalendarDays} tone="peach" label="Confirmed upcoming" value={snapshot.pricedUpcomingCount ? formatZar(snapshot.upcomingTotal) : '—'} foot={`${snapshot.upcomingCount} record${snapshot.upcomingCount === 1 ? '' : 's'} · ${snapshot.unpricedUpcomingCount} without amount`} />
        </div>
      </div>

      <div className="section-heading attention-heading">
        <div><div className="section-heading-title"><span className="section-dot section-dot--coral" />Needs your attention <span className="count-pill">{openInbox.length}</span></div><p>MoneyLens keeps uncertainty visible. You stay in control.</p></div>
        <button className="text-button" onClick={() => onNavigate('inbox')}>Open AI Inbox <ArrowRight size={15} /></button>
      </div>

      <div className="attention-grid">
        {attention.map((event) => <AttentionCard key={event.id} event={event} onClick={() => onOpenEvent(event)} />)}
        {attention.length === 0 && <div className="empty-card"><span className="empty-icon"><Check size={18} /></span><strong>You’re all caught up</strong><span>No items need a review right now.</span></div>}
      </div>

      <div className="dashboard-lower-grid">
        <section className="panel spending-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">YOUR MONEY, THIS MONTH</p><h2>Spending at a glance</h2></div>
            <button className="icon-button icon-button--outlined" aria-label="Open money timeline" onClick={() => onNavigate('money')}><ArrowRight size={17} /></button>
          </div>
          <div className="spending-total-row"><strong>{snapshot.spendEvents ? formatZar(snapshot.spent) : '—'}</strong><span>confirmed dated outflow</span></div>
          <div className="spending-chart">
            <SpendingBars events={events} />
          </div>
          <div className="spending-foot-row">
            <div><span className="legend-dot legend-dot--green" />This month <span className="legend-dot legend-dot--light" />Last month</div>
            {topSpend && <span>Top category <strong>{topSpend[0]}</strong></span>}
          </div>
          <div className="spending-divider" />
          <button className="insight-inline" onClick={() => onNavigate('insights')}>
            <span className="insight-inline-icon"><Sparkles size={15} /></span>
            <span><strong>{snapshot.spendEvents} confirmed outflow records</strong><small>Only dated, reviewed transactions are included</small></span>
            <ChevronRight size={17} />
          </button>
        </section>

        <section className="panel upcoming-panel">
          <div className="panel-heading">
            <div><p className="eyebrow">MONEY RADAR</p><h2>Coming up</h2></div>
            <button className="text-button text-button--quiet" onClick={() => onNavigate('money')}>See all</button>
          </div>
          <div className="upcoming-list">
            {upcoming.map((event) => <UpcomingRow key={event.id} event={event} onClick={() => onOpenEvent(event)} />)}
            {upcoming.length === 0 && <div className="small-empty">No upcoming payments captured yet.</div>}
          </div>
          <div className="upcoming-total-row"><span>Sum of confirmed amounts</span><strong>{snapshot.pricedUpcomingCount ? formatZar(snapshot.upcomingTotal) : '—'}</strong></div>
          <button className="upcoming-question" onClick={() => onAnswer('What confirmed payments are upcoming?')}><Sparkles size={14} /> Review upcoming records <ArrowRight size={14} /></button>
        </section>
      </div>

      <section className="capture-strip">
        <div className="capture-strip-icon"><Plus size={21} /></div>
        <div><strong>Something important landed in your phone?</strong><span>Share or paste it here. We’ll turn it into a clear next step.</span></div>
        <button className="button button--primary" onClick={onOpenCapture}>Capture information <ArrowRight size={16} /></button>
      </section>
    </div>
  );
}

function MetricCard({ icon: Icon, tone, label, value, foot, trend }) {
  return (
    <section className="metric-card">
      <div className="metric-top"><IconBadge icon={Icon} tone={tone} size={38} /><span className="metric-label">{label}</span>{trend && <span className="metric-trend"><TrendingUp size={14} /></span>}</div>
      <strong className="metric-value">{value}</strong>
      <span className="metric-foot">{foot}</span>
    </section>
  );
}

function AttentionCard({ event, onClick }) {
  const scam = event.kind === 'scam';
  const change = event.kind === 'premium_increase';
  return (
    <button className={`attention-card ${scam ? 'attention-card--danger' : change ? 'attention-card--change' : ''}`} onClick={onClick}>
      <span className={`attention-card-icon ${scam ? 'tone-danger' : change ? 'tone-purple' : 'tone-amber'}`}>
        {scam ? <ShieldAlert size={18} /> : change ? <TrendingUp size={18} /> : event.kind === 'expense' ? <CircleDollarSign size={18} /> : <CalendarDays size={18} />}
      </span>
      <span className="attention-card-main">
        <span className="attention-card-title">{event.kind === 'scam' ? 'Potential scam' : event.title}</span>
        <span className="attention-card-sub">{scam ? 'Urgent account threat · verify safely' : change ? `${event.delta == null ? 'Price change' : `${formatZar(event.delta, { plus: true })}${event.recurring === 'monthly' ? '/month' : ' change'}`} · ${event.merchant}` : event.isAnomaly ? `${formatZar(event.amount)} · new merchant` : `${event.merchant} · ${formatRelativeDate(event.dueDate || event.date)}`}</span>
      </span>
      {event.amount != null && !change && <span className="attention-card-amount">{formatZar(event.amount)}</span>}
      {change && event.delta != null && <span className="attention-card-amount attention-card-amount--up">{formatZar(event.delta, { plus: true })}{event.recurring === 'monthly' ? '/mo' : ''}</span>}
      <ChevronRight className="attention-chevron" size={16} />
    </button>
  );
}

function SpendingBars({ events }) {
  const now = new Date();
  const currentMonth = localDateISO(now).slice(0, 7);
  const previousMonth = localDateISO(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7);
  const monthly = calculateMonthlyTotals(events);
  const currentByCategory = monthly.find((month) => month.month === currentMonth)?.categories || {};
  const previousByCategory = monthly.find((month) => month.month === previousMonth)?.categories || {};
  const categories = Object.entries(currentByCategory).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const maximum = Math.max(...categories.map(([, value]) => value), 1);
  return (
    <div className="bars-wrap">
      {categories.map(([category, value]) => {
        const previous = previousByCategory[category] || 0;
        const maxPair = Math.max(value, previous, 1);
        return (
          <div className="bar-row" key={category}>
            <span className="bar-category">{category}</span>
            <div className="bar-track"><span className="bar-previous" style={{ width: `${Math.max((previous / maxPair) * 100, 4)}%` }} /><span className="bar-current" style={{ width: `${Math.max((value / maxPair) * 100, 4)}%` }} /></div>
            <span className="bar-value">{formatZar(value)}</span>
          </div>
        );
      })}
      {categories.length === 0 && <p className="small-empty">No confirmed, dated spending records exist for these months yet.</p>}
      <span className="chart-scale" aria-hidden="true"><i style={{ width: `${Math.min(100, (maximum / Math.max(maximum, 1900)) * 100)}%` }} /></span>
    </div>
  );
}

function UpcomingRow({ event, onClick }) {
  const Icon = event.category === 'Housing' ? Home : event.category === 'Utilities' ? Zap : event.category === 'Insurance' ? ShieldCheck : ReceiptText;
  return (
    <button className="upcoming-row" onClick={onClick}>
      <span className={`upcoming-icon upcoming-icon--${event.category === 'Utilities' ? 'yellow' : event.category === 'Housing' ? 'blue' : event.category === 'Insurance' ? 'purple' : 'rose'}`}><Icon size={16} /></span>
      <span className="upcoming-row-main"><strong>{event.merchant === 'Electricity account' ? 'Electricity' : event.merchant}</strong><small>{event.dueDate ? formatRelativeDate(event.dueDate) : 'Due date not entered'}{event.inboxState === 'open' ? ' · Review' : ''}</small></span>
      <span className="upcoming-amount">{event.amount == null ? 'No amount' : formatZar(event.amount)}</span>
      <ChevronRight size={15} className="upcoming-chevron" />
    </button>
  );
}

function MoneyScreen({ events, snapshot, onOpenEvent, onOpenCapture }) {
  const [filter, setFilter] = useState('All items');
  const nowMonth = localDateISO().slice(0, 7);
  const filtered = useMemo(() => events.filter((event) => {
    if (filter === 'This month') return event.transactionDate?.startsWith(nowMonth) || event.dueDate?.startsWith(nowMonth);
    if (filter === 'Upcoming') return event.state === 'upcoming';
    if (filter === 'Income') return event.flow === 'in';
    if (filter === 'Spending') return event.flow === 'out';
    return true;
  }).sort((a, b) => {
    if (a.state === 'upcoming' && b.state !== 'upcoming') return -1;
    if (b.state === 'upcoming' && a.state !== 'upcoming') return 1;
    return String(b.transactionDate || b.dueDate || b.date || '').localeCompare(String(a.transactionDate || a.dueDate || a.date || ''));
  }), [events, filter, nowMonth]);
  const filters = ['All items', 'This month', 'Upcoming', 'Income', 'Spending'];

  return (
    <div className="page-content">
      <PageTitle eyebrow="YOUR MONEY" title="Confirmed records" description="Totals include only records you reviewed and gave a transaction date. They are not a complete bank statement." action={<button className="button button--primary" onClick={onOpenCapture}><Plus size={17} /> Capture information</button>} />
      <div className="money-summary-grid">
        <SummaryTile label="Confirmed inflow" value={snapshot.incomeEvents ? formatZar(snapshot.income) : '—'} icon={ArrowDownLeft} tone="green" />
        <SummaryTile label="Confirmed outflow" value={snapshot.spendEvents ? formatZar(snapshot.spent) : '—'} icon={ArrowUpRight} tone="peach" />
        <SummaryTile label="Upcoming amounts" value={snapshot.pricedUpcomingCount ? formatZar(snapshot.upcomingTotal) : '—'} icon={CalendarDays} tone="lavender" />
        <SummaryTile label="Net captured flow" value={snapshot.eventsThisMonth ? formatZar(snapshot.netFlow) : '—'} icon={CircleDollarSign} tone="mint" />
      </div>
      <section className="panel timeline-panel">
        <div className="panel-heading panel-heading--timeline">
          <div><p className="eyebrow">FINANCIAL TIMELINE</p><h2>What’s happening with your money</h2></div>
          <div className="timeline-control"><Filter size={15} /><select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter timeline">{filters.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></div>
        </div>
        <div className="timeline-list">
          {filtered.map((event, index) => <TimelineRow key={event.id} event={event} showConnector={index < filtered.length - 1} onClick={() => onOpenEvent(event)} />)}
          {!filtered.length && <EmptyState title="Nothing here yet" detail="Share a message or receipt and it will appear on your timeline." icon={FileText} />}
        </div>
      </section>
      <div className="inline-note"><ShieldCheck size={16} /><span>MoneyLens doesn’t connect to your bank in this prototype. Amounts are extracted from messages you share and may be incomplete.</span></div>
    </div>
  );
}

function SummaryTile({ label, value, icon, tone }) {
  return <div className="summary-tile"><IconBadge icon={icon} tone={tone} size={38} /><div><span>{label}</span><strong>{value}</strong></div></div>;
}

function TimelineRow({ event, showConnector, onClick }) {
  const Icon = event.flow === 'in' ? ArrowDownLeft : event.kind === 'scam' ? ShieldAlert : event.state === 'upcoming' ? CalendarDays : ReceiptText;
  const amountClass = event.flow === 'in' ? 'amount-positive' : event.flow === 'out' ? 'amount-negative' : 'amount-neutral';
  return (
    <button className="timeline-row" onClick={onClick}>
      <span className="timeline-marker-wrap"><span className={`timeline-marker ${event.flow === 'in' ? 'marker--green' : event.kind === 'scam' ? 'marker--red' : event.state === 'upcoming' ? 'marker--amber' : 'marker--gray'}`}><Icon size={15} /></span>{showConnector && <i className="timeline-connector" />}</span>
      <span className="timeline-date">{event.state === 'upcoming' ? (event.dueDate ? formatRelativeDate(event.dueDate) : 'No due date') : event.transactionDate ? formatDate(event.transactionDate, { day: 'numeric', month: 'short' }) : formatDate(event.date, { day: 'numeric', month: 'short' })}<small>{event.state === 'upcoming' ? 'UPCOMING' : event.kind === 'scam' ? 'SAFETY REVIEW' : event.transactionDate ? 'TRANSACTION DATE' : 'CAPTURED · DATE NEEDED'}</small></span>
      <span className="timeline-description"><strong>{event.title}</strong><small>{event.merchant}{event.recurring ? ' · Recurring' : ''}{event.inboxState === 'open' ? ' · Needs review' : ''}</small></span>
      <span className={`timeline-amount ${amountClass}`}>{event.amount == null ? '—' : `${event.flow === 'in' ? '+' : event.flow === 'out' ? '−' : ''}${formatZar(event.amount)}`}</span>
      <ChevronRight size={16} className="timeline-chevron" />
    </button>
  );
}

function InsightsScreen({ events, snapshot, onOpenEvent, onNavigate }) {
  const now = new Date();
  const current = localDateISO(now).slice(0, 7);
  const previous = localDateISO(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7);
  const monthly = calculateMonthlyTotals(events);
  const comparisonMonths = Array.from(new Set([
    current,
    previous,
    ...monthly.map((month) => month.month),
    ...Array.from({ length: 24 }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    }),
  ])).sort((a, b) => b.localeCompare(a));
  const [monthA, setMonthA] = useState(current);
  const [monthB, setMonthB] = useState(previous);
  const monthARecord = monthly.find((month) => month.month === monthA);
  const monthBRecord = monthly.find((month) => month.month === monthB);
  const currentByCategory = monthARecord?.categories || {};
  const previousByCategory = monthBRecord?.categories || {};
  const comparisons = Object.entries(currentByCategory)
    .filter(([category]) => previousByCategory[category] != null)
    .map(([category, amount]) => ({ category, amount, previous: previousByCategory[category], pct: previousByCategory[category] === 0 ? null : Math.round(((amount - previousByCategory[category]) / previousByCategory[category]) * 100) }))
    .filter((item) => item.pct != null)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  const flowComparisons = [
    { label: 'Confirmed inflow', amountKey: 'income', countKey: 'incomeEvents' },
    { label: 'Confirmed outflow', amountKey: 'spent', countKey: 'spendEvents' },
    { label: 'Net captured flow', amountKey: 'netFlow', countKey: null, needsBothFlows: true },
  ].map((item) => {
    const complete = (record) => record && (item.needsBothFlows ? record.incomeEvents > 0 && record.spendEvents > 0 : record[item.countKey] > 0);
    const hasA = complete(monthARecord);
    const hasB = complete(monthBRecord);
    return { ...item, hasA, hasB, amountA: hasA ? monthARecord[item.amountKey] : null, amountB: hasB ? monthBRecord[item.amountKey] : null };
  });
  const insurance = events.find((event) => event.kind === 'premium_increase' && ['reviewed', 'resolved'].includes(event.inboxState) && event.previousAmount != null && event.amount != null && event.delta != null);
  const subscriptions = events.filter((event) => event.state === 'upcoming' && event.category === 'Subscriptions' && ['reviewed', 'resolved'].includes(event.inboxState));
  const leadingComparison = comparisons[0];
  const hasFlowComparison = flowComparisons.some((item) => item.hasA && item.hasB);
  const insightCount = [comparisons.length > 0, hasFlowComparison, subscriptions.length > 0, Boolean(insurance)].filter(Boolean).length;
  const comparisonSummary = comparisons.slice(0, 2).map((item) => item.category.toLowerCase()).join(' and ');

  return (
    <div className="page-content">
      <PageTitle eyebrow="PATTERNS, NOT JUST NUMBERS" title="A little more perspective" description="Changes and patterns based on your captured information — with the why, not just a score." action={<span className="updated-chip"><Sparkles size={14} /> {insightCount ? `${insightCount} insight${insightCount === 1 ? '' : 's'} ready` : 'Waiting for more activity'}</span>} />
      <section className="insight-hero panel">
        <div className="insight-hero-copy">
          <div className="insight-icon-large"><Sparkles size={20} /></div>
          <p className="eyebrow">COMPARE CAPTURED MONTHS</p>
          <div className="insight-compare-selectors"><label>Month A<select value={monthA} onChange={(input) => setMonthA(input.target.value)}>{comparisonMonths.map((key) => <option key={key} value={key} disabled={key === monthB}>{formatMonth(key)}</option>)}</select></label><span>against</span><label>Month B<select value={monthB} onChange={(input) => setMonthB(input.target.value)}>{comparisonMonths.map((key) => <option key={key} value={key} disabled={key === monthA}>{formatMonth(key)}</option>)}</select></label></div>
          <h2>{leadingComparison ? <>{leadingComparison.category} outflow is {leadingComparison.pct > 0 ? 'higher' : leadingComparison.pct < 0 ? 'lower' : 'unchanged'} in {formatMonth(monthA)} vs {formatMonth(monthB)}.</> : hasFlowComparison ? <>Your captured money flows are comparable across {formatMonth(monthA)} and {formatMonth(monthB)}.</> : 'Choose months with comparable records.'}</h2>
          <p className="insight-hero-description">{leadingComparison ? `${comparisonSummary} ${comparisonSummary.includes(' and ') ? 'have' : 'has'} confirmed outflow records in both selected months. This compares saved records only; missing categories are not treated as zero.${monthA === current ? ' The current month may be incomplete.' : ''}${insurance ? ' The insurance price change is a separate captured item.' : ''}` : hasFlowComparison ? 'MoneyLens compares inflow, outflow and net captured flow only where both selected months contain the required confirmed records. It does not fill missing flows with zero.' : 'There are not yet matching, confirmed records for these selected periods. Missing activity is not assumed to be zero.'}</p>
          <button className="button button--soft" onClick={() => onNavigate('forecast')}>Explore your forecast <ArrowRight size={16} /></button>
        </div>
        <div className="comparison-bars">
          {comparisons.length ? comparisons.slice(0, 3).map((item) => <ComparisonBar key={item.category} {...item} currentLabel={formatMonth(monthA, { month: 'short', year: 'numeric' })} previousLabel={formatMonth(monthB, { month: 'short', year: 'numeric' })} />) : <div className="comparison-empty">Category bars appear only when the same category has records in both selected months.</div>}
        </div>
        <div className="insight-orbit orbit-one" /><div className="insight-orbit orbit-two" />
      </section>

      <div className="insight-card-grid">
        <section className="panel change-panel">
          <div className="panel-heading"><div><p className="eyebrow">RECURRING COST WATCH</p><h2>Small payments, together</h2></div><IconBadge icon={ReceiptText} tone="lavender" size={38} /></div>
          <p className="body-copy">Amounts below are from confirmed upcoming records only. MoneyLens does not multiply them into a monthly or annual estimate unless the message explicitly gives that frequency.</p>
          <div className="recurring-rows">
            {subscriptions.map((event) => <div className="recurring-row" key={event.id}><span className="brand-dot">{event.merchant.slice(0, 1)}</span><span><strong>{event.merchant}</strong><small>{event.dueDate ? `Due ${formatDate(event.dueDate, { day: 'numeric', month: 'short' })}` : 'No due date entered'}</small></span><b>{event.amount == null ? 'No amount' : formatZar(event.amount)}</b></div>)}
            {!subscriptions.length && <p className="small-empty">No confirmed upcoming subscription records.</p>}
          </div>
          <div className="soft-callout"><span><Activity size={15} /></span><span>Only user-confirmed messages are listed. A recurrence pattern is not proof that future charges will match.</span></div>
        </section>

        <section className="panel change-panel">
          <div className="panel-heading"><div><p className="eyebrow">PRICE CHANGE DETECTOR</p><h2>{insurance ? `${insurance.merchant} changed` : 'No recent price change'}</h2></div><IconBadge icon={TrendingUp} tone="peach" size={38} /></div>
          {insurance ? (
            <>
              <div className="price-change-merchant"><span className="insurer-avatar">{insurance.merchant.slice(0, 1).toUpperCase()}</span><span><strong>{insurance.merchant} premium</strong><small>{insurance.dueDate ? `Effective ${formatDate(insurance.dueDate, { day: 'numeric', month: 'long' })}` : 'Effective date not entered'}</small></span><span className="change-pill">{formatZar(insurance.delta || 0, { plus: true })}{insurance.recurring === 'monthly' ? '/month' : ' change'}</span></div>
              <div className="price-track"><div className="price-old"><small>BEFORE</small><strong>{formatZar(insurance.previousAmount || 0)}</strong></div><ArrowRight size={17} /><div className="price-new"><small>NOW</small><strong>{formatZar(insurance.amount || 0)}</strong></div></div>
              <p className="price-impact">Difference recorded in the confirmed message: <strong>{formatZar(insurance.delta || 0, { plus: true })}</strong>. No annual figure is inferred.</p>
              <button className="text-button" onClick={() => onOpenEvent(insurance)}>See why MoneyLens detected this <ArrowRight size={14} /></button>
            </>
          ) : <EmptyState title="No price changes yet" detail="Share a renewal or updated bill to compare it." icon={TrendingUp} />}
        </section>

        <section className="panel change-panel">
          <div className="panel-heading"><div><p className="eyebrow">FLOW COMPARISON</p><h2>What moved between the months?</h2></div><IconBadge icon={Activity} tone="peach" size={38} /></div>
          <p className="body-copy">These are sums of confirmed dated records. A missing inflow or outflow is shown as “no record”, never as R0.</p>
          <div className="flow-comparison-list">{flowComparisons.map((item) => <FlowComparisonRow key={item.label} {...item} monthA={monthA} monthB={monthB} />)}</div>
          <button className="button button--outline button--full" onClick={() => onNavigate('forecast')}>See all monthly records <ArrowRight size={15} /></button>
        </section>

        <section className="panel change-panel explain-panel">
          <div className="panel-heading"><div><p className="eyebrow">EXPLAINABLE BY DESIGN</p><h2>Every insight has a reason</h2></div><IconBadge icon={Sparkles} tone="green" size={38} /></div>
          <div className="explain-points"><span><Check size={15} /> Clear source and amount</span><span><Check size={15} /> Confidence stays visible</span><span><Check size={15} /> You can correct or remove it</span></div>
          <button className="text-button" onClick={() => onNavigate('inbox')}>Review your AI Inbox <ArrowRight size={14} /></button>
        </section>
      </div>
    </div>
  );
}

function ComparisonBar({ category, amount, previous, pct, currentLabel = 'Selected month', previousLabel = 'Compared month' }) {
  const percent = Math.min(100, Math.max(34, Math.round((amount / Math.max(amount, previous)) * 100)));
  return (
    <div className="comparison-row">
      <div><span>{category}</span><strong className={pct > 0 ? 'trend-up' : 'trend-down'}>{pct > 0 ? '↑' : '↓'} {Math.abs(pct)}%</strong></div>
      <div className="comparison-track"><span className="comparison-prev" style={{ width: `${100 - percent + Math.min(20, Math.abs(pct))}%` }} /><span className="comparison-current" style={{ width: `${percent}%` }} /></div>
      <small>{formatZar(previous)} <i>{previousLabel}</i> <b>{formatZar(amount)} {currentLabel}</b></small>
    </div>
  );
}

function FlowComparisonRow({ label, hasA, hasB, amountA, amountB, monthA, monthB }) {
  const comparable = hasA && hasB;
  const change = comparable ? Math.round((amountA - amountB) * 100) / 100 : null;
  return (
    <div className="flow-comparison-row">
      <strong className="flow-comparison-label">{label}</strong>
      <div><small>{formatMonth(monthA, { month: 'short', year: 'numeric' })}</small><b>{hasA ? formatZar(amountA) : 'No captured record'}</b></div>
      <ArrowRight size={15} />
      <div><small>{formatMonth(monthB, { month: 'short', year: 'numeric' })}</small><b>{hasB ? formatZar(amountB) : 'No captured record'}</b></div>
      <span className={comparable ? change > 0 ? 'flow-delta flow-delta--up' : change < 0 ? 'flow-delta flow-delta--down' : 'flow-delta' : 'flow-delta flow-delta--missing'}>{comparable ? `Change ${formatZar(change, { plus: true })}` : 'Not comparable yet'}</span>
    </div>
  );
}

function ForecastScreen({ events, snapshot }) {
  const [showProjection, setShowProjection] = useState(false);
  const now = new Date();
  const currentMonth = localDateISO(now).slice(0, 7);
  const monthly = calculateMonthlyTotals(events);
  const byMonth = new Map(monthly.map((record) => [record.month, record]));
  const recentKeys = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  });
  const projection = projectMonthlyFlow(events, { now });

  return (
    <div className="page-content forecast-page">
      <PageTitle eyebrow="MONTH BY MONTH" title="Your recorded money flow" description="Actual totals require confirmed amounts and transaction dates. Months without complete captures stay blank—not zero." action={<span className="estimate-tag"><ShieldCheck size={14} /> Capture-based</span>} />
      <div className="forecast-grid">
        <section className="panel scenario-panel monthly-ledger-panel">
          <div className="forecast-panel-title"><span className="forecast-spark"><Activity size={17} /></span><div><p className="eyebrow">HISTORICAL RECORDS</p><h2>Inflow, outflow and net flow</h2></div></div>
          <p className="scenario-description">Net flow is confirmed inflow minus confirmed outflow for that transaction month. It is not an account balance.</p>
          <div className="monthly-ledger" role="table" aria-label="Monthly confirmed money flow">
            <div className="monthly-ledger-row monthly-ledger-row--head" role="row"><span>Month</span><span>Inflow</span><span>Outflow</span><span>Net flow</span></div>
            {recentKeys.map((key) => {
              const record = byMonth.get(key);
              return <div className="monthly-ledger-row" role="row" key={key}>
                <span><strong>{formatMonth(key)}</strong><small>{record ? `${record.events.length} dated amount record${record.events.length === 1 ? '' : 's'}` : 'No complete dated totals'}</small></span>
                <span>{record?.incomeEvents ? formatZar(record.income) : '—'}</span>
                <span>{record?.spendEvents ? formatZar(record.spent) : '—'}</span>
                <span>{record ? formatZar(record.netFlow) : '—'}</span>
              </div>;
            })}
          </div>
          <div className="forecast-data-note"><AlertCircle size={16} /><span>{snapshot.undatedPostedCount} confirmed posted record{snapshot.undatedPostedCount === 1 ? '' : 's'} lack a valid transaction date; {snapshot.unpricedPostedCount} lack an amount. Both fields are required for monthly totals. Unreviewed records are also excluded.</span></div>
          <div className="forecast-projection-actions">
            <button className="button button--outline" onClick={() => setShowProjection((visible) => !visible)}>{showProjection ? 'Hide projection' : 'Show optional 3-month projection'} <ArrowRight size={15} /></button>
          </div>
          {showProjection && (
            <section className="projection-card">
              <div className="panel-heading"><div><p className="eyebrow">OPTIONAL PROJECTION</p><h3>Simple historical average</h3></div><span className="estimate-tag">Not actual future data</span></div>
              {!projection.ready ? (
                <p className="body-copy">Not enough history to calculate this. Each of the three completed months needs at least one confirmed, dated inflow and outflow. Missing record months: {projection.missingMonths.map((key) => formatMonth(key)).join(', ') || 'none'}. Missing flows: {projection.missingFlowsByMonth.map((item) => `${formatMonth(item.month)} (${item.missingFlows.join(' and ')})`).join(', ') || 'none'}. Missing records are not treated as zero.</p>
              ) : (
                <>
                  <p className="body-copy">This is a projection from the arithmetic mean of records in {projection.requiredMonths.map((key) => formatMonth(key)).join(', ')}. MoneyLens cannot verify whether you captured every transaction.</p>
                  <div className="projection-average"><span>Average recorded inflow</span><strong>{formatZar(projection.average.income)}</strong><span>Average recorded outflow</span><strong>{formatZar(projection.average.spent)}</strong><span>Average recorded net flow</span><strong>{formatZar(projection.average.netFlow)}</strong></div>
                  <div className="projection-months">{projection.projectedMonths.map((month) => <div key={month.month}><span>{formatMonth(month.month)}</span><strong>{formatZar(month.netFlow)}</strong><small>projected net flow</small></div>)}</div>
                  <p className="form-footnote">Projection only, not a promise or a bank forecast. It assumes the recent capture average repeats; actual income, bills and missing records may differ.</p>
                </>
              )}
            </section>
          )}
        </section>
        <aside className="forecast-side-column">
          <section className="panel forecast-breakdown">
            <p className="eyebrow">CURRENT MONTH · {formatMonth(currentMonth)}</p>
            <h3>Confirmed record totals</h3>
            <BreakdownRow label="Confirmed inflow" amount={snapshot.incomeEvents ? snapshot.income : null} positive />
            <BreakdownRow label="Confirmed outflow" amount={snapshot.spendEvents ? snapshot.spent : null} />
            <div className="breakdown-total"><span>Captured net flow</span><strong>{snapshot.eventsThisMonth ? formatZar(snapshot.netFlow) : '—'}</strong></div>
          </section>
          <div className="forecast-safety-note"><ShieldCheck size={17} /><span><strong>Actuals are still partial.</strong> MoneyLens cannot see transactions you did not capture, and this browser has no live bank feed. Confirm each date and amount against the original record.</span></div>
        </aside>
      </div>
    </div>
  );
}

function BreakdownRow({ label, amount, positive }) {
  return <div className="breakdown-row"><span>{label}</span><strong className={positive ? 'amount-positive' : ''}>{amount == null ? '—' : `${positive ? '+' : '−'}${formatZar(amount)}`}</strong></div>;
}

function InboxScreen({ events, openInbox, onOpenEvent, onNavigate }) {
  const [filter, setFilter] = useState('All items');
  const filtered = useMemo(() => openInbox.filter((event) => {
    if (filter === 'Potential scams') return event.kind === 'scam';
    if (filter === 'Price changes') return event.kind === 'premium_increase';
    if (filter === 'Payments') return event.kind !== 'scam' && event.kind !== 'premium_increase';
    return true;
  }).sort((a, b) => {
    const priority = (event) => event.kind === 'scam' ? 0 : event.isAnomaly ? 1 : event.kind === 'premium_increase' ? 2 : 3;
    return priority(a) - priority(b) || String(a.dueDate || a.date).localeCompare(String(b.dueDate || b.date));
  }), [openInbox, filter]);
  const options = ['All items', 'Payments', 'Price changes', 'Potential scams'];

  return (
    <div className="page-content inbox-page">
      <PageTitle eyebrow="HUMAN-IN-THE-LOOP AI" title="Your AI Inbox" description="A few things may need your eyes. Confirm what’s right, correct it, or dismiss it." action={<span className="inbox-total-pill"><Inbox size={15} /> {openInbox.length} waiting</span>} />
      <div className="inbox-toolbar">
        <div className="filter-pills">{options.map((option) => <button key={option} onClick={() => setFilter(option)} className={filter === option ? 'filter-pill filter-pill--active' : 'filter-pill'}>{option}{option === 'All items' && <span>{openInbox.length}</span>}</button>)}</div>
        <span className="inbox-confidence-note"><Sparkles size={14} /> Rule-match scores are clues, not probability. You decide.</span>
      </div>
      <div className="inbox-list">
        {filtered.map((event) => <InboxCard key={event.id} event={event} onClick={() => onOpenEvent(event)} />)}
        {!filtered.length && <div className="inbox-empty"><div className="inbox-empty-icon"><Check size={23} /></div><h2>You’re all caught up</h2><p>New shared messages that need a second look will appear here.</p><button className="button button--outline" onClick={() => onNavigate('scan')}><Plus size={16} /> Share something</button></div>}
      </div>
      <div className="human-review-note"><span><ShieldCheck size={18} /></span><div><strong>You make the final call.</strong><p>MoneyLens can organise and flag information. It can’t confirm a payment, contact a provider, or move money for you.</p></div></div>
    </div>
  );
}

function InboxCard({ event, onClick }) {
  const isDanger = event.kind === 'scam';
  const isChange = event.kind === 'premium_increase';
  return (
    <article className={`inbox-card ${isDanger ? 'inbox-card--danger' : isChange ? 'inbox-card--purple' : ''}`}>
      <div className="inbox-card-icon">{isDanger ? <ShieldAlert size={20} /> : isChange ? <TrendingUp size={20} /> : event.isAnomaly ? <AlertCircle size={20} /> : <Sparkles size={20} />}</div>
      <div className="inbox-card-main">
        <div className="inbox-card-title-row"><h3>{event.title}</h3><span className={`confidence-chip confidence-chip--${event.confidenceLabel.toLowerCase()}`}><span />Rule match {Math.round(event.confidence * 100)}% · heuristic</span></div>
        <p className="inbox-card-summary">{isDanger ? 'This message creates urgency and includes an unverified link. Verify independently before acting.' : isChange ? `${event.merchant} moved from ${formatZar(event.previousAmount || 0)} to ${formatZar(event.amount || 0)} — ${formatZar(event.delta || 0, { plus: true })} each month.` : event.isAnomaly ? `${formatZar(event.amount)} to ${event.merchant} stands out as a larger, non-recurring payment.` : `${event.merchant} · ${event.amount == null ? 'Amount not clear' : formatZar(event.amount)}${event.dueDate ? ` · ${formatRelativeDate(event.dueDate)}` : ''}`}</p>
        <div className="inbox-card-meta"><span><span className="source-dot" />{event.source}</span><span><Clock3 size={13} />{formatRelativeDate(event.date)}</span>{event.flags.slice(0, 2).map((flag) => <span className="flag-chip" key={flag}>{flag}</span>)}</div>
      </div>
      <div className="inbox-card-right">
        {event.amount != null && !isChange && <strong>{formatZar(event.amount)}</strong>}
        {isChange && <strong className="amount-change">+{formatZar(event.delta || 0).slice(1)}<small>/mo</small></strong>}
        <button className="button button--small button--outline" onClick={onClick}>{isDanger ? 'Review warning' : 'Review'} <ArrowRight size={14} /></button>
      </div>
    </article>
  );
}

function ScanScreen({ onCapture, onOpenEvent }) {
  const [file, setFile] = useState(null);
  const [objectUrl, setObjectUrl] = useState('');
  const [text, setText] = useState('');
  const [source, setSource] = useState('Screenshot');
  const [ocrState, setOcrState] = useState('idle');
  const [ocrProgress, setOcrProgress] = useState(0);
  const [error, setError] = useState('');
  const [lastResult, setLastResult] = useState(null);
  const fileInput = useRef(null);
  const workerRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      workerRef.current?.terminate().catch(() => undefined);
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!file) { setObjectUrl(''); return undefined; }
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const selectFile = (nextFile) => {
    setError('');
    setLastResult(null);
    if (!nextFile) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(nextFile.type.toLowerCase())) {
      setFile(null);
      setText('');
      setOcrState('idle');
      setError('Choose a PNG, JPG or WEBP screenshot. For a PDF, copy the relevant text into the box below.');
      return;
    }
    if (nextFile.size > 12 * 1024 * 1024) {
      setFile(null);
      setText('');
      setOcrState('idle');
      setError('This image is larger than 12 MB. Choose a smaller image to keep OCR responsive.');
      return;
    }
    setFile(nextFile);
    setText('');
    setSource('Screenshot');
  };

  const runOcr = async () => {
    if (!file) return;
    setOcrState('loading');
    setOcrProgress(0);
    setError('');
    let worker;
    try {
      const { createWorker } = await import('tesseract.js');
      worker = await createWorker('eng', 1, {
        logger: (message) => {
          if (mountedRef.current && message.status === 'recognizing text') setOcrProgress(Math.round(message.progress * 100));
        },
      });
      workerRef.current = worker;
      if (!mountedRef.current) {
        await worker.terminate();
        workerRef.current = null;
        return;
      }
      const { data } = await worker.recognize(file);
      await worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
      worker = null;
      if (!mountedRef.current) return;
      setText(data.text.trim());
      setOcrState('done');
      if (!data.text.trim()) setError('I couldn’t read text from this image. Try a sharper screenshot, or type/paste the message below.');
    } catch (ocrError) {
      if (worker) await worker.terminate().catch(() => undefined);
      if (workerRef.current === worker) workerRef.current = null;
      if (!mountedRef.current) return;
      console.error(ocrError);
      setOcrState('error');
      setError('On-device OCR could not start. Check your connection for the one-time English language-model download, then try again or paste the text yourself.');
    }
  };

  const submitText = () => {
    const result = onCapture(text, source);
    if (result && !result.duplicate) setLastResult(result);
  };

  return (
    <div className="page-content scan-page">
      <PageTitle eyebrow="USER-CHOSEN CAPTURE" title="Bring the important bits together" description="Choose an image or paste message text. You decide what MoneyLens processes; this browser cannot read other apps." action={<span className="local-chip"><ShieldCheck size={14} /> Processed in this browser</span>} />
      <div className="scan-grid">
        <section className="panel scan-drop-panel">
          <div className="scan-section-title"><span className="scan-title-icon"><FileImage size={20} /></span><div><h2>Screenshot or receipt</h2><p>Choose an image to read its text on your device.</p></div></div>
          {!file ? (
            <button className="upload-dropzone" onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); selectFile(event.dataTransfer.files?.[0]); }}>
              <span className="upload-circle"><Upload size={22} /></span><strong>Drop an image here, or <u>browse</u></strong><small>PNG, JPG or WEBP · up to 12 MB</small>
            </button>
          ) : (
            <div className="image-preview-wrap">
              <img className="image-preview" src={objectUrl} alt="Selected screenshot preview" />
              <button className="remove-image" disabled={ocrState === 'loading'} onClick={() => { setFile(null); setText(''); setOcrState('idle'); }} aria-label="Remove selected image"><X size={15} /></button>
              <div className="image-file-name"><FileImage size={14} />{file.name}<span>{(file.size / 1024 / 1024).toFixed(1)} MB</span></div>
            </div>
          )}
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="visually-hidden" onChange={(event) => selectFile(event.target.files?.[0])} />
          {file && (
            <button className="button button--outline button--full ocr-button" onClick={runOcr} disabled={ocrState === 'loading'}>
              {ocrState === 'loading' ? <><span className="mini-spinner" /> Reading text · {ocrProgress}%</> : <><Sparkles size={16} /> {ocrState === 'done' ? 'Read image again' : 'Read text on this device'}</>}
            </button>
          )}
          {error && <div className="inline-error"><AlertCircle size={16} />{error}</div>}
          <div className="privacy-inline"><ShieldCheck size={16} /><span>Your image is handled in this browser and is <strong>not saved</strong> to your history. Tesseract’s English OCR files may download from its CDN the first time. The image itself is not uploaded.</span></div>
          <button className="text-button scan-pdf-note" onClick={() => { setFile(null); setSource('Bill'); document.getElementById('scan-message')?.focus(); }}><FileText size={15} /> Have a PDF or email? Paste its text instead</button>
        </section>

        <section className="panel scan-text-panel">
          <div className="scan-section-title"><span className="scan-title-icon scan-title-icon--purple"><Sparkles size={20} /></span><div><h2>Understand a message</h2><p>Paste the text, then check what was extracted.</p></div></div>
          <label className="form-label" htmlFor="source-app">Where did it come from?</label>
          <div className="select-wrap"><select id="source-app" value={source} onChange={(event) => setSource(event.target.value)}>{SOURCES.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={15} /></div>
          <label className="form-label" htmlFor="scan-message">Message or text from your document</label>
          <textarea id="scan-message" className="scan-textarea" value={text} onChange={(event) => { setText(event.target.value); setLastResult(null); }} placeholder="Paste the exact text from your bill or message" />
          {ocrState === 'done' && <p className="scan-ocr-success"><CheckCircle2 size={14} /> Text read on your device. Please check it before adding.</p>}
          <button className="button button--primary button--full" onClick={submitText} disabled={!text.trim()}><Sparkles size={16} /> Analyse & add to MoneyLens <ArrowRight size={15} /></button>
          {lastResult && <AnalysisResult event={lastResult} onOpen={() => onOpenEvent(lastResult)} />}
          <p className="scan-engine-note"><Zap size={13} /> This prototype uses an offline extraction ruleset. It does not call a cloud AI service.</p>
        </section>
      </div>
      <div className="scan-steps"><div><span>01</span><strong>Share</strong><small>Choose only what matters.</small></div><ArrowRight size={15} /><div><span>02</span><strong>Check</strong><small>Review extracted clues and source.</small></div><ArrowRight size={15} /><div><span>03</span><strong>Decide</strong><small>Confirm, edit or dismiss.</small></div></div>
    </div>
  );
}

function AnalysisResult({ event, onOpen }) {
  return (
    <div className={`analysis-result ${event.inboxState === 'open' ? 'analysis-result--review' : 'analysis-result--done'}`}>
      <span className="analysis-result-icon">{event.inboxState === 'open' ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}</span>
      <div className="analysis-result-main"><strong>{event.title}</strong><span>{event.amount == null ? 'No Rand amount found' : `${event.category} · ${formatZar(event.amount)}`} · Rule-match score {Math.round(event.confidence * 100)}% · unconfirmed</span></div>
      <button className="text-button" onClick={onOpen}>{event.inboxState === 'open' ? 'Review' : 'Details'} <ChevronRight size={14} /></button>
    </div>
  );
}

function AskScreen({ events, snapshot, messages, onAnswer, onOpenEvent }) {
  const [question, setQuestion] = useState('');
  const [showSources, setShowSources] = useState(false);
  const [useCloudAI, setUseCloudAI] = useState(false);
  const [aiStatus, setAiStatus] = useState({ loading: true, configured: false, model: '' });
  const [pending, setPending] = useState(false);
  const bottomRef = useRef(null);
  const hasMessages = messages.length > 0;

  useEffect(() => {
    let active = true;
    fetch('/api/ai/status').then((response) => response.json()).then((status) => {
      if (active) setAiStatus({ loading: false, configured: Boolean(status.configured), model: status.model || '' });
    }).catch(() => {
      if (active) setAiStatus({ loading: false, configured: false, model: '' });
    });
    return () => { active = false; };
  }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages.length]);

  const submit = async (event) => {
    event.preventDefault();
    if (!question.trim() || pending) return;
    const prompt = question;
    setQuestion('');
    setPending(true);
    try { await onAnswer(prompt, useCloudAI); } finally { setPending(false); }
  };

  return (
    <div className="page-content ask-page">
      <PageTitle eyebrow="ANSWERS WITH EVIDENCE" title="Ask about your records" description="Choose private on-device calculations or explicitly send a question and reviewed-record summary to a configured cloud LLM." action={<span className="local-ai-pill"><span /> Local answers always available</span>} />
      <div className="chat-layout">
        <section className="panel chat-panel">
          <div className="chat-topline"><div className="chat-avatar"><Sparkles size={18} /></div><div><strong>MoneyLens records assistant</strong><span><i /> Confirmed records only</span></div><button className="icon-button icon-button--outlined" aria-label="About MoneyLens answers" onClick={() => setShowSources(!showSources)}><CircleDollarSign size={17} /></button></div>
          {showSources && <div className="chat-source-note"><ShieldCheck size={15} /> Local replies are deterministic calculations. Cloud replies use a configured LLM and can be wrong: verify them against cited records. Cloud mode sends your question plus up to 100 reviewed record summaries (merchant, date, amount, category and flow); it never sends raw capture text, passwords or your API key. Your chosen provider’s data-handling terms apply.</div>}
          <div className="chat-messages">
            {!hasMessages && (
              <div className="chat-welcome">
                <div className="assistant-spark"><Sparkles size={22} /></div><h2>Let’s make the money picture clearer.</h2><p>Ask about what you’ve shared. I’ll show what I know — and where the gaps are.</p>
                <div className="question-suggestions">{SUGGESTED_QUESTIONS.map((item) => <button key={item} onClick={() => onAnswer(item)}>{item}<ArrowUpRight size={14} /></button>)}</div>
                <div className="chat-coverage"><span><FileText size={15} /> {snapshot.confirmedCount} reviewed records</span><span><CalendarDays size={15} /> {snapshot.pricedUpcomingCount ? formatZar(snapshot.upcomingTotal) : 'No priced'} upcoming</span></div>
              </div>
            )}
            {hasMessages && messages.map((message) => (
              <div className={`chat-message chat-message--${message.role}`} key={message.id}>
                {message.role === 'assistant' && <div className="assistant-mini"><Sparkles size={14} /></div>}
                <div className="chat-bubble"><p>{message.content}</p><span>{message.role === 'assistant' ? message.provider?.startsWith('cloud:') ? `Cloud LLM · ${message.provider.slice(6)} · verify answer` : message.provider === 'error' ? 'Cloud AI error' : 'MoneyLens · on-device calculation' : 'You'}</span>
                  {message.role === 'assistant' && message.sources?.length > 0 && <div className="chat-evidence-list"><small>Records used · {message.sources.length}</small>{message.sources.map((source) => <button type="button" key={source.id} onClick={() => { const record = events.find((event) => event.id === source.id); if (record) onOpenEvent(record); }}><strong>{source.merchant || source.title}</strong><span>{source.amount == null ? 'Amount not entered' : formatZar(source.amount)} · {source.date || 'No transaction date'} · {source.source}</span></button>)}</div>}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          {hasMessages && <div className="question-suggestions question-suggestions--compact">{SUGGESTED_QUESTIONS.slice(0, 3).map((item) => <button key={item} onClick={() => onAnswer(item)}>{item}<ArrowUpRight size={13} /></button>)}</div>}
          <div className={`cloud-ai-consent ${useCloudAI ? 'cloud-ai-consent--selected' : ''}`}>
            <label><input type="checkbox" checked={useCloudAI} onChange={(event) => setUseCloudAI(event.target.checked)} /> <span><strong>Use cloud AI for my next question</strong><small>{aiStatus.loading ? 'Checking server configuration…' : aiStatus.configured ? `Sends your question and up to 100 confirmed record summaries to ${aiStatus.model}. Provider data terms apply.` : 'Not configured yet. Add OPENAI_API_KEY to the server to enable; otherwise answers stay on-device.'}</small></span></label>
            <button type="button" className="cloud-ai-about" aria-label="About cloud AI data sharing" onClick={() => setShowSources((current) => !current)}>Data details</button>
          </div>
          <form className="chat-composer" onSubmit={submit}>
            <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about your money…" aria-label="Ask MoneyLens a question" />
            <button className="send-button" disabled={!question.trim() || pending} aria-label="Send question">{pending ? '…' : <ArrowRight size={18} />}</button>
          </form>
          <p className="chat-disclaimer">{useCloudAI ? 'Cloud mode sends only this question and reviewed record summaries; never raw message text, passwords or API keys. Verify model answers against the cited records.' : 'On-device answers use deterministic rules. Based only on information you shared; not financial, legal or tax advice.'}</p>
        </section>
        <aside className="chat-side">
          <div className="ask-context-card"><p className="eyebrow">CURRENT-MONTH RECORDS</p><div className="ask-context-value">{snapshot.eventsThisMonth ? formatZar(snapshot.netFlow) : '—'}<span>confirmed net flow, not a balance</span></div><div className="ask-context-divider" /><div className="ask-context-row"><span>Upcoming confirmed records</span><strong>{snapshot.upcomingCount}</strong></div><div className="ask-context-row"><span>Waiting for review</span><strong>{snapshot.attentionCount}</strong></div><button className="text-button" onClick={() => setShowSources(!showSources)}>How totals are calculated <ArrowRight size={14} /></button></div>
          <div className="ask-safe-card"><span><ShieldCheck size={19} /></span><strong>You’re in control</strong><p>No payments, transfers or financial products are recommended or actioned here. Check important details against the original message.</p></div>
        </aside>
      </div>
    </div>
  );
}

function SettingsScreen({ events, settings, account, saveStateLabel, onChangeSetting, onToggleSource, onDelete, onExport, onLogout, onDeleteAccount }) {
  const [exportDone, setExportDone] = useState(false);
  const updateExport = () => { onExport(); setExportDone(true); window.setTimeout(() => setExportDone(false), 2500); };
  return (
    <div className="page-content settings-page">
      <PageTitle eyebrow="YOUR CONTROL CENTRE" title="Local vault & permissions" description="Review exactly what MoneyLens can access, what it stores and what it leaves out." action={<span className="local-chip"><ShieldCheck size={14} /> Device-only account</span>} />
      <div className="settings-layout">
        <div className="settings-main">
          <section className="panel settings-panel">
            <div className="settings-panel-head"><span className="settings-icon settings-icon--green"><ShieldCheck size={19} /></span><div><h2>What MoneyLens can access</h2><p>Your local account is {account?.email}. The {PIN_LENGTH}-digit PIN derives the encryption key in this browser; there is no server account or email recovery.</p></div></div>
            <div className="privacy-status-list">
              <div><span className="privacy-status-dot" /><span><strong>SMS / WhatsApp / bank-app notifications</strong><small>Not accessible from this browser. No notification permission has been requested or granted.</small></span><b>Unavailable</b></div>
              <div><span className="privacy-status-dot privacy-status-dot--active" /><span><strong>Encrypted local vault</strong><small>{events.length} capture records are AES-GCM encrypted before browser storage; assistant conversations are encrypted too. Device compromise can still expose data while unlocked.</small></span><b>{saveStateLabel === 'error' ? 'Save failed' : saveStateLabel === 'saving' ? 'Saving' : 'Active'}</b></div>
              <div><span className="privacy-status-dot" /><span><strong>Cloud AI processing</strong><small>Optional and off by default. Only a question and limited reviewed-record summaries are sent when you explicitly check “Use cloud AI” in Ask MoneyLens. Raw capture text stays local; provider data terms apply.</small></span><b>Per-question consent</b></div>
              <div><span className="privacy-status-dot" /><span><strong>Bank connection</strong><small>No credentials, verified balance, transaction feed or payment service is connected.</small></span><b>Off</b></div>
            </div>
            <div className="settings-footnote"><AlertCircle size={15} /> To automatically read app notifications, MoneyLens needs a native Android app and OS notification-listener approval. This web preview cannot ask for or use that permission. Manual share/paste is available.</div>
          </section>

          <section className="panel settings-panel">
            <div className="settings-panel-head"><span className="settings-icon settings-icon--purple"><Filter size={19} /></span><div><h2>Choose what can be analysed</h2><p>Excluded sources are blocked when you share or paste a message from them.</p></div></div>
            <div className="source-toggle-list">
              {SOURCES.filter((source) => source !== 'Other').map((source) => {
                const excluded = settings.excludedSources.includes(source);
                return <label className="source-toggle-row" key={source}><span className="source-toggle-icon"><FileText size={16} /></span><span><strong>{source}</strong><small>{excluded ? 'Excluded from future user-shared captures' : 'Allowed only when you choose to share it'}</small></span><button type="button" className={`switch ${excluded ? 'switch--on' : ''}`} aria-pressed={excluded} aria-label={`${excluded ? 'Allow' : 'Exclude'} ${source}`} onClick={() => onToggleSource(source)}><i /></button></label>;
              })}
            </div>
            <div className="settings-footnote"><ShieldCheck size={15} /> These exclusions apply only to items you intentionally share in this web app. They do not grant background access to other apps.</div>
          </section>

          <section className="panel settings-panel">
            <div className="settings-panel-head"><span className="settings-icon settings-icon--amber"><Bell size={19} /></span><div><h2>Capture controls</h2><p>Pause new additions at any time. Existing information stays until you delete it.</p></div></div>
            <div className="pause-capture-row"><span><strong>{settings.monitoringPaused ? 'Capture is paused' : 'Capturing is available'}</strong><small>{settings.monitoringPaused ? 'No new user-shared items can be added while paused.' : 'Items are processed only after you choose to share or paste them.'}</small></span><button type="button" className={`switch ${settings.monitoringPaused ? 'switch--on' : ''}`} aria-pressed={settings.monitoringPaused} onClick={() => onChangeSetting('monitoringPaused', !settings.monitoringPaused)}><i /></button></div>
          </section>

          <section className="panel settings-panel data-panel">
            <div className="settings-panel-head"><span className="settings-icon settings-icon--blue"><Download size={19} /></span><div><h2>Your local account</h2><p>Export your records, clear captures, lock the vault or permanently remove the account from this browser.</p></div></div>
            <div className="data-actions"><button className="button button--outline" onClick={updateExport}><Download size={15} /> {exportDone ? 'Export started' : 'Export records'}</button><button className="button button--danger-outline" onClick={onDelete}><X size={15} /> Delete captured records & chat</button></div>
            <div className="data-actions"><button className="button button--outline" onClick={onLogout}><LogOut size={15} /> Lock vault</button><button className="button button--danger-outline" onClick={onDeleteAccount}><X size={15} /> Delete local account & vault</button></div>
            <p className="settings-footnote settings-footnote--warning"><AlertCircle size={15} /> JSON exports are plaintext after download. This device-only prototype has no password reset; deleting the vault is permanent. Avoid storing PINs, passwords or full account numbers.</p>
          </section>
        </div>

        <aside className="settings-side">
          <div className="settings-side-card">
            <div className="settings-shield"><ShieldCheck size={22} /></div><p className="eyebrow">PRIVACY PRINCIPLE</p><h3>Nothing important happens behind your back.</h3><p>Real notification monitoring, cloud AI and bank feeds are not enabled by this browser prototype.</p>
          </div>
          <div className="settings-side-card settings-side-card--warm"><div className="side-card-small-icon"><AlertCircle size={17} /></div><strong>Before real launch</strong><p>Complete a privacy impact assessment, security review, consent flows, retention rules and South African regulatory assessment.</p></div>
        </aside>
      </div>
    </div>
  );
}

function CaptureModal({ onClose, onAnalyze, result, settings, onOpenEvent }) {
  const [text, setText] = useState('');
  const [source, setSource] = useState('Bank notification');
  const [localMessage, setLocalMessage] = useState('');
  const [storedResult, setStoredResult] = useState(null);
  const textareaRef = useRef(null);
  const currentResult = result || storedResult;
  useEffect(() => { textareaRef.current?.focus(); }, []);

  const process = () => {
    setLocalMessage('');
    const response = onAnalyze(text, source);
    if (response && response.duplicate) setLocalMessage(response.reason);
    else if (response) setStoredResult(response);
  };

  const clear = () => { setText(''); setStoredResult(null); setLocalMessage(''); };

  return (
    <ModalShell onClose={onClose} className="capture-modal">
      <div className="modal-header"><div className="modal-title-icon"><Sparkles size={19} /></div><div><p className="eyebrow">USER-CHOSEN CAPTURE</p><h2>Share what matters</h2></div><button className="icon-button modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
      {settings.monitoringPaused && <div className="inline-error"><AlertCircle size={15} />New captures are paused in Settings.</div>}
          <p className="modal-intro">Paste the exact message text. It remains unconfirmed and is excluded from money totals until you review it.</p>
      <label className="form-label" htmlFor="capture-source">Where did you receive it?</label>
      <div className="select-wrap"><select id="capture-source" value={source} onChange={(event) => setSource(event.target.value)}>{SOURCES.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={15} /></div>
      <label className="form-label" htmlFor="capture-text">Message text</label>
      <textarea ref={textareaRef} id="capture-text" className="capture-textarea" value={text} onChange={(event) => { setText(event.target.value); setStoredResult(null); setLocalMessage(''); }} placeholder="Paste the exact text from your message or notification" />
      {localMessage && <div className="inline-error"><AlertCircle size={15} />{localMessage}</div>}
      <div className="capture-privacy"><ShieldCheck size={14} />Your text stays in the encrypted local vault. Never share PINs, passwords or full account numbers.</div>
      {currentResult && <AnalysisResult event={currentResult} onOpen={() => { onOpenEvent(currentResult); onClose(); }} />}
      <div className="modal-actions">
        {currentResult ? <><button className="button button--outline" onClick={clear}>Capture another</button>{currentResult.inboxState === 'open' ? <button className="button button--primary" onClick={() => { onOpenEvent(currentResult); onClose(); }}>Answer a few questions <ArrowRight size={15} /></button> : <button className="button button--primary" onClick={() => { onOpenEvent(currentResult); onClose(); }}>View details <ArrowRight size={15} /></button>}</> : <><button className="button button--text" onClick={onClose}>Cancel</button><button className="button button--primary" onClick={process} disabled={!text.trim() || settings.monitoringPaused}><Sparkles size={15} /> Understand this <ArrowRight size={15} /></button></>}
      </div>
    </ModalShell>
  );
}

function GuidedReview({ event, categories, onClose, onManual, onConfirm }) {
  const [draft, setDraft] = useState({
    classification: '',
    amount: event.amount == null ? '' : String(event.amount),
    previousAmount: event.previousAmount == null ? '' : String(event.previousAmount),
    transactionDate: event.transactionDate || '',
    dueDate: event.dueDate || '',
    merchant: event.merchant === 'Unknown sender' ? '' : event.merchant,
    category: event.category || 'Other',
    recurring: event.recurring || '',
  });
  const [stepIndex, setStepIndex] = useState(0);
  const [editAmounts, setEditAmounts] = useState(event.amount == null);
  const [editMerchant, setEditMerchant] = useState(event.merchant === 'Unknown sender');

  const typeOptions = [
    ['income', 'Money received', 'An actual inflow already reached you'],
    ['expense', 'Payment already made', 'Money has already left'],
    ['bill', 'Upcoming bill', 'A payment is still due'],
    ['subscription', 'Subscription or renewal', 'A future recurring charge is described'],
    ['premium_increase', 'Price or premium change', 'A future amount changed'],
    ['scam', 'Safety warning', 'Keep it out of money calculations'],
    ['unknown', 'Not sure / information only', 'Keep it out of money calculations'],
  ];
  const typeLabels = Object.fromEntries(typeOptions.map(([value, label]) => [value, label]));
  const financialType = ['income', 'expense', 'bill', 'subscription', 'premium_increase'].includes(draft.classification);
  const postedType = ['income', 'expense'].includes(draft.classification);
  const upcomingType = ['bill', 'subscription', 'premium_increase'].includes(draft.classification);
  const stepSequence = [0, ...(financialType ? [1] : []), ...(postedType || upcomingType ? [2] : []), 3, ...(financialType ? [4, 5] : []), 6];
  const currentStep = stepSequence[Math.min(stepIndex, stepSequence.length - 1)];
  const stepNames = { 0: 'Type', 1: 'Amount', 2: postedType ? 'Transaction date' : 'Due date', 3: 'Name', 4: 'Category', 5: 'Frequency', 6: 'Confirm' };
  const updateDraft = (changes) => setDraft((current) => ({ ...current, ...changes }));
  const next = () => setStepIndex((index) => Math.min(index + 1, stepSequence.length - 1));
  const back = () => setStepIndex((index) => Math.max(0, index - 1));
  const parseOptionalNumber = (value) => value === '' || !Number.isFinite(Number(value)) ? null : Math.max(0, Number(value));
  const amountLabel = (value) => value == null || value === '' ? 'Amount not recorded' : formatZar(value);

  return (
    <section className="guided-review" aria-label="MoneyLens guided record review">
      <div className="guided-review-head"><span><MessageCircle size={16} /></span><div><p className="eyebrow">MONEYLENS FOLLOW-UP</p><h3>Let’s make this record useful</h3></div><small>{stepIndex + 1} of {stepSequence.length}</small></div>
      <div className="guided-progress"><i style={{ width: `${((stepIndex + 1) / stepSequence.length) * 100}%` }} /></div>
      <div className="guided-stepper">{stepSequence.map((step, index) => <span className={index === stepIndex ? 'guided-step guided-step--active' : index < stepIndex ? 'guided-step guided-step--done' : 'guided-step'} key={step}>{stepNames[step]}</span>)}</div>

      {currentStep === 0 && <div className="guided-question"><p className="eyebrow">QUESTION 1 · WHAT HAPPENED?</p><h4>Which description matches the message?</h4><p className="guided-hint">MoneyLens’ rule is only a clue: <strong>{event.title}</strong>. Choose what you know; nothing is counted yet.</p><div className="guided-choice-grid">{typeOptions.map(([value, label, detail]) => <button key={value} className="guided-choice" onClick={() => { updateDraft({ classification: value }); next(); }}><strong>{label}</strong><small>{detail}</small></button>)}</div></div>}

      {currentStep === 1 && <div className="guided-question"><p className="eyebrow">QUESTION 2 · AMOUNT</p><h4>What amount should the record use?</h4><p className="guided-hint">{event.amount == null ? 'No single amount was selected from the message. Enter it only if you can confirm it.' : `The message rules found ${formatZar(event.amount)}${draft.classification === 'premium_increase' && event.previousAmount != null ? ` and a prior amount of ${formatZar(event.previousAmount)}` : ''}. Confirm or correct the clue.`}</p>
        {!editAmounts && event.amount != null ? <div className="guided-amount-actions"><button className="button button--primary" onClick={() => { updateDraft({ amount: String(event.amount), previousAmount: event.previousAmount == null ? '' : String(event.previousAmount) }); next(); }}><Check size={15} /> Use amount clue</button><button className="button button--outline" onClick={() => setEditAmounts(true)}>Change amount</button><button className="guided-text-action" onClick={() => { updateDraft({ amount: '', previousAmount: '' }); next(); }}>I can’t confirm an amount</button></div> : <><label className="form-label">{draft.classification === 'premium_increase' ? 'New amount, if known' : 'Amount, if known'}<input type="number" min="0" step="0.01" value={draft.amount} onChange={(input) => updateDraft({ amount: input.target.value })} placeholder="Enter the Rand amount" /></label>{draft.classification === 'premium_increase' && <label className="form-label">Previous amount, if known<input type="number" min="0" step="0.01" value={draft.previousAmount} onChange={(input) => updateDraft({ previousAmount: input.target.value })} placeholder="Enter the earlier amount" /></label>}<div className="guided-amount-actions"><button className="button button--primary" onClick={next}>Use these values <ArrowRight size={15} /></button><button className="guided-text-action" onClick={() => { updateDraft({ amount: '', previousAmount: '' }); next(); }}>Leave amount unconfirmed</button></div></>}
      </div>}

      {currentStep === 2 && <div className="guided-question"><p className="eyebrow">QUESTION 3 · {postedType ? 'TRANSACTION DATE' : 'DUE DATE'}</p><h4>{postedType ? 'On what date did the money actually move?' : 'When is this payment due or change effective?'}</h4><p className="guided-hint">{postedType ? `The capture date (${formatDate(event.date)}) is not the transaction date. Only the date you enter here assigns it to a month.` : event.dueDate ? `A possible date in the message is ${formatDate(event.dueDate)}. Confirm it or correct it.` : 'No exact due date was found. Leave this blank if the message does not say.'}</p><label className="form-label">{postedType ? 'Actual transaction date' : 'Due / effective date'}<input type="date" value={postedType ? draft.transactionDate : draft.dueDate} onChange={(input) => updateDraft(postedType ? { transactionDate: input.target.value } : { dueDate: input.target.value })} /></label><div className="guided-amount-actions"><button className="button button--primary" onClick={next}>{(postedType ? draft.transactionDate : draft.dueDate) ? 'Use this date' : 'Continue without a date'} <ArrowRight size={15} /></button>{(postedType ? draft.transactionDate : draft.dueDate) && <button className="guided-text-action" onClick={() => { updateDraft(postedType ? { transactionDate: '' } : { dueDate: '' }); next(); }}>I don’t know the date yet</button>}</div></div>}

      {currentStep === 3 && <div className="guided-question"><p className="eyebrow">QUESTION {financialType ? '4' : '2'} · NAME</p><h4>Who or what is this record about?</h4><p className="guided-hint">The name helps you find the record later. Keep the extracted name only if it matches the original text.</p>{!editMerchant && draft.merchant ? <div className="guided-amount-actions"><button className="button button--primary" onClick={next}><Check size={15} /> Keep “{draft.merchant}”</button><button className="button button--outline" onClick={() => setEditMerchant(true)}>Correct the name</button><button className="guided-text-action" onClick={() => { updateDraft({ merchant: '' }); next(); }}>Leave unknown</button></div> : <><label className="form-label">Merchant / payer / sender<input value={draft.merchant} onChange={(input) => updateDraft({ merchant: input.target.value })} placeholder="Only enter a name you can verify" /></label><div className="guided-amount-actions"><button className="button button--primary" onClick={next}>Continue <ArrowRight size={15} /></button><button className="guided-text-action" onClick={() => { updateDraft({ merchant: '' }); next(); }}>Leave unknown</button></div></>}</div>}

      {currentStep === 4 && <div className="guided-question"><p className="eyebrow">QUESTION 5 · CATEGORY</p><h4>Which category fits best?</h4><p className="guided-hint">This category is used to group captured records. You can change it later.</p><label className="form-label">Choose a category<select value={draft.category} onChange={(input) => updateDraft({ category: input.target.value })}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label><button className="button button--primary" onClick={next}>Use this category <ArrowRight size={15} /></button></div>}

      {currentStep === 5 && <div className="guided-question"><p className="eyebrow">QUESTION 6 · FREQUENCY</p><h4>Does the original message state a repeating frequency?</h4><p className="guided-hint">MoneyLens won’t multiply a payment unless you confirm a frequency. Choose “not stated” if the message is unclear.</p><div className="frequency-choice-grid">{[['', 'One-time / not stated'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']].map(([value, label]) => <button className={draft.recurring === value ? 'frequency-choice frequency-choice--active' : 'frequency-choice'} key={label} onClick={() => { updateDraft({ recurring: value }); next(); }}>{label}</button>)}</div></div>}

      {currentStep === 6 && <div className="guided-question"><p className="eyebrow">FINAL CHECK</p><h4>Does this summary match what you know?</h4><div className="guided-summary"><div><span>Type</span><strong>{typeLabels[draft.classification] || 'Not sure / information only'}</strong></div><div><span>Amount</span><strong>{draft.classification === 'premium_increase' ? `${amountLabel(draft.previousAmount)} → ${amountLabel(draft.amount)}` : amountLabel(draft.amount)}</strong></div><div><span>Name</span><strong>{draft.merchant || 'Not recorded'}</strong></div>{financialType && <div><span>Category</span><strong>{draft.category}</strong></div>}{postedType && <div><span>Transaction date</span><strong>{draft.transactionDate ? formatDate(draft.transactionDate, { day: 'numeric', month: 'long', year: 'numeric' }) : 'Not entered'}</strong></div>}{upcomingType && <div><span>Due / effective date</span><strong>{draft.dueDate ? formatDate(draft.dueDate, { day: 'numeric', month: 'long', year: 'numeric' }) : 'Not entered'}</strong></div>}{financialType && <div><span>Frequency</span><strong>{draft.recurring || 'Not stated'}</strong></div>}</div>{postedType && (!draft.transactionDate || draft.amount === '') && <div className="guided-missing-note"><AlertCircle size={15} />This record will be saved, but monthly totals will exclude it until both a Rand amount and actual transaction date are confirmed.</div>}{upcomingType && draft.amount === '' && <div className="guided-missing-note"><AlertCircle size={15} />This commitment can be saved without an amount, but it will not contribute to the upcoming-amount sum.</div>}{draft.classification === 'premium_increase' && (draft.amount === '' || draft.previousAmount === '') && <div className="guided-missing-note"><AlertCircle size={15} />MoneyLens will not calculate a price difference until both the old and new amounts are confirmed.</div>}{!financialType && <div className="guided-missing-note"><ShieldCheck size={15} />This item will stay out of income and spending totals.</div>}<button className="button button--primary guided-confirm" onClick={() => onConfirm({ ...draft, amount: parseOptionalNumber(draft.amount), previousAmount: parseOptionalNumber(draft.previousAmount), merchant: draft.merchant, inboxState: 'reviewed' })}><Check size={15} /> Confirm & save this record</button></div>}

      <div className="guided-footer">{stepIndex > 0 ? <button className="button button--text" onClick={back}><ArrowRight className="guided-back-icon" size={14} /> Back</button> : <button className="button button--text" onClick={onClose}>Keep for later</button>}{onManual && <button className="guided-manual-link" onClick={onManual}>Edit all fields manually</button>}</div>
    </section>
  );
}

function EventDetailModal({ event, events, onClose, onUpdate }) {
  const [category, setCategory] = useState(event.category);
  const [amount, setAmount] = useState(event.amount == null ? '' : String(event.amount));
  const [classification, setClassification] = useState(event.kind);
  const [transactionDate, setTransactionDate] = useState(event.transactionDate || '');
  const [dueDate, setDueDate] = useState(event.dueDate || '');
  const [merchant, setMerchant] = useState(event.merchant === 'Unknown sender' ? '' : event.merchant);
  const [previousAmount, setPreviousAmount] = useState(event.previousAmount == null ? '' : String(event.previousAmount));
  const [recurring, setRecurring] = useState(event.recurring || '');
  const [guidedReview, setGuidedReview] = useState(needsGuidedReview(event));
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setCategory(event.category);
    setAmount(event.amount == null ? '' : String(event.amount));
    setClassification(event.kind);
    setTransactionDate(event.transactionDate || '');
    setDueDate(event.dueDate || '');
    setMerchant(event.merchant === 'Unknown sender' ? '' : event.merchant);
    setPreviousAmount(event.previousAmount == null ? '' : String(event.previousAmount));
    setRecurring(event.recurring || '');
    setGuidedReview(needsGuidedReview(event));
    setSaved(false);
  }, [event.id]);
  const isScam = event.kind === 'scam';
  const flowLabel = classification === 'income' ? 'Money in' : ['expense', 'bill', 'subscription', 'premium_increase'].includes(classification) ? 'Money out' : 'Information only';
  const classificationOptions = [
    ['income', 'Money received'],
    ['expense', 'Payment already made'],
    ['bill', 'Upcoming bill or commitment'],
    ['subscription', 'Subscription or renewal'],
    ['premium_increase', 'Price or premium change'],
    ['scam', 'Potential safety warning'],
    ['unknown', 'Not sure / information only'],
  ];
  const isPostedRecord = ['income', 'expense'].includes(classification);
  const isUpcomingRecord = ['bill', 'subscription', 'premium_increase'].includes(classification);
  const selectedFlow = classification === 'income' ? 'in' : ['expense', 'bill', 'subscription', 'premium_increase'].includes(classification) ? 'out' : 'none';
  const possibleDuplicates = isPostedRecord && transactionDate && amount !== '' && Number.isFinite(Number(amount))
    ? events.filter((record) => record.id !== event.id && record.state === 'posted' && ['reviewed', 'resolved'].includes(record.inboxState) && record.transactionDate === transactionDate && record.flow === selectedFlow && record.amount != null && Number.isFinite(Number(record.amount)) && Number(record.amount) === Number(amount))
    : [];

  const save = (inboxState = 'reviewed') => {
    const parsedAmount = amount === '' || !Number.isFinite(Number(amount)) ? null : Math.max(0, Number(amount));
    const parsedPreviousAmount = previousAmount === '' || !Number.isFinite(Number(previousAmount)) ? null : Math.max(0, Number(previousAmount));
    onUpdate(event.id, applyReviewCorrection(event, { category, amount: parsedAmount, previousAmount: parsedPreviousAmount, merchant, recurring, classification, transactionDate, dueDate, inboxState }));
    setSaved(true);
    if (inboxState === 'dismissed') window.setTimeout(onClose, 350);
  };

  return (
    <ModalShell onClose={onClose} className="detail-modal">
      <div className={`detail-hero ${isScam ? 'detail-hero--danger' : event.kind === 'premium_increase' ? 'detail-hero--purple' : ''}`}>
        <div className="detail-hero-top"><span className="detail-kind-icon">{isScam ? <ShieldAlert size={20} /> : event.flow === 'in' ? <ArrowDownLeft size={20} /> : event.state === 'upcoming' ? <CalendarDays size={20} /> : <ReceiptText size={20} />}</span><span className="detail-source">{event.source}</span><button className="icon-button detail-close" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <p className="eyebrow">{isScam ? 'SAFETY CHECK' : event.state === 'upcoming' ? 'UPCOMING COMMITMENT' : 'CAPTURED EVENT'}</p>
        <h2>{event.title}</h2>
        <div className="detail-merchant">{event.merchant} <span>·</span> {event.category}</div>
        {event.amount != null && <strong className="detail-amount">{formatZar(event.amount)}{event.kind === 'premium_increase' && event.recurring === 'monthly' ? <small>/ month</small> : null}</strong>}
        {event.kind === 'premium_increase' && event.previousAmount != null && event.delta != null && <div className="detail-comparison">Previously {formatZar(event.previousAmount)} · change {formatZar(event.delta, { plus: true })}{event.recurring === 'monthly' ? ' / month' : ''}</div>}
      </div>

      <div className="detail-content">
        <div className="detail-confidence-row"><span className={`confidence-chip confidence-chip--${event.confidenceLabel.toLowerCase()}`}><span />Rule-match score {Math.round(event.confidence * 100)}% · heuristic, not probability</span><span className="detail-flow">{flowLabel}{event.inboxState === 'open' ? ' · Needs review; excluded from totals' : needsGuidedReview(event) ? ' · More information needed' : ''}</span></div>
        <div className="detail-facts">
          <div><span>Source</span><strong>{event.source}</strong></div>
          <div><span>Captured on</span><strong>{formatDate(event.date, { day: 'numeric', month: 'long', year: 'numeric' })}</strong></div>
          {event.transactionDate && <div><span>Transaction date</span><strong>{formatDate(event.transactionDate, { day: 'numeric', month: 'long', year: 'numeric' })}</strong></div>}
          {event.dueDate && <div><span>Due / effective</span><strong>{formatDate(event.dueDate, { day: 'numeric', month: 'long', year: 'numeric' })}</strong></div>}
          {event.recurring && <div><span>Frequency</span><strong>{event.recurring === 'monthly' ? 'Monthly' : event.recurring}</strong></div>}
          {event.linkDomain && <div className="detail-link-row"><span>Link domain</span><strong><Link2 size={14} /> {event.linkDomain} <em>not opened</em></strong></div>}
        </div>
        {event.state === 'posted' && (!event.transactionDate || event.amount == null) && <div className="settings-footnote"><CalendarDays size={15} />This posted record stays out of monthly totals until it has {event.amount == null ? 'a confirmed amount' : ''}{event.amount == null && !event.transactionDate ? ' and ' : ''}{!event.transactionDate ? 'the actual transaction date' : ''}.</div>}
        {event.state === 'upcoming' && (!event.dueDate || event.amount == null) && <div className="settings-footnote"><CalendarDays size={15} />{event.amount == null ? 'No confirmed amount is recorded.' : ''}{event.amount == null && !event.dueDate ? ' ' : ''}{!event.dueDate ? 'No due date is recorded yet.' : ''}</div>}
        {possibleDuplicates.length > 0 && <div className="duplicate-warning"><AlertCircle size={16} /><div><strong>Check for a possible duplicate</strong><span>{possibleDuplicates.length} confirmed record{possibleDuplicates.length === 1 ? '' : 's'} already share this date, direction and amount. Compare the source before counting both.</span>{possibleDuplicates.map((record) => <small key={record.id}>{record.merchant} · {record.source} · {formatZar(record.amount)}</small>)}</div></div>}
        <div className="why-box"><strong><Sparkles size={15} /> Why MoneyLens detected this</strong><ul>{(event.explanation?.length ? event.explanation : ['This event came from information you chose to share.']).map((item, index) => <li key={index}>{item}</li>)}</ul></div>
        {event.sourceText && <details className="source-quote"><summary>View the original text</summary><blockquote>{event.sourceText}</blockquote></details>}
        {event.flags?.length > 0 && <div className="detail-flags">{event.flags.map((flag) => <span key={flag}>{flag}</span>)}</div>}

        {guidedReview && <GuidedReview event={event} categories={CATEGORIES} onClose={onClose} onManual={isScam ? null : () => setGuidedReview(false)} onConfirm={(answers) => { onUpdate(event.id, applyReviewCorrection(event, answers)); setSaved(true); setGuidedReview(false); }} />}
        {!guidedReview && !isScam && <div className="detail-edit-grid">
          <label className="form-label">What happened?<select value={classification} onChange={(input) => setClassification(input.target.value)}>{classificationOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="form-label">Category<select value={category} onChange={(input) => setCategory(input.target.value)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="form-label">Who or where?<input value={merchant} onChange={(input) => setMerchant(input.target.value)} placeholder="Name as shown in the message" /></label>
          <label className="form-label">{classification === 'premium_increase' ? 'New amount, if known' : 'Amount, if known'}<input type="number" min="0" step="0.01" value={amount} onChange={(input) => setAmount(input.target.value)} /></label>
          {classification === 'premium_increase' && <label className="form-label">Previous amount, if known<input type="number" min="0" step="0.01" value={previousAmount} onChange={(input) => setPreviousAmount(input.target.value)} /></label>}
          {isPostedRecord && <label className="form-label">Transaction date · required for month totals<input type="date" value={transactionDate} onChange={(input) => setTransactionDate(input.target.value)} /></label>}
          {isUpcomingRecord && <label className="form-label">Due date, if known<input type="date" value={dueDate} onChange={(input) => setDueDate(input.target.value)} /></label>}
          {!['unknown', 'scam'].includes(classification) && <label className="form-label">Frequency stated, if any<select value={recurring} onChange={(input) => setRecurring(input.target.value)}><option value="">One-time / not stated</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></label>}
          {needsGuidedReview(event) && <button className="button button--outline detail-guide-link" onClick={() => setGuidedReview(true)}><MessageCircle size={15} /> Ask me one question at a time</button>}
        </div>}
        {isScam && <div className="scam-safe-action"><ShieldCheck size={17} /><span>Do not tap links in the message. Check through your bank’s official app or a phone number you already trust. MoneyLens cannot verify sender identity.</span></div>}
        {saved && <div className="saved-confirmation"><CheckCircle2 size={15} /> Review saved in your encrypted local vault. Totals update from the fields you confirmed.</div>}
        {!guidedReview && <div className="detail-actions">
          {event.inboxState === 'open' ? <><button className="button button--text" onClick={() => save('dismissed')}>Dismiss</button><button className="button button--primary" onClick={() => save('reviewed')}><Check size={15} /> {isScam ? 'I’ve checked this' : 'Confirm & save'}</button></> : <><button className="button button--text" onClick={onClose}>Close</button><button className="button button--primary" onClick={() => save(event.inboxState || 'reviewed')}><Check size={15} /> Save changes</button></>}
        </div>}
      </div>
    </ModalShell>
  );
}

function SearchModal({ events, value, onChange, onClose, onOpenEvent }) {
  const matches = value.trim() ? events.filter((event) => `${event.title} ${event.merchant} ${event.category} ${event.sourceText || ''}`.toLowerCase().includes(value.toLowerCase())).slice(0, 8) : [];
  const inputRef = useRef(null);
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <ModalShell onClose={onClose} className="search-modal">
      <div className="search-modal-input"><Search size={19} /><input ref={inputRef} value={value} onChange={(event) => onChange(event.target.value)} placeholder="Search your captured information…" /><kbd>ESC</kbd><button className="icon-button" onClick={onClose} aria-label="Close search"><X size={17} /></button></div>
      <div className="search-results">
        {!value && <div className="search-hint"><Sparkles size={16} /><span>Search messages, merchants, categories and dates.</span></div>}
        {value && matches.map((event) => <button className="search-result-row" key={event.id} onClick={() => onOpenEvent(event)}><span className="search-result-icon"><FileText size={16} /></span><span><strong>{event.title}</strong><small>{event.merchant} · {event.category} · {event.source}</small></span><span className="search-result-amount">{event.amount == null ? '' : formatZar(event.amount)}</span><ChevronRight size={15} /></button>)}
        {value && !matches.length && <div className="search-no-results">No matching messages in this browser.</div>}
      </div>
    </ModalShell>
  );
}

function ConfirmModal({ onCancel, onConfirm }) {
  return (
    <ModalShell onClose={onCancel} className="confirm-modal">
      <div className="confirm-icon"><AlertCircle size={22} /></div><h2>Delete captured records and chat?</h2><p>This permanently clears your saved captures and assistant conversations from this browser. Your local account and privacy settings remain.</p><div className="modal-actions"><button className="button button--outline" onClick={onCancel}>Keep my records</button><button className="button button--danger" onClick={onConfirm}>Delete records</button></div>
    </ModalShell>
  );
}

function ModalShell({ children, onClose, className = '' }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`modal-card ${className}`} role="dialog" aria-modal="true">{children}</div>
    </div>
  );
}

function EmptyState({ title, detail, icon: Icon }) {
  return <div className="empty-state"><span><Icon size={20} /></span><strong>{title}</strong><p>{detail}</p></div>;
}

export default App;
