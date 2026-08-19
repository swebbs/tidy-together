interface PushPayload { title?: string; body?: string; url?: string; }
interface PushEventData { json(): PushPayload; }
interface PushEventLike { data: PushEventData | null; waitUntil(promise: Promise<unknown>): void; }
interface NotificationEventLike { notification: { close(): void; data?: { link?: string } }; waitUntil(promise: Promise<unknown>): void; }
interface WorkerRegistrationLike { showNotification(title: string, options: { body: string; data: { link: string } }): Promise<void>; }
interface ServiceWorkerLike {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  registration: WorkerRegistrationLike;
  clients: { openWindow(url: string): Promise<unknown>; };
}

const worker = self as unknown as ServiceWorkerLike;

worker.addEventListener('push', (rawEvent) => {
  const event = rawEvent as PushEventLike;
  if (!event.data) return;
  const payload = event.data.json() as PushPayload;
  const title = payload.title || 'Chore Tracker';
  const options = {
    body: payload.body || 'You have a chore tracker update.',
    data: { link: payload.url || '/' }
  };
  event.waitUntil(worker.registration.showNotification(title, options));
});

worker.addEventListener('notificationclick', (rawEvent) => {
  const event = rawEvent as NotificationEventLike;
  event.notification.close();
  event.waitUntil(worker.clients.openWindow(event.notification.data?.link || '/'));
});
