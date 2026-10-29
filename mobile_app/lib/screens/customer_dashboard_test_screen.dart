import 'dart:async';

import 'package:package_info_plus/package_info_plus.dart';
import 'package:flutter/material.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';

import '../config/support_contact.dart';

import '../models/user.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../providers/notification_provider.dart' as app_notif;
import '../services/api_service.dart';
import '../utils/customer_language.dart';
import '../utils/cart_counts.dart';
import '../widgets/customer_bottom_nav.dart';
import '../widgets/notification_bell_widget.dart';
import '../widgets/ui/ui.dart';
import 'store_screen.dart';

class CustomerDashboardTestScreen extends StatefulWidget {
  const CustomerDashboardTestScreen({super.key});

  @override
  State<CustomerDashboardTestScreen> createState() =>
      _CustomerDashboardTestScreenState();
}

class _CustomerDashboardTestScreenState
    extends State<CustomerDashboardTestScreen> {
  static const String _launchFlashSeenSignatureKey =
      'customer_launch_flash_seen_signature';
  List<dynamic> _allStores = [];
  List<dynamic> _filteredStores = [];
  bool _isLoading = true;
  String? _errorMessage;
  String? _serviceLimitedMessage;
  Map<String, dynamic>? _globalStatus;
  Map<String, dynamic>? _livePromotions;
  Map<String, dynamic>? _customerFlashMessage;
  Map<String, dynamic>? _supportContact;
  Map<String, dynamic>? _appUpdateStatus;
  final TextEditingController _searchController = TextEditingController();
  double? _userLat;
  double? _userLng;
  String? _userCity;
  final PageController _bannerController = PageController(
    viewportFraction: 0.92,
  );
  int _activeBanner = 0;
  Timer? _bannerTimer;
  Timer? _globalStatusRefreshTimer;
  Timer? _livePromotionsRefreshTimer;
  Timer? _globalStatusPollTimer;
  CustomerTab _tab = CustomerNav.homeTab.value;
  double? _baseDeliveryFee;
  List<Map<String, dynamic>> _recentOrders = const [];
  bool _launchFlashShown = false;
  String? _launchFlashSignature;
  bool _isUrdu = false;
  String _selectedCategory = 'all';

  @override
  void initState() {
    super.initState();
    _loadLanguagePreference();
    _fetchData();
    _globalStatusPollTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      _refreshGlobalStatusOnly();
    });
    _searchController.addListener(_onSearchChanged);
    _startBannerAutoScroll();
    CustomerNav.homeTab.addListener(_onHomeTabRequested);
    _loadHomeExtras();
  }

  Future<void> _loadLanguagePreference() async {
    final isUrdu = await CustomerLanguage.loadIsUrdu();
    if (!mounted) return;
    setState(() {
      _isUrdu = isUrdu;
    });
  }

  Future<void> _setLanguage(bool isUrdu) async {
    await CustomerLanguage.saveIsUrdu(isUrdu);
    if (!mounted) return;
    setState(() {
      _isUrdu = isUrdu;
    });
  }

  String _tr(String english) {
    const translations = <String, String>{
      'ServeNow Support': 'سروناؤ سپورٹ',
      'Contact Us': 'ہم سے رابطہ کریں',
      'Support contact is not configured yet.':
          'ابھی سپورٹ رابطہ معلومات شامل نہیں کی گئی ہیں۔',
      'Choose how you want to contact us.': 'رابطے کا طریقہ منتخب کریں۔',
      'Email': 'ای میل',
      'Update Required': 'اپ ڈیٹ ضروری ہے',
      'Update Available': 'اپ ڈیٹ دستیاب ہے',
      'A new version of ServeNow is available.':
          'سروناؤ کا نیا ورژن دستیاب ہے۔',
      'A newer version of ServeNow is available.':
          'سروناؤ کا نیا ورژن دستیاب ہے۔',
      'Installed': 'انسٹال شدہ',
      'Latest': 'تازہ ترین',
      'Unknown': 'نامعلوم',
      'Update Now': 'ابھی اپ ڈیٹ کریں',
      'Hide': 'چھپائیں',
      'ServeNow Flash Message': 'سروناؤ اہم پیغام',
      'Check latest updates in ServeNow.':
          'سروناؤ کی تازہ ترین معلومات دیکھیں۔',
      'Check latest promotions and events.': 'تازہ پروموشنز اور ایونٹس دیکھیں۔',
      'Flash Message': 'اہم پیغام',
      'OK': 'ٹھیک ہے',
      'Promotion window': 'پروموشن مدت',
      'My Cart': 'میری کارٹ',
      'Welcome': 'خوش آمدید',
      'Ref Area': 'حوالہ علاقہ',
      'ServeNow Customer': 'سروناؤ کسٹمر',
      'Live Promotions': 'لائیو پروموشنز',
      'Live: Promotions / Events': 'لائیو: پروموشنز / ایونٹس',
      'live widgets': 'لائیو ویجٹس',
      'Live Delivery Pause': 'لائیو ڈیلیوری بندش',
      'Delivery Update': 'ڈیلیوری اپ ڈیٹ',
      'Search store by name or area': 'دکان نام یا علاقے سے تلاش کریں',
      'No stores found in this category': 'اس زمرے میں کوئی دکان نہیں ملی۔',
      'Language': 'زبان',
      'Select Language': 'زبان منتخب کریں',
      'English': 'English',
      'Urdu': 'اردو',
      'Selected': 'منتخب',
      'You are not allowed to see Store when you are out of Delivery Area':
          'ڈیلیوری ایریا سے باہر ہونے پر آپ دکانیں نہیں دیکھ سکتے۔',
    };
    if (_isUrdu && translations.containsKey(english)) {
      return translations[english]!;
    }
    return CustomerLanguage.tr(_isUrdu, english);
  }

  String _languageLabel() => _isUrdu ? 'اردو' : 'EN';

  Future<void> _showLanguageOptions() async {
    if (!mounted) return;
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) {
        Widget option(String label, bool selected, bool urdu) {
          return ListTile(
            minTileHeight: 56,
            leading: Icon(
              selected
                  ? Icons.radio_button_checked_rounded
                  : Icons.radio_button_off_rounded,
              color: selected ? AppColors.primary : AppColors.muted,
            ),
            title: Text(label),
            trailing: selected
                ? Text(
                    _tr('Selected'),
                    style: AppText.label.copyWith(color: AppColors.primary),
                  )
                : null,
            onTap: () async {
              Navigator.of(sheetContext).pop();
              await _setLanguage(urdu);
            },
          );
        }

        return LanguageScope(
          isUrdu: _isUrdu,
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 12),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: Text(_tr('Select Language'), style: AppText.h2),
                  ),
                  const SizedBox(height: AppSpace.sm),
                  option('English', !_isUrdu, false),
                  option('اردو', _isUrdu, true),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  @override
  void dispose() {
    _bannerTimer?.cancel();
    _globalStatusRefreshTimer?.cancel();
    _livePromotionsRefreshTimer?.cancel();
    _globalStatusPollTimer?.cancel();
    _bannerController.dispose();
    CustomerNav.homeTab.removeListener(_onHomeTabRequested);
    _searchController.removeListener(_onSearchChanged);
    _searchController.dispose();
    super.dispose();
  }

  void _startBannerAutoScroll() {
    _bannerTimer = Timer.periodic(const Duration(seconds: 4), (_) {
      if (!mounted) return;
      final count = _liveWidgetItems.length;
      if (count <= 1 || !_bannerController.hasClients) return;
      final next = (_activeBanner + 1) % count;
      _bannerController.animateToPage(
        next,
        duration: const Duration(milliseconds: 350),
        curve: Curves.easeInOut,
      );
    });
  }

  List<Map<String, dynamic>> get _liveWidgetItems {
    final includePromotionCard = _showLivePromotionsCard();
    final includeStatusCard = _showGlobalStatusBanner();
    final storeSlots =
        (5 - (includePromotionCard ? 1 : 0) - (includeStatusCard ? 1 : 0))
            .clamp(0, 5);
    final stores = _allStores
        .where((s) => (s['image_url'] ?? '').toString().trim().isNotEmpty)
        .take(storeSlots)
        .toList();
    final items = <Map<String, dynamic>>[];
    if (includePromotionCard) {
      items.add({'type': 'promotion'});
    }
    if (includeStatusCard) {
      items.add({'type': 'status'});
    }
    for (final store in stores) {
      items.add({'type': 'store', 'data': store});
    }
    return items;
  }

  void _onSearchChanged() {
    _filterStores(_searchController.text);
  }

  Future<void> _fetchData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      final hadResolvedLocation = _userLat != null && _userLng != null;
      final locationFuture = _resolveLocationContext();

      Future<Map<String, dynamic>?> loadGlobalStatus() async {
        if (token == null) return null;
        try {
          final global = await ApiService.getGlobalDeliveryStatus(token);
          return (global['status'] is Map<String, dynamic>)
              ? (global['status'] as Map<String, dynamic>)
              : (global['global_status'] is Map<String, dynamic>)
              ? (global['global_status'] as Map<String, dynamic>)
              : global;
        } catch (_) {
          return null;
        }
      }

      Future<Map<String, dynamic>?> loadPromotions() async {
        try {
          final promotions = await ApiService.getLivePromotions(token);
          return (promotions['live_promotions'] is Map<String, dynamic>)
              ? (promotions['live_promotions'] as Map<String, dynamic>)
              : promotions;
        } catch (_) {
          return null;
        }
      }

      Future<Map<String, dynamic>?> loadCustomerFlash() async {
        if (token == null) return null;
        try {
          return await ApiService.getCustomerFlashMessage(token);
        } catch (_) {
          return null;
        }
      }

      Future<Map<String, dynamic>?> loadSupportContact() async {
        if (token == null) return null;
        try {
          return await ApiService.getCustomerSupportContact(token);
        } catch (_) {
          return null;
        }
      }

      Future<Map<String, dynamic>?> loadAppUpdateStatus() async {
        if (token == null) return null;
        try {
          return await _resolveAppUpdateStatus(token);
        } catch (_) {
          return null;
        }
      }

      final futures = await Future.wait<dynamic>([
        loadGlobalStatus(),
        loadPromotions(),
        loadCustomerFlash(),
        loadSupportContact(),
        loadAppUpdateStatus(),
        ApiService.getStores(
          latitude: _userLat,
          longitude: _userLng,
          city: _userCity,
        ),
      ]);

      final globalStatus = futures[0] as Map<String, dynamic>?;
      final livePromotions = futures[1] as Map<String, dynamic>?;
      final customerFlash = futures[2] as Map<String, dynamic>?;
      final supportContact = futures[3] as Map<String, dynamic>?;
      final appUpdateStatus = futures[4] as Map<String, dynamic>?;
      final storesResp = futures[5] as Map<String, dynamic>;

      if (!mounted) return;
      final stores = (storesResp['stores'] as List<dynamic>? ?? []);
      final limited = storesResp['service_limited'] == true;
      final limitedMessage = (storesResp['service_message'] ?? '')
          .toString()
          .trim();
      setState(() {
        _allStores = stores;
        _filteredStores = _computeFilteredStores(
          query: _searchController.text,
          categoryKey: _selectedCategory,
        );
        _globalStatus = globalStatus;
        _livePromotions = livePromotions;
        _customerFlashMessage = customerFlash;
        _supportContact = supportContact;
        _appUpdateStatus = appUpdateStatus;
        _scheduleGlobalStatusRefresh(globalStatus);
        _scheduleLivePromotionsRefresh(livePromotions);
        _serviceLimitedMessage = limited
            ? (limitedMessage.isNotEmpty
                  ? limitedMessage
                  : _tr(
                      'You are not allowed to see Store when you are out of Delivery Area',
                    ))
            : null;
        _isLoading = false;
      });
      if (appUpdateStatus != null) {
        await _maybeShowDailyUpdateReminder(appUpdateStatus);
      }
      _tryShowLaunchFlash();

      final locationChanged = await locationFuture;
      if (!mounted) return;
      if (!hadResolvedLocation && locationChanged) {
        unawaited(_refreshStoresForResolvedLocation());
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _refreshStoresForResolvedLocation() async {
    try {
      final storesResp = await ApiService.getStores(
        latitude: _userLat,
        longitude: _userLng,
        city: _userCity,
        forceRefresh: true,
      );
      if (!mounted) return;
      final stores = (storesResp['stores'] as List<dynamic>? ?? []);
      final limited = storesResp['service_limited'] == true;
      final limitedMessage = (storesResp['service_message'] ?? '')
          .toString()
          .trim();
      setState(() {
        _allStores = stores;
        _filteredStores = _computeFilteredStores(
          query: _searchController.text,
          categoryKey: _selectedCategory,
        );
        _serviceLimitedMessage = limited
            ? (limitedMessage.isNotEmpty
                  ? limitedMessage
                  : _tr(
                      'You are not allowed to see Store when you are out of Delivery Area',
                    ))
            : null;
      });
    } catch (_) {}
  }

  Future<bool> _resolveLocationContext() async {
    try {
      if (_userLat != null && _userLng != null) return false;
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) return false;
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return false;
      }
      final position = await Geolocator.getCurrentPosition();
      final previousLat = _userLat;
      final previousLng = _userLng;
      _userLat = position.latitude;
      _userLng = position.longitude;
      try {
        final places = await placemarkFromCoordinates(
          position.latitude,
          position.longitude,
        );
        if (places.isNotEmpty) {
          _userCity =
              (places.first.locality ??
                      places.first.subAdministrativeArea ??
                      '')
                  .toString()
                  .trim();
        }
      } catch (_) {}
      return previousLat != _userLat || previousLng != _userLng;
    } catch (_) {}
    return false;
  }

  List<dynamic> _computeFilteredStores({String? query, String? categoryKey}) {
    final search = (query ?? _searchController.text).trim().toLowerCase();
    final selectedCategory = categoryKey ?? _selectedCategory;
    return _allStores.where((store) {
      final name = (store['name'] ?? '').toString().toLowerCase();
      final location = (store['location'] ?? '').toString().toLowerCase();
      final category = (store['category_name'] ?? '').toString().trim();
      final categoryLabel = _normalizeCategoryKey(category);
      final matchesSearch =
          search.isEmpty ||
          name.contains(search) ||
          location.contains(search) ||
          category.toLowerCase().contains(search);
      final matchesCategory =
          selectedCategory == 'all' || categoryLabel == selectedCategory;
      return matchesSearch && matchesCategory;
    }).toList();
  }

  void _applyFilters({String? query, String? categoryKey}) {
    final nextCategory = categoryKey ?? _selectedCategory;
    setState(() {
      _selectedCategory = nextCategory;
      _filteredStores = _computeFilteredStores(
        query: query,
        categoryKey: nextCategory,
      );
    });
  }

  void _filterStores(String query) {
    _applyFilters(query: query);
  }

  String _normalizeCategoryKey(String category) {
    final normalized = category.trim().toLowerCase();
    if (normalized.isEmpty) return 'popular';
    return normalized.replaceAll(RegExp(r'[^a-z0-9]+'), '-');
  }

  IconData _categoryIcon(String label) {
    final value = label.toLowerCase();
    if (value.contains('grocery') || value.contains('mart')) {
      return Icons.local_grocery_store_rounded;
    }
    if (value.contains('fruit')) return Icons.apple_rounded;
    if (value.contains('veg')) return Icons.eco_rounded;
    if (value.contains('meat') || value.contains('seafood')) {
      return Icons.set_meal_rounded;
    }
    if (value.contains('bakery') || value.contains('dessert')) {
      return Icons.bakery_dining_rounded;
    }
    if (value.contains('drink') || value.contains('beverage')) {
      return Icons.local_drink_rounded;
    }
    if (value.contains('pharmacy') || value.contains('health')) {
      return Icons.medication_rounded;
    }
    if (value.contains('home') || value.contains('house')) {
      return Icons.home_work_rounded;
    }
    return Icons.storefront_rounded;
  }

  List<Map<String, dynamic>> get _categoryOptions {
    final counts = <String, int>{};
    final labels = <String, String>{};
    for (final raw in _allStores) {
      final category = (raw['category_name'] ?? '').toString().trim();
      if (category.isEmpty) continue;
      final key = _normalizeCategoryKey(category);
      counts[key] = (counts[key] ?? 0) + 1;
      labels[key] = category;
    }

    final options = <Map<String, dynamic>>[
      {
        'key': 'all',
        'label': _tr('All'),
        'count': _allStores.length,
        'icon': Icons.grid_view_rounded,
      },
    ];

    final sortedKeys = counts.keys.toList()
      ..sort((a, b) => counts[b]!.compareTo(counts[a]!));

    for (final key in sortedKeys.take(6)) {
      final label = labels[key]!;
      options.add({
        'key': key,
        'label': label,
        'count': counts[key]!,
        'icon': _categoryIcon(label),
      });
    }

    return options;
  }

  Future<void> _showSupportOptions() async {
    final token = Provider.of<AuthProvider>(context, listen: false).token;
    var contact = SupportContact.fromServer(_supportContact);
    if (contact.isEmpty) {
      contact = await SupportContact.load(token, refresh: true);
    }
    if (!mounted) return;
    await showSupportContactSheet(
      context,
      contact: contact,
      isUrdu: _isUrdu,
      title: _tr('Contact Us'),
    );
  }

  int _compareVersionStrings(String current, String target) {
    List<int> parseParts(String value) {
      final cleaned = value.split('+').first.trim();
      if (cleaned.isEmpty) return const <int>[0];
      return cleaned
          .split('.')
          .map(
            (part) => int.tryParse(part.replaceAll(RegExp(r'[^0-9]'), '')) ?? 0,
          )
          .toList();
    }

    final currentParts = parseParts(current);
    final targetParts = parseParts(target);
    final maxLen = currentParts.length > targetParts.length
        ? currentParts.length
        : targetParts.length;
    for (int i = 0; i < maxLen; i++) {
      final a = i < currentParts.length ? currentParts[i] : 0;
      final b = i < targetParts.length ? targetParts[i] : 0;
      if (a < b) return -1;
      if (a > b) return 1;
    }
    return 0;
  }

  Future<Map<String, dynamic>> _resolveAppUpdateStatus(String token) async {
    final status = await ApiService.getAppUpdateStatus(token);
    String installedVersion = '';
    String installedBuild = '';
    try {
      final info = await PackageInfo.fromPlatform();
      installedVersion = info.version.trim();
      installedBuild = info.buildNumber.trim();
    } catch (_) {}

    final latestVersion = (status['latest_version'] ?? '').toString().trim();
    final minimumSupportedVersion = (status['minimum_supported_version'] ?? '')
        .toString()
        .trim();
    final installedComparableVersion = installedVersion.isEmpty
        ? ''
        : (installedBuild.isNotEmpty
              ? '$installedVersion+$installedBuild'
              : installedVersion);
    final updateAvailable =
        latestVersion.isNotEmpty &&
        _compareVersionStrings(installedComparableVersion, latestVersion) < 0;
    final forcedByVersion =
        minimumSupportedVersion.isNotEmpty &&
        _compareVersionStrings(
              installedComparableVersion,
              minimumSupportedVersion,
            ) <
            0;
    final reminderHour =
        int.tryParse((status['reminder_hour'] ?? '12').toString()) ?? 12;

    return {
      ...status,
      'installed_version': installedVersion,
      'installed_build': installedBuild,
      'installed_comparable_version': installedComparableVersion,
      'update_available': updateAvailable,
      'force_update_active':
          (status['force_update'] == true || status['force_update'] == 1) ||
          forcedByVersion,
      'reminder_hour': reminderHour.clamp(0, 23),
    };
  }

  Future<void> _openAppUpdateLink([Map<String, dynamic>? status]) async {
    final update = status ?? _appUpdateStatus ?? const <String, dynamic>{};
    final url =
        (update['play_store_url'] ??
                'https://play.google.com/store/apps/details?id=com.onenetsol.servenow')
            .toString()
            .trim();
    if (url.isEmpty) return;
    final uri = Uri.parse(url);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _maybeShowDailyUpdateReminder(
    Map<String, dynamic> status,
  ) async {
    return;
  }

  bool _showAppUpdateBanner() {
    return false;
  }

  Widget _buildAppUpdateBanner() {
    final status = _appUpdateStatus ?? const <String, dynamic>{};
    final latestVersion = (status['latest_version'] ?? '').toString().trim();
    final installedVersion = (status['installed_version'] ?? '')
        .toString()
        .trim();
    final forceUpdate = status['force_update_active'] == true;
    final message =
        (status['message'] ?? _tr('A new version of ServeNow is available.'))
            .toString()
            .trim();

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: AppRadius.cardAll,
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.system_update_alt, color: AppColors.primary),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  forceUpdate
                      ? _tr('Update Required')
                      : _tr('Update Available'),
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    fontSize: 15,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            message.isNotEmpty
                ? message
                : _tr('A newer version of ServeNow is available.'),
            style: const TextStyle(fontSize: 12.8, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 8),
          Text(
            '${_tr('Installed')}: ${installedVersion.isNotEmpty ? installedVersion : _tr('Unknown')}'
            '${latestVersion.isNotEmpty ? '   ${_tr('Latest')}: $latestVersion' : ''}',
            style: AppText.caption,
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: () => _openAppUpdateLink(status),
                  icon: const Icon(Icons.open_in_new, size: 16),
                  label: Text(_tr('Update Now')),

                ),
              ),
              if (!forceUpdate) ...[
                const SizedBox(width: 8),
                TextButton(
                  onPressed: () {
                    setState(() {
                      _appUpdateStatus = {...status, 'update_available': false};
                    });
                  },
                  child: Text(_tr('Hide')),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }

  bool _toBool(dynamic value) {
    if (value is bool) return value;
    if (value is num) return value != 0;
    if (value is String) {
      final v = value.trim().toLowerCase();
      return v == 'true' || v == '1' || v == 'yes';
    }
    return false;
  }

  DateTime? _parseDateTime(dynamic raw) {
    final value = (raw ?? '').toString().trim();
    if (value.isEmpty) return null;
    return DateTime.tryParse(value)?.toLocal();
  }

  void _scheduleGlobalStatusRefresh(Map<String, dynamic>? status) {
    _globalStatusRefreshTimer?.cancel();
    if (status == null) return;

    final now = DateTime.now();
    final startAt = _parseDateTime(status['start_at']);
    final endAt = _parseDateTime(status['end_at']);
    final candidates = <DateTime>[
      if (startAt != null && startAt.isAfter(now)) startAt,
      if (endAt != null && endAt.isAfter(now)) endAt,
    ];
    if (candidates.isEmpty) return;

    candidates.sort();
    final nextTick = candidates.first;
    final delay = nextTick.difference(now) + const Duration(seconds: 1);
    _globalStatusRefreshTimer = Timer(delay, _refreshGlobalStatusOnly);
  }

  void _scheduleLivePromotionsRefresh(Map<String, dynamic>? promotions) {
    _livePromotionsRefreshTimer?.cancel();
    if (promotions == null) return;

    final now = DateTime.now();
    final startAt = _parseDateTime(promotions['start_at']);
    final endAt = _parseDateTime(promotions['end_at']);
    final candidates = <DateTime>[
      if (startAt != null && startAt.isAfter(now)) startAt,
      if (endAt != null && endAt.isAfter(now)) endAt,
    ];
    if (candidates.isEmpty) return;

    candidates.sort();
    final nextTick = candidates.first;
    final delay = nextTick.difference(now) + const Duration(seconds: 1);
    _livePromotionsRefreshTimer = Timer(delay, _refreshGlobalStatusOnly);
  }

  Future<void> _refreshGlobalStatusOnly() async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      Map<String, dynamic>? status;
      Map<String, dynamic>? customerFlash;
      Map<String, dynamic>? supportContact;
      Map<String, dynamic>? appUpdateStatus;
      if (token != null) {
        status = await ApiService.getGlobalDeliveryStatus(token);
        try {
          customerFlash = await ApiService.getCustomerFlashMessage(token);
        } catch (_) {}
        try {
          supportContact = await ApiService.getCustomerSupportContact(token);
        } catch (_) {}
        try {
          appUpdateStatus = await _resolveAppUpdateStatus(token);
        } catch (_) {}
      }
      final promotions = await ApiService.getLivePromotions(token);
      if (!mounted) return;
      setState(() {
        _globalStatus = status;
        _livePromotions = promotions;
        _customerFlashMessage = customerFlash;
        _supportContact = supportContact;
        _appUpdateStatus = appUpdateStatus ?? _appUpdateStatus;
      });
      if (appUpdateStatus != null) {
        await _maybeShowDailyUpdateReminder(appUpdateStatus);
      }
      _scheduleGlobalStatusRefresh(status);
      _scheduleLivePromotionsRefresh(promotions);
      _tryShowLaunchFlash();
    } catch (_) {}
  }

  Map<String, dynamic>? _promotionFlashData() {
    final flash = _customerFlashMessage;
    if (flash != null && _toBool(flash['is_enabled'])) {
      final isVisible =
          _toBool(flash['is_visible']) ||
          (_toBool(flash['is_window_active']) &&
              (_toBool(flash['is_target_matched']) ||
                  (flash['notification_target'] ?? 'all').toString() == 'all'));
      if (isVisible) {
        final title = (flash['title'] ?? _tr('ServeNow Flash Message'))
            .toString()
            .trim();
        final message = (flash['status_message'] ?? '').toString().trim();
        final imageUrl = ApiService.getImageUrl(
          (flash['image_url'] ?? '').toString().trim(),
        );
        final signature =
            '${flash['updated_at'] ?? ''}|$title|$message|$imageUrl|${flash['start_at'] ?? ''}|${flash['end_at'] ?? ''}';
        return {
          'title': title.isNotEmpty ? title : _tr('ServeNow Flash Message'),
          'message': message.isNotEmpty
              ? message
              : _tr('Check latest updates in ServeNow.'),
          'imageUrl': imageUrl,
          'signature': signature,
        };
      }
    }

    final promo = _livePromotions;
    if (promo == null) return null;
    if (!_toBool(promo['is_enabled'])) return null;
    if (!_toBool(promo['is_window_active']) && !_isGlobalWindowActive(promo)) {
      return null;
    }
    final title = (promo['title'] ?? _tr('ServeNow Flash Message'))
        .toString()
        .trim();
    final message = _livePromotionMessage().trim();
    final images = _promotionImages();
    final imageUrl = images.isNotEmpty
        ? ApiService.getImageUrl(images.first)
        : '';
    final signature =
        '${promo['id'] ?? ''}|${promo['updated_at'] ?? ''}|$title|$message|$imageUrl';

    return {
      'title': title.isNotEmpty ? title : _tr('ServeNow Flash Message'),
      'message': message.isNotEmpty
          ? message
          : _tr('Check latest promotions and events.'),
      'imageUrl': imageUrl,
      'signature': signature,
    };
  }

  Future<void> _tryShowLaunchFlash() async {
    if (!mounted || _launchFlashShown) return;
    final flash = _promotionFlashData();
    if (flash == null) return;

    final signature = (flash['signature'] ?? '').toString();
    if (signature.isNotEmpty) {
      final prefs = await SharedPreferences.getInstance();
      final seenSignature = prefs.getString(_launchFlashSeenSignatureKey) ?? '';
      if (seenSignature == signature) {
        _launchFlashShown = true;
        _launchFlashSignature = signature;
        return;
      }
    }

    _launchFlashShown = true;
    if (signature.isNotEmpty && _launchFlashSignature != signature) {
      _launchFlashSignature = signature;
      if (!mounted) return;
      try {
        Provider.of<app_notif.NotificationProvider>(
          context,
          listen: false,
        ).addNotification(
          title: (flash['title'] ?? _tr('ServeNow Flash Message')).toString(),
          message: (flash['message'] ?? '').toString(),
          type: 'promotion',
          icon: 'campaign',
        );
      } catch (_) {}
    }

    final imageUrl = (flash['imageUrl'] ?? '').toString().trim();
    if (imageUrl.isNotEmpty) {
      if (!mounted) return;
      try {
        await precacheImage(
          NetworkImage(imageUrl),
          context,
        ).timeout(const Duration(seconds: 2));
      } catch (_) {}
    }

    if (!mounted) return;
    if (signature.isNotEmpty) {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_launchFlashSeenSignatureKey, signature);
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _showLaunchFlashDialog(flash);
    });
  }

  void _showLaunchFlashDialog(Map<String, dynamic> flash) {
    final title = (flash['title'] ?? _tr('ServeNow Flash Message')).toString();
    final message = (flash['message'] ?? '').toString();
    final imageUrl = (flash['imageUrl'] ?? '').toString();

    showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: _tr('Flash Message'),
      barrierColor: Colors.black54,
      transitionDuration: const Duration(milliseconds: 260),
      pageBuilder: (context, animation, secondaryAnimation) {
        return SafeArea(
          child: Center(
            child: Container(
              margin: const EdgeInsets.symmetric(horizontal: 18),
              padding: const EdgeInsets.fromLTRB(14, 14, 14, 12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: AppRadius.cardAll,
                boxShadow: AppColors.floatingShadow,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(
                        Icons.campaign_outlined,
                        color: AppColors.primary,
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontWeight: FontWeight.w800,
                            fontSize: 17,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(14),
                    child: SizedBox(
                      height: 190,
                      width: double.infinity,
                      child: imageUrl.isNotEmpty
                          ? TweenAnimationBuilder<double>(
                              tween: Tween(begin: 0.92, end: 1.0),
                              duration: const Duration(milliseconds: 800),
                              curve: Curves.easeOutBack,
                              builder: (context, scale, child) =>
                                  Transform.scale(scale: scale, child: child),
                              child: Image.network(
                                imageUrl,
                                fit: BoxFit.cover,
                                errorBuilder: (_, _, _) => Container(
                                  color: AppColors.surface3,
                                  alignment: Alignment.center,
                                  child: const Icon(
                                    Icons.image_not_supported_outlined,
                                    size: 34,
                                    color: AppColors.primary,
                                  ),
                                ),
                              ),
                            )
                          : Container(
                              color: AppColors.surface3,
                              alignment: Alignment.center,
                              child: const Icon(
                                Icons.celebration_outlined,
                                size: 44,
                                color: AppColors.primary,
                              ),
                            ),
                    ),
                  ),
                  if (message.trim().isNotEmpty) ...[
                    const SizedBox(height: 12),
                    Text(
                      message,
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                  const SizedBox(height: 10),
                  Align(
                    alignment: Alignment.centerRight,
                    child: FilledButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: Text(_tr('OK')),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
      transitionBuilder: (context, animation, secondaryAnimation, child) {
        final curved = CurvedAnimation(
          parent: animation,
          curve: Curves.easeOut,
        );
        return FadeTransition(
          opacity: curved,
          child: ScaleTransition(
            scale: Tween<double>(begin: 0.95, end: 1.0).animate(curved),
            child: child,
          ),
        );
      },
    );
  }

  bool _isGlobalWindowActive(Map<String, dynamic> status) {
    if (_toBool(status['is_window_active'])) return true;
    final startRaw = (status['start_at'] ?? '').toString().trim();
    final endRaw = (status['end_at'] ?? '').toString().trim();
    if (startRaw.isEmpty || endRaw.isEmpty) return true;
    final start = DateTime.tryParse(startRaw);
    final end = DateTime.tryParse(endRaw);
    if (start == null || end == null) return true;
    final now = DateTime.now();
    return now.isAfter(start) && now.isBefore(end);
  }

  bool _showGlobalStatusBanner() {
    final status = _globalStatus;
    if (status == null) return false;
    if (!_toBool(status['is_enabled'])) return false;
    return _isGlobalWindowActive(status);
  }

  bool _isGlobalOrderingBlocked() {
    final status = _globalStatus;
    if (status == null) return false;
    if (!_showGlobalStatusBanner()) return false;
    if (_toBool(status['block_ordering_active'])) return true;
    return _toBool(status['block_ordering']) && _isGlobalWindowActive(status);
  }

  String _globalStatusMessage() {
    final status = _globalStatus;
    if (status == null) return '';
    final message = (status['status_message'] ?? '').toString().trim();
    final when = _formatDeliveryWindow(status['start_at'], status['end_at']);
    if (message.isNotEmpty && when.isNotEmpty) return '$message ($when)';
    if (message.isNotEmpty) return message;
    if (when.isNotEmpty) return '${_tr('Delivery update')}: $when';
    final title = (status['title'] ?? '').toString().trim();
    return title;
  }

  String _formatDeliveryWindow(dynamic startRaw, dynamic endRaw) {
    final start = Fmt.dateTime(startRaw);
    final end = Fmt.dateTime(endRaw);
    if (start.isEmpty || end.isEmpty) return '';
    final window = '$start \u2013 $end';
    return _isUrdu ? Fmt.isolate(window) : window;
  }

  bool _showLivePromotionsCard() {
    final promo = _livePromotions;
    if (promo == null) return false;
    if (!_toBool(promo['is_enabled'])) return false;
    if (!_toBool(promo['is_window_active']) && !_isGlobalWindowActive(promo)) {
      return false;
    }
    return _promotionImages().isNotEmpty;
  }

  List<String> _promotionImages() {
    final promo = _livePromotions;
    if (promo == null) return const [];
    final raw = promo['widget_images'];
    if (raw is! List) return const [];
    return raw
        .map((e) => e?.toString().trim() ?? '')
        .where((e) => e.isNotEmpty)
        .take(5)
        .toList();
  }

  String _livePromotionMessage() {
    final promo = _livePromotions;
    if (promo == null) return '';
    final reason = (promo['status_message'] ?? '').toString().trim();
    final when = _formatDeliveryWindow(promo['start_at'], promo['end_at']);
    if (reason.isNotEmpty && when.isNotEmpty) return '$reason ($when)';
    if (reason.isNotEmpty) return reason;
    if (when.isNotEmpty) return '${_tr('Promotion window')}: $when';
    return '';
  }

  // ---------------------------------------------------------------------------
  // Extras for the redesigned home: delivery fee for store cards and the
  // "Order again" row. Both are read-only GETs; failures are silent.
  // ---------------------------------------------------------------------------

  Future<void> _loadHomeExtras() async {
    try {
      final cfg = await ApiService.getDeliveryFeeConfig();
      final base = cfg['base_fee'] ?? cfg['delivery_fee_base'];
      if (base != null && mounted) {
        setState(() => _baseDeliveryFee = Fmt.toDouble(base));
      }
    } catch (_) {}

    try {
      if (!mounted) return;
      final auth = Provider.of<AuthProvider>(context, listen: false);
      final token = auth.token;
      if (auth.isGuest || token == null || token.isEmpty) return;
      final orders = await ApiService.getMyOrders(token);
      if (!mounted) return;
      orders.sort((a, b) {
        final ad = Fmt.parseDate((a as Map)['created_at']);
        final bd = Fmt.parseDate((b as Map)['created_at']);
        if (ad == null || bd == null) return 0;
        return bd.compareTo(ad);
      });
      final seenStores = <String>{};
      final recent = <Map<String, dynamic>>[];
      for (final raw in orders) {
        if (raw is! Map) continue;
        final order = Map<String, dynamic>.from(raw);
        if (order['is_group'] == true) continue;
        final storeId = (order['store_id'] ?? '').toString();
        if (storeId.isEmpty || !seenStores.add(storeId)) continue;
        if (OrderStatusStyle.normalize(order['status']) == 'cancelled') {
          continue;
        }
        recent.add(order);
        if (recent.length >= 6) break;
      }
      setState(() => _recentOrders = recent);
    } catch (_) {}
  }

  void _onHomeTabRequested() {
    if (!mounted) return;
    final requested = CustomerNav.homeTab.value;
    if (requested == _tab) return;
    setState(() => _tab = requested);
  }

  void _selectTab(CustomerTab tab) {
    switch (tab) {
      case CustomerTab.home:
      case CustomerTab.stores:
      case CustomerTab.account:
        CustomerNav.homeTab.value = tab;
        setState(() => _tab = tab);
        return;
      case CustomerTab.cart:
      case CustomerTab.orders:
        CustomerNav.go(context, tab, from: _tab);
        return;
    }
  }

  void _openStore(dynamic store) {
    final id = store['id'];
    if (id == null) return;
    Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (ctx) => StoreScreen(storeId: id)));
  }

  dynamic _storeById(dynamic storeId) {
    final key = (storeId ?? '').toString();
    for (final store in _allStores) {
      if ((store['id'] ?? '').toString() == key) return store;
    }
    return null;
  }

  bool _isStoreOpen(dynamic store) =>
      store['is_open'] == true || store['is_open'] == 1;

  String? _storeRating(dynamic store) {
    final value = Fmt.toDouble(store['rating']);
    if (value <= 0) return null;
    return value.toStringAsFixed(1);
  }

  String _storeEta(dynamic store) {
    final eta = Fmt.eta(store['delivery_time']);
    if (eta.isNotEmpty) return _isUrdu ? Fmt.isolate(eta) : eta;
    final hours = Fmt.hours(
      store['opening_time']?.toString(),
      store['closing_time']?.toString(),
    );
    return _isUrdu ? Fmt.isolate(hours) : hours;
  }

  String? _storeFee() {
    final fee = _baseDeliveryFee;
    if (fee == null) return null;
    if (fee <= 0) return _tr('Free delivery');
    return '${Fmt.money(fee, urdu: _isUrdu)} ${_tr('delivery')}';
  }

  Widget _storeCard(dynamic store, {double? width}) {
    final isOpen = _isStoreOpen(store);
    final card = StoreCard(
      name: (store['name'] ?? _tr('Unknown Store')).toString(),
      subtitle: (store['location'] ?? '').toString(),
      imageUrl: ApiService.getImageUrl(store['image_url']),
      isOpen: isOpen,
      rating: _storeRating(store),
      eta: _storeEta(store),
      deliveryFee: _storeFee(),
      openLabel: _tr('Open'),
      closedLabel: _tr('Closed'),
      closedNote: (store['status_message'] ?? '').toString().trim(),
      onTap: () => _openStore(store),
    );
    if (width == null) return card;
    return SizedBox(width: width, child: card);
  }

  // ---------------------------------------------------------------------------
  // Sheets
  // ---------------------------------------------------------------------------

  void _openQuickActions() {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final isGuest = auth.isGuest;
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (ctx) {
        Widget item(
          IconData icon,
          String label,
          VoidCallback onTap, {
          Color? color,
        }) {
          return ListTile(
            leading: Icon(icon, color: color ?? AppColors.text2),
            title: Text(label, style: TextStyle(color: color)),
            minTileHeight: 52,
            onTap: () {
              Navigator.of(ctx).pop();
              onTap();
            },
          );
        }

        return LanguageScope(
          isUrdu: _isUrdu,
          child: SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  item(
                    Icons.receipt_long_outlined,
                    _tr('My Orders'),
                    () => _selectTab(CustomerTab.orders),
                  ),
                  item(
                    Icons.shopping_cart_outlined,
                    _tr('My Cart'),
                    () => _selectTab(CustomerTab.cart),
                  ),
                  if (isGuest)
                    item(
                      Icons.person_add_alt_1_outlined,
                      _tr('Register'),
                      () => Navigator.of(context).pushNamed('/register'),
                    )
                  else
                    item(
                      Icons.key_outlined,
                      _tr('Change Password'),
                      () => Navigator.of(context).pushNamed('/change-password'),
                    ),
                  item(
                    Icons.support_agent_outlined,
                    _tr('Contact Us'),
                    _showSupportOptions,
                  ),
                  item(
                    Icons.logout_rounded,
                    _tr('Logout'),
                    _logout,
                    color: AppColors.danger,
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  void _logout() {
    Provider.of<AuthProvider>(context, listen: false).logout();
    Navigator.of(context).pushReplacementNamed('/login');
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthProvider>(context);
    final user = auth.user;

    Widget body;
    switch (_tab) {
      case CustomerTab.stores:
        body = _buildStoresTab();
        break;
      case CustomerTab.account:
        body = _buildAccountTab(user, auth.isGuest);
        break;
      default:
        body = _buildHomeTab(user);
    }

    return LanguageScope(
      isUrdu: _isUrdu,
      child: PopScope(
        canPop: _tab == CustomerTab.home,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) _selectTab(CustomerTab.home);
        },
        child: Scaffold(
          backgroundColor: AppColors.background,
          body: SafeArea(
            bottom: false,
            child: AnimatedSwitcher(
              duration: AppMotion.fast,
              child: KeyedSubtree(key: ValueKey(_tab), child: body),
            ),
          ),
          bottomNavigationBar: CustomerBottomNav(
            current: _tab,
            isUrdu: _isUrdu,
            onSelect: _selectTab,
          ),
        ),
      ),
    );
  }

  bool get _isFiltering =>
      _searchController.text.trim().isNotEmpty || _selectedCategory != 'all';

  Widget _buildHomeTab(User? user) {
    final popular = _popularStores();
    return RefreshIndicator(
      onRefresh: () async {
        await _fetchData();
        await _loadHomeExtras();
      },
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverToBoxAdapter(child: _buildTopBar(user)),
          SliverToBoxAdapter(child: _buildSearchField()),
          if (_categoryOptions.length > 1)
            SliverToBoxAdapter(child: _buildCategoryStrip()),
          if (_showAppUpdateBanner())
            SliverToBoxAdapter(child: _buildAppUpdateBanner()),
          if (_showGlobalStatusBanner() && _isGlobalOrderingBlocked())
            SliverToBoxAdapter(child: _buildGlobalStatusBanner()),
          if (_serviceLimitedMessage != null)
            SliverToBoxAdapter(child: _buildServiceLimitWarning()),
          if (!_isFiltering) ...[
            SliverToBoxAdapter(child: _buildBannerSection()),
            if (_recentOrders.isNotEmpty)
              SliverToBoxAdapter(child: _buildOrderAgainRow()),
            if (!_isLoading && _errorMessage == null && popular.length >= 3)
              SliverToBoxAdapter(child: _buildPopularRow(popular)),
          ],
          ..._buildStoreListSlivers(
            title: _isFiltering ? _resultsTitle() : _tr('All stores'),
            subtitle: _isFiltering
                ? null
                : _tr('Tap any store to browse its live products'),
          ),
          const SliverToBoxAdapter(child: SizedBox(height: AppSpace.xxl)),
        ],
      ),
    );
  }

  Widget _buildStoresTab() {
    return RefreshIndicator(
      onRefresh: _fetchData,
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpace.gutter,
                AppSpace.lg,
                AppSpace.gutter,
                AppSpace.xs,
              ),
              child: Semantics(
                header: true,
                child: Text(_tr('Stores'), style: AppText.h1),
              ),
            ),
          ),
          SliverToBoxAdapter(child: _buildSearchField()),
          if (_categoryOptions.length > 1)
            SliverToBoxAdapter(child: _buildCategoryStrip()),
          if (_serviceLimitedMessage != null)
            SliverToBoxAdapter(child: _buildServiceLimitWarning()),
          ..._buildStoreListSlivers(
            title: _isFiltering
                ? _resultsTitle()
                : '${_allStores.length} ${_tr('stores near you')}',
          ),
          const SliverToBoxAdapter(child: SizedBox(height: AppSpace.xxl)),
        ],
      ),
    );
  }

  String _resultsTitle() {
    final query = _searchController.text.trim();
    if (query.isNotEmpty) {
      return '${_tr('Results for')} "${_isUrdu ? Fmt.isolate(query) : query}"';
    }
    for (final option in _categoryOptions) {
      if (option['key'] == _selectedCategory) {
        return (option['label'] ?? '').toString();
      }
    }
    return _tr('Stores');
  }

  List<dynamic> _popularStores() {
    final open = _allStores.where(_isStoreOpen).toList();
    open.sort(
      (a, b) =>
          Fmt.toDouble(b['rating']).compareTo(Fmt.toDouble(a['rating'])),
    );
    return open.take(8).toList();
  }

  // ---------------------------------------------------------------------------
  // Header, search, categories
  // ---------------------------------------------------------------------------

  Widget _buildTopBar(User? user) {
    final firstName = (user?.firstName ?? '').trim();
    final greeting = firstName.isNotEmpty && user?.isGuest != true
        ? (_isUrdu
              ? '${_tr('Hi')} ${Fmt.isolate(firstName)}'
              : '${_tr('Hi')}, $firstName')
        : _tr('Welcome to ServeNow');
    final area = _userCity?.isNotEmpty == true ? _userCity! : _tr('Your area');
    final units = context.select<CartProvider, int>((c) => c.totalUnits);

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpace.sm,
        AppSpace.sm,
        AppSpace.xs,
        AppSpace.xs,
      ),
      child: Row(
        children: [
          IconButton(
            tooltip: _tr('Menu'),
            onPressed: _openQuickActions,
            icon: const Icon(Icons.menu_rounded),
          ),
          const SizedBox(width: AppSpace.xs),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  greeting,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.caption.copyWith(color: AppColors.text2),
                ),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.location_on_rounded,
                      size: 16,
                      color: AppColors.primary,
                    ),
                    const SizedBox(width: 2),
                    Flexible(
                      child: Text(
                        area,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.title,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          Semantics(
            button: true,
            label: _tr('Language'),
            excludeSemantics: true,
            child: TextButton(
              onPressed: _showLanguageOptions,
              style: TextButton.styleFrom(
                foregroundColor: AppColors.primaryPressed,
                minimumSize: const Size(48, 48),
                padding: const EdgeInsets.symmetric(horizontal: 10),
              ),
              child: Text(_languageLabel()),
            ),
          ),
          const NotificationBellWidget(),
          IconButton(
            tooltip: _tr('Open cart'),
            onPressed: () => _selectTab(CustomerTab.cart),
            icon: Badge(
              isLabelVisible: units > 0,
              label: Text(units > 99 ? '99+' : '$units'),
              child: const Icon(Icons.shopping_cart_outlined),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchField() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpace.gutter,
        AppSpace.sm,
        AppSpace.gutter,
        0,
      ),
      child: TextField(
        controller: _searchController,
        textInputAction: TextInputAction.search,
        decoration: InputDecoration(
          hintText: _tr('Search stores or areas'),
          prefixIcon: const Icon(Icons.search_rounded),
          fillColor: AppColors.surface,
          enabledBorder: const OutlineInputBorder(
            borderRadius: AppRadius.controlAll,
            borderSide: BorderSide(color: AppColors.border),
          ),
          suffixIcon: _searchController.text.trim().isEmpty
              ? null
              : IconButton(
                  tooltip: _tr('Clear search'),
                  onPressed: () {
                    _searchController.clear();
                    _filterStores('');
                  },
                  icon: const Icon(Icons.close_rounded),
                ),
        ),
      ),
    );
  }

  Widget _buildCategoryStrip() {
    final options = _categoryOptions;
    if (options.isEmpty) return const SizedBox.shrink();
    return SizedBox(
      height: 60,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.fromLTRB(
          AppSpace.gutter,
          AppSpace.md,
          AppSpace.gutter,
          AppSpace.xs,
        ),
        itemCount: options.length,
        separatorBuilder: (_, _) => const SizedBox(width: AppSpace.sm),
        itemBuilder: (context, index) {
          final option = options[index];
          final selected = option['key'] == _selectedCategory;
          return ChoiceChip(
            selected: selected,
            onSelected: (_) =>
                _applyFilters(categoryKey: option['key'] as String),
            avatar: Icon(
              option['icon'] as IconData,
              size: 18,
              color: selected ? AppColors.primaryPressed : AppColors.text2,
            ),
            label: Text((option['label'] ?? '').toString()),
            side: BorderSide(
              color: selected ? AppColors.primary : AppColors.border,
            ),
          );
        },
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Banners
  // ---------------------------------------------------------------------------

  Widget _noticeCard({
    required IconData icon,
    required String text,
    required Color foreground,
    required Color background,
    String? title,
  }) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpace.gutter,
        AppSpace.md,
        AppSpace.gutter,
        0,
      ),
      child: Container(
        padding: const EdgeInsets.all(AppSpace.md),
        decoration: BoxDecoration(
          color: background,
          borderRadius: AppRadius.controlAll,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: foreground, size: 22),
            const SizedBox(width: AppSpace.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (title != null)
                    Text(
                      title,
                      style: AppText.bodyStrong.copyWith(
                        color: foreground,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  Text(
                    text,
                    style: AppText.small.copyWith(
                      color: foreground,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildGlobalStatusBanner() {
    final blocked = _isGlobalOrderingBlocked();
    return _noticeCard(
      icon: blocked ? Icons.block_rounded : Icons.info_outline_rounded,
      title: blocked ? _tr('Live Delivery Pause') : _tr('Delivery Update'),
      text: _globalStatusMessage(),
      foreground: blocked ? AppColors.danger : AppColors.warning,
      background: blocked ? AppColors.dangerBg : AppColors.warningBg,
    );
  }

  Widget _buildServiceLimitWarning() {
    return _noticeCard(
      icon: Icons.location_off_outlined,
      text: _serviceLimitedMessage ?? '',
      foreground: AppColors.warning,
      background: AppColors.warningBg,
    );
  }

  Widget _buildBannerSection() {
    final items = _liveWidgetItems;
    if (items.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(
          title: _tr('Featured'),
          subtitle: _tr('Fresh offers and live delivery updates'),
        ),
        SizedBox(
          height: 148,
          child: PageView.builder(
            controller: _bannerController,
            onPageChanged: (index) {
              setState(() => _activeBanner = index);
            },
            itemCount: items.length,
            itemBuilder: (context, index) {
              final item = items[index];
              Widget child;
              if (item['type'] == 'promotion') {
                child = _promotionBanner();
              } else if (item['type'] == 'status') {
                child = _statusBanner();
              } else {
                child = _storeBanner(item['data']);
              }
              return Padding(
                padding: const EdgeInsets.symmetric(horizontal: 6),
                child: child,
              );
            },
          ),
        ),
        const SizedBox(height: AppSpace.md),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(items.length, (i) {
            final active = i == _activeBanner;
            return AnimatedContainer(
              duration: AppMotion.medium,
              margin: const EdgeInsets.symmetric(horizontal: 3),
              width: active ? 18 : 6,
              height: 6,
              decoration: BoxDecoration(
                color: active ? AppColors.primary : AppColors.borderStrong,
                borderRadius: AppRadius.pillAll,
              ),
            );
          }),
        ),
      ],
    );
  }

  Widget _promotionBanner() {
    final promoImages = _promotionImages();
    final promoTitle = (_livePromotions?['title'] ?? _tr('Live Promotions'))
        .toString()
        .trim();
    final promoMessage = _livePromotionMessage();
    final bg = promoImages.isNotEmpty
        ? ApiService.getImageUrl(promoImages.first)
        : '';
    return ClipRRect(
      borderRadius: AppRadius.cardAll,
      child: Stack(
        fit: StackFit.expand,
        children: [
          AppNetworkImage(url: bg, placeholderIcon: Icons.campaign_outlined),
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.bottomCenter,
                end: Alignment.topCenter,
                colors: [Color(0xD9111827), Color(0x26111827)],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(AppSpace.lg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TonePill.success(_tr('Live offer')),
                const Spacer(),
                Text(
                  promoTitle.isNotEmpty ? promoTitle : _tr('Live Promotions'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.h2.copyWith(color: Colors.white),
                ),
                if (promoMessage.isNotEmpty)
                  Text(
                    promoMessage,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.small.copyWith(color: Colors.white),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _statusBanner() {
    final blocked = _isGlobalOrderingBlocked();
    final fg = blocked ? AppColors.danger : AppColors.warning;
    return Container(
      padding: const EdgeInsets.all(AppSpace.lg),
      decoration: BoxDecoration(
        color: blocked ? AppColors.dangerBg : AppColors.warningBg,
        borderRadius: AppRadius.cardAll,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                blocked ? Icons.block_rounded : Icons.info_outline_rounded,
                color: fg,
              ),
              const SizedBox(width: AppSpace.sm),
              Expanded(
                child: Text(
                  blocked ? _tr('Live Delivery Pause') : _tr('Delivery Update'),
                  style: AppText.title.copyWith(color: fg),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpace.sm),
          Expanded(
            child: Text(
              _globalStatusMessage(),
              maxLines: 3,
              overflow: TextOverflow.ellipsis,
              style: AppText.small.copyWith(
                color: fg,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Store banner: white card, logo shown whole (no cropping) on one side,
  /// readable dark text on the other.
  Widget _storeBanner(dynamic store) {
    final isOpen = _isStoreOpen(store);
    return Material(
      color: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: AppRadius.cardAll,
        side: BorderSide(color: AppColors.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => _openStore(store),
        child: Row(
          children: [
            AspectRatio(
              aspectRatio: 1,
              child: ColoredBox(
                color: AppColors.surface2,
                child: AppNetworkImage(
                  url: ApiService.getImageUrl(store['image_url']),
                  fit: BoxFit.cover,
                ),
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(AppSpace.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    OpenBadge(
                      isOpen: isOpen,
                      openLabel: _tr('Open'),
                      closedLabel: _tr('Closed'),
                    ),
                    const SizedBox(height: AppSpace.sm),
                    Text(
                      (store['name'] ?? '').toString(),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.title.copyWith(height: _isUrdu ? null : 1.2),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      (store['location'] ?? '').toString(),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.caption,
                    ),
                    const Spacer(),
                    Text(
                      '${_tr('Order now')} →',
                      style: AppText.label.copyWith(color: AppColors.primary),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Order again + popular rows
  // ---------------------------------------------------------------------------

  Widget _buildOrderAgainRow() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(
          title: _tr('Order again'),
          actionLabel: _tr('My Orders'),
          onAction: () => _selectTab(CustomerTab.orders),
        ),
        SizedBox(
          height: 112,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
            itemCount: _recentOrders.length,
            separatorBuilder: (_, _) => const SizedBox(width: AppSpace.md),
            itemBuilder: (context, index) {
              final order = _recentOrders[index];
              final store = _storeById(order['store_id']);
              final items = ((order['items'] as List?) ?? const [])
                  .whereType<Map>()
                  .map(
                    (i) => (i['product_name'] ?? i['name'] ?? '')
                        .toString()
                        .trim(),
                  )
                  .where((n) => n.isNotEmpty)
                  .take(2)
                  .join(', ');
              return SizedBox(
                width: 260,
                child: AppCard(
                  padding: const EdgeInsets.all(AppSpace.md),
                  onTap: store == null ? null : () => _openStore(store),
                  child: Row(
                    children: [
                      AppNetworkImage(
                        url: store == null
                            ? null
                            : ApiService.getImageUrl(store['image_url']),
                        width: 64,
                        height: 64,
                        borderRadius: AppRadius.controlAll,
                      ),
                      const SizedBox(width: AppSpace.md),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              (order['store_name'] ?? store?['name'] ?? '')
                                  .toString(),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: AppText.bodyStrong,
                            ),
                            if (items.isNotEmpty)
                              Text(
                                items,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: AppText.caption,
                              ),
                            const SizedBox(height: 4),
                            Row(
                              children: [
                                Expanded(
                                  child: Text(
                                    Fmt.money(
                                      order['total_amount'],
                                      urdu: _isUrdu,
                                    ),
                                    style: AppText.label.copyWith(
                                      color: AppColors.text,
                                      fontFeatures: AppText.tabular,
                                    ),
                                  ),
                                ),
                                if (store != null)
                                  Text(
                                    _tr('Reorder'),
                                    style: AppText.label.copyWith(
                                      color: AppColors.primary,
                                    ),
                                  ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _buildPopularRow(List<dynamic> stores) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(
          title: _tr('Popular Stores'),
          subtitle: _tr('Top rated and open now'),
          actionLabel: _tr('See all'),
          onAction: () => _selectTab(CustomerTab.stores),
        ),
        SizedBox(
          height: 248 * 9 / 16 + (_isUrdu ? 168 : 128),
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
            itemCount: stores.length,
            separatorBuilder: (_, _) => const SizedBox(width: AppSpace.md),
            itemBuilder: (context, index) =>
                Align(alignment: Alignment.topCenter, child: _storeCard(stores[index], width: 248)),
          ),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Store list
  // ---------------------------------------------------------------------------

  List<Widget> _buildStoreListSlivers({required String title, String? subtitle}) {
    final header = SliverToBoxAdapter(
      child: SectionHeader(title: title, subtitle: subtitle),
    );

    if (_isLoading) {
      return [
        header,
        SliverPadding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
          sliver: SliverToBoxAdapter(
            child: Shimmer(
              child: Column(
                children: List.generate(
                  3,
                  (_) => const Padding(
                    padding: EdgeInsets.only(bottom: AppSpace.md),
                    child: SkeletonCard(imageHeight: 150),
                  ),
                ),
              ),
            ),
          ),
        ),
      ];
    }

    if (_errorMessage != null) {
      return [
        SliverToBoxAdapter(
          child: EmptyState(
            icon: Icons.wifi_off_rounded,
            isError: true,
            title: _tr('Could not load stores'),
            message: _tr('Check your connection and try again.'),
            actionLabel: _tr('Retry'),
            actionIcon: Icons.refresh_rounded,
            onAction: _fetchData,
          ),
        ),
      ];
    }

    if (_filteredStores.isEmpty) {
      return [
        header,
        SliverToBoxAdapter(
          child: EmptyState(
            compact: true,
            icon: Icons.storefront_outlined,
            title: _serviceLimitedMessage != null
                ? _tr('No stores in your area yet')
                : _tr('No stores found'),
            message: _serviceLimitedMessage ??
                _tr('Try another name or category.'),
            actionLabel: _isFiltering ? _tr('Show all stores') : null,
            onAction: _isFiltering
                ? () {
                    _searchController.clear();
                    _applyFilters(query: '', categoryKey: 'all');
                  }
                : null,
          ),
        ),
      ];
    }

    final width = MediaQuery.sizeOf(context).width;
    final columns = width >= 1100 ? 3 : (width >= 700 ? 2 : 1);
    return [
      header,
      SliverPadding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
        sliver: columns == 1
            ? SliverList.separated(
                itemCount: _filteredStores.length,
                separatorBuilder: (_, _) => const SizedBox(height: AppSpace.md),
                itemBuilder: (context, index) =>
                    _storeCard(_filteredStores[index]),
              )
            : SliverGrid.builder(
                gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                  crossAxisCount: columns,
                  crossAxisSpacing: AppSpace.md,
                  mainAxisSpacing: AppSpace.md,
                  mainAxisExtent: (width - 32) / columns * 9 / 16 + 100,
                ),
                itemCount: _filteredStores.length,
                itemBuilder: (context, index) =>
                    _storeCard(_filteredStores[index]),
              ),
      ),
    ];
  }

  // ---------------------------------------------------------------------------
  // Account tab
  // ---------------------------------------------------------------------------

  Widget _buildAccountTab(User? user, bool isGuest) {
    final fullName = user == null
        ? ''
        : '${user.firstName} ${user.lastName}'.trim();
    final name = isGuest || fullName.isEmpty ? _tr('Guest') : fullName;
    final initial = name.isNotEmpty ? name.substring(0, 1).toUpperCase() : 'S';

    Widget tile(
      IconData icon,
      String label,
      VoidCallback onTap, {
      Color? color,
      String? trailing,
    }) {
      return ListTile(
        leading: Icon(icon, color: color ?? AppColors.text2),
        title: Text(label, style: TextStyle(color: color)),
        trailing: trailing != null
            ? Text(trailing, style: AppText.small)
            : const Icon(Icons.chevron_right_rounded, color: AppColors.muted),
        minTileHeight: 56,
        onTap: onTap,
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpace.gutter,
        AppSpace.lg,
        AppSpace.gutter,
        AppSpace.xxl,
      ),
      children: [
        Semantics(
          header: true,
          child: Text(_tr('Account'), style: AppText.h1),
        ),
        const SizedBox(height: AppSpace.lg),
        AppCard(
          child: Row(
            children: [
              CircleAvatar(
                radius: 26,
                backgroundColor: AppColors.tint100,
                child: Text(
                  initial,
                  style: AppText.h2.copyWith(color: AppColors.primaryPressed),
                ),
              ),
              const SizedBox(width: AppSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, style: AppText.title),
                    if (!isGuest && (user?.email ?? '').isNotEmpty)
                      Text(
                        Fmt.isolate(user!.email),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.small,
                      ),
                    if (isGuest)
                      Text(
                        _tr('Register to place orders and track them.'),
                        style: AppText.small,
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
        if (isGuest) ...[
          const SizedBox(height: AppSpace.md),
          PrimaryButton(
            label: _tr('Register'),
            icon: Icons.person_add_alt_1_outlined,
            onPressed: () => Navigator.of(context).pushNamed('/register'),
          ),
        ],
        const SizedBox(height: AppSpace.lg),
        AppCard(
          padding: const EdgeInsets.symmetric(vertical: AppSpace.xs),
          child: Column(
            children: [
              tile(
                Icons.receipt_long_outlined,
                _tr('My Orders'),
                () => _selectTab(CustomerTab.orders),
              ),
              tile(
                Icons.shopping_cart_outlined,
                _tr('My Cart'),
                () => _selectTab(CustomerTab.cart),
              ),
              if (!isGuest)
                tile(
                  Icons.key_outlined,
                  _tr('Change Password'),
                  () => Navigator.of(context).pushNamed('/change-password'),
                ),
              tile(
                Icons.translate_rounded,
                _tr('Language'),
                _showLanguageOptions,
                trailing: _isUrdu ? 'اردو' : 'English',
              ),
              tile(
                Icons.support_agent_outlined,
                _tr('Contact Us'),
                _showSupportOptions,
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpace.lg),
        AppCard(
          padding: const EdgeInsets.symmetric(vertical: AppSpace.xs),
          child: tile(
            Icons.logout_rounded,
            _tr('Logout'),
            _logout,
            color: AppColors.danger,
          ),
        ),
        const SizedBox(height: AppSpace.xxl),
        const AppVersionText(),
      ],
    );
  }
}
