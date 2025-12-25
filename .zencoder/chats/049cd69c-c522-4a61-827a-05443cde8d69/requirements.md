# Feature Specification: Mobile App Wallet Feature Parity

---

## User Stories

### User Story 1 - View Wallet Balance & Statistics
**As a** customer
**I want to** view my wallet balance, total credited, total spent, and transaction count
**So that** I can manage my account balance and track spending

**Acceptance Scenarios**:
1. **Given** I'm logged in as a customer, **When** I navigate to the wallet screen, **Then** I should see my current balance, total amount credited, total amount spent, and transaction count
2. **Given** I'm on the wallet screen, **When** my wallet is updated (after topup/spending), **Then** the balance should refresh automatically

---

### User Story 2 - Top-up Wallet with Card Payment
**As a** customer
**I want to** add money to my wallet using a credit/debit card
**So that** I can use wallet balance for purchases

**Acceptance Scenarios**:
1. **Given** I'm on the wallet screen, **When** I enter an amount and select card as payment method, **Then** I should be able to enter card details
2. **Given** I've entered valid card details, **When** I confirm the payment, **Then** the amount should be credited to my wallet and a transaction record created
3. **Given** I complete a topup, **When** the transaction succeeds, **Then** I should see a success message and the wallet balance should update

---

### User Story 3 - View Transaction History
**As a** customer
**I want to** see a history of all my wallet transactions (credits, debits, refunds)
**So that** I can track my wallet activity

**Acceptance Scenarios**:
1. **Given** I'm on the wallet screen, **When** I scroll to the transactions section, **Then** I should see a list of all transactions with date, type, amount, and description
2. **Given** I have multiple transactions, **When** I filter by transaction type (credit/debit/refund/transfer), **Then** only matching transactions should be displayed
3. **Given** I'm viewing transactions, **When** they're fetched from the server, **Then** they should be paginated (20 per page) with load-more capability

---

### User Story 4 - Configure Auto-Recharge Settings
**As a** customer
**I want to** enable automatic wallet recharge when balance drops below a threshold
**So that** I don't run out of balance for purchases

**Acceptance Scenarios**:
1. **Given** I'm on the wallet settings section, **When** I enable auto-recharge, **Then** I should be required to set a threshold amount and recharge amount
2. **Given** auto-recharge is enabled, **When** I save the settings, **Then** they should be persisted on the server
3. **Given** auto-recharge is disabled, **When** I toggle it off, **Then** the settings should be saved and auto-recharge disabled

---

### User Story 5 - Manage Saved Payment Methods
**As a** customer
**I want to** save and manage my payment cards
**So that** I don't need to enter card details for every transaction

**Acceptance Scenarios**:
1. **Given** I complete a card payment, **When** I check "Save this card", **Then** the card should be saved for future use
2. **Given** I have saved cards, **When** I'm on the payment methods section, **Then** I should see a list of all saved cards with last 4 digits and brand
3. **Given** I have multiple saved cards, **When** I set one as primary, **Then** it should be marked and used by default
4. **Given** I no longer want a saved card, **When** I delete it, **Then** it should be removed from my saved methods list

---

### User Story 6 - Send Money to Another User
**As a** customer
**I want to** transfer wallet money to another user
**So that** I can pay friends or colleagues directly

**Acceptance Scenarios**:
1. **Given** I'm on the "Send Money" tab, **When** I enter a recipient (by User ID or email/phone), **Then** the system should validate the recipient exists
2. **Given** I enter a valid recipient and amount, **When** I submit the transfer, **Then** a transfer request should be created with "pending" status
3. **Given** my transfer is created, **When** the recipient accepts it, **Then** the funds should be transferred and balance updated

---

### User Story 7 - Receive & Accept/Reject Money Transfers
**As a** customer
**I want to** see pending money transfers from others and accept or reject them
**So that** I can control incoming transfers

**Acceptance Scenarios**:
1. **Given** someone sends me money, **When** I'm on the "Received Transfers" tab, **Then** I should see pending transfer requests with sender info, amount, and description
2. **Given** I receive a transfer, **When** I accept it, **Then** the funds should be credited to my wallet and status updated to "completed"
3. **Given** I don't want a transfer, **When** I reject it, **Then** the status should change to "rejected" and funds stay with sender

---

### User Story 8 - View Sent & Received Transfers History
**As a** customer
**I want to** view history of all money transfers I've sent and received
**So that** I can track P2P transactions

**Acceptance Scenarios**:
1. **Given** I navigate to the "Sent Transfers" tab, **When** page loads, **Then** I should see list of all transfers I sent with status
2. **Given** I navigate to the "Received Transfers" tab, **When** page loads, **Then** I should see list of transfers I received with status

---

## Requirements

### Functional Requirements

#### Core Wallet Features
- **FR1**: Display current wallet balance with auto-refresh capability
- **FR2**: Display wallet statistics (total credited, total spent, transaction count)
- **FR3**: Support wallet topup with Stripe card payment integration
- **FR4**: Maintain transaction history with pagination (20 items per page)
- **FR5**: Filter transaction history by type (credit, debit, refund, transfer)
- **FR6**: Support auto-recharge configuration with threshold and amount settings
- **FR7**: Display auto-recharge current status (enabled/disabled)

#### Payment Methods
- **FR8**: Save payment cards during topup
- **FR9**: Display list of saved payment methods with card details (last 4 digits, brand, expiry)
- **FR10**: Set primary payment method for auto-recharge
- **FR11**: Delete saved payment methods

#### P2P Transfers
- **FR12**: Support sending money to another user by User ID
- **FR13**: Support sending money to another user by email/phone
- **FR14**: Create transfer with description
- **FR15**: Display list of sent transfers with status
- **FR16**: Display list of pending received transfers
- **FR17**: Accept received transfer requests
- **FR18**: Reject received transfer requests
- **FR19**: Display transfer history with timestamps and amounts

---

### Non-Functional Requirements

#### Performance
- **NFR1**: Wallet balance should update within 2 seconds after transaction
- **NFR2**: Transaction history should load within 3 seconds
- **NFR3**: Stripe card element should render within 2 seconds

#### Security
- **NFR4**: All API calls must include JWT authentication token
- **NFR5**: Card details must be handled by Stripe (PCI compliance)
- **NFR6**: Sensitive data (card tokens, transfer details) must be transmitted over HTTPS
- **NFR7**: Auto-recharge settings must be verified before saving
- **NFR8**: Users can only view/modify their own wallet

#### Usability
- **NFR9**: Wallet screen must be responsive on mobile devices
- **NFR10**: Quick amount buttons for common topup amounts (500, 1000, 2000, 5000 PKR)
- **NFR11**: Clear error messages for failed transactions
- **NFR12**: Success confirmations after each operation
- **NFR13**: Loading indicators during API calls

#### Data Validation
- **NFR14**: Amount fields must accept only positive decimal values
- **NFR15**: Email validation for P2P transfer recipients
- **NFR16**: User ID validation for P2P transfer recipients
- **NFR17**: Threshold amount must be less than recharge amount

---

## Success Criteria

### Completion Criteria
1. **All API endpoints** from web app wallet are integrated in mobile app
2. **Stripe integration** is working for card payments
3. **Transaction history** is displaying correctly with pagination and filtering
4. **Auto-recharge settings** can be configured and persist
5. **P2P transfers** work with both User ID and email/phone recipients
6. **Saved payment methods** are displayed and manageable
7. **All screens** are responsive and work on various screen sizes
8. **Error handling** provides user-friendly messages
9. **Token refresh** works if wallet requires re-authentication
10. **Unit and integration tests** cover critical wallet flows

### Test Cases
- Successful wallet topup with card payment
- Failed payment handling
- Transaction history pagination and filtering
- Auto-recharge configuration
- P2P transfer with User ID recipient
- P2P transfer with email recipient
- Accepting/rejecting transfer requests
- Saved payment method management
- Edge cases (zero balance, invalid amounts, network errors)

### Acceptance Criteria
- Feature is at feature parity with web app wallet
- All user stories are implemented
- Mobile wallet uses consistent API endpoints with web app
- UI is intuitive and matches app's design language
- Performance metrics are met
- Security requirements are satisfied

---
