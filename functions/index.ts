import { initializeApp } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { onValueWritten } from 'firebase-functions/v2/database';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';
import webpush from 'web-push';

type Person = 'Jenn' | 'Sam';
type BucketName = 'cooking' | 'cleaning';
interface ChoreRecord { doneAt?: number; doneBy?: Person; verified?: boolean; verifiedAt?: number; verifiedBy?: Person; autoVerified?: boolean; needsImprovement?: boolean; needsImprovementAt?: number; needsImprovementBy?: Person; }
interface SubscriptionRecord { subscription?: webpush.PushSubscription; endpoint?: string; }

initializeApp();
const db = getDatabase();
const REGION = 'us-central1';
const DATABASE_REGION = 'us-central1';
const WEB_PUSH_PUBLIC_KEY = 'BP4UiwY8do1t9UFrFnuj-zinaJPSowXp-49gFSY6tbuehAvUhaS7KyL1dx7d7q_jJVIfkeifNMMS37hY2isB6NA';
const WEB_PUSH_PRIVATE_KEY = defineSecret('WEB_PUSH_PRIVATE_KEY');
const PEOPLE: Person[] = ['Jenn', 'Sam'];
const COOKING: string[] = ['Dinner', 'Dishes', 'Trash'];
const CLEANING: string[] = ['Floors', 'Laundry', 'Bathroom'];

function otherPerson(person: Person): Person { return person === 'Jenn' ? 'Sam' : 'Jenn'; }
function bucketForWeek(weekId: string): BucketName {
  const start = Date.parse(`${weekId}T00:00:00Z`);
  const baseline = Date.parse('2026-05-02T00:00:00Z');
  return Math.abs(Math.round((start - baseline) / 86400000) / 7) % 2 === 0 ? 'cooking' : 'cleaning';
}
function keyParts(key: string): { weekId: string; bucket: BucketName; chore: string } { const parts = key.split('-'); return { weekId: parts.slice(0, 3).join('-'), bucket: parts[3] === 'cook' ? 'cooking' : 'cleaning', chore: parts.slice(4).join('-') }; }
function assignmentFor(weekId: string, person: Person): BucketName { const first = bucketForWeek(weekId); return person === 'Jenn' ? first : (first === 'cooking' ? 'cleaning' : 'cooking'); }

async function notify(person: Person, title: string, body: string): Promise<void> {
  await notifyWebPush(person, title, body);
}

async function notifyWebPush(person: Person, title: string, body: string): Promise<void> {
  if (WEB_PUSH_PUBLIC_KEY.includes('PASTE_')) return;
  webpush.setVapidDetails('mailto:sammerwebber@gmail.com', WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY.value());
  const snapshot = await db.ref(`webPushSubscriptions/${person}`).get();
  if (!snapshot.exists()) return;
  for (const [id, value] of Object.entries(snapshot.val())) {
    const subscription = (value as SubscriptionRecord)?.subscription || value as webpush.PushSubscription;
    if (!subscription?.endpoint) continue;
    try {
      await webpush.sendNotification(subscription, JSON.stringify({ title, body, url: 'https://chores-1e359.web.app/' }));
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) await db.ref(`webPushSubscriptions/${person}/${id}`).remove();
      else console.error('Web Push delivery failed', error);
    }
  }
}

export const choreNotifications = onValueWritten({ ref: '/chores/{choreKey}', instance: 'chores-1e359-default-rtdb', region: DATABASE_REGION, secrets: [WEB_PUSH_PRIVATE_KEY] }, async (event) => {
  const before = event.data.before.exists() ? event.data.before.val() : null;
  const after = event.data.after.exists() ? event.data.after.val() : null;
  if (!after?.doneAt) return;
  const { chore } = keyParts(event.params.choreKey);
  if (!before?.doneAt && after.doneBy) await notify(otherPerson(after.doneBy), 'New chore completed', `${after.doneBy} completed ${chore}. Please verify it.`);
  if (!before?.verified && after.verified && after.verifiedBy && after.doneBy) await notify(after.doneBy, 'Chore verified', `${after.verifiedBy} verified your ${chore} chore.`);
  if (!before?.needsImprovement && after.needsImprovement && after.needsImprovementBy && after.doneBy) await notify(after.doneBy, 'Work needs improvement', `${after.needsImprovementBy} says your ${chore} work needs work. Please review it.`);
});

async function autoVerifyPreviousWeek(): Promise<void> {
  const date = new Date();
  const saturday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - ((date.getUTCDay() + 1) % 7)));
  saturday.setUTCDate(saturday.getUTCDate() - 7);
  const weekId = saturday.toISOString().slice(0, 10);
  const records = ((await db.ref('chores').get()).val() || {}) as Record<string, ChoreRecord>;
  const verifiedAt = Date.now();
  await Promise.all(Object.entries(records)
    .filter(([key, record]) => key.startsWith(`${weekId}-`) && record?.doneAt && !record.verified && !record.needsImprovement)
    .map(([key, record]) => db.ref(`chores/${key}`).set({ ...record, verified: true, verifiedAt, autoVerified: true })));
}

async function sendScheduledReminders() {
  const date = new Date();
  const saturday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - ((date.getUTCDay() + 1) % 7)));
  const weekId = saturday.toISOString().slice(0, 10);
  const records = ((await db.ref('chores').get()).val() || {}) as Record<string, ChoreRecord>;
  for (const person of PEOPLE) {
    const assignedBucket = assignmentFor(weekId, person);
    const chores = assignedBucket === 'cooking' ? COOKING : CLEANING;
    const prefix = `${weekId}-${assignedBucket === 'cooking' ? 'cook' : 'clean'}-`;
    const incomplete = chores.filter((chore) => !records[`${prefix}${chore}`]?.doneAt);
    if (incomplete.length) await notify(person, 'Chore reminder', `Still to do: ${incomplete.join(', ')}.`);
    const pending = Object.entries(records).filter(([key, record]) => key.startsWith(`${weekId}-`) && record?.doneAt && !record.verified && record.doneBy === otherPerson(person));
    if (pending.length) await notify(person, 'Verification reminder', `${pending.length} chore${pending.length === 1 ? '' : 's'} await your verification.`);
  }
}

async function sendWeeklyOverview() {
  const date = new Date();
  const saturday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - ((date.getUTCDay() + 1) % 7)));
  const weekId = saturday.toISOString().slice(0, 10);
  for (const person of PEOPLE) {
    const assignedBucket = assignmentFor(weekId, person);
    const chores = assignedBucket === 'cooking' ? COOKING : CLEANING;
    await notify(person, 'Your chores this week', `You are assigned: ${chores.join(', ')}.`);
  }
}

export const dailyChoreReminders = onSchedule({ schedule: '0 9,18 * * *', timeZone: 'America/New_York', region: REGION, secrets: [WEB_PUSH_PRIVATE_KEY] }, async () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date());
  const weekday = parts.find((part) => part.type === 'weekday')?.value;
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  if (hour === 9 && weekday === 'Sat') { await autoVerifyPreviousWeek(); return sendWeeklyOverview(); }
  if (hour === 9 && weekday === 'Sun') return sendScheduledReminders();
  if (hour === 18 && ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday)) return sendScheduledReminders();
});
