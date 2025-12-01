# ServeNow Mobile App

A Flutter mobile application for the ServeNow grocery delivery platform.

## Features

- **Authentication**: Login and registration for customers
- **Product Browsing**: Browse products by categories
- **Shopping Cart**: Add/remove items, update quantities
- **Checkout**: Place orders with delivery address and payment options
- **Order Tracking**: View order history and status
- **Profile Management**: View and manage user profile

## Setup Instructions

### Prerequisites

1. **Flutter SDK**: Install Flutter from [flutter.dev](https://flutter.dev)
2. **Android Studio** or **VS Code** with Flutter extensions
3. **Android/iOS emulator** or physical device

### Installation

1. Navigate to the mobile app directory:
   ```bash
   cd mobile_app
   ```

2. Install dependencies:
   ```bash
   flutter pub get
   ```

3. Ensure the backend server is running on `http://10.0.2.2:3002` (Android emulator) or `http://localhost:3002` (iOS simulator)

### Running the App

1. **For Android Emulator**:
   ```bash
   flutter run
   ```

2. **For iOS Simulator** (macOS only):
   ```bash
   flutter run
   ```

3. **For Physical Device**:
   - Connect your device
   - Enable USB debugging (Android)
   - Run `flutter run`

## Backend Configuration

The app is configured to connect to the ServeNow backend API. Update the base URL in `lib/services/api_service.dart` if needed:

```dart
static const String baseUrl = 'http://10.0.2.2:3002'; // Android emulator
// For iOS simulator: 'http://localhost:3002'
// For physical device: 'http://YOUR_LOCAL_IP:3002'
```

## Demo Credentials

- **Email**: admin@servenow.com
- **Password**: admin123

## App Structure

```
lib/
├── main.dart              # App entry point
├── models/                # Data models
│   ├── user.dart
│   ├── product.dart
│   └── cart_item.dart
├── providers/             # State management
│   ├── auth_provider.dart
│   └── cart_provider.dart
├── screens/               # UI screens
│   ├── splash_screen.dart
│   ├── login_screen.dart
│   ├── home_screen.dart
│   ├── cart_screen.dart
│   ├── checkout_screen.dart
│   ├── orders_screen.dart
│   └── profile_screen.dart
├── services/              # API services
│   └── api_service.dart
└── widgets/               # Reusable widgets
    ├── product_card.dart
    ├── category_card.dart
    └── cart_badge.dart
```

## Key Features Implementation

### Authentication
- JWT-based authentication
- Persistent login state using SharedPreferences
- Registration with validation

### Product Management
- Category-based product filtering
- Real-time cart updates
- Product search and browsing

### Cart & Checkout
- Add/remove/update cart items
- Order placement with delivery details
- Multiple payment options

### Order Management
- Order history viewing
- Order status tracking
- Real-time updates

## API Integration

The app integrates with the ServeNow backend API endpoints:

- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration
- `GET /api/products` - Fetch products
- `POST /api/orders` - Place orders
- `GET /api/orders` - Get user orders
- `GET /api/categories` - Get categories

## Troubleshooting

### Common Issues

1. **Network Connection Issues**:
   - Ensure backend server is running
   - Check API base URL configuration
   - For physical devices, use your computer's local IP address

2. **Build Issues**:
   - Run `flutter clean` then `flutter pub get`
   - Check Flutter and Dart versions

3. **Emulator Issues**:
   - Ensure emulator is properly configured
   - Check Android SDK installation

### Debug Mode

To enable debug logging, add this to your `main.dart`:

```dart
import 'package:flutter/foundation.dart';

void main() {
  // Enable debug logging
  debugPrint = (String? message, {int? wrapWidth}) {
    // Your custom debug print logic
  };
  // ... rest of main()
}
```

## Contributing

1. Follow Flutter best practices
2. Use Provider for state management
3. Maintain consistent code style
4. Test on both Android and iOS

## License

This project is part of the ServeNow platform.
