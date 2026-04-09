import 'dart:async';

import 'package:package_info_plus/package_info_plus.dart';
import 'package:flutter/material.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/user.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../providers/notification_provider.dart' as app_notif;
import '../services/api_service.dart';
import '../theme/customer_palette.dart';
import '../utils/customer_language.dart';
import '../widgets/notification_bell_widget.dart';
import 'store_screen.dart';

class CustomerDashboardTestScreen extends StatefulWidget {
  const CustomerDashboardTestScreen({super.key});

  @override
  State<CustomerDashboardTestScreen> createState() =>
      _CustomerDashboardTestScreenState();
}

class _CustomerDashboardTestScreenState
    extends State<CustomerDashboardTestScreen> {
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
  final PageController _bannerController = PageController();
  int _activeBanner = 0;
  Timer? _bannerTimer;
  Timer? _globalStatusRefreshTimer;
  Timer? _livePromotionsRefreshTimer;
  Timer? _globalStatusPollTimer;
  int _bottomIndex = 0;
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
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _tr('Select Language'),
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.language),
                  title: Text(_tr('English')),
                  trailing: !_isUrdu
                      ? Text(
                          _tr('Selected'),
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        )
                      : null,
                  onTap: () async {
                    Navigator.of(sheetContext).pop();
                    await _setLanguage(false);
                  },
                ),
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: const Icon(Icons.translate),
                  title: const Text('اردو'),
                  trailing: _isUrdu
                      ? Text(
                          _tr('Selected'),
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        )
                      : null,
                  onTap: () async {
                    Navigator.of(sheetContext).pop();
                    await _setLanguage(true);
                  },
                ),
              ],
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
      await _resolveLocationContext();
      Map<String, dynamic>? globalStatus;
      if (token != null) {
        try {
          final global = await ApiService.getGlobalDeliveryStatus(token);
          globalStatus = (global['status'] is Map<String, dynamic>)
              ? (global['status'] as Map<String, dynamic>)
              : (global['global_status'] is Map<String, dynamic>)
              ? (global['global_status'] as Map<String, dynamic>)
              : global;
        } catch (_) {}
      }
      Map<String, dynamic>? livePromotions;
      try {
        final promotions = await ApiService.getLivePromotions(token);
        livePromotions = (promotions['live_promotions'] is Map<String, dynamic>)
            ? (promotions['live_promotions'] as Map<String, dynamic>)
            : promotions;
      } catch (_) {}
      Map<String, dynamic>? customerFlash;
      Map<String, dynamic>? supportContact;
      Map<String, dynamic>? appUpdateStatus;
      if (token != null) {
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
      final storesResp = await ApiService.getStores(
        latitude: _userLat,
        longitude: _userLng,
        city: _userCity,
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
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _resolveLocationContext() async {
    try {
      if (_userLat != null && _userLng != null) return;
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) return;
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return;
      }
      final position = await Geolocator.getCurrentPosition();
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
    } catch (_) {}
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

  Future<void> _makeCall(String phoneNumber) async {
    final cleaned = phoneNumber.trim().replaceAll(RegExp(r'[^0-9+]'), '');
    if (cleaned.isEmpty) return;
    final uri = Uri(scheme: 'tel', path: cleaned);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _openWhatsApp(String phoneNumber) async {
    final cleanPhone = phoneNumber.replaceAll(RegExp(r'[^0-9]'), '');
    if (cleanPhone.isEmpty) return;
    final uri = Uri.parse('https://wa.me/$cleanPhone');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _sendEmail(String emailAddress) async {
    final cleaned = emailAddress.trim();
    if (cleaned.isEmpty) return;
    final uri = Uri(
      scheme: 'mailto',
      path: cleaned,
      queryParameters: {'subject': _tr('ServeNow Support')},
    );
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  Future<void> _showSupportOptions() async {
    Map<String, dynamic> contact = _supportContact ?? const <String, dynamic>{};
    final token = Provider.of<AuthProvider>(context, listen: false).token;
    if ((contact['phone'] ?? '').toString().trim().isEmpty &&
        (contact['whatsapp'] ?? '').toString().trim().isEmpty &&
        (contact['email'] ?? '').toString().trim().isEmpty &&
        token != null) {
      try {
        contact = await ApiService.getCustomerSupportContact(token);
        if (!mounted) return;
        setState(() {
          _supportContact = contact;
        });
      } catch (_) {}
    }

    final name = (contact['name'] ?? _tr('Contact Us')).toString().trim();
    final phone = (contact['phone'] ?? '').toString().trim();
    final whatsapp = (contact['whatsapp'] ?? phone).toString().trim();
    final email = (contact['email'] ?? '').toString().trim();

    if (phone.isEmpty && whatsapp.isEmpty && email.isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_tr('Support contact is not configured yet.'))),
      );
      return;
    }

    if (!mounted) return;
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name.isEmpty ? _tr('Contact Us') : name,
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  _tr('Choose how you want to contact us.'),
                  style: TextStyle(fontSize: 12.5, color: Colors.black54),
                ),
                const SizedBox(height: 12),
                if (phone.isNotEmpty)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const CircleAvatar(
                      backgroundColor: Color(0xFFE8F1FF),
                      child: Icon(Icons.call_outlined, color: Colors.blue),
                    ),
                    title: Text(_tr('Call')),
                    subtitle: Text(phone),
                    onTap: () {
                      Navigator.of(sheetContext).pop();
                      _makeCall(phone);
                    },
                  ),
                if (whatsapp.isNotEmpty)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const CircleAvatar(
                      backgroundColor: Color(0xFFEAF9EF),
                      child: Icon(Icons.chat_outlined, color: Colors.green),
                    ),
                    title: Text(_tr('WhatsApp')),
                    subtitle: Text(whatsapp),
                    onTap: () {
                      Navigator.of(sheetContext).pop();
                      _openWhatsApp(whatsapp);
                    },
                  ),
                if (email.isNotEmpty)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const CircleAvatar(
                      backgroundColor: Color(0xFFEFF3FF),
                      child: Icon(
                        Icons.email_outlined,
                        color: CustomerPalette.primary,
                      ),
                    ),
                    title: Text(_tr('Email')),
                    subtitle: Text(email),
                    onTap: () {
                      Navigator.of(sheetContext).pop();
                      _sendEmail(email);
                    },
                  ),
              ],
            ),
          ),
        );
      },
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
      margin: const EdgeInsets.fromLTRB(16, 4, 16, 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF4E8),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFFFD5A8)),
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
            style: const TextStyle(fontSize: 12, color: Colors.black54),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: () => _openAppUpdateLink(status),
                  icon: const Icon(Icons.open_in_new, size: 16),
                  label: Text(_tr('Update Now')),
                  style: FilledButton.styleFrom(
                    backgroundColor: CustomerPalette.primary,
                    foregroundColor: Colors.white,
                    visualDensity: VisualDensity.compact,
                  ),
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

  void _tryShowLaunchFlash() {
    if (!mounted || _launchFlashShown) return;
    final flash = _promotionFlashData();
    if (flash == null) return;
    _launchFlashShown = true;

    final signature = (flash['signature'] ?? '').toString();
    if (signature.isNotEmpty && _launchFlashSignature != signature) {
      _launchFlashSignature = signature;
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
                borderRadius: BorderRadius.circular(18),
                boxShadow: const [
                  BoxShadow(
                    color: Colors.black26,
                    blurRadius: 16,
                    offset: Offset(0, 8),
                  ),
                ],
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(
                        Icons.campaign,
                        color: CustomerPalette.primary,
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
                                  color: const Color(0xFFFDEBD0),
                                  alignment: Alignment.center,
                                  child: const Icon(
                                    Icons.image_not_supported_outlined,
                                    size: 34,
                                    color: Color(0xFFB35A00),
                                  ),
                                ),
                              ),
                            )
                          : Container(
                              color: const Color(0xFFFDEBD0),
                              alignment: Alignment.center,
                              child: const Icon(
                                Icons.celebration_outlined,
                                size: 44,
                                color: Color(0xFFB35A00),
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
                      style: FilledButton.styleFrom(
                        backgroundColor: CustomerPalette.primary,
                      ),
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
    final start = DateTime.tryParse((startRaw ?? '').toString());
    final end = DateTime.tryParse((endRaw ?? '').toString());
    if (start == null || end == null) return '';
    final startLocal = start.toLocal();
    final endLocal = end.toLocal();
    return '${startLocal.toString().substring(0, 16)} - ${endLocal.toString().substring(0, 16)}';
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

  Widget _buildGlobalStatusBanner() {
    final blocked = _isGlobalOrderingBlocked();
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: blocked ? Colors.red.shade50 : Colors.orange.shade50,
        border: Border.all(
          color: blocked ? Colors.red.shade200 : Colors.orange.shade200,
        ),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(
            blocked ? Icons.block : Icons.info_outline,
            color: blocked ? Colors.red.shade700 : Colors.orange.shade700,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              _globalStatusMessage(),
              style: TextStyle(
                color: blocked ? Colors.red.shade800 : Colors.orange.shade900,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }

  void _openQuickActions() {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (ctx) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.shopping_bag_outlined),
                title: Text(_tr('My Orders')),
                onTap: () {
                  Navigator.of(ctx).pop();
                  Navigator.of(context).pushNamed('/orders');
                },
              ),
              ListTile(
                leading: const Icon(Icons.shopping_cart_outlined),
                title: Text(_tr('My Cart')),
                onTap: () {
                  Navigator.of(ctx).pop();
                  Navigator.of(context).pushNamed('/cart');
                },
              ),
              ListTile(
                leading: const Icon(Icons.key_outlined),
                title: Text(_tr('Change Password')),
                onTap: () {
                  Navigator.of(ctx).pop();
                  Navigator.of(context).pushNamed('/change-password');
                },
              ),
              ListTile(
                leading: const Icon(Icons.support_agent_outlined),
                title: Text(_tr('Contact Us')),
                onTap: () {
                  Navigator.of(ctx).pop();
                  _showSupportOptions();
                },
              ),
              ListTile(
                leading: const Icon(Icons.logout, color: Colors.red),
                title: Text(
                  _tr('Logout'),
                  style: const TextStyle(color: Colors.red),
                ),
                onTap: () {
                  Navigator.of(ctx).pop();
                  Provider.of<AuthProvider>(context, listen: false).logout();
                  Navigator.of(context).pushReplacementNamed('/login');
                },
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = Provider.of<AuthProvider>(context);
    final user = auth.user;
    final crossAxisCount = MediaQuery.of(context).size.width >= 1100 ? 3 : 2;

    return Directionality(
      textDirection: _isUrdu ? TextDirection.rtl : TextDirection.ltr,
      child: Scaffold(
        backgroundColor: Colors.transparent,
        extendBody: true,
        body: Stack(
          children: [
            _buildBackdrop(),
            SafeArea(
              child: RefreshIndicator(
                onRefresh: _fetchData,
                child: SingleChildScrollView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.fromLTRB(16, 14, 16, 110),
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 620),
                      child: Container(
                        decoration: BoxDecoration(
                          borderRadius: BorderRadius.circular(36),
                          color: Colors.white.withValues(alpha: 0.76),
                          border: Border.all(
                            color: Colors.white.withValues(alpha: 0.7),
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.12),
                              blurRadius: 28,
                              offset: const Offset(0, 18),
                            ),
                          ],
                        ),
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(16, 14, 16, 20),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _buildTopBar(),
                              if (user != null) _buildWelcomeText(user),
                              if (user != null) _buildHeroCard(user),
                              _buildSearchField(),
                              if (_categoryOptions.length > 1)
                                _buildCategoryStrip(),
                              if (_showAppUpdateBanner())
                                Padding(
                                  padding: const EdgeInsets.only(top: 8),
                                  child: _buildAppUpdateBanner(),
                                ),
                              if (_showGlobalStatusBanner())
                                Padding(
                                  padding: const EdgeInsets.only(top: 12),
                                  child: _buildGlobalStatusBanner(),
                                ),
                              if (_serviceLimitedMessage != null)
                                _buildServiceLimitWarning(),
                              _buildBannerSection(),
                              _buildStoreSection(crossAxisCount),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
        bottomNavigationBar: _buildBottomBar(),
      ),
    );
  }

  Widget _buildBackdrop() {
    return Stack(
      children: [
        Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [Color(0xFFFFF6EA), Color(0xFFF7D4B7), Color(0xFFF4C29B)],
            ),
          ),
        ),
        Positioned(
          left: -70,
          top: 60,
          child: _buildBlurOrb(
            size: 220,
            colors: const [Color(0xFFFFD58A), Color(0x00FFD58A)],
          ),
        ),
        Positioned(
          right: -30,
          top: 120,
          child: _buildBlurOrb(
            size: 170,
            colors: const [Color(0xFFFFB26F), Color(0x00FFB26F)],
          ),
        ),
        Positioned(
          right: -90,
          bottom: 40,
          child: _buildBlurOrb(
            size: 280,
            colors: const [Color(0xFFF0A35B), Color(0x00F0A35B)],
          ),
        ),
        Positioned(
          left: -40,
          bottom: 120,
          child: _buildBlurOrb(
            size: 190,
            colors: const [Color(0xFFFFE0B8), Color(0x00FFE0B8)],
          ),
        ),
      ],
    );
  }

  Widget _buildBlurOrb({required double size, required List<Color> colors}) {
    return IgnorePointer(
      child: Container(
        width: size,
        height: size,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          gradient: RadialGradient(colors: colors),
        ),
      ),
    );
  }

  Widget _buildTopBar() {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          _buildHeaderAction(
            icon: Icons.menu_rounded,
            onTap: _openQuickActions,
            solid: true,
          ),
          const Spacer(),
          TextButton.icon(
            onPressed: _showLanguageOptions,
            icon: const Icon(Icons.language, color: CustomerPalette.primary),
            label: Text(
              _languageLabel(),
              style: const TextStyle(
                color: CustomerPalette.primary,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const NotificationBellWidget(),
          Consumer<CartProvider>(
            builder: (ctx, cart, child) => Stack(
              children: [
                _buildHeaderAction(
                  icon: Icons.shopping_cart_outlined,
                  onTap: () => Navigator.of(context).pushNamed('/cart'),
                ),
                if (cart.itemCount > 0)
                  Positioned(
                    right: 0,
                    top: 0,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 6,
                        vertical: 3,
                      ),
                      decoration: BoxDecoration(
                        color: CustomerPalette.primaryDark,
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        '${cart.itemCount}',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildHeaderAction({
    required IconData icon,
    required VoidCallback onTap,
    bool solid = false,
  }) {
    return Container(
      margin: const EdgeInsets.only(right: 8),
      decoration: BoxDecoration(
        color: solid
            ? CustomerPalette.primaryDark
            : Colors.white.withValues(alpha: 0.82),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: solid
              ? CustomerPalette.primaryDark
              : CustomerPalette.primary.withValues(alpha: 0.2),
        ),
      ),
      child: IconButton(
        icon: Icon(
          icon,
          color: solid ? Colors.white : CustomerPalette.primaryDark,
        ),
        onPressed: onTap,
      ),
    );
  }

  Widget _buildWelcomeText(User user) {
    final fullName = '${user.firstName} ${user.lastName}'.trim();
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 6, 8, 0),
      child: Center(
        child: Text(
          '${_tr('Welcome')}, ${fullName.isNotEmpty ? fullName : _tr('ServeNow Customer')}',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w700,
            color: CustomerPalette.primaryDark,
          ),
        ),
      ),
    );
  }

  Widget _buildHeroCard(User user) {
    final cartCount = context.watch<CartProvider>().itemCount;
    final locationLabel = _userCity?.isNotEmpty == true
        ? _userCity!
        : _tr('Home');
    return Padding(
      padding: const EdgeInsets.fromLTRB(6, 8, 6, 8),
      child: Column(
        children: [
          Text(
            _userCity?.isNotEmpty == true
                ? '${_tr('Ref Area')}: $_userCity'
                : 'Groceries, food & more',
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Colors.black54,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.2,
            ),
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: _buildMetricPill(
                  icon: Icons.storefront_rounded,
                  label: '${_allStores.length} ${_tr('Stores')}',
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _buildMetricPill(
                  icon: Icons.shopping_cart_checkout_rounded,
                  label: '$cartCount ${_tr('My Cart')}',
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _buildMetricPill(
                  icon: Icons.place_rounded,
                  label: locationLabel,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  onPressed: () => Navigator.of(context).pushNamed('/orders'),
                  icon: const Icon(Icons.shopping_bag_outlined, size: 18),
                  label: Text(_tr('My Orders')),
                  style: FilledButton.styleFrom(
                    backgroundColor: CustomerPalette.primary,
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(18),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _showSupportOptions,
                  icon: const Icon(Icons.support_agent_rounded, size: 18),
                  label: Text(_tr('Contact Us')),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: CustomerPalette.primaryDark,
                    side: BorderSide(
                      color: CustomerPalette.primary.withValues(alpha: 0.3),
                    ),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    backgroundColor: Colors.white.withValues(alpha: 0.75),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(18),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMetricPill({required IconData icon, required String label}) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.8),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(
          color: CustomerPalette.primary.withValues(alpha: 0.18),
        ),
      ),
      child: Row(
        children: [
          Icon(icon, size: 16, color: CustomerPalette.primaryDark),
          const SizedBox(width: 6),
          Expanded(
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                fontWeight: FontWeight.w700,
                color: CustomerPalette.textDark,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBannerSection() {
    final items = _liveWidgetItems;
    if (items.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildSectionHeader(
            title: _tr('Featured'),
            subtitle: _tr('Fresh offers and live delivery updates'),
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 176,
            child: PageView.builder(
              controller: _bannerController,
              onPageChanged: (index) {
                setState(() => _activeBanner = index);
              },
              itemCount: items.length,
              itemBuilder: (context, index) {
                final item = items[index];
                if (item['type'] == 'promotion') {
                  final promoImages = _promotionImages();
                  final promoTitle =
                      (_livePromotions?['title'] ?? _tr('Live Promotions'))
                          .toString()
                          .trim();
                  final promoMessage = _livePromotionMessage();
                  final bg = promoImages.isNotEmpty
                      ? ApiService.getImageUrl(promoImages.first)
                      : '';
                  return ClipRRect(
                    borderRadius: BorderRadius.circular(26),
                    child: Stack(
                      fit: StackFit.expand,
                      children: [
                        if (bg.isNotEmpty)
                          Image.network(
                            bg,
                            fit: BoxFit.cover,
                            errorBuilder: (_, error, stackTrace) =>
                                Container(color: CustomerPalette.primaryDark),
                          )
                        else
                          Container(color: CustomerPalette.primaryDark),
                        Container(
                          decoration: BoxDecoration(
                            gradient: LinearGradient(
                              begin: Alignment.bottomCenter,
                              end: Alignment.topCenter,
                              colors: [
                                Colors.black.withValues(alpha: 0.74),
                                Colors.black.withValues(alpha: 0.2),
                              ],
                            ),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.all(14),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                  vertical: 4,
                                ),
                                decoration: BoxDecoration(
                                  color: Colors.white.withValues(alpha: 0.18),
                                  borderRadius: BorderRadius.circular(30),
                                ),
                                child: Text(
                                  _tr('Live: Promotions / Events'),
                                  style: TextStyle(
                                    color: Colors.white,
                                    fontSize: 11,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                              const Spacer(),
                              Text(
                                promoTitle.isNotEmpty
                                    ? promoTitle
                                    : _tr('Live Promotions'),
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  color: Colors.white,
                                  fontSize: 18,
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              if (promoMessage.isNotEmpty) ...[
                                const SizedBox(height: 6),
                                Text(
                                  promoMessage,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                              if (promoImages.length > 1) ...[
                                const SizedBox(height: 8),
                                Text(
                                  '${promoImages.length} ${_tr('live widgets')}',
                                  style: const TextStyle(
                                    color: Colors.white70,
                                    fontSize: 11,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ),
                      ],
                    ),
                  );
                }
                if (item['type'] == 'status') {
                  final blocked = _isGlobalOrderingBlocked();
                  return Container(
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(26),
                      gradient: LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: blocked
                            ? const [Color(0xFFB71C1C), Color(0xFFE53935)]
                            : const [Color(0xFFEF6C00), Color(0xFFFFA726)],
                      ),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(
                                blocked ? Icons.block : Icons.info_outline,
                                color: Colors.white,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  blocked
                                      ? _tr('Live Delivery Pause')
                                      : _tr('Delivery Update'),
                                  style: const TextStyle(
                                    color: Colors.white,
                                    fontSize: 16,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          Expanded(
                            child: Text(
                              _globalStatusMessage(),
                              maxLines: 4,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w700,
                                fontSize: 13,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                }
                final store = item['data'];
                return ClipRRect(
                  borderRadius: BorderRadius.circular(26),
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      Image.network(
                        ApiService.getImageUrl(store['image_url']),
                        fit: BoxFit.cover,
                        errorBuilder: (ctx, err, _) => Container(
                          color: CustomerPalette.primaryDark,
                          child: const Icon(
                            Icons.store,
                            color: Colors.white,
                            size: 40,
                          ),
                        ),
                      ),
                      Container(
                        decoration: BoxDecoration(
                          gradient: LinearGradient(
                            begin: Alignment.bottomCenter,
                            end: Alignment.topCenter,
                            colors: [
                              Colors.black.withValues(alpha: 0.58),
                              Colors.transparent,
                            ],
                          ),
                        ),
                      ),
                      Positioned(
                        left: 14,
                        right: 14,
                        bottom: 14,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              (store['name'] ?? '').toString(),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Colors.white,
                                fontWeight: FontWeight.w800,
                                fontSize: 18,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              (store['location'] ?? '').toString(),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: Colors.white70,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: List.generate(items.length, (i) {
              final active = i == _activeBanner;
              return AnimatedContainer(
                duration: const Duration(milliseconds: 220),
                margin: const EdgeInsets.symmetric(horizontal: 3),
                width: active ? 22 : 8,
                height: 8,
                decoration: BoxDecoration(
                  color: active
                      ? CustomerPalette.primaryDark
                      : Colors.black.withValues(alpha: 0.16),
                  borderRadius: BorderRadius.circular(999),
                ),
              );
            }),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchField() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(4, 14, 4, 0),
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.06),
              blurRadius: 18,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        child: TextField(
          controller: _searchController,
          decoration: InputDecoration(
            hintText: _tr('Search store by name or area'),
            prefixIcon: const Icon(Icons.search_rounded),
            suffixIcon: _searchController.text.trim().isEmpty
                ? null
                : IconButton(
                    onPressed: () {
                      _searchController.clear();
                      _filterStores('');
                    },
                    icon: const Icon(Icons.close_rounded),
                  ),
            filled: true,
            fillColor: Colors.white,
            border: OutlineInputBorder(
              borderSide: BorderSide.none,
              borderRadius: BorderRadius.circular(18),
            ),
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 16,
              vertical: 16,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildCategoryStrip() {
    final options = _categoryOptions;
    if (options.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: SizedBox(
        height: 86,
        child: ListView.separated(
          scrollDirection: Axis.horizontal,
          itemCount: options.length,
          separatorBuilder: (_, _) => const SizedBox(width: 12),
          itemBuilder: (context, index) {
            final option = options[index];
            final selected = option['key'] == _selectedCategory;
            return InkWell(
              onTap: () => _applyFilters(categoryKey: option['key'] as String),
              borderRadius: BorderRadius.circular(26),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 180),
                width: 88,
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                decoration: BoxDecoration(
                  color: selected
                      ? CustomerPalette.primary.withValues(alpha: 0.14)
                      : Colors.white.withValues(alpha: 0.74),
                  borderRadius: BorderRadius.circular(26),
                  border: Border.all(
                    color: selected
                        ? CustomerPalette.primary
                        : Colors.white.withValues(alpha: 0.7),
                    width: selected ? 2 : 1,
                  ),
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: selected
                            ? CustomerPalette.primary
                            : Colors.white,
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.06),
                            blurRadius: 10,
                            offset: const Offset(0, 6),
                          ),
                        ],
                      ),
                      child: Icon(
                        option['icon'] as IconData,
                        color: selected
                            ? Colors.white
                            : CustomerPalette.primaryDark,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      (option['label'] ?? '').toString(),
                      textAlign: TextAlign.center,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: selected
                            ? FontWeight.w800
                            : FontWeight.w700,
                        color: CustomerPalette.textDark,
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _buildSectionHeader({
    required String title,
    required String subtitle,
  }) {
    return Padding(
      padding: const EdgeInsets.only(left: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 24,
              fontWeight: FontWeight.w900,
              color: CustomerPalette.textDark,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            subtitle,
            style: const TextStyle(
              fontWeight: FontWeight.w600,
              color: Colors.black54,
              height: 1.3,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildServiceLimitWarning() {
    return Container(
      margin: const EdgeInsets.only(top: 14),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: const Color(0xFFFFF1E0),
        border: Border.all(color: const Color(0xFFFFD4A7)),
        borderRadius: BorderRadius.circular(18),
      ),
      child: Row(
        children: [
          const Icon(Icons.info_outline_rounded, color: Color(0xFFE57C23)),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              _serviceLimitedMessage ?? '',
              style: const TextStyle(
                color: Color(0xFFB75B27),
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStoreSection(int crossAxisCount) {
    final effectiveCrossAxisCount = crossAxisCount.clamp(2, 3);
    final storeCardHeight = effectiveCrossAxisCount >= 3 ? 229.5 : 243.0;
    if (_isLoading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 56),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    if (_errorMessage != null) {
      return Padding(
        padding: const EdgeInsets.only(top: 24),
        child: Center(child: Text('Error: $_errorMessage')),
      );
    }

    return Padding(
      padding: const EdgeInsets.only(top: 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildSectionHeader(
            title: _tr('Popular Stores'),
            subtitle: _tr('Tap any store to browse its live products'),
          ),
          const SizedBox(height: 14),
          if (_filteredStores.isEmpty)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.82),
                borderRadius: BorderRadius.circular(22),
              ),
              child: Text(
                _serviceLimitedMessage ??
                    _tr('No stores found in this category'),
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  color: Colors.black54,
                ),
              ),
            )
          else
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: effectiveCrossAxisCount,
                mainAxisExtent: storeCardHeight,
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
              ),
              itemCount: _filteredStores.length,
              itemBuilder: (context, index) =>
                  _buildStoreCard(_filteredStores[index]),
            ),
        ],
      ),
    );
  }

  Widget _buildStoreCard(dynamic store) {
    final bool isOpen = store['is_open'] == true || store['is_open'] == 1;
    final String closedReason = (store['status_message'] ?? '')
        .toString()
        .trim();
    final String imageUrl = ApiService.getImageUrl(store['image_url']);
    final String deliveryLabel =
        ((store['delivery_time'] ?? '').toString().trim()).isNotEmpty
        ? '${store['delivery_time']} min'
        : '${_formatTimeOnly(store['opening_time'])} - ${_formatTimeOnly(store['closing_time'])}';

    return InkWell(
      borderRadius: BorderRadius.circular(24),
      onTap: () {
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (ctx) => StoreScreen(storeId: store['id']),
          ),
        );
      },
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.96),
          borderRadius: BorderRadius.circular(24),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.08),
              blurRadius: 16,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            SizedBox(
              height: 128,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  ClipRRect(
                    borderRadius: const BorderRadius.vertical(
                      top: Radius.circular(24),
                    ),
                    child: imageUrl.isNotEmpty
                        ? Image.network(
                            imageUrl,
                            fit: BoxFit.cover,
                            errorBuilder: (ctx, err, _) =>
                                _buildStoreFallback(),
                          )
                        : _buildStoreFallback(),
                  ),
                  Positioned(
                    left: 10,
                    top: 10,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 10,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: isOpen
                            ? const Color(0xFFEDF8EA)
                            : const Color(0xFFFFECE8),
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        isOpen ? _tr('OPEN') : _tr('CLOSED'),
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w800,
                          color: isOpen
                              ? const Color(0xFF2E7D32)
                              : const Color(0xFFC62828),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                    Text(
                      (store['name'] ?? _tr('Unknown Store')).toString(),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w900,
                        color: CustomerPalette.textDark,
                        height: 1.1,
                      ),
                    ),
                    const SizedBox(height: 1),
                    Text(
                      (store['location'] ?? '').toString(),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 11,
                        color: Colors.black54,
                        fontWeight: FontWeight.w600,
                        height: 1.1,
                      ),
                    ),
                    const Spacer(),
                    if (!isOpen && closedReason.isNotEmpty) ...[
                      Text(
                        closedReason,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 10,
                          color: Color(0xFFC62828),
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 3),
                    ],
                    Row(
                      children: [
                        Expanded(
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 6,
                            ),
                            decoration: BoxDecoration(
                              color: CustomerPalette.accent.withValues(
                                alpha: 0.18,
                              ),
                              borderRadius: BorderRadius.circular(14),
                            ),
                            child: Row(
                              children: [
                                const Icon(
                                  Icons.schedule_rounded,
                                  size: 16,
                                  color: CustomerPalette.primaryDark,
                                ),
                                const SizedBox(width: 6),
                                Expanded(
                                  child: Text(
                                    deliveryLabel,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    style: const TextStyle(
                                      fontSize: 10,
                                      fontWeight: FontWeight.w700,
                                      color: CustomerPalette.primaryDark,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                        FilledButton(
                          onPressed: () {
                            Navigator.of(context).push(
                              MaterialPageRoute(
                                builder: (ctx) =>
                                    StoreScreen(storeId: store['id']),
                              ),
                            );
                          },
                          style: FilledButton.styleFrom(
                            minimumSize: const Size(0, 34),
                            padding: const EdgeInsets.symmetric(horizontal: 10),
                            backgroundColor: CustomerPalette.primary,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(14),
                            ),
                          ),
                          child: Text(_tr('Open')),
                        ),
                      ],
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

  Widget _buildStoreFallback() {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFFFFE7CF), Color(0xFFF4C394)],
        ),
      ),
      child: const Center(
        child: Icon(
          Icons.storefront_rounded,
          size: 42,
          color: CustomerPalette.primaryDark,
        ),
      ),
    );
  }

  Widget _buildBottomBar() {
    return SafeArea(
      top: false,
      child: Container(
        margin: const EdgeInsets.fromLTRB(18, 0, 18, 10),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.94),
          borderRadius: BorderRadius.circular(28),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.14),
              blurRadius: 20,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: [
            _buildBottomIcon(
              index: 0,
              icon: Icons.home_filled,
              label: _tr('Home'),
              onTap: () => setState(() => _bottomIndex = 0),
            ),
            _buildBottomIcon(
              index: 1,
              icon: Icons.storefront_rounded,
              label: _tr('Stores'),
              onTap: () => setState(() => _bottomIndex = 1),
            ),
            _buildBottomIcon(
              index: 2,
              icon: Icons.shopping_bag_outlined,
              label: _tr('Orders'),
              onTap: () {
                setState(() => _bottomIndex = 2);
                Navigator.of(context).pushNamed('/orders');
              },
            ),
            _buildBottomIcon(
              index: 3,
              icon: Icons.shopping_cart_outlined,
              label: _tr('Cart'),
              badgeCount: context.watch<CartProvider>().itemCount,
              onTap: () {
                setState(() => _bottomIndex = 3);
                Navigator.of(context).pushNamed('/cart');
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBottomIcon({
    required int index,
    required IconData icon,
    required String label,
    int badgeCount = 0,
    required VoidCallback onTap,
  }) {
    final active = _bottomIndex == index;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(18),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Stack(
              clipBehavior: Clip.none,
              children: [
                AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: active
                        ? CustomerPalette.primary
                        : Colors.transparent,
                    borderRadius: BorderRadius.circular(14),
                  ),
                  child: Icon(
                    icon,
                    size: 22,
                    color: active ? Colors.white : Colors.grey.shade600,
                  ),
                ),
                if (badgeCount > 0)
                  Positioned(
                    right: -9,
                    top: -7,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 5,
                        vertical: 1,
                      ),
                      decoration: BoxDecoration(
                        color: CustomerPalette.primaryDark,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      constraints: const BoxConstraints(minWidth: 16),
                      child: Text(
                        badgeCount > 99 ? '99+' : '$badgeCount',
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 9,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: active ? FontWeight.w800 : FontWeight.w600,
                color: active
                    ? CustomerPalette.primaryDark
                    : Colors.grey.shade600,
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _formatTimeOnly(dynamic time) {
    if (time == null) return '--:--';
    final parts = time.toString().split(':');
    if (parts.length >= 2) {
      return '${parts[0]}:${parts[1]}';
    }
    return time.toString();
  }
}
