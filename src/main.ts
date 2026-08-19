import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { getDatabase, onValue, push, ref, remove, set } from 'firebase/database';
import './style.css';

type Person = 'Jenn' | 'Sam';
type BucketName = 'cooking' | 'cleaning';
interface ChoreRecord {
  doneAt?: number;
  doneBy?: Person;
  verified?: boolean;
  verifiedAt?: number;
  verifiedBy?: Person;
  subscription?: PushSubscriptionJSON;
  updatedAt?: number;
}
type Records = Record<string, ChoreRecord>;
interface Metrics { assigned: number; completed: number; verifiable: number; verified: number; }

const firebaseConfig = {
  apiKey: 'AIzaSyBKIY-O5q3DhtCxYwkNaN1AwBr-nWjOmfg',
  authDomain: 'chores-1e359.firebaseapp.com',
  databaseURL: 'https://chores-1e359-default-rtdb.firebaseio.com',
  projectId: 'chores-1e359',
  storageBucket: 'chores-1e359.firebasestorage.app',
  messagingSenderId: '933757863317',
  appId: '1:933757863317:web:71b1c952fd136251d4e29c',
  measurementId: 'G-3YQC9K46QN'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const WEB_PUSH_PUBLIC_KEY = 'BP4UiwY8do1t9UFrFnuj-zinaJPSowXp-49gFSY6tbuehAvUhaS7KyL1dx7d7q_jJVIfkeifNMMS37hY2isB6NA';
const provider = new GoogleAuthProvider();
const ALLOWED_EMAIL = 'jamwebnolds@gmail.com';
const people: Person[] = ['Jenn', 'Sam'];
const buckets: Record<BucketName, { label: string; chores: string[] }> = {
  cooking: { label: 'COOKING & KITCHEN', chores: ['Dinner', 'Dishes', 'Trash'] },
  cleaning: { label: 'CLEANING', chores: ['Floors', 'Laundry', 'Bathroom'] }
};
const RETENTION_DAYS = 365;
const METRICS_DAYS = 60;
const now = new Date();
const state: { user: import('firebase/auth').User | null; selected: Person | null; records: Records; month: Date } = { user: null, selected: localStorage.getItem('chore-person') as Person | null, records: {}, month: new Date(now.getFullYear(), now.getMonth(), 1) };

const $ = (selector: string): HTMLElement => document.querySelector(selector) as HTMLElement;
const esc = (value: unknown): string => String(value).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[c as '&' | '<' | '>' | '"' | "'"]);
const pad = (n: number): string => String(n).padStart(2, '0');
const dateKey = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startOfWeek = (date: Date): Date => { const d = new Date(date); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 1) % 7)); return d; };
const weekId = (date: Date): string => dateKey(startOfWeek(date));
const weekDates = (start: Date): Date[] => Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
const formatDate = (date: Date): string => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const formatTime = (stamp?: number): string => stamp ? new Date(stamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
const currentBucket = (start: Date): boolean => Math.abs(Math.round((start.getTime() - new Date(2026, 4, 2).getTime()) / 86400000) / 7) % 2 === 0;

function rollingMetrics(): Record<Person, Metrics> {
  const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0); cutoff.setDate(cutoff.getDate() - METRICS_DAYS + 1);
  const totals: Record<Person, Metrics> = {
    Jenn: { assigned: 0, completed: 0, verifiable: 0, verified: 0 },
    Sam: { assigned: 0, completed: 0, verifiable: 0, verified: 0 }
  };
  let week = startOfWeek(new Date());
  while (weekDates(week)[6] >= cutoff) {
    const id = weekId(week); const bucketOne = currentBucket(week);
    const assignments: Record<Person, BucketName> = { Jenn: bucketOne ? 'cooking' : 'cleaning', Sam: bucketOne ? 'cleaning' : 'cooking' };
    for (const person of people) {
      const other = person === 'Jenn' ? 'Sam' : 'Jenn';
      buckets[assignments[person]].chores.forEach((chore) => {
        totals[person].assigned += 1;
        const key = `${id}-${assignments[person] === 'cooking' ? 'cook' : 'clean'}-${chore}`;
        const record = state.records[key];
        if (record?.doneAt && record.doneBy === person) totals[person].completed += 1;
      });
      buckets[assignments[other]].chores.forEach((chore) => {
        const key = `${id}-${assignments[other] === 'cooking' ? 'cook' : 'clean'}-${chore}`;
        const record = state.records[key];
        if (record?.doneAt && record.doneBy === other) { totals[person].verifiable += 1; if (record.verified && record.verifiedBy === person) totals[person].verified += 1; }
      });
    }
    week = new Date(week); week.setDate(week.getDate() - 7);
  }
  return totals;
}
const percent = (value: number, total: number): number => total ? Math.round((value / total) * 100) : 0;

function render(): void {
  if (!state.user) return renderLogin();
  if (!state.selected) return renderChooser();
  const monthName = state.month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const first = new Date(state.month.getFullYear(), state.month.getMonth(), 1);
  const firstWeek = startOfWeek(first);
  const weeks = Array.from({ length: 6 }, (_, i) => new Date(firstWeek.getFullYear(), firstWeek.getMonth(), firstWeek.getDate() + i * 7));
  $('#app').innerHTML = `<main class="shell">
    <header><h1>Jenn &amp; Sam Chore Tracker</h1><p>Alternating weekly</p>
    <div class="account">Logged in as ${esc(state.selected)} <button data-action="notifications">Enable notifications</button> <button data-action="switch">Switch</button> <button data-action="signout">Sign out</button></div><div class="sync">● Synced</div></header>
    <div class="legend"><span class="j-dot">●</span> Jenn's turn <span class="s-dot">●</span> Sam's turn</div>
    <div class="legend muted"><span>● To do</span><span class="waiting">● Awaiting verify</span><span class="verified">● Verified</span></div>
    <nav class="month-nav"><button data-action="prev">←</button><strong>${monthName}</strong><button data-action="next">→</button><button data-action="today">TODAY</button></nav>
    <section class="weeks">${weeks.map(renderWeek).join('')}</section>
    <div class="backup"><button data-action="export">Export Backup</button><button data-action="import">Import Backup</button><input id="import-file" type="file" accept="application/json" hidden /></div>
    <footer>Mark chores done, then the other person verifies.<br/>Changes sync live between devices.</footer>
  </main>`;
}

function renderLogin(): void { $('#app').innerHTML = `<main class="login"><h1>Jenn &amp; Sam</h1><p>Chore Tracker</p><button class="google" data-action="login">ⓖ &nbsp; Sign in with Google</button></main>`; }
function renderStats(monthName: string, totals: number[], metrics: Record<Person, Metrics>): string { return `<section class="summary"><h2>Completed in ${monthName}</h2><div class="totals">${people.map((p, i) => `<div class="total ${p.toLowerCase()}"><b>${p}</b><strong>${totals[i]}</strong><small>verified chores completed</small></div>`).join('')}</div></section><section class="metrics"><h2>Rolling averages <small>last ${METRICS_DAYS} days</small></h2><div class="metric-grid">${people.map((person) => `<div class="metric-card ${person.toLowerCase()}"><h3>${person}</h3><p><strong>${percent(metrics[person].completed, metrics[person].assigned)}%</strong><span>chores completed</span><small>${metrics[person].completed}/${metrics[person].assigned}</small></p><p><strong>${percent(metrics[person].verified, metrics[person].verifiable)}%</strong><span>verifications completed</span><small>${metrics[person].verified}/${metrics[person].verifiable}</small></p></div>`).join('')}</div></section>`; }
function renderChooser(): void { const monthName = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); const totals = people.map((person) => Object.values(state.records).filter((r) => r.doneBy === person && r.verified && new Date(r.verifiedAt || r.doneAt || 0).getMonth() === new Date().getMonth()).length); $('#app').innerHTML = `<main class="login chooser" style="width:min(610px,calc(100% - 20px));margin:50px auto"><h1>Who's checking in?</h1><p>This is remembered on this device</p><div>${people.map((p) => `<button data-person="${p}">${p}</button>`).join('')}</div>${renderStats(monthName, totals, rollingMetrics())}</main>`; }

async function enableNotifications(): Promise<void> {
  if (!('Notification' in window)) throw new Error('Web Notifications are unavailable here. Use an iOS/iPadOS 16.4+ Home Screen app created from Safari.');
  if (WEB_PUSH_PUBLIC_KEY.includes('PASTE_')) { alert('Push notifications are not configured yet.'); return; }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') { alert('Notification permission was not granted.'); return; }
  const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  const activeRegistration = await navigator.serviceWorker.ready;
  if (!activeRegistration.pushManager) { alert('This browser does not support push notifications. Use the Home Screen app.'); return; }
  const base64Key = WEB_PUSH_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64Key + '='.repeat((4 - (base64Key.length % 4)) % 4);
  const applicationServerKey = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  const subscription = await activeRegistration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  await set(push(ref(db, `webPushSubscriptions/${state.selected}`)), { subscription: subscription.toJSON(), updatedAt: Date.now() });
  alert(`Notifications enabled for ${state.selected} on this device.`);
}

function renderWeek(start: Date): string {
  const id = weekId(start), dates = weekDates(start), active = dates.some((d) => d.getMonth() === state.month.getMonth());
  const bucketOne = currentBucket(start); const leftPerson = bucketOne ? 'Jenn' : 'Sam'; const rightPerson = bucketOne ? 'Sam' : 'Jenn';
  const entries = (kind: BucketName, person: Person): string => buckets[kind].chores.map((chore) => { const key = `${id}-${kind === 'cooking' ? 'cook' : 'clean'}-${chore}`; const r = state.records[key] || {}; const canDo = state.selected === person && (!r.doneAt || (r.doneAt && !r.verified && r.doneBy === state.selected)); const canVerify = state.selected !== person && !!r.doneAt && !r.verified; return `<label class="chore ${r.verified ? 'is-verified' : r.doneAt ? 'is-waiting' : ''}"><input type="checkbox" data-key="${key}" ${r.doneAt ? 'checked' : ''} ${canDo || canVerify ? '' : 'disabled'}><span>${esc(chore)}</span>${r.doneAt ? `<small>Done by ${esc(r.doneBy)} · ${r.verified ? `Verified by ${esc(r.verifiedBy)} · ` : 'Waiting for verification · '}${formatTime(r.verifiedAt || r.doneAt)}</small>` : ''}</label>`; }).join('');
  const all = [...buckets.cooking.chores, ...buckets.cleaning.chores].map((c) => state.records[`${id}-${buckets.cooking.chores.includes(c) ? 'cook' : 'clean'}-${c}`]).filter(Boolean); const done = all.filter((r) => r.verified).length;
  const status = done === 6 ? 'DONE' : startOfWeek(new Date()) > start ? 'PAST DUE' : startOfWeek(new Date()).getTime() === start.getTime() ? 'THIS WEEK' : 'UPCOMING';
  return `<article class="week ${status !== 'THIS WEEK' ? 'collapsed' : ''} ${active && status === 'THIS WEEK' ? 'active' : ''} ${status === 'DONE' ? 'complete' : ''}"><div class="week-head" role="button" tabindex="0"><strong>${formatDate(dates[0])} — ${formatDate(dates[6])}</strong><span class="dots">••••••</span><em>${status}</em></div>${active || all.length ? `<div class="columns" style="display:${status !== 'THIS WEEK' ? 'none' : 'grid'}"><div><h3>${buckets.cooking.label} — ${leftPerson}</h3>${entries('cooking', leftPerson)}</div><div><h3>${buckets.cleaning.label} — ${rightPerson}</h3>${entries('cleaning', rightPerson)}</div></div>` : ''}</article>`;
}

async function save(key: string, value: ChoreRecord): Promise<void> { await set(ref(db, `chores/${key}`), value); }
async function toggle(key: string): Promise<void> { const old = state.records[key] || {}; if (!old.doneAt && state.selected) await save(key, { doneAt: Date.now(), doneBy: state.selected, verified: false }); else if (!old.verified && old.doneBy !== state.selected && state.selected) await save(key, { ...old, verified: true, verifiedAt: Date.now(), verifiedBy: state.selected }); else if (!old.verified && old.doneBy === state.selected) await remove(ref(db, `chores/${key}`)); }
function backup(): void { const blob = new Blob([JSON.stringify(state.records, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `chores-backup-${dateKey(new Date())}.json`; a.click(); URL.revokeObjectURL(a.href); }
async function importBackup(file: File): Promise<void> { const json = JSON.parse(await file.text()) as Records; for (const [key, value] of Object.entries(json)) await save(key, value); }
async function pruneOldRecords(records: Records): Promise<void> { const cutoff = new Date(); cutoff.setHours(0, 0, 0, 0); cutoff.setDate(cutoff.getDate() - RETENTION_DAYS); await Promise.all(Object.keys(records).filter((key) => /^\d{4}-\d{2}-\d{2}-/.test(key) && new Date(`${key.slice(0, 10)}T00:00:00`) < cutoff).map((key) => remove(ref(db, `chores/${key}`)))); }
async function normalizeRecords(records: Records): Promise<void> { await Promise.all(Object.entries(records).filter(([, record]) => record?.doneAt && typeof record.verified !== 'boolean').map(([key, record]) => save(key, { ...record, verified: false }))); }

document.addEventListener('click', async (event) => { const target = event.target as HTMLElement; const weekHead = target.closest('.week-head') as HTMLElement | null; if (weekHead && !target.closest('button')) { const columns = weekHead.nextElementSibling as HTMLElement | null; if (columns?.classList.contains('columns')) columns.style.display = columns.style.display === 'none' ? 'grid' : 'none'; weekHead.closest('.week')?.classList.toggle('collapsed'); return; } const action = target.dataset.action; if (target.dataset.person) { state.selected = target.dataset.person as Person; localStorage.setItem('chore-person', state.selected); render(); } else if (action === 'login') await signInWithPopup(auth, provider); else if (action === 'signout') await signOut(auth); else if (action === 'notifications') await enableNotifications(); else if (action === 'switch') { state.selected = null; render(); } else if (action === 'prev') { state.month = new Date(state.month.getFullYear(), state.month.getMonth() - 1, 1); render(); } else if (action === 'next') { state.month = new Date(state.month.getFullYear(), state.month.getMonth() + 1, 1); render(); } else if (action === 'today') { state.month = new Date(); state.month.setDate(1); render(); } else if (action === 'export') backup(); else if (action === 'import') $('#import-file').click(); });
document.addEventListener('change', async (event) => { const target = event.target as HTMLInputElement; if (target.id === 'import-file' && target.files?.[0]) await importBackup(target.files[0]); if (target.dataset.key) await toggle(target.dataset.key); });
onAuthStateChanged(auth, (user) => { if (user && user.email !== ALLOWED_EMAIL) { signOut(auth); return; } state.user = user; if (user) onValue(ref(db, 'chores'), (snapshot) => { state.records = snapshot.val() || {}; render(); normalizeRecords(state.records); pruneOldRecords(state.records); }); else render(); });
render();

window.addEventListener('unhandledrejection', (event) => {
  const error = event.reason;
  console.error('Notification setup failed', error);
  if (error?.name || error?.message) alert(`Notification setup failed: ${error.name || 'Error'}${error.message ? ` — ${error.message}` : ''}`);
});
