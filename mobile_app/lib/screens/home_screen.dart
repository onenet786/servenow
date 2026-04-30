import 'dart:async';

import 'package:flutter/material.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/api_service.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../providers/notification_provider.dart' as app_notif;
import '../models/user.dart';
import 'store_screen.dart';
import '../theme/customer_palette.dart';
import '../widgets/notification_bell_widget.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
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
  Timer? _globalStatusRefreshTimer;
  Timer? _livePromotionsRefreshTimer;
  Timer? _promoCarouselTimer;
  final TextEditingController _searchController = TextEditingController();
  final PageController _promoController = PageController();
  int _activePromo = 0;
  double? _userLat;
  double? _userLng;
  String? _userCity;
  bool _launchFlashShown = false;
  String? _launchFlashSignature;

  @override
  void initState() {
    super.initState();
    _fetchData();
    _startPromoAutoScroll();
    _searchController.addListener(_onSearchChanged);
  }

  @override
  void dispose() {
    _globalStatusRefreshTimer?.cancel();
    _livePromotionsRefreshTimer?.cancel();
    _promoCarouselTimer?.cancel();
    _searchController.removeListener(_onSearchChanged);
    _searchController.dispose();
    _promoController.dispose();
    super.dispose();
  }

  void _onSearchChanged() {
    _filterStores(_searchController.text);
  }

  Future<void> _fetchData() async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      Future<T?> safe<T>(Future<T> future) async {
        try {
          return await future;
        } catch (_) {
          return null;
        }
      }

      final locationFuture = _resolveLocationContext();
      final globalFuture = token != null
          ? safe(ApiService.getGlobalDeliveryStatus(token))
          : Future.value(null);
      final promotionsFuture = safe(ApiService.getLivePromotions(token));
      final flashFuture = token != null
          ? safe(ApiService.getCustomerFlashMessage(token))
          : Future.value(null);
      final supportFuture = token != null
          ? safe(ApiService.getCustomerSupportContact(token))
          : Future.value(null);

      await locationFuture;
      final storesFuture = safe(ApiService.getStores(
        latitude: _userLat,
        longitude: _userLng,
        city: _userCity,
      ));

      final results = await Future.wait([
        globalFuture,
        promotionsFuture,
        flashFuture,
        supportFuture,
        storesFuture,
      ]);

      final globalRaw = results[0];
      final promotionsRaw = results[1];
      final customerFlash = results[2];
      final supportContact = results[3];
      final storesResp = results[4] ?? {};

      Map<String, dynamic>? globalStatus;
      if (globalRaw != null) {
        globalStatus = (globalRaw['status'] is Map<String, dynamic>)
            ? (globalRaw['status'] as Map<String, dynamic>)
            : (globalRaw['global_status'] is Map<String, dynamic>)
                ? (globalRaw['global_status'] as Map<String, dynamic>)
                : globalRaw;
      }

      Map<String, dynamic>? livePromotions;
      if (promotionsRaw != null) {
        livePromotions = (promotionsRaw['live_promotions'] is Map<String, dynamic>)
            ? (promotionsRaw['live_promotions'] as Map<String, dynamic>)
            : promotionsRaw;
      }

      if (mounted) {
        final stores = (storesResp['stores'] as List<dynamic>? ?? []);
        final limited = storesResp['service_limited'] == true;
        final limitedMessage = (storesResp['service_message'] ?? '').toString().trim();
        setState(() {
          _allStores = stores;
          _filteredStores = stores;
          _globalStatus = globalStatus;
          _livePromotions = livePromotions;
          _customerFlashMessage = customerFlash;
          _supportContact = supportContact;
          _scheduleGlobalStatusRefresh(globalStatus);
          _scheduleLivePromotionsRefresh(livePromotions);
          _serviceLimitedMessage = limited
              ? (limitedMessage.isNotEmpty
                  ? limitedMessage
                  : 'You are not allowed to see Store when you are out of Delivery Area')
              : null;
          _isLoading = false;
        });
        _tryShowLaunchFlash();
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
          _userCity = (places.first.locality ?? places.first.subAdministrativeArea ?? '')
              .toString()
              .trim();
        }
      } catch (_) {}
    } catch (_) {}
  }

  void _filterStores(String query) {
    if (query.isEmpty) {
      setState(() {
        _filteredStores = _allStores;
      });
    } else {
      setState(() {
        _filteredStores = _allStores.where((store) {
          final name = store['name'].toString().toLowerCase();
          final location = store['location'].toString().toLowerCase();
          final q = query.toLowerCase();
          return name.contains(q) || location.contains(q);
        }).toList();
      });
    }
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
      if (token != null) {
        status = await ApiService.getGlobalDeliveryStatus(token);
        try {
          customerFlash = await ApiService.getCustomerFlashMessage(token);
        } catch (_) {}
        try {
          supportContact = await ApiService.getCustomerSupportContact(token);
        } catch (_) {}
      }
      final promotions = await ApiService.getLivePromotions(token);
      if (!mounted) return;
      setState(() {
        _globalStatus = status;
        _livePromotions = promotions;
        _customerFlashMessage = customerFlash;
        _supportContact = supportContact;
      });
      _scheduleGlobalStatusRefresh(status);
      _scheduleLivePromotionsRefresh(promotions);
      _tryShowLaunchFlash();
    } catch (_) {}
  }

  Future<void> _promptGuestRegistration() async {
    final shouldRegister = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Register Required'),
        content: const Text(
          'Guest mode lets you browse stores and add items to cart. Please register to view your orders or place one.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Later'),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Register'),
          ),
        ],
      ),
    );

    if (shouldRegister == true && mounted) {
      Navigator.of(context).pushNamed('/register');
    }
  }

  Future<void> _makeCall(String phoneNumber) async {
    final cleaned = phoneNumber.trim().replaceAll(RegExp(r'[^0-9+]'), '');
    if (cleaned.isEmpty) return;
    final uri = Uri(scheme: 'tel', path: cleaned);
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
      return;
    }
  }

  Future<void> _openWhatsApp(String phoneNumber) async {
    final cleanPhone = phoneNumber.replaceAll(RegExp(r'[^0-9]'), '');
    if (cleanPhone.isEmpty) return;
    final uri = Uri.parse('https://wa.me/$cleanPhone');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
      return;
    }
  }

  Future<void> _sendEmail(String emailAddress) async {
    final cleaned = emailAddress.trim();
    if (cleaned.isEmpty) return;
    final uri = Uri(
      scheme: 'mailto',
      path: cleaned,
      queryParameters: const {
        'subject': 'ServeNow Support',
      },
    );
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
      return;
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

    final name = (contact['name'] ?? 'ServeNow Support').toString().trim();
    final phone = (contact['phone'] ?? '').toString().trim();
    final whatsapp = (contact['whatsapp'] ?? phone).toString().trim();
    final email = (contact['email'] ?? '').toString().trim();

    if (phone.isEmpty && whatsapp.isEmpty && email.isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Support contact is not configured yet.')),
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
                  name.isEmpty ? 'Contact Us' : name,
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 6),
                const Text(
                  'Choose how you want to contact us.',
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
                    title: const Text('Call'),
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
                    title: const Text('WhatsApp'),
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
                      child: Icon(Icons.email_outlined, color: CustomerPalette.primary),
                    ),
                    title: const Text('Email'),
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

  Widget _buildSupportCard() {
    final contact = _supportContact ?? const <String, dynamic>{};
    final name = (contact['name'] ?? 'ServeNow Support').toString().trim();
    final phone = (contact['phone'] ?? '').toString().trim();
    final whatsapp = (contact['whatsapp'] ?? phone).toString().trim();
    final email = (contact['email'] ?? '').toString().trim();
    if (phone.isEmpty && whatsapp.isEmpty && email.isEmpty) {
      return const SizedBox.shrink();
    }

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFD7E4FF)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.05),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.support_agent, color: CustomerPalette.primary, size: 20),
              SizedBox(width: 8),
              Text(
                'Contact Us',
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'Need help with any order? Contact $name directly.',
            style: const TextStyle(
              fontSize: 12.5,
              color: Colors.black87,
              fontWeight: FontWeight.w600,
            ),
          ),
          if (phone.isNotEmpty || email.isNotEmpty) ...[
            const SizedBox(height: 8),
            if (phone.isNotEmpty)
              Text(
                phone,
                style: const TextStyle(fontSize: 12, color: Colors.black54),
              ),
            if (email.isNotEmpty)
              Text(
                email,
                style: const TextStyle(fontSize: 12, color: Colors.black54),
              ),
          ],
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (phone.isNotEmpty)
                _supportActionButton(
                  icon: Icons.call_outlined,
                  color: Colors.blue,
                  label: 'Call',
                  onPressed: () => _makeCall(phone),
                ),
              if (whatsapp.isNotEmpty)
                _supportActionButton(
                  icon: Icons.chat_outlined,
                  color: Colors.green,
                  label: 'WhatsApp',
                  onPressed: () => _openWhatsApp(whatsapp),
                ),
              if (email.isNotEmpty)
                _supportActionButton(
                  icon: Icons.email_outlined,
                  color: CustomerPalette.primary,
                  label: 'Email',
                  onPressed: () => _sendEmail(email),
                ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _supportActionButton({
    required IconData icon,
    required Color color,
    required String label,
    required VoidCallback onPressed,
  }) {
    return OutlinedButton.icon(
      onPressed: onPressed,
      icon: Icon(icon, size: 16, color: color),
      label: Text(
        label,
        style: TextStyle(color: color, fontWeight: FontWeight.w700),
      ),
      style: OutlinedButton.styleFrom(
        foregroundColor: color,
        side: BorderSide(color: color.withValues(alpha: 0.35)),
        backgroundColor: color.withValues(alpha: 0.06),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
    );
  }

  Map<String, dynamic>? _promotionFlashData() {
    final flash = _customerFlashMessage;
    if (flash != null && _toBool(flash['is_enabled'])) {
      final isVisible = _toBool(flash['is_visible']) ||
          (_toBool(flash['is_window_active']) &&
              (_toBool(flash['is_target_matched']) ||
                  (flash['notification_target'] ?? 'all').toString() == 'all'));
      if (isVisible) {
        final title =
            (flash['title'] ?? 'ServeNow Flash Message').toString().trim();
        final message = (flash['status_message'] ?? '').toString().trim();
        final imageUrl = ApiService.getImageUrl(
          (flash['image_url'] ?? '').toString().trim(),
        );
        final signature =
            '${flash['updated_at'] ?? ''}|$title|$message|$imageUrl|${flash['start_at'] ?? ''}|${flash['end_at'] ?? ''}';
        return {
          'title': title.isNotEmpty ? title : 'ServeNow Flash Message',
          'message': message.isNotEmpty
              ? message
              : 'Check latest updates in ServeNow.',
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
    final title = (promo['title'] ?? 'ServeNow Flash Message').toString().trim();
    final message = _livePromotionMessage().trim();
    final images = _promotionImages();
    final imageUrl =
        images.isNotEmpty ? ApiService.getImageUrl(images.first) : '';
    final signature =
        '${promo['id'] ?? ''}|${promo['updated_at'] ?? ''}|$title|$message|$imageUrl';

    return {
      'title': title.isNotEmpty ? title : 'ServeNow Flash Message',
      'message': message.isNotEmpty
          ? message
          : 'Check latest promotions and events.',
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
        Provider.of<app_notif.NotificationProvider>(context, listen: false)
            .addNotification(
              title: (flash['title'] ?? 'ServeNow Flash Message').toString(),
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
        await precacheImage(NetworkImage(imageUrl), context).timeout(
          const Duration(seconds: 2),
        );
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
    final title = (flash['title'] ?? 'ServeNow Flash Message').toString();
    final message = (flash['message'] ?? '').toString();
    final imageUrl = (flash['imageUrl'] ?? '').toString();

    showGeneralDialog<void>(
      context: context,
      barrierDismissible: true,
      barrierLabel: 'Flash Message',
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
                      const Icon(Icons.campaign, color: CustomerPalette.primary),
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
                              builder: (context, scale, child) => Transform.scale(
                                scale: scale,
                                child: child,
                              ),
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
                      child: const Text('OK'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      },
      transitionBuilder: (context, animation, secondaryAnimation, child) {
        final curved = CurvedAnimation(parent: animation, curve: Curves.easeOut);
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
    if (when.isNotEmpty) return 'Delivery update: $when';
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

  void _startPromoAutoScroll() {
    _promoCarouselTimer = Timer.periodic(const Duration(seconds: 4), (_) {
      if (!mounted || !_promoController.hasClients) return;
      final count = _promotionImages().length;
      if (count <= 1) return;
      final next = (_activePromo + 1) % count;
      _promoController.animateToPage(
        next,
        duration: const Duration(milliseconds: 350),
        curve: Curves.easeInOut,
      );
    });
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
    final message = (promo['status_message'] ?? '').toString().trim();
    final when = _formatDeliveryWindow(promo['start_at'], promo['end_at']);
    if (message.isNotEmpty && when.isNotEmpty) return '$message ($when)';
    if (message.isNotEmpty) return message;
    if (when.isNotEmpty) return 'Promotion window: $when';
    return '';
  }

  Widget _buildLivePromotionsSection() {
    final images = _promotionImages();
    final title = (_livePromotions?['title'] ?? 'Live Promotions')
        .toString()
        .trim();
    final message = _livePromotionMessage();
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(14),
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [CustomerPalette.primary, CustomerPalette.primaryDark],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Live Promotions / Events',
            style: TextStyle(
              color: Colors.white70,
              fontWeight: FontWeight.w700,
              fontSize: 12,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            title.isNotEmpty ? title : 'Live Promotions',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w800,
              fontSize: 16,
            ),
          ),
          if (message.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text(
              message,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w600,
                fontSize: 12,
              ),
            ),
          ],
          const SizedBox(height: 10),
          SizedBox(
            height: 160,
            child: PageView.builder(
              controller: _promoController,
              itemCount: images.length,
              onPageChanged: (index) {
                setState(() => _activePromo = index);
              },
              itemBuilder: (context, index) {
                return ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Image.network(
                    ApiService.getImageUrl(images[index]),
                    fit: BoxFit.cover,
                    errorBuilder: (_, error, stackTrace) => Container(
                      color: const Color(0xFF164E63),
                      alignment: Alignment.center,
                      child: const Icon(
                        Icons.image_not_supported_outlined,
                        color: Colors.white,
                        size: 34,
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
          if (images.length > 1) ...[
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(images.length, (i) {
                final active = i == _activePromo;
                return AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  margin: const EdgeInsets.symmetric(horizontal: 3),
                  width: active ? 18 : 7,
                  height: 7,
                  decoration: BoxDecoration(
                    color: active ? Colors.white : Colors.white54,
                    borderRadius: BorderRadius.circular(10),
                  ),
                );
              }),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildGlobalStatusBanner() {
    final blocked = _isGlobalOrderingBlocked();
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 8),
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

  @override
  Widget build(BuildContext context) {
    final isLandscape =
        MediaQuery.of(context).orientation == Orientation.landscape;
    final crossAxisCount = isLandscape ? 4 : 2;
    final auth = Provider.of<AuthProvider>(context);
    final isGuest = auth.isGuest;

    return Scaffold(
        appBar: AppBar(
          title: const Text('ServeNow'),
          actions: [
            if (!isGuest) const NotificationBellWidget(),
            Consumer<CartProvider>(
              builder: (ctx, cart, child) => Stack(
                alignment: Alignment.center,
                children: [
                  IconButton(
                    icon: const Icon(Icons.shopping_cart),
                    onPressed: () => Navigator.of(context).pushNamed('/cart'),
                    tooltip: 'Cart',
                  ),
                  if (cart.itemCount > 0)
                    Positioned(
                      right: 8,
                      top: 8,
                      child: Container(
                        padding: const EdgeInsets.all(2),
                        decoration: BoxDecoration(
                          color: Colors.red,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        constraints: const BoxConstraints(
                          minWidth: 16,
                          minHeight: 16,
                        ),
                        child: Text(
                          '${cart.itemCount}',
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 10,
                            color: Colors.white,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            TextButton.icon(
              onPressed: () {
                if (isGuest) {
                  _promptGuestRegistration();
                  return;
                }
                Navigator.of(context).pushNamed('/orders');
              },
              style: TextButton.styleFrom(
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              ),
              icon: const Icon(Icons.shopping_bag, size: 18),
              label: const Text(
                'My Orders',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
            TextButton.icon(
              onPressed: _showSupportOptions,
              style: TextButton.styleFrom(
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              ),
              icon: const Icon(Icons.support_agent, size: 18),
              label: const Text(
                'Contact Us',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
            IconButton(
              icon: const Icon(Icons.logout),
              onPressed: () {
                Provider.of<AuthProvider>(context, listen: false).logout();
                Navigator.of(context).pushReplacementNamed('/login');
              },
            ),
          ],
        ),
        body: RefreshIndicator(
          onRefresh: _fetchData,
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // User Login Data Section
                Selector<AuthProvider, User?>(
                  selector: (_, auth) => auth.user,
                  builder: (context, user, child) {
                    if (user == null) return const SizedBox.shrink();
                    return Container(
                      margin: const EdgeInsets.all(16),
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 12,
                      ),
                      decoration: BoxDecoration(
                        color: CustomerPalette.primary,
                        borderRadius: BorderRadius.circular(15),
                        boxShadow: [
                          BoxShadow(
                            color: CustomerPalette.primary.withValues(alpha: 0.3),
                            blurRadius: 8,
                            offset: const Offset(0, 4),
                          ),
                        ],
                      ),
                      child: Column(
                        children: [
                          Text(
                            user.isGuest
                                ? 'Welcome, Guest User!'
                                : 'Welcome, ${user.firstName} ${user.lastName}!',
                            style: const TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.bold,
                              color: Colors.white,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                          if (user.isGuest) ...[
                            const SizedBox(height: 8),
                            Text(
                              'Browse freely now, then register before checkout.',
                              style: TextStyle(
                                color: Colors.white.withValues(alpha: 0.92),
                                fontWeight: FontWeight.w500,
                              ),
                              textAlign: TextAlign.center,
                            ),
                            const SizedBox(height: 10),
                            OutlinedButton(
                              onPressed: () =>
                                  Navigator.of(context).pushNamed('/register'),
                              style: OutlinedButton.styleFrom(
                                foregroundColor: Colors.white,
                                side: const BorderSide(color: Colors.white70),
                              ),
                              child: const Text('Register to Order'),
                            ),
                          ],
                          const SizedBox(height: 12),
                          Row(
                            children: [
                              CircleAvatar(
                                radius: 22,
                                backgroundColor: Colors.white,
                                child: Text(
                                  user.firstName.isNotEmpty
                                      ? user.firstName
                                            .substring(0, 1)
                                            .toUpperCase()
                                      : 'U',
                                  style: const TextStyle(
                                    fontSize: 18,
                                    color: CustomerPalette.primary,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                              const Spacer(),
                              IconButton(
                                icon: const Icon(
                                  Icons.key,
                                  color: Colors.white,
                                ),
                                onPressed: () {
                                  Navigator.of(
                                    context,
                                  ).pushNamed('/change-password');
                                },
                                tooltip: 'Change Password',
                              ),
                            ],
                          ),
                        ],
                      ),
                    );
                  },
                ),
                _buildSupportCard(),

                // Search Section
                Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: TextField(
                    controller: _searchController,
                    decoration: InputDecoration(
                      hintText: 'Search stores...',
                      prefixIcon: const Icon(Icons.search),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(30),
                        borderSide: BorderSide.none,
                      ),
                      filled: true,
                      fillColor: Colors.grey[200],
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 20,
                      ),
                    ),
                  ),
                ),
                if (_showGlobalStatusBanner()) _buildGlobalStatusBanner(),
                if (_showLivePromotionsCard()) _buildLivePromotionsSection(),

                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16.0),
                  child: const Text(
                    'Browse\nStores',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),

                const SizedBox(height: 10),

                // Store Grid
                if (_isLoading)
                  const Padding(
                    padding: EdgeInsets.only(top: 50.0),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (_errorMessage != null)
                  Center(child: Text('Error: $_errorMessage'))
                else if (_filteredStores.isEmpty)
                  Center(
                    child: Padding(
                      padding: const EdgeInsets.all(40.0),
                      child: Text(
                        _serviceLimitedMessage ??
                            'No stores found in this category',
                      ),
                    ),
                  )
                else
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 16),
                    child: GridView.builder(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: crossAxisCount,
                        childAspectRatio: 0.75, // Adjusted for 2-line name
                        crossAxisSpacing: 10,
                        mainAxisSpacing: 10,
                      ),
                      itemCount: _filteredStores.length,
                      itemBuilder: (context, index) {
                        final store = _filteredStores[index];
                        return _buildStoreCard(store);
                      },
                    ),
                  ),
                const SizedBox(height: 20),
              ],
            ),
          ),
        ),
      );
  }

  Widget _buildStoreCard(dynamic store) {
    final bool isOpen = store['is_open'] == true || store['is_open'] == 1;
    final String closedReason = (store['status_message'] ?? '').toString().trim();

    return GestureDetector(
      onTap: () {
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (ctx) => StoreScreen(storeId: store['id']),
          ),
        );
      },
      child: Container(
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(15),
          boxShadow: [
            BoxShadow(
              color: Colors.grey.withValues(alpha: 0.1),
              spreadRadius: 1,
              blurRadius: 5,
              offset: const Offset(0, 3),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // First Row: Status indicator (separate container, small font)
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(vertical: 4),
              decoration: BoxDecoration(
                color: isOpen ? Colors.green.shade100 : Colors.red.shade100,
                borderRadius: const BorderRadius.vertical(
                  top: Radius.circular(15),
                ),
              ),
              child: Center(
                child: Text(
                  isOpen ? '🟢 OPEN' : '🔴 CLOSED',
                  style: TextStyle(
                    color: isOpen ? Colors.green.shade800 : Colors.red.shade800,
                    fontWeight: FontWeight.bold,
                    fontSize: 8,
                  ),
                ),
              ),
            ),
            // Second Row: Store image container (best fit image)
            Expanded(
              child: ClipRRect(
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    Image.network(
                      ApiService.getImageUrl(store['image_url']),
                      width: double.infinity,
                      fit: BoxFit.cover,
                      errorBuilder: (ctx, err, _) => Container(
                        color: Colors.grey[300],
                        child: const Center(
                          child: Icon(Icons.store, size: 40, color: Colors.grey),
                        ),
                      ),
                    ),
                    if (!isOpen && closedReason.isNotEmpty)
                      Positioned(
                        left: 0,
                        right: 0,
                        bottom: 0,
                        child: Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 6,
                          ),
                          color: Colors.red.withValues(alpha: 0.88),
                          child: Text(
                            closedReason,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 9,
                              color: Colors.white,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            // Rest of the card: info
            Padding(
              padding: const EdgeInsets.all(8.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    store['name'],
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      const Icon(
                        Icons.location_on,
                        size: 12,
                        color: Colors.grey,
                      ),
                      const SizedBox(width: 2),
                      Expanded(
                        child: Text(
                          store['location'],
                          style: const TextStyle(
                            fontSize: 10,
                            color: Colors.grey,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      const Icon(
                        Icons.access_time,
                        size: 10,
                        color: Colors.green,
                      ),
                      const SizedBox(width: 2),
                      Text(
                        _formatTimeOnly(store['opening_time']),
                        style: const TextStyle(
                          fontSize: 9,
                          color: Colors.grey,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(width: 4),
                      const Icon(Icons.timer_off, size: 10, color: Colors.red),
                      const SizedBox(width: 2),
                      Text(
                        _formatTimeOnly(store['closing_time']),
                        style: const TextStyle(
                          fontSize: 9,
                          color: Colors.grey,
                          fontWeight: FontWeight.bold,
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
