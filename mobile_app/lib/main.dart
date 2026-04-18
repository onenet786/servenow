import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import 'providers/auth_provider.dart';
import 'providers/cart_provider.dart';
import 'providers/wallet_provider.dart';
import 'providers/notification_provider.dart';
import 'services/api_service.dart';
import 'screens/login_screen.dart';
import 'screens/register_screen.dart';
import 'screens/home_screen.dart';
import 'screens/admin_dashboard_screen.dart';
import 'screens/rider_dashboard_screen.dart';
import 'screens/store_owner_dashboard_screen.dart';
import 'screens/cart_screen.dart';
import 'screens/checkout_screen.dart';
import 'screens/inventory_report_screen.dart';
import 'screens/manage_stores_screen.dart';
import 'screens/manage_products_screen.dart';
import 'screens/manage_users_screen.dart';
import 'screens/manage_riders_screen.dart';
import 'screens/orders_screen.dart';
import 'screens/splash_screen.dart';
import 'screens/store_balances_screen.dart';
import 'screens/change_password_screen.dart';
import 'screens/forgot_password_screen.dart';
import 'screens/ui_test_home_screen.dart';
import 'screens/customer_dashboard_test_screen.dart';
import 'screens/customer_tile_demo_screen.dart';
import 'theme/customer_palette.dart';
import 'services/notifier.dart';

final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();
final FlutterLocalNotificationsPlugin _backgroundLocalNotifications =
    FlutterLocalNotificationsPlugin();
bool _backgroundNotificationsInitialized = false;

Future<void> _ensureBackgroundNotificationsReady() async {
  if (_backgroundNotificationsInitialized || kIsWeb) return;

  const settings = InitializationSettings(
    android: AndroidInitializationSettings('@mipmap/ic_launcher'),
    iOS: DarwinInitializationSettings(),
  );

  await _backgroundLocalNotifications.initialize(settings);
  await _backgroundLocalNotifications
      .resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin
      >()
      ?.createNotificationChannel(
        const AndroidNotificationChannel(
          NotificationProvider.androidChannelId,
          NotificationProvider.androidChannelName,
          description: NotificationProvider.androidChannelDescription,
          importance: Importance.max,
        ),
      );

  _backgroundNotificationsInitialized = true;
}

@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  try {
    await Firebase.initializeApp();
    await _ensureBackgroundNotificationsReady();

    if (message.notification != null) {
      return;
    }

    final title =
        message.data['title']?.toString().trim().isNotEmpty == true
            ? message.data['title']!.toString().trim()
            : 'ServeNow Notification';
    final body = message.data['message']?.toString().trim() ?? '';
    if (body.isEmpty) return;

    const notificationDetails = NotificationDetails(
      android: AndroidNotificationDetails(
        NotificationProvider.androidChannelId,
        NotificationProvider.androidChannelName,
        channelDescription: NotificationProvider.androidChannelDescription,
        importance: Importance.max,
        priority: Priority.high,
        icon: '@mipmap/ic_launcher',
      ),
      iOS: DarwinNotificationDetails(),
    );

    await _backgroundLocalNotifications.show(
      message.messageId?.hashCode ?? DateTime.now().millisecondsSinceEpoch,
      title,
      body,
      notificationDetails,
    );
  } catch (_) {}
}

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (!kIsWeb) {
    try {
      await Firebase.initializeApp();
      await _ensureBackgroundNotificationsReady();
      FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);
    } catch (_) {}
  }
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    final baseScheme = ColorScheme.fromSeed(
      seedColor: CustomerPalette.primary,
      brightness: Brightness.light,
    ).copyWith(
      primary: CustomerPalette.primary,
      secondary: CustomerPalette.accent,
      surface: CustomerPalette.card,
      onPrimary: Colors.white,
      onSecondary: CustomerPalette.textDark,
      onSurface: CustomerPalette.textDark,
    );

    return MultiProvider(
      providers: [
        ChangeNotifierProvider(create: (_) => AuthProvider()),
        ChangeNotifierProvider(create: (_) => CartProvider()),
        ChangeNotifierProvider(create: (_) => WalletProvider()),
        ChangeNotifierProxyProvider<AuthProvider, NotificationProvider>(
          create: (_) => NotificationProvider(navigatorKey),
          update: (_, auth, previous) =>
              (previous ?? NotificationProvider(navigatorKey))..update(auth),
        ),
      ],
      child: MaterialApp(
        navigatorKey: navigatorKey,
        title: 'ServeNow',
        debugShowCheckedModeBanner: false,
        builder: (context, child) {
          return SafeArea(
            top: false,
            left: false,
            right: false,
            bottom: true,
            child: _SessionGuard(
              child: _AppUpdateOverlay(
                child: Stack(
                  children: [
                    if (child != null) child,
                    const Positioned(
                      right: 6,
                      bottom: 4,
                      child: _VersionBadge(),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
        theme: ThemeData(
          colorScheme: baseScheme,
          fontFamily: 'Roboto',
          scaffoldBackgroundColor: CustomerPalette.background,
          useMaterial3: true,
          appBarTheme: const AppBarTheme(
            backgroundColor: CustomerPalette.primary,
            foregroundColor: Colors.white,
            elevation: 0,
            centerTitle: false,
          ),
          cardTheme: CardThemeData(
            color: CustomerPalette.card,
            elevation: 1,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14),
            ),
          ),
          elevatedButtonTheme: ElevatedButtonThemeData(
            style: ElevatedButton.styleFrom(
              backgroundColor: CustomerPalette.primary,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          filledButtonTheme: FilledButtonThemeData(
            style: FilledButton.styleFrom(
              backgroundColor: CustomerPalette.primary,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          inputDecorationTheme: InputDecorationTheme(
            filled: true,
            fillColor: Colors.white,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 14,
              vertical: 12,
            ),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: Colors.orange.shade200),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: BorderSide(color: Colors.orange.shade200),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(
                color: CustomerPalette.primary,
                width: 1.4,
              ),
            ),
          ),
          chipTheme: ChipThemeData(
            backgroundColor: Colors.white,
            selectedColor: CustomerPalette.primaryDark,
            secondarySelectedColor: CustomerPalette.primaryDark,
            side: BorderSide(color: Colors.orange.shade200),
            labelStyle: const TextStyle(
              color: CustomerPalette.textDark,
              fontWeight: FontWeight.w600,
            ),
            secondaryLabelStyle: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w700,
            ),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
          ),
          bottomNavigationBarTheme: BottomNavigationBarThemeData(
            backgroundColor: Colors.white,
            selectedItemColor: CustomerPalette.primaryDark,
            unselectedItemColor: Colors.brown.shade300,
            selectedLabelStyle: const TextStyle(fontWeight: FontWeight.w700),
            unselectedLabelStyle: const TextStyle(fontWeight: FontWeight.w500),
            type: BottomNavigationBarType.fixed,
          ),
          dialogTheme: DialogThemeData(
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
            ),
          ),
          snackBarTheme: const SnackBarThemeData(
            behavior: SnackBarBehavior.floating,
            elevation: 2,
            showCloseIcon: true,
            backgroundColor: CustomerPalette.primaryDark,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.all(Radius.circular(12)),
            ),
            contentTextStyle: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        home: const AuthWrapper(),
        routes: {
          '/login': (context) => const LoginScreen(),
          '/register': (context) => const RegisterScreen(),
          '/home': (context) => const CustomerDashboardTestScreen(),
          '/admin': (context) => const AdminDashboardScreen(),
          '/store-balances': (context) => const StoreBalancesScreen(),
          '/rider': (context) => const RiderDashboardScreen(),
          '/store_owner': (context) => const StoreOwnerDashboardScreen(),
          '/orders': (context) => const OrdersScreen(),
          '/cart': (context) => const CartScreen(),
          '/checkout': (context) => const CheckoutScreen(),
          '/wallet': (context) => const HomeScreen(), // Redirect to home
          '/inventory-report': (context) => const InventoryReportScreen(),
          '/manage-stores': (context) => const ManageStoresScreen(),
          '/manage-products': (context) => const ManageProductsScreen(),
          '/manage-users': (context) => const ManageUsersScreen(),
          '/manage-riders': (context) => const ManageRidersScreen(),
          '/change-password': (context) => const ChangePasswordScreen(),
          '/forgot-password': (context) => const ForgotPasswordScreen(),
          '/ui-test-home': (context) => const UiTestHomeScreen(),
          '/customer-test-dashboard': (context) =>
              const CustomerDashboardTestScreen(),
          '/customer-tile-demo': (context) => const CustomerTileDemoScreen(),
        },
      ),
    );
  }
}

class _VersionBadge extends StatefulWidget {
  const _VersionBadge();

  @override
  State<_VersionBadge> createState() => _VersionBadgeState();
}

class _VersionBadgeState extends State<_VersionBadge> {
  static const String _envTag =
      String.fromEnvironment('APP_VERSION_TAG', defaultValue: '');
  String _tag = _envTag;

  @override
  void initState() {
    super.initState();
    _loadVersionTag();
  }

  Future<void> _loadVersionTag() async {
    try {
      final info = await PackageInfo.fromPlatform();
      final version = info.version.trim();
      final build = info.buildNumber.trim();
      if (!mounted) return;
      if (version.isNotEmpty) {
        setState(() {
          _tag = build.isNotEmpty ? 'v$version+$build' : 'v$version';
        });
      }
    } catch (_) {
      // Keep environment tag fallback if package info is unavailable.
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_tag.trim().isEmpty) return const SizedBox.shrink();
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.05),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(
        _tag,
        style: const TextStyle(
          fontSize: 10,
          color: Colors.black54,
          fontWeight: FontWeight.w500,
        ),
      ),
    );
  }
}

class _SessionGuard extends StatefulWidget {
  final Widget child;

  const _SessionGuard({required this.child});

  @override
  State<_SessionGuard> createState() => _SessionGuardState();
}

class _SessionGuardState extends State<_SessionGuard> {
  bool _initialized = false;
  bool _wasAuthenticated = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final auth = Provider.of<AuthProvider>(context);
    final isAuthenticated = auth.isAuthenticated;

    if (!_initialized) {
      _initialized = true;
      _wasAuthenticated = isAuthenticated;
      return;
    }

    if (_wasAuthenticated && !isAuthenticated) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        final currentRoute = ModalRoute.of(context)?.settings.name;
        if (auth.sessionExpired) {
          Notifier.error(
            context,
            'Session expired. Please log in again.',
          );
          auth.clearSessionExpiredFlag();
        }
        if (currentRoute != '/login') {
          Navigator.of(
            context,
          ).pushNamedAndRemoveUntil('/login', (route) => false);
        }
      });
    }

    _wasAuthenticated = isAuthenticated;
  }

  @override
  Widget build(BuildContext context) {
    return widget.child;
  }
}

class _AppUpdateOverlay extends StatefulWidget {
  final Widget child;

  const _AppUpdateOverlay({required this.child});

  @override
  State<_AppUpdateOverlay> createState() => _AppUpdateOverlayState();
}

class _AppUpdateOverlayState extends State<_AppUpdateOverlay>
    with WidgetsBindingObserver {
  Map<String, dynamic>? _appUpdateStatus;
  String? _authToken;
  String? _dismissedVersion;
  bool _dialogOpen = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _refreshUpdateStatusIfNeeded(force: true);
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final token = Provider.of<AuthProvider>(context).token;
    if (token != _authToken) {
      _authToken = token;
      _dismissedVersion = null;
      _refreshUpdateStatusIfNeeded(force: true);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _refreshUpdateStatusIfNeeded(force: true);
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  int _compareVersionStrings(String current, String target) {
    List<int> parseParts(String value) {
      final trimmed = value.trim();
      var versionPart = trimmed;
      var buildNumber = 0;
      if (trimmed.contains('+')) {
        final parts = trimmed.split('+');
        versionPart = parts.first.trim();
        if (parts.length > 1) {
          buildNumber =
              int.tryParse(parts[1].replaceAll(RegExp(r'[^0-9]'), '')) ?? 0;
        }
      }
      if (versionPart.isEmpty) return <int>[0, buildNumber];
      final versionParts = versionPart
          .split('.')
          .map((part) => int.tryParse(part.replaceAll(RegExp(r'[^0-9]'), '')) ?? 0)
          .toList();
      versionParts.add(buildNumber);
      return versionParts;
    }

    final currentParts = parseParts(current);
    final targetParts = parseParts(target);
    final maxLen =
        currentParts.length > targetParts.length ? currentParts.length : targetParts.length;
    for (int i = 0; i < maxLen; i++) {
      final a = i < currentParts.length ? currentParts[i] : 0;
      final b = i < targetParts.length ? targetParts[i] : 0;
      if (a < b) return -1;
      if (a > b) return 1;
    }
    return 0;
  }

  Future<Map<String, dynamic>?> _loadStatus(String token) async {
    final status = await ApiService.getAppUpdateStatus(token);
    String installedVersion = '';
    String installedBuild = '';
    try {
      final info = await PackageInfo.fromPlatform();
      installedVersion = info.version.trim();
      installedBuild = info.buildNumber.trim();
    } catch (_) {}

    final latestVersion = (status['latest_version'] ?? '').toString().trim();
    if (latestVersion.isEmpty) return null;

    final installedComparableVersion = installedVersion.isEmpty
        ? ''
        : (installedBuild.isNotEmpty
              ? '$installedVersion+$installedBuild'
              : installedVersion);

    final minimumSupportedVersion =
        (status['minimum_supported_version'] ?? '').toString().trim();
    final updateAvailable =
        _compareVersionStrings(installedComparableVersion, latestVersion) < 0;
    if (!updateAvailable) return null;

    final forcedByVersion = minimumSupportedVersion.isNotEmpty &&
        _compareVersionStrings(installedComparableVersion, minimumSupportedVersion) < 0;
    final reminderHour =
        int.tryParse((status['reminder_hour'] ?? '12').toString()) ?? 12;

    return {
      ...status,
      'installed_version': installedVersion,
      'installed_build': installedBuild,
      'installed_comparable_version': installedComparableVersion,
      'latest_version': latestVersion,
      'update_available': true,
      'force_update_active':
          (status['force_update'] == true || status['force_update'] == 1) || forcedByVersion,
      'reminder_hour': reminderHour.clamp(0, 23),
    };
  }

  Future<void> _refreshUpdateStatusIfNeeded({bool force = false}) async {
    final token = _authToken;
    if (token == null || token.trim().isEmpty) {
      if (_appUpdateStatus != null && mounted) {
        setState(() {
          _appUpdateStatus = null;
        });
      }
      return;
    }

    try {
      final status = await _loadStatus(token);
      if (!mounted) return;
      setState(() {
        _appUpdateStatus = status;
        if (status == null) _dismissedVersion = null;
      });
      if (status != null) {
        await _maybeShowDailyReminder(status, force: force);
      }
    } catch (_) {}
  }

  Future<void> _openAppUpdateLink() async {
    final status = _appUpdateStatus;
    if (status == null) return;
    final url = (status['play_store_url'] ??
            'https://play.google.com/store/apps/details?id=com.onenetsol.servenow')
        .toString()
        .trim();
    if (url.isEmpty) return;
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _maybeShowDailyReminder(
    Map<String, dynamic> status, {
    bool force = false,
  }) async {
    final now = DateTime.now();
    final reminderHour = int.tryParse('${status['reminder_hour'] ?? 12}') ?? 12;
    if (!force && now.hour < reminderHour) return;

    final latestVersion = (status['latest_version'] ?? '').toString().trim();
    if (latestVersion.isEmpty) return;

    final prefs = await SharedPreferences.getInstance();
    final today =
        '${now.year}-${now.month.toString().padLeft(2, '0')}-${now.day.toString().padLeft(2, '0')}';
    final key = 'global_update_reminder_$latestVersion';
    if (prefs.getString(key) == today) return;
    await prefs.setString(key, today);

    if (!mounted || _dialogOpen) return;
    _dialogOpen = true;
    final forceUpdate = status['force_update_active'] == true;
    final message = (status['message'] ?? 'A new version of ServeNow is available.')
        .toString()
        .trim();

    await showDialog<void>(
      context: context,
      barrierDismissible: !forceUpdate,
      builder: (dialogContext) {
        return AlertDialog(
          title: Text(forceUpdate ? 'Update Required' : 'Update Available'),
          content: Text(message.isNotEmpty ? message : 'Please update the app.'),
          actions: [
            if (!forceUpdate)
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(),
                child: const Text('Later'),
              ),
            FilledButton(
              onPressed: () {
                Navigator.of(dialogContext).pop();
                _openAppUpdateLink();
              },
              child: const Text('Update Now'),
            ),
          ],
        );
      },
    );
    _dialogOpen = false;
  }

  bool get _showBanner {
    final status = _appUpdateStatus;
    if (status == null) return false;
    final latestVersion = (status['latest_version'] ?? '').toString().trim();
    if (latestVersion.isEmpty) return false;
    final forceUpdate = status['force_update_active'] == true;
    return forceUpdate || _dismissedVersion != latestVersion;
  }

  @override
  Widget build(BuildContext context) {
    final status = _appUpdateStatus;
    final topInset = MediaQuery.of(context).padding.top;

    return Stack(
      children: [
        widget.child,
        if (status != null && _showBanner)
          Positioned(
            left: 12,
            right: 12,
            top: topInset + 10,
            child: Material(
              color: Colors.transparent,
              child: Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF4E8),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFFFFD5A8)),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.12),
                      blurRadius: 12,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.system_update_alt, color: Color(0xFFB45309)),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            status['force_update_active'] == true
                                ? 'Update Required'
                                : 'Update Available',
                            style: const TextStyle(
                              fontWeight: FontWeight.w800,
                              fontSize: 15,
                            ),
                          ),
                        ),
                        if (status['force_update_active'] != true)
                          IconButton(
                            icon: const Icon(Icons.close, size: 18),
                            visualDensity: VisualDensity.compact,
                            onPressed: () {
                              setState(() {
                                _dismissedVersion =
                                    (status['latest_version'] ?? '').toString().trim();
                              });
                            },
                          ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      (status['message'] ?? 'A newer version of ServeNow is available.')
                          .toString(),
                      style: const TextStyle(
                        fontSize: 12.8,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      'Installed: ${(status['installed_version'] ?? 'Unknown').toString()}'
                      '   Latest: ${(status['latest_version'] ?? '').toString()}',
                      style: const TextStyle(fontSize: 12, color: Colors.black54),
                    ),
                    const SizedBox(height: 10),
                    Align(
                      alignment: Alignment.centerRight,
                      child: FilledButton.icon(
                        onPressed: _openAppUpdateLink,
                        icon: const Icon(Icons.open_in_new, size: 16),
                        label: const Text('Update Now'),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class AuthWrapper extends StatefulWidget {
  const AuthWrapper({super.key});

  @override
  State<AuthWrapper> createState() => _AuthWrapperState();
}

class _AuthWrapperState extends State<AuthWrapper> {
  @override
  void initState() {
    super.initState();
    _checkAuth();
  }

  Future<void> _checkAuth() async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    await auth.tryAutoLogin();

    if (!mounted) return;

    if (auth.isAuthenticated) {
      if (auth.isAdmin) {
        Navigator.of(context).pushReplacementNamed('/admin');
      } else if (auth.isRider) {
        Navigator.of(context).pushReplacementNamed('/rider');
      } else if (auth.isStoreOwner) {
        Navigator.of(context).pushReplacementNamed('/store_owner');
      } else {
        Navigator.of(context).pushReplacementNamed('/home');
      }
    } else {
      Navigator.of(context).pushReplacementNamed('/login');
    }
  }

  @override
  Widget build(BuildContext context) {
    return const SplashScreen();
  }
}
