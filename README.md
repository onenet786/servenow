## 🚀 Quick Start

### Prerequisites
- Node.js 14+
- MySQL 5.7+ (or MariaDB)
- npm or yarn

### Installation

1. **Clone and setup**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your database credentials
   ```

3. **Initialize database**:
   ```bash
   node setup-db.js
   ```

4. **Start server**:
   ```bash
   npm run dev      # Development with auto-reload
   npm start        # Production
   ```

5. **Access the application**:
   - Open http://localhost:3002 in your browser
   - Login with default admin credentials (see Security section)

### Environment Variables

Key variables in `.env`:
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` - Database connection
- `JWT_SECRET` - **MUST change in production**
- `PORT` - Server port (default: 3002)
- `NODE_ENV` - Set to 'production' for production deployment
- `ALLOWED_ORIGINS` - Comma-separated CORS origins (production only)

---

## 🎯 Admin Dashboard Features

The admin dashboard provides comprehensive management capabilities:

### User Management
- **Add Users**: Create new customers, store owners, or admins
- **Edit Users**: Change user types (customer/store_owner/admin)
- **Activate/Deactivate**: Enable or disable user accounts
- **View All Users**: Complete user list with status indicators

### Store Management
- **Add Stores**: Create new stores with location and contact details
- **Edit Stores**: Modify store information (name, location, etc.)
- **Activate/Deactivate**: Enable or disable stores
- **View Store Owners**: See which users own which stores

### Product Management
- **Add Products**: Create products with pricing, categories, and stock
- **Edit Products**: Modify product details (price, stock, etc.)
- **Activate/Deactivate**: Enable or disable products
- **Category Assignment**: Link products to categories and stores

### Category Management
- **Add Categories**: Create product categories
- **Edit Categories**: Modify category names and descriptions
- **Activate/Deactivate**: Enable or disable categories

### Order Management
- **View All Orders**: See all customer orders across all stores
- **Update Status**: Change order status (pending → confirmed → preparing → ready → delivered)
- **Order Details**: View customer info, store details, and order items

### Dashboard Overview
- **Statistics**: Total users, stores, products, and orders
- **Real-time Updates**: Data refreshes when changes are made
- **Tabbed Interface**: Easy navigation between different management sections

## 🔐 Security Features

- **JWT Authentication**: Secure token-based authentication
- **Role-Based Access**: Different permissions for different user types
- **Protected Routes**: All admin operations require proper authentication
- **Input Validation**: Server-side validation for all data inputs
- **Security Headers**: CSRF protection, XSS prevention, clickjacking protection
- **CORS Protection**: Environment-aware CORS configuration
- **Database Connection Pooling**: Improved performance and resource management

### Default Admin Credentials (⚠️ Change immediately in production)
- **Email:** admin@servenow.com
- **Password:** admin123

## 🎯 User Roles

### Customer
- Browse stores and products
- Add to cart and checkout
- View order history

### Store Owner
- Manage their own stores
- Add/edit products
- Update order status

### Admin
- Full system access
- Manage all users, stores, products
- Access to all orders and analytics

## 📚 API Endpoints

### Authentication
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `GET /api/auth/profile` - Get user profile

### Stores & Products
- `GET /api/stores` - Get all stores
- `GET /api/products` - Get products (with filters)
- `POST /api/products` - Create product (Store Owner/Admin)
- `PUT /api/products/:id` - Update product
- `DELETE /api/products/:id` - Delete product

### Orders
- `POST /api/orders` - Create order
- `GET /api/orders/my-orders` - Get user's orders
- `PUT /api/orders/:id/status` - Update order status

### Admin Only
- `GET /api/users` - Manage users
- `POST /api/stores` - Create stores
- `GET /api/orders` - View all orders

## 🌐 Access Points

- **Website:** http://localhost:3002
- **Admin Dashboard:** Login as admin → /admin.html

## 📄 Database Schema

Includes tables for: users, stores, products, categories, orders, order_items

## 🔧 Development

- `npm start` - Production server
- `npm run dev` - Development with nodemon

## 📄 License

Educational and demonstration purposes.
