# Feature Specification: Mobile App Optimization, Wallet Hiding, and Professional Splash Screen

## User Stories

### User Story 1 - Temporary Wallet Feature Hiding
**As a** user of the ServeNow app,  
**I want** the wallet feature to be temporarily hidden because it has known issues,  
**So that** I can use the app without encountering problems with wallet functionality.

**Acceptance Scenarios**:
1. **Given** a user is on the home screen, **When** they view the app bar, **Then** the wallet icon should not be visible.
2. **Given** a user tries to navigate directly to `/wallet` route, **When** they attempt access, **Then** they should be redirected to the home screen.
3. **Given** any user profile or account screen, **When** they look for wallet options, **Then** no wallet-related UI elements should be displayed.

---

### User Story 2 - Professional Splash Screen with Green/Fresh Theme
**As a** new user installing ServeNow,  
**I want** to see a professional, branded splash screen with animated logo,  
**So that** I have a smooth and polished onboarding experience.

**Acceptance Scenarios**:
1. **Given** the app is launched, **When** the AuthWrapper is initializing, **Then** a splash screen should display with ServeNow logo and animated branding.
2. **Given** the app is checking authentication, **When** authentication check is in progress, **Then** a loading indicator should appear below the logo.
3. **Given** the splash screen is displayed, **When** authentication check completes, **Then** the app should smoothly navigate to the appropriate screen (admin, rider, or home).
4. **Given** the splash screen design, **When** viewed, **Then** it should use green color scheme reflecting a fresh, grocery-themed brand identity.

---

### User Story 3 - Mobile App Performance and Code Quality Optimization
**As a** developer maintaining ServeNow,  
**I want** the mobile app to have optimized performance and better code quality,  
**So that** the app runs faster and is easier to maintain.

**Acceptance Scenarios**:
1. **Given** the app is launched, **When** initial load occurs, **Then** the app should load noticeably faster.
2. **Given** the codebase, **When** reviewed, **Then** unused imports and dead code should be removed.
3. **Given** the screens and providers, **When** analyzed, **Then** widget rebuilds should be minimized where possible.
4. **Given** the UI elements, **When** viewed, **Then** the design should be visually consistent and follow Material Design principles better.

---

## Requirements

### Functional Requirements
1. **Wallet Hiding**
   - Remove wallet icon from home screen AppBar
   - Remove `/wallet` route from routing table or redirect to home
   - Hide WalletProvider usage from UI completely
   - Keep wallet provider in codebase for future fixes (don't delete)

2. **Splash Screen**
   - Create a new dedicated SplashScreen widget to replace AuthWrapper's loading indicator
   - Display ServeNow logo/app icon at center
   - Implement smooth fade-in and scale animation for logo (500-800ms duration)
   - Display app name "ServeNow" with animated text below logo
   - Show a circular loading indicator during authentication check (appears after 0.5s, if auth check is still ongoing)
   - Use green color scheme (#2ECC71 or similar fresh green for primary, #27AE60 for darker accent)
   - Smooth navigation transition when authentication completes

3. **Performance Optimization**
   - Remove unused imports across all screen files
   - Optimize image loading and caching
   - Implement const constructors where possible
   - Reduce unnecessary widget rebuilds using Consumer/Selector from provider
   - Lazy load data where appropriate

4. **Code Quality Improvement**
   - Follow consistent naming conventions
   - Improve code structure and organization
   - Remove dead code and unused variables
   - Add proper null safety checks
   - Ensure consistent error handling patterns

---

## Success Criteria

1. **Wallet Feature**
   - ✅ Wallet icon completely removed from home screen
   - ✅ `/wallet` route inaccessible or redirects
   - ✅ No wallet UI visible in user-facing screens
   - ✅ App functions normally without wallet feature

2. **Splash Screen**
   - ✅ Professional looking, branded splash screen displays on app launch
   - ✅ Logo animates smoothly (fade-in + scale effect)
   - ✅ Loading indicator shows during auth check
   - ✅ App transitions smoothly to home/admin/rider screen after auth completes
   - ✅ Splash uses green color scheme consistent with grocery/delivery theme

3. **Optimization**
   - ✅ No unused imports or dead code
   - ✅ App performance improved (startup time reduced)
   - ✅ Code follows Flutter/Dart best practices
   - ✅ Consistent Material Design patterns throughout
   - ✅ No linting errors reported by `flutter analyze`

