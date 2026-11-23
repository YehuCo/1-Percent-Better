# 1% Better MVP Plan

Nov 22, 2026

The MVP is a home-screen web app backed by Firebase. It has every rule from the trial (`docs/V1+YehudaOnePager.html`): check-offs, the daily 2, weekly and two-week goals, the feed, Cap with proof, passes and voting, clowning and pay-up tracking. Wrapped comes after launch. Your group tests it from December 7, and it launches January 1, 2027.

The app is hosted online. Friends open a link and add it to their home screen, where it opens full-screen like any other app. This avoids Xcode, a macOS update, and $124 in store accounts for now. The store app from `docs/MOBILE-PLAN.md` (Capacitor) comes later, and it reuses this same code.

## Decisions

| Decision | Choice |
| --- | --- |
| App type | Home-screen web app (installable, with push) |
| Phones | iPhone and Android, both from the first test |
| Backend | Firebase: Auth, Firestore, Storage, Cloud Messaging, Cloud Functions, Hosting |
| Sign-in | **Google + email link** for now, then add Apple with the store app (needs your OK, see below) |
| Scope | All rules from the trial. Wrapped after launch |
| Code | Vite project in this repo, with the rules in their own tested file |

**Sign-in change, needs your OK:** Sign in with Apple needs the $99/year Apple developer account, even on the web. Google covers anyone with a Gmail account, and the email link covers everyone else for free. Apple sign-in gets added with the store app, when you'd pay for the Apple account anyway.

## How it fits together

```
Phone (home-screen web app)                         Firebase
┌──────────────────────────────┐        ┌───────────────────────────────────┐
│ index.html  UI from the trial │        │ Hosting    serves the app (https)  │
│ app.js      screens, sheets   │◄──────►│ Auth       Google + email link     │
│ rules.js    goals, caps, ...  │        │ Firestore  groups, logs, votes ... │
│ store.js    Firebase calls    │        │ Storage    check-off + proof photos│
│ sw.js       offline + push    │◄───────│ Messaging  push to the phone       │
└──────────────────────────────┘        │ Functions  nudges, deadlines,      │
                                        │            invite codes            │
                                        └───────────────────────────────────┘
```

- **The app** stays the trial's HTML and JS, split into four files. Only `store.js` talks to Firebase, so the screens barely change.
- **The rules** (`rules.js`) are the trial's goal, Cap, pass, prorating and pay-up logic, moved out unchanged and covered by tests. Money depends on them, so they get tested before anything else changes. The Cloud Functions use the same file, so the phone and the server always agree.
- **The server only sends notifications.** Every deadline is worked out from timestamps in the data, as the trial does now, so the app is still right even if a push arrives late.

## Data and access

Each group holds the trial's data, so `store.js` mirrors the paths the trial already uses:

```
users/{uid}                          name, photo, timezone, push tokens
groups/{gid}                         name, ownerId, inviteCode
groups/{gid}/settings/current        stakes history              creator writes
groups/{gid}/members/{uid}           joinedAt, joinDay           joins go through the invite function
groups/{gid}/logs/{uid}/days/{date}  entries, picks              you write your own
groups/{gid}/votes/{uid}             caps, pass votes, reactions, comments, nudges, roasts
groups/{gid}/passes/{uid}            pass requests
groups/{gid}/paid/{uid}              payments you've received
```

Security rules: only members can read a group. Everyone writes only their own docs, and only the creator writes settings. A day can't be changed after its 24-hour window closes, which the rules check on the server as well as in the app. The invite function refuses a 7th member.

## Build steps

| # | Step | Done when | Needs from you |
| --- | --- | --- | --- |
| 1 | **Project setup:** Vite project, split the trial into `index.html`, `app.js`, `rules.js`, `store.js`, and bundle the fonts | The app runs locally, looking and working as the trial does now | Nothing |
| 2 | **Rules tests:** tests for the daily 2, weekly and block goals, passes, prorating, Cap and pay-ups, including the cases from the spec | All of `rules.js` is covered, and the tests run with `npm test` | Nothing |
| 3 | **Firebase project:** Auth (Google, email link), Firestore and Storage with security rules, Hosting | `npm run deploy` puts the app online at a `web.app` address | Create the Firebase project with your Google account |
| 4 | **Real data:** `store.js` replaces the trial's Claude storage. Sign-in screen, create a group, invite by 6-character code or link | Two people on different phones see each other's check-offs live | Nothing |
| 5 | **Photos:** check-off and proof photos to Storage, shrunk on the phone first | A proof photo shows up for the whole group | Nothing |
| 6 | **Install:** web app manifest, icons, offline support, and an "Add to Home Screen" guide for iPhone and Android | The app installs and opens full-screen on both | Nothing |
| 7 | **Push:** notification permission after install, and Cloud Functions for the Thursday nudge, Saturday at-risk, friend nudges, "you've been capped," pass votes, and results when a 24-hour window closes | Each notification arrives on a locked iPhone and Android phone | Switch Firebase to the Blaze plan, which needs a card (expect $0 to a few dollars a month) |
| 8 | **Group test** | 6 people use it daily for two weeks | Your group |
| 9 | **Fix and launch** | Bugs from the test are fixed, and the group restarts clean on January 1 | Pick the stakes |

## Timeline

| Dates | Work |
| --- | --- |
| Nov 23 – Nov 29 | Steps 1–4: the app on real data, with sign-in and groups |
| Nov 30 – Dec 6 | Steps 5–7: photos, install and push |
| Dec 7 – Dec 20 | Step 8: group test, fixing bugs as they come in |
| Dec 21 – Dec 31 | Step 9: final fixes, clear the test data, set the stakes |
| Jan 1 | Launch |

## Things to know

- **iPhone push only works after the app is added to the home screen**, on iOS 16.4 or later. That's why the install guide in step 6 comes before push. Anyone who just uses it in Safari won't get notifications.
- **Money never goes through the app.** It tracks who owes whom, people pay over Venmo, and the receiver marks it paid, as in the spec.
- **Timezones:** each person's day follows their phone's timezone, which is saved on their account so the server's nudges match.
- **Test data:** the December test runs in the same Firebase project. Step 9 clears it so January 1 starts fresh.

## After launch

- **Wrapped**, built from the year's logs, ready by December 2027
- **Store app** with Capacitor (`docs/MOBILE-PLAN.md`), adding Sign in with Apple, when you want App Store and Play Store listings
- **More than one group per person**
- Updating the "First version" section of `docs/SPEC.md` to match this plan

## Open questions

1. **Sign-in:** OK to use Google + email link now, and add Apple with the store app?
2. **Nudge times:** Thursday 6pm and Saturday 10am, in each person's local time?
3. **Name and address:** the app is "1% Better," and the free address would be something like `one-percent-better.web.app`. Do you want a custom domain later?
