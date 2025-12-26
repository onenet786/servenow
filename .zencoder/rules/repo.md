---
description: Repository Information Overview
alwaysApply: true
---

# Repository Information Overview

## Repository Summary
**ServeNow** is a full-stack grocery delivery platform featuring a Node.js/Express backend, a vanilla JavaScript web frontend, and a Flutter mobile application. The system supports multi-tenant roles including customers, store owners, riders, and administrators.

## Repository Structure
- **root**: Contains the Node.js backend server and the static web frontend files (HTML/JS/CSS).
- **mobile_app/**: A Flutter-based mobile application for customers and riders.
- **database/**: SQL schema, migrations, and initialization scripts.
- **routes/**: Backend API endpoint definitions.
- **middleware/**: Custom Express middleware for authentication and validation.
- **js/** & **css/**: Frontend assets for the web application.

### Main Repository Components
- **Backend API**: RESTful API built with Express, connecting to a MySQL database.
- **Web Frontend**: Vanilla JavaScript application served statically by the backend.
- **Mobile App**: Cross-platform application built with Flutter.

## Projects

### Backend & Web Frontend
**Configuration File**: `package.json`

#### Language & Runtime
**Language**: JavaScript (Node.js)  
**Version**: Node.js 14+  
**Build System**: N/A (Scripts-based)  
**Package Manager**: npm

#### Dependencies
**Main Dependencies**:
- `express`: Web framework
- `mysql2`: MySQL client with promise support
- `jsonwebtoken`: JWT authentication
- `bcryptjs`: Password hashing
- `stripe`: Payment processing integration
- `multer`: File upload handling
- `nodemailer`: Email notifications

**Development Dependencies**:
- `nodemon`: Development server with auto-reload
- `eslint`: JavaScript linting

#### Build & Installation
```bash
# Install dependencies
npm install

# Initialize database (requires MySQL)
node setup-db.js

# Start development server
npm run dev

# Start production server
npm start
```

#### Main Files & Resources
- **Entry Point**: `server.js`
- **Frontend Entry**: `index.html`
- **Database Schema**: `database/schema.sql`
- **Environment Config**: `.env.example`

### Mobile App (servenow)
**Configuration File**: `mobile_app/pubspec.yaml`

#### Language & Runtime
**Language**: Dart (Flutter)  
**Version**: SDK ^3.10.4  
**Build System**: Flutter Build  
**Package Manager**: pub

#### Dependencies
**Main Dependencies**:
- `provider`: State management
- `http`: HTTP requests
- `shared_preferences`: Local storage
- `geolocator` & `geocoding`: Location services
- `flutter_stripe`: Mobile payment processing
- `intl`: Internationalization

#### Build & Installation
```bash
cd mobile_app
# Install dependencies
flutter pub get

# Run application
flutter run
```

#### Testing
**Framework**: flutter_test  
**Test Location**: `mobile_app/test/`  
**Naming Convention**: `*_test.dart`  
**Run Command**:
```bash
cd mobile_app
flutter test
```

#### Main Files & Resources
- **Entry Point**: `mobile_app/lib/main.dart`
- **Assets**: `mobile_app/assets/`
