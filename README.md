# 1% Better

Groups of up to 6 friends hold each other to getting 1% better every day across five categories: Physical, Mental, Spiritual, Social and Skill/Art.

- [docs/SPEC.md](docs/SPEC.md): the rules
- [docs/MVP-PLAN.md](docs/MVP-PLAN.md): how the MVP gets built and launched

## Running it

Needs Node 22 or later.

```bash
npm install
npm run dev
```

Then open http://localhost:5173. Use your browser's phone view, since the app is built for phones.

`npm run build` makes the production files in `dist/`.

## Code

| File | What's in it |
| --- | --- |
| `index.html` | The page: header, tab bar, screens and sheets |
| `src/styles.css` | All styles, phone-first, with light and dark themes |
| `src/rules.js` | The rules: dates, goals, the daily 2, Cap, passes, prorating and pay-ups. No page or storage code |
| `src/store.js` | Loading and saving data. The only file that changes for Firebase |
| `src/app.js` | Screens, sheets, the example group and startup |

`docs/V1+YehudaOnePager.html` is the original single-file trial, kept for reference. Make changes in `src/` instead.
