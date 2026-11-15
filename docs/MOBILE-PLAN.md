# 1% Better Mobile Plan

Nov 15, 2026

How to turn the MVP (`docs/V1+YehudaOnePager.html`) into a real iOS and Android app. The rules stay as written in `docs/SPEC.md`. This replaces the spec's "mobile web app on the home screen" plan for the first version, because a store app gets reliable push on iOS and a normal install for friends.

## Summary

| Decision | Recommendation | Why |
| --- | --- | --- |
| App shell | **Capacitor**, wrapping the existing HTML | Keeps nearly all of the ~1,000 lines of JS and the UI that was just made phone-ready. The app is forms, a feed and progress bars, which a web view handles well. |
| Backend | **Firebase** (Auth, Firestore, Storage, Cloud Messaging, Cloud Functions) | The MVP's data layer already uses Firestore's API shape (`doc`, `collection`, `set`, `onSnapshot`), so the swap is close to one for one, and push is built in. |

Target: a 6-person group testing on real phones in about two weeks, early December, so the January 1 launch still captures a full year.

## 1. App shell: Capacitor vs. React Native/Expo

What the MVP is today: one HTML file with inline CSS and one `<script>` block of vanilla JS. Roughly a third of that JS is pure rules (dates, the daily 2, locking, weekly and block goals, prorating, Cap, passes, pay-ups) and the rest builds DOM with template strings and `<dialog>` sheets. It already handles safe areas, a fixed tab bar and a floating Check off button.

| | Capacitor | React Native/Expo |
| --- | --- | --- |
| Reuse of the rules code | All of it, unchanged | Most of it, after pulling it into a plain module (it has no DOM in it) |
| Reuse of the UI code | All of it, with small fixes | None. Every screen, sheet and the feed are rebuilt as RN components |
| Time to first phone build | Days | Several weeks |
| Native feel | Good for this app: native push, haptics, camera, share sheet and status bar via plugins. Scrolling and sheets are web, so they feel a little less native | Best: native lists, gestures, navigation and sheets |
| One codebase for web too | Yes, the same files still run in a browser | Only through Expo web, which is a second target to maintain |
| Risk | Web-view quirks (keyboard covering inputs, `<dialog>` on older iOS), fixable with CSS and the Keyboard plugin | Rewrite bugs in rules that already work, during the month meant for testing |

**Recommendation: Capacitor.** The schedule (test through December, launch January 1) leaves no room for a rewrite, and nothing in the app needs native rendering: no maps, no heavy animation, no long lists beyond one group's feed. Do one cheap step that keeps the door open: move the rules functions into their own file (`rules.js`) with no DOM or storage in them. The Cloud Functions need that file anyway (see below), and if the app ever moves to React Native, that file comes along.

What changes in the shell:

- Move the HTML into a Vite (or plain static) project as `index.html`, with `app.js`, `rules.js` and `store.js` split out. Capacitor serves it from the device, so there is no hosting needed for the app itself.
- Bundle the three Google Fonts locally instead of loading them from `fonts.googleapis.com`, so the app works offline and opens fast.
- Plugins: `@capacitor-firebase/authentication`, `@capacitor-firebase/messaging`, `@capacitor/camera` (for proof photos, replacing the file input), `@capacitor/haptics`, `@capacitor/keyboard`, `@capacitor/status-bar`, `@capacitor/app` (deep links for invites).
- Keep `localStorage` only for the remembered tab (`opb.trial.view`). Real check-offs move to Firestore, which also caches offline.

## 2. Backend: Firebase vs. Supabase

What the backend has to do:

- **Accounts:** real sign-in, a display name and photo for each person.
- **Many groups:** today one Claude artifact is one group. The app needs many groups, each with up to 6 members, and invites by link or code.
- **Shared data:** logs, votes (caps, pass votes, reactions, comments, nudges, roasts), passes, paid and group settings, live-updating for everyone in the group.
- **Write rules:** each person writes only their own logs, votes, passes and paid docs; only the creator writes settings; only members read a group.
- **Photos:** proof and Skill/Art photos, shrunk on the phone first (the MVP already does this in `shrink`).
- **Push:** Thursday private nudge, Saturday at-risk notice and friend nudges, "you've been capped, 24 hours to add proof," "vote on this pass, 24 hours," and the result when a vote or proof window closes. These must fire when nobody has the app open, so they need scheduled server code.

| | Firebase | Supabase |
| --- | --- | --- |
| Fit with the MVP's code | Near one for one. `claude.use("db")` exposes `doc().set()`, `collection().onSnapshot()`, which is Firestore's API | Needs a new data layer: tables or JSONB rows, and Realtime channels instead of snapshot listeners |
| Data model | Same paths as now under `groups/{groupId}/...` | Postgres tables (better for Wrapped-style queries later) |
| Access rules | Security Rules: `request.auth.uid == userId` for own docs, `ownerId` check for settings, member check for reads | Row Level Security policies in SQL, equally capable |
| Auth | Sign in with Apple, Google, phone, email link; native Capacitor plugin | Same providers; native Apple/Google sign-in needs more glue in Capacitor |
| Photos | Cloud Storage with rules tied to auth | Supabase Storage with RLS |
| Push | Cloud Messaging (FCM) for Android and iOS (via an APNs key), with a Capacitor plugin | No push service. You still use FCM/APNs, called from Edge Functions |
| Scheduled jobs | Cloud Functions with `onSchedule` (nudges) and Cloud Tasks (exact 24-hour deadlines) | `pg_cron` plus Edge Functions |
| Cost for this scale | Free tier covers it, but Functions need the pay-as-you-go Blaze plan (expect $0 to a few dollars a month) | Free tier covers it, but free projects pause after a week idle |
| Lock-in | Higher: Firestore is proprietary | Lower: it is Postgres |

**Recommendation: Firebase.** The code was written against a Firestore-shaped API, push and native sign-in are first-class in Capacitor, and the data volume is tiny (6 people × 365 days is a few thousand docs a year per group), so Postgres's query strengths don't matter yet. Wrapped can be computed from each person's logs on the device or in a Function at year end. If heavier analytics are needed later, Firestore can stream to BigQuery.

### Data layout in Firestore

Keep the MVP's paths and put them under a group:

```
users/{uid}                          {name, photoUrl, tz, fcmTokens:[...]}
groups/{gid}                         {name, ownerId, inviteCode, createdAt}
groups/{gid}/settings/current        {history:[{cost, mode, from, at}]}      owner writes
groups/{gid}/members/{uid}           {joinedAt, joinDay}                    self writes, max 6
groups/{gid}/logs/{uid}/days/{date}  {date, entries, picks, locked}         self writes
groups/{gid}/votes/{uid}             {cap, pass, react, cmt, nudge, roast}  self writes
groups/{gid}/passes/{uid}            {req:{date:{reason, at}}}              self writes
groups/{gid}/paid/{uid}              {got:{...}}                            self writes (receiver)
```

Add `tz` to each user so the Thursday and Saturday nudges fire at a sensible local hour, and so the server agrees with the phone about which day an entry belongs to.

### Server-side work (Cloud Functions)

1. **Weekly nudges:** an hourly scheduled function finds members whose local time is Thursday 6pm or Saturday 10am, runs `rules.js` on their logs, and sends "Still missing Spiritual and Social. 4 days left" privately, or tells the group who is at risk.
2. **Caps:** when a cap vote is written and the entry reaches its cap count, notify the owner and queue a Cloud Task for 24 hours later that checks for proof and notifies the group of the result.
3. **Passes:** when a pass request is written, notify the other members and queue a task for 24 hours later that announces granted or denied.
4. **Friend nudges, roasts and comments:** a trigger on vote writes sends a push to the person nudged or roasted.
5. **Invites:** a callable function that joins a group by code and refuses a 7th member. Doing this on the server avoids two people taking the last spot at once.

Every deadline is still computed from timestamps in the data, as the MVP does now, so the app stays correct even if a push is late. The functions only send notifications; they don't decide outcomes.

## 3. Where the code touches `window.claude`, and what replaces it

| MVP function | What it does now | Replacement |
| --- | --- | --- |
| `initStore` | Calls `claude.use("db")`, `("user")`, `("assets")`; gets the user id, `isOwner` and `can("data.write")`; subscribes to members, votes, passes, paid and `group/settings`; falls back to `localStorage` | Firebase Auth sign-in (`onAuthStateChanged`) gives `uid`. Group picker or invite screen sets `gid`. Same `onSnapshot` listeners on `groups/{gid}/...`. `isOwner` becomes `group.ownerId === uid`. `canWrite` becomes "is a member." The local-only fallback and the "sign in to Claude" banners go away |
| `persistDay` | `db.doc("logs/{me}/days/{date}").set(d)` or `.delete()` | Same call on `groups/{gid}/logs/{uid}/days/{date}` with the Firestore SDK. Firestore's offline cache replaces the `lsSave` fallback |
| `writeOwn` (used by `saveVotes`, `savePasses`, `savePaid`) | `db.doc("{coll}/{me}").set(data)` | Same, on `groups/{gid}/{coll}/{uid}`. Consider `set(data, {merge:true})` or field updates so two phones of the same person don't overwrite each other |
| `uploadPhoto` | `assets.upload(shrink(file))` returns `{id, url}` | Capacitor Camera to take or pick the photo, `shrink` as now, then upload to Storage at `groups/{gid}/photos/{uid}/{id}.jpg` and save `getDownloadURL()` |
| `loadNames` | `userCap.profiles(memberIds)` returns names | Read `users/{uid}` docs for the group's members (name and photo set at sign-up) |
| Settings save (line ~1242) and join (line ~1253) | `db.doc("group/settings").set(...)`, `db.doc("members/{me}").set(...)` | `groups/{gid}/settings/current` (owner only by rule); joining goes through the invite function |

Put all of this in one `store.js` with the same function names, so the rest of the app doesn't change. The demo group (`startDemo`) stays as is, since it never touches storage.

## 4. First milestone: one group on real phones

Goal: Yehuda and 5 friends install the app, sign in, join one group, and use check-offs, Cap, passes and nudges for a week.

In scope:

1. Capacitor project with the current HTML, split into `app.js`, `rules.js`, `store.js`, fonts bundled.
2. Firebase project: Sign in with Apple and Google, Firestore with the layout above and Security Rules, Storage for photos.
3. `store.js` replacing the five `window.claude` touchpoints.
4. Create a group, share a 6-character invite code, join by code (deep links can wait).
5. Push: register the FCM token at sign-in, and send just two kinds of notification: the Thursday private nudge and "you've been capped." That proves the scheduled path and the trigger path end to end.
6. Builds: iOS through TestFlight and Android through Google Play internal testing (or Firebase App Distribution). This needs an Apple Developer account ($99 a year) and a Play Console account ($25 once). Sign in with Apple is required on iOS once Google sign-in is offered.

Out of scope until the group has used it for a week: Saturday at-risk and friend-nudge pushes, pass-vote and deadline pushes, deep-link invites, multiple groups per person, Wrapped, and store listing assets.

Done means: 6 people on at least one iPhone and one Android phone can each check off, see each other's entries live, call cap and add proof with a photo, request and vote on a pass, and receive the Thursday nudge on a locked phone.

## Open questions

- **Sign-in options:** Apple and Google only, or also phone number (familiar for friend groups, but SMS costs money)?
- **App name and bundle id:** needed before the first TestFlight build, for example `com.onepercentbetter.app`.
- **Nudge times:** Thursday 6pm and Saturday 10am local are guesses; pick the real ones.
