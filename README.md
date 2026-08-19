# Jenn & Sam Chore Tracker

A small, real-time chore tracking application for Jenn and Sam. The app alternates weekly responsibility for cooking and cleaning chores, lets the assigned person mark work complete, and requires the other person to verify it.

The project is designed around a simple goal: make shared household chores visible, accountable, and easy to keep up with across devices.

## Features

- Alternating weekly assignments for cooking and cleaning.
- Six tracked chores:
  - Cooking & kitchen: Dinner, Dishes, Trash
  - Cleaning: Floors, Laundry, Bathroom
- Google sign-in with an allowlisted account.
- Real-time synchronization through Firebase Realtime Database.
- Two-step completion flow:
  1. The assigned person marks a chore done.
  2. The other person verifies the chore.
- Weekly and monthly chore views.
- Completion and verification metrics.
- Rolling 60-day performance averages.
- JSON backup export and import.
- Browser push notifications for completed chores, verification requests, reminders, and weekly overviews.
- Automatic cleanup of records older than the configured retention period.

## Architecture

```text
Browser
  │
  ├─ Firebase Web SDK ── Google Authentication
  │                    └─ Firebase Realtime Database
  │
  ├─ Service Worker ─── Browser push notifications
  │
  └─ Firebase Hosting ── Serves the compiled Vite app

Google Cloud / Firebase
  └─ Cloud Functions
       ├─ React to chore changes and send notifications
       └─ Run scheduled chore and verification reminders
```

The frontend runs in the browser. Firebase Cloud Functions run server-side in Google Cloud and handle notification delivery and scheduled reminders.

## Repository structure

```text
.
├── src/
│   ├── main.ts                    # Main frontend application
│   ├── firebase-messaging-sw.ts   # Push notification service worker
│   └── style.css                  # Application styles
├── public/
│   ├── icon.svg                   # App icon
│   └── manifest.webmanifest       # Installable web app metadata
├── functions/
│   ├── index.ts                   # Google Cloud Functions
│   ├── package.json               # Functions dependencies and scripts
│   └── tsconfig.json              # Functions TypeScript configuration
├── index.html                     # Frontend entry page
├── firebase.json                  # Firebase Hosting and Functions config
├── .firebaserc                    # Firebase project selection
├── tsconfig.json                  # Frontend TypeScript configuration
├── tsconfig.sw.json               # Service worker TypeScript configuration
└── package.json                   # Frontend dependencies and scripts
```

Generated directories such as `dist/`, `functions/lib/`, `node_modules/`, and `.firebase/` are intentionally excluded from Git.

## Firebase and Google Cloud setup

The configured Firebase project is:

```text
chores-1e359
```

The project currently uses:

- Firebase Hosting for the web application.
- Firebase Authentication with Google sign-in.
- Firebase Realtime Database for chore records and push subscriptions.
- Cloud Functions for Firebase, running on Node.js 22.
- Google Secret Manager for the Web Push private VAPID key.
- Scheduled Cloud Functions in the `us-central1` region.

### Cloud Functions

`choreNotifications` listens to changes under `chores/{choreKey}` and sends notifications when chores are completed or verified.

`dailyChoreReminders` runs on a schedule and sends weekly overviews, incomplete-chore reminders, and verification reminders.

The private VAPID key is accessed through the `WEB_PUSH_PRIVATE_KEY` Firebase secret. Do not put this private key in source control or frontend code.

The public Firebase web configuration and public VAPID key are included in the frontend because browser clients need them. They do not replace Firebase Database security rules or server-side authorization.

## Local development

Requirements:

- Node.js 22 recommended for Firebase Functions.
- npm.
- Firebase CLI for deployment.

Install frontend dependencies:

```bash
npm install
```

Install Functions dependencies:

```bash
cd functions
npm install
cd ..
```

Start the frontend development server:

```bash
npm run dev
```

Run frontend typechecking:

```bash
npm run typecheck
```

Run Functions typechecking and compilation:

```bash
cd functions
npm run typecheck
npm run build
cd ..
```

## Building the application

From the project root:

```bash
npm run build
```

This performs two steps:

1. Compiles the TypeScript service worker into `public/firebase-messaging-sw.js`.
2. Uses Vite to bundle the frontend into `dist/`.

The Functions build is separate:

```bash
cd functions
npm run build
```

It compiles `functions/index.ts` into `functions/lib/index.js`.

## Deploying changes

Authenticate with Firebase CLI if needed:

```bash
firebase login
```

Confirm the selected project:

```bash
firebase use
```

Build the frontend:

```bash
npm run build
```

Deploy Hosting and Functions:

```bash
firebase deploy
```

`firebase.json` includes a Functions predeploy hook, so Firebase automatically runs the Functions TypeScript build during deployment.

You can deploy only one area when appropriate:

```bash
firebase deploy --only hosting
firebase deploy --only functions
```

After deployment, test Google sign-in, real-time chore updates, completion and verification, backup/import, and push notifications.

## Data model

Chore records are stored under:

```text
chores/{weekId}-{bucket}-{chore}
```

Records contain fields such as:

```json
{
  "doneAt": 1720000000000,
  "doneBy": "Jenn",
  "verified": true,
  "verifiedAt": 1720000100000,
  "verifiedBy": "Sam"
}
```

Push subscriptions are stored under:

```text
webPushSubscriptions/{person}
```

## Security and maintenance notes

- Keep the Web Push private VAPID key in Firebase Secret Manager.
- Review Firebase Realtime Database rules before sharing the app more broadly. Database rules are not currently stored in this repository, so they should be exported and version-controlled when practical.
- The frontend allowlist is useful for the app experience, but database rules and server-side controls are the real security boundary.
- Use Node.js 22 for Functions development and deployment to match the configured runtime.
- Avoid `npm audit fix --force` unless breaking dependency upgrades have been reviewed.
- Never commit `.env` files, private keys, generated build output, or local diagnostic logs.

## Typical change workflow

```bash
# 1. Make a change

# 2. Check frontend TypeScript
npm run typecheck

# 3. Check Functions when backend code changed
cd functions
npm run typecheck
npm run build
cd ..

# 4. Build the frontend
npm run build

# 5. Test locally
npm run dev

# 6. Deploy after verification
firebase deploy
```
