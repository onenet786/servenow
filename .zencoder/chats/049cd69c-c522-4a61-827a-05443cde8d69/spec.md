# Technical Specification: Mobile App Wallet Feature

---

## Technical Context

**Platform**: Flutter (Dart)
**Target**: Android & iOS
**Primary Dependencies**:
- `provider` - State management (already used)
- `flutter_stripe` - Stripe payment integration (official Stripe package)
- `shared_preferences` - Local storage for wallet data persistence
- `http` - HTTP client for API calls (already used)
- `logger` - Debugging and logging (already used)
- `intl` - Date formatting for transactions

**Backend API**: Node.js/Express with MySQL (routes/wallets.js)
**Authentication**: JWT Bearer tokens (already implemented in mobile app)

---

## Technical Implementation Brief

### Key Decisions

1. **State Management**: Create `WalletProvider` using Provider pattern (consistent with existing `AuthProvider` and `CartProvider`)
   - Manages wallet balance, transactions, transfers, and settings
   - Notifies UI of changes for real-time updates

2. **Stripe Integration**: Use `flutter_stripe` package
   - Initialize Stripe with public key from backend
   - Handle card payments client-side
   - Support both new cards and saved payment methods
   - No Stripe SDK initialization needed (managed by flutter_stripe)

3. **Data Persistence**: Use `SharedPreferences` for:
   - Cached wallet balance (for offline display)
   - Cached transaction history (paginated, cached locally)
   - User preferences (e.g., quick topup amounts)

4. **API Communication**: Extend existing `ApiService` with wallet endpoints
   - All endpoints use Bearer token authentication
   - Follow existing response format: `{success: bool, data: ...}`
   - Implement pagination for transactions and transfers (limit=20, offset)

5. **UI Architecture**: 
   - Single `WalletScreen` (main wallet dashboard)
   - Tabbed navigation for different sections (Balance, Topup, Transfers, History)
   - Reusable components for transaction lists, transfer cards
   - Consistent with existing mobile app design patterns

6. **Error Handling**:
   - Network error detection and offline mode
   - Invalid Stripe token handling
   - Insufficient balance validation
   - User-friendly error messages displayed in snackbars

7. **Performance Optimization**:
   - Cache wallet balance and refresh on demand
   - Paginate transaction history (lazy load)
   - Debounce API calls for filter/search operations
   - Local caching reduces network calls

---

## Source Code Structure

### Files to Create

```
mobile_app/lib/
├── providers/
│   └── wallet_provider.dart          # New: Wallet state management
├── models/
│   ├── wallet_model.dart             # New: Wallet data model
│   ├── transaction_model.dart        # New: Wallet transaction model
│   ├── transfer_model.dart           # New: P2P transfer model
│   └── payment_method_model.dart     # New: Saved payment method model
├── screens/
│   └── wallet_screen.dart            # New: Main wallet screen
├── widgets/
│   ├── wallet_balance_card.dart      # New: Balance display widget
│   ├── transaction_list_item.dart    # New: Transaction list item
│   ├── transfer_card.dart            # New: Transfer display widget
│   ├── topup_form.dart               # New: Topup form widget
│   ├── auto_recharge_settings.dart   # New: Auto-recharge settings widget
│   └── send_money_form.dart          # New: Send money form widget
└── services/
    └── api_service.dart              # Modify: Add wallet API methods
```

### Files to Modify

1. **lib/services/api_service.dart**
   - Add wallet endpoints (balance, topup, transactions, etc.)
   - Add transfer endpoints (send, received, accept, reject)
   - Add payment method endpoints

2. **lib/main.dart**
   - Add `WalletProvider` to MultiProvider list
   - Add `/wallet` route to named routes

3. **lib/screens/home_screen.dart** (optional)
   - Add wallet balance quick view / navigation button

4. **pubspec.yaml**
   - Add `flutter_stripe` dependency
   - Add `intl` dependency for date formatting

---

## Contracts

### Data Models

#### WalletModel
```dart
class WalletModel {
  final int id;
  final int userId;
  final double balance;
  final double totalCredited;
  final double totalSpent;
  final bool autoRechargeEnabled;
  final double autoRechargeAmount;
  final double autoRechargeThreshold;
  final DateTime? lastCreditedAt;
  final DateTime createdAt;
  final DateTime updatedAt;
}
```

#### WalletTransactionModel
```dart
class WalletTransactionModel {
  final int id;
  final int walletId;
  final String type;  // 'credit', 'debit', 'refund', 'transfer'
  final double amount;
  final String description;
  final String? referenceType;  // 'order', 'topup', 'transfer', 'refund'
  final String? referenceId;
  final double balanceAfter;
  final DateTime createdAt;
}
```

#### WalletTransferModel
```dart
class WalletTransferModel {
  final int id;
  final int senderId;
  final int recipientId;
  final double amount;
  final String description;
  final String status;  // 'pending', 'completed', 'rejected', 'cancelled'
  final String? senderEmail;
  final String? senderName;
  final String? recipientEmail;
  final String? recipientName;
  final String? rejectionReason;
  final DateTime? completedAt;
  final DateTime createdAt;
  final DateTime updatedAt;
}
```

#### PaymentMethodModel
```dart
class PaymentMethodModel {
  final int id;
  final String type;  // 'card', 'paypal'
  final String? cardLastFour;
  final String? cardBrand;
  final int? cardExpiryMonth;
  final int? cardExpiryYear;
  final bool isPrimary;
  final bool isActive;
  final DateTime createdAt;
}
```

### API Endpoints

#### Wallet Balance & Transactions
- **GET** `/api/wallet/balance` - Get wallet balance and stats
- **POST** `/api/wallet/topup` - Top-up wallet with card payment
- **GET** `/api/wallet/transactions` - Get transaction history (paginated)
- **POST** `/api/wallet/auto-recharge` - Configure auto-recharge settings
- **GET** `/api/wallet/auto-recharge` - Get auto-recharge settings

#### Payment Methods
- **GET** `/api/wallet/payment-methods` - List saved payment methods
- **PUT** `/api/wallet/payment-methods/:id/primary` - Set primary payment method
- **DELETE** `/api/wallet/payment-methods/:id` - Delete saved payment method

#### P2P Transfers
- **POST** `/api/wallet/transfers/send` - Send money to another user
- **GET** `/api/wallet/transfers/sent` - Get sent transfers (paginated)
- **GET** `/api/wallet/transfers/received` - Get received transfers (paginated)
- **POST** `/api/wallet/transfers/:id/accept` - Accept transfer request
- **POST** `/api/wallet/transfers/:id/reject` - Reject transfer request
- **POST** `/api/wallet/transfers/:id/cancel` - Cancel pending transfer (sender only)

### WalletProvider Interface

```dart
class WalletProvider extends ChangeNotifier {
  // State
  WalletModel? get wallet;
  List<WalletTransactionModel> get transactions;
  List<WalletTransferModel> get sentTransfers;
  List<WalletTransferModel> get receivedTransfers;
  List<PaymentMethodModel> get paymentMethods;
  bool get isLoading;
  String? get error;
  
  // Wallet Operations
  Future<void> loadWalletBalance();
  Future<void> topupWallet(double amount, String paymentMethodId, {bool saveCard = false});
  
  // Transactions
  Future<void> loadTransactions({int limit = 20, int offset = 0, String? type});
  void filterTransactions(String type);
  
  // Auto-Recharge
  Future<void> loadAutoRechargeSettings();
  Future<void> saveAutoRechargeSettings(bool enabled, double amount, double threshold);
  
  // Payment Methods
  Future<void> loadPaymentMethods();
  Future<void> setPrimaryPaymentMethod(int id);
  Future<void> deletePaymentMethod(int id);
  
  // P2P Transfers
  Future<void> sendMoney(int recipientId, double amount, String description);
  Future<void> sendMoneyByEmail(String email, double amount, String description);
  Future<void> loadSentTransfers({int limit = 20, int offset = 0});
  Future<void> loadReceivedTransfers({int limit = 20, int offset = 0});
  Future<void> acceptTransfer(int transferId);
  Future<void> rejectTransfer(int transferId, {String? reason});
  Future<void> cancelTransfer(int transferId);
  
  // Utilities
  void clearError();
  void refreshWallet();
}
```

---

## Delivery Phases

### Phase 1: Foundation & Wallet Balance (MVP)
**Duration**: 2-3 days
**Deliverable**: Basic wallet display with balance and topup functionality

**What's Included**:
- Create data models (WalletModel, WalletTransactionModel)
- Create WalletProvider with state management
- Extend ApiService with wallet endpoints
- Create WalletScreen UI (Balance display, Topup form)
- Integrate Stripe for card payment
- Add WalletScreen to navigation

**Testing**:
- View wallet balance
- Topup with card payment
- Error handling for failed payments
- Offline mode handling

**Acceptance Criteria**:
- Wallet balance displays correctly
- Topup form accepts card and amount
- Stripe integration processes payment
- Balance updates after successful topup
- Error messages shown for failed topups

---

### Phase 2: Transaction History & Auto-Recharge
**Duration**: 2 days
**Deliverable**: Transaction history with filtering and auto-recharge settings

**What's Included**:
- Add transaction loading to WalletProvider
- Create transaction list UI component
- Implement transaction filtering by type
- Add pagination for transaction history (load more)
- Create auto-recharge settings UI
- Implement auto-recharge configuration API calls

**Testing**:
- Load and display 20 transactions
- Filter transactions by type (credit/debit/refund)
- Load more transactions (pagination)
- Enable/disable auto-recharge
- Set threshold and amount
- Validate form inputs

**Acceptance Criteria**:
- Transaction history displays with correct data
- Filtering works for all transaction types
- Pagination loads additional transactions
- Auto-recharge settings can be configured
- Settings persist on server

---

### Phase 3: Payment Methods Management
**Duration**: 1-2 days
**Deliverable**: Save and manage payment cards

**What's Included**:
- Add PaymentMethodModel data model
- Create payment methods UI section
- Implement save card during topup
- Load and display saved cards
- Set primary payment method
- Delete saved cards
- Use saved cards for quick topup

**Testing**:
- Save card during topup with checkbox
- List saved cards with details
- Set card as primary
- Delete card from list
- Use saved card for topup (simplified flow)

**Acceptance Criteria**:
- Cards can be saved during topup
- Saved cards display correctly
- Primary card can be set
- Cards can be deleted
- Quick topup with saved card works

---

### Phase 4: P2P Transfers (Send Money)
**Duration**: 2-3 days
**Deliverable**: Send money to other users with recipient lookup

**What's Included**:
- Create WalletTransferModel data model
- Create "Send Money" tab in WalletScreen
- Implement send by User ID
- Implement send by email/phone
- Add recipient lookup/search
- Display sent transfers with status
- Handle transfer validation (balance, user exists)
- Implement transfer cancellation (pending only)

**Testing**:
- Send money by User ID
- Send money by email
- Handle invalid recipient
- Handle insufficient balance
- View sent transfers list
- Cancel pending transfer
- Error handling for network failures

**Acceptance Criteria**:
- Transfer can be sent with User ID
- Transfer can be sent with email
- Transfer creation returns pending status
- Sent transfers list displays correctly
- Pending transfers can be cancelled
- Balance validated before transfer

---

### Phase 5: P2P Transfers (Receive & Accept/Reject)
**Duration**: 1-2 days
**Deliverable**: Receive and manage incoming transfer requests

**What's Included**:
- Create "Received Transfers" tab in WalletScreen
- Load received transfers with pending status
- Implement transfer acceptance flow
- Implement transfer rejection flow
- Add rejection reason input
- Display balance updates after acceptance
- Handle insufficient sender balance on accept

**Testing**:
- Load pending received transfers
- Accept transfer request
- Reject transfer with reason
- Balance updates correctly after accept
- Sender balance restored on reject
- Status changes reflected in UI

**Acceptance Criteria**:
- Received transfers display with correct status
- Transfer can be accepted
- Transfer can be rejected with reason
- Recipient balance updates on accept
- Sender balance updated appropriately

---

### Phase 6: Polish, Testing & Documentation
**Duration**: 1-2 days
**Deliverable**: Complete feature with tests and documentation

**What's Included**:
- Unit tests for WalletProvider
- Integration tests for API calls
- Widget tests for UI components
- Error handling edge cases
- Performance optimization
- Code documentation
- User-facing help text/tooltips

**Testing**:
- Run all unit/widget/integration tests
- Test on Android & iOS devices
- Test network failure scenarios
- Test low balance scenarios
- Test concurrent operations

**Acceptance Criteria**:
- 80%+ code coverage
- All tests pass
- No lint errors
- Performance benchmarks met
- Responsive on all screen sizes

---

## Verification Strategy

### Testing Approach

#### Unit Tests (WalletProvider)
- Test state management (balance updates, transaction list updates)
- Test balance calculations
- Test transfer validation logic
- Test local caching/persistence

**Run with**: `flutter test`

#### Widget Tests
- Test wallet balance display
- Test topup form validation
- Test transaction list rendering
- Test transfer UI interactions

**Run with**: `flutter test`

#### Integration Tests
- Test complete topup flow (form → Stripe → server)
- Test transaction history loading
- Test transfer send/accept/reject flow
- Test API error handling

**Run with**: `flutter drive --target=test_driver/integration_test.dart`

#### Manual Testing Checklist
```
[ ] Wallet balance displays correctly
[ ] Topup works with valid card
[ ] Topup fails gracefully with invalid card
[ ] Transaction history loads and filters
[ ] Auto-recharge can be configured
[ ] Payment methods can be saved/deleted
[ ] Send money by User ID works
[ ] Send money by email works
[ ] Accept/reject transfers work
[ ] Offline mode shows cached data
[ ] Token refresh works if needed
[ ] All error messages are user-friendly
[ ] UI is responsive on mobile screens
```

### Helper Scripts & Artifacts

#### Test Data Fixtures
- Mock wallet response
- Mock transaction history
- Mock transfer requests
- Test Stripe token for development

**Location**: `mobile_app/test/fixtures/`

#### API Mocking (test_helpers)
- Mock ApiService for unit tests
- Mock Stripe payment responses

**Location**: `mobile_app/test/helpers/`

#### Performance Benchmarks
- Wallet balance load: < 2 seconds
- Transaction list load: < 3 seconds
- Topup process: < 5 seconds (including Stripe)

### MCP Servers (if needed)
- None required for basic testing
- Use standard Flutter testing tools

### Verification Commands

```bash
# Run all tests
flutter test

# Run with coverage
flutter test --coverage

# Lint code
flutter analyze

# Format code
dart format .

# Run app in debug mode
flutter run

# Test on specific device
flutter run -d <device_id>
```

---
