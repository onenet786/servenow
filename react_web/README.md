# ServeNow React Web

This is a new frontend workspace for ServeNow. It intentionally lives in `react_web/` so the current root HTML app and the existing `webapp_v2` app remain untouched.

## Stack

- React 18
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui-style components using Radix UI primitives
- Electron for the Windows desktop shell
- Existing Node.js backend API from the repository root

## Setup

```powershell
cd react_web
npm install
npm run dev
```

The Vite dev server runs on `http://localhost:5174`. In development the browser calls same-origin `/api` routes and Vite proxies them to the hosted API at `http://servenow.pk`.

If the API is on another URL, copy `.env.example` to `.env` and set:

```env
VITE_API_TARGET_URL=http://servenow.pk
VITE_API_BASE_URL=
```

For local backend testing, set `VITE_API_TARGET_URL=http://localhost:3002`.

For a static production build that is not served behind a proxy, set `VITE_API_BASE_URL` to the full API origin before building.

## Electron

```powershell
cd react_web
npm run electron:dev
```

Build a Windows installer:

```powershell
cd react_web
npm run electron:build
```

## Notes

- No existing root web files, `webapp_v2`, or backend route files are changed.
- The first screen already reads stores, products, and categories from the existing API.
- Login posts to `/api/auth/login` and stores the returned token in local storage for later authenticated screens.
