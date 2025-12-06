# ServeNow - Copilot AI Coding Instructions

## Project Overview

**ServeNow** is a full-stack grocery delivery platform with:
- **Backend**: Node.js/Express REST API with MySQL database (`server.js`)
- **Frontend**: Vanilla JavaScript web app with HTML/CSS (responsive design)
- **Mobile**: Flutter app for customers and riders
- **Architecture**: Role-based multi-tenant system (customers, store owners, riders, admins)

**Start here**: Read `README.md` for features; database schema in `database/schema.sql`; API routes structure in `routes/`.

---

## Architecture & Data Flow

### Core Components
1. **Backend Server** (`server.js`)
   - Express.js with CORS (allows all origins for dev)
   - MySQL connection via `mysql2/promise` (async/await pattern)
   - Static file serving: `/uploads`, `/images`, and frontend HTML/CSS from root
   - Routes attached via middleware: `/api/auth`, `/api/users`, `/api/stores`, `/api/products`, `/api/orders`, `/api/categories`, `/api/riders`
   - Error handling middleware with verbose logging
   - Database connection attached to `req.db` in middleware (line 56-59)

2. **Database** (`database/schema.sql`)
   - Core tables: users, stores, products, categories, orders, order_items, riders
   - User types: `'customer'`, `'store_owner'`, `'admin'` (stored in users.user_type ENUM)
   - Order status flow: pending → confirmed → preparing → ready → out_for_delivery → delivered (or cancelled)
   - Foreign key relationships: products→stores, products→categories, orders→users/stores/riders, order_items→orders/products
   - Sample data includes 1 admin, 3 stores, 12 products, 3 riders

3. **Authentication**
   - JWT tokens stored in `localStorage.serveNowToken` (frontend)
   - JWT verified via `authenticateToken` middleware (`middleware/auth.js`)
   - Bearer token format: `Authorization: Bearer <token>`
   - Token payload includes user object: `req.user = {id, email, user_type, ...}`
   - Role checks: `requireAdmin()`, `requireStoreOwner()` middleware enforce access

4. **Frontend State Management**
   - Cart stored in `localStorage.serveNowCart` (JSON array of items)
   - Current user stored in `currentUser` JavaScript variable
   - API base URL computed dynamically: `window.location.protocol + '//' + window.location.host`
   - No framework—vanilla fetch() calls with manual DOM manipulation

---

## Key Patterns & Conventions

### Backend API Responses
All routes follow this JSON response format:
```javascript
// Success
{ success: true, [resource]: data, message?: "..." }
// Error
{ success: false, message: "...", errors?: [...], error?: error_message }
```
Example: `routes/products.js` line 30-44 shows product list response wrapping.

### Input Validation
- Use `express-validator` for server-side validation (see `routes/auth.js` line 9-14)
- Validation errors returned as array: `errors: errors.array()`
- Validation must happen BEFORE database queries

### Database Query Pattern
- Always use parameterized queries with `await req.db.execute(sql, [params])`
- Destructure result: `const [rows] = await req.db.execute(...)`
- Never concatenate user input into SQL strings

### Authentication Flow
1. User calls `/api/auth/login` or `/api/auth/register` with credentials
2. Server returns `{success: true, token: "jwt...", user: {...}}`
3. Frontend stores token in `localStorage.serveNowToken`
4. Frontend attaches token to requests: `Authorization: Bearer <token>` header
5. Backend middleware verifies token; attaches user to `req.user`

### File Organization
- Routes (endpoint logic): `routes/*.js` named by resource (auth, users, products, stores, orders, categories, riders)
- Middleware (shared logic): `middleware/auth.js` for JWT and role checks
- Frontend HTML: root directory (index.html, admin.html, login.html, etc.)
- Frontend JS: `js/app.js` (main), `js/admin.js` (admin panel), plus role-specific files (store.js, rider.js, etc.)
- CSS: `css/style.css` (main), `css/admin.css` (admin panel)
- Database: `database/schema.sql` and setup script `setup-db.js`

---

## Development Workflow

### Environment Setup
1. **Node.js Backend**:
   - `npm install` (dependencies: express, mysql2, bcryptjs, jsonwebtoken, cors, dotenv, express-validator, multer, nodemon)
   - Create `.env` file with: `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT`, `JWT_SECRET`, `PORT`, `NODE_ENV`
   - `npm run dev` starts server with nodemon auto-restart (or `npm start` for production)
   - Server logs to console with timestamps (line 6-143 in server.js shows verbose logging)

2. **Database**:
   - Run `setup-db.js` to initialize MySQL database and load `database/schema.sql`
   - Default admin: email `admin@servenow.com`, password `admin123`

3. **Frontend**:
   - Frontend served by Express as static files (line 104-107 in server.js)
   - No build step required for vanilla JS
   - Access at `http://localhost:3000` (or configured PORT)

### Testing Commands
- `npm start` — runs backend server on PORT (default 3000)
- `npm run dev` — runs with nodemon (auto-reload on file changes)
- Frontend accessible at `http://localhost:3000` after login
- Admin panel accessible at `/admin.html` after login as admin

### Common Operations
- **Add new API endpoint**: Create route file in `routes/`, add middleware/validation, attach in `server.js` line 77-91
- **Add new database table**: Add to `database/schema.sql`, run `setup-db.js` to reinitialize
- **Modify user roles**: Extend `requireAdmin`, `requireStoreOwner` middleware or add custom role checks
- **Frontend form submission**: Call `/api/auth/login` or other endpoint, store token, refresh UI

---

## Project-Specific Patterns

### Cart Management
- Cart lives in `localStorage.serveNowCart` as JSON array of `{id, name, price, quantity}`
- Functions in `js/app.js`: `addToCart()`, `removeFromCart()`, `displayCart()`, `updateCartCount()`
- Cart persists across page reloads but is lost on logout (no per-user persistence in DB)

### Role-Based UI/Navigation
- Frontend HTML files vary by role (admin.html, store.html, rider.html, index.html for customers)
- Redirect logic checks user_type after `/api/auth/profile` call (see `js/admin.js` line 15-29)
- Role redirects: rider → rider.html, store_owner → store.html, customer → index.html, admin → admin.html

### Image & File Handling
- Images served from `/images` and `/uploads` directories (configured in server.js line 38-41)
- Multer middleware available for file upload routes (imported in package.json)
- When adding file upload, attach multer middleware to route

### Mobile App Integration
- Flutter app connects to backend via ApiService (`mobile_app/lib/services/api_service.dart`)
- API base URL: `http://23.137.84.249:3002` (production) with fallback for simulator/local
- App uses Provider package for state management (AuthProvider, CartProvider in `mobile_app/lib/providers/`)
- Mobile uses same `/api/` endpoints as web frontend

---

## Integration Points & Dependencies

### External Services
- **MySQL Database**: Connected via `mysql2/promise`; credentials from `.env`
- **JWT Authentication**: Uses `jsonwebtoken` package (verify with `JWT_SECRET` from `.env`)
- **Password Hashing**: `bcryptjs` with saltRounds=10 (see routes/auth.js line 35)
- **CORS**: Allows all origins in dev mode (line 23 in server.js) — **restrict in production**

### Cross-Component Communication
- Frontend → Backend: HTTP REST calls with JWT in Authorization header
- Backend → Database: Parameterized queries with async/await
- Mobile ↔ Backend: Same REST API as web frontend
- Frontend ↔ LocalStorage: Cart and token persistence

---

## Common Pitfalls & Guidelines

1. **Always parameterize database queries** — use `?` placeholders, never string concatenation
2. **Validate input server-side** — express-validator checks should run before DB operations
3. **Return consistent JSON structure** — all endpoints must have `{success: boolean, ...}` format
4. **Preserve JWT in localStorage** — token survives page reload but is lost on logout (by design)
5. **Use async/await for DB calls** — `await req.db.execute()` avoids callback hell
6. **Role checks happen in middleware** — don't duplicate auth logic in route handlers
7. **Static files served from root** — ensure HTML/CSS/JS files exist at project root or `/css`, `/js` subdirs
8. **Environment variables required** — `.env` must include DB credentials and JWT_SECRET
9. **Order status is immutable sequence** — transitions should validate state machine (pending → confirmed → preparing → ready → out_for_delivery → delivered)
10. **Frontend redirects on auth failure** — if token invalid, redirect to login.html (see js/admin.js line 28)

---

## Useful Reference Files

- **Backend entry**: `server.js` (routes attachment, middleware setup, database connection)
- **Database schema**: `database/schema.sql` (table structure, relationships, sample data)
- **Authentication middleware**: `middleware/auth.js` (JWT verification, role checks)
- **Example route**: `routes/products.js` (validation, DB queries, response formatting)
- **Frontend auth**: `js/app.js` (token management, API calls, localStorage usage)
- **Admin panel**: `js/admin.js` (role-based UI, tab navigation, tabbed data management)
- **Mobile integration**: `mobile_app/lib/services/api_service.dart` (API client pattern)
