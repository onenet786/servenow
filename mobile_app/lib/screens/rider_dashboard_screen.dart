import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:logger/logger.dart';
import 'package:geolocator/geolocator.dart';
import 'package:geocoding/geocoding.dart';
import 'package:intl/intl.dart';
import 'package:url_launcher/url_launcher.dart';
import 'dart:async';
import '../providers/auth_provider.dart';
import '../providers/notification_provider.dart';
import '../services/api_service.dart';
import '../services/rider_background_tracking_service.dart';
import '../utils/customer_language.dart';
import '../widgets/notification_bell_widget.dart';
import '../widgets/staff/staff_ui.dart';
import 'login_screen.dart';

class RiderDashboardScreen extends StatefulWidget {
  const RiderDashboardScreen({super.key});

  @override
  State<RiderDashboardScreen> createState() => _RiderDashboardScreenState();
}

class _RiderDashboardScreenState extends State<RiderDashboardScreen>
    with TickerProviderStateMixin {
  final Logger _logger = Logger();
  late TabController _tabController;
  bool _isLoading = true;
  Map<String, dynamic>? _riderProfile;
  List<dynamic> _assignedDeliveries = [];
  List<dynamic> _completedDeliveries = [];
  String _currentLocation = 'Getting location...';
  double _walletBalance = 0.0;
  Timer? _assignmentRefreshTimer;
  StreamSubscription<Position>? _locationStreamSubscription;
  final Map<String, String> _locationLabelCache = {};
  String _selectedStatsPeriod = 'daily';
  Map<String, dynamic>? _walletStats;
  bool _isLoadingStats = false;
  DateTime _selectedCashFlowDate = DateTime.now();
  bool _isLoadingCashFlow = false;
  Map<String, dynamic>? _cashFlowData;
  bool _isNotificationRefreshRunning = false;
  int _selectedTabIndex = 0;
  late AnimationController _blinkController;
  late Animation<double> _blinkAnimation;
  bool _isUrdu = false;
  final Map<String, DateTime> _recentNotificationEvents = {};
  static const Duration _notificationDedupWindow = Duration(seconds: 8);

  Future<void> _loadLanguagePreference() async {
    final isUrdu = await CustomerLanguage.loadIsUrdu();
    if (!mounted) return;
    setState(() => _isUrdu = isUrdu);
  }

  String _tr(String text) {
    const localTranslations = <String, String>{
      'Welcome Rider': 'خوش آمدید رائیڈر',
      'Assigned': 'تعینات',
      'Rider': 'رائیڈر',
      'Vehicle': 'گاڑی',
      'ID': 'شناخت',
      'Rider ID': 'رائیڈر شناخت',
      'Deliveries': 'ڈیلیوریز',
      'Active': 'جاری',
      'Delivered': 'پہنچا دیے',
      'Today': 'آج',
      'Yesterday': 'کل',
      'order': 'آرڈر',
      'orders': 'آرڈرز',
      'item': 'آئٹم',
      'items': 'آئٹمز',
      'entry': 'اندراج',
      'entries': 'اندراجات',
      'Collect cash': 'نقد رقم وصول کریں',
      'Cash on delivery': 'کیش آن ڈیلیوری',
      'Cash collected': 'نقد رقم وصول ہو گئی',
      'Now mark the order delivered': 'اب آرڈر کو پہنچا دیا گیا مارک کریں',
      'PAID — do not collect': 'ادائیگی ہو چکی — رقم نہ لیں',
      'Paid online': 'آن لائن ادائیگی ہو چکی',
      'Paid by': 'ادائیگی بذریعہ',
      'Card': 'کارڈ',
      'Call': 'کال',
      'SMS': 'ایس ایم ایس',
      'WhatsApp': 'واٹس ایپ',
      'Maps': 'نقشہ',
      'Could not open maps': 'نقشہ نہیں کھل سکا',
      'Pick up': 'پک اپ',
      'Drop off': 'ڈراپ',
      'Customer': 'گاہک',
      'Store': 'دکان',
      'Summary': 'خلاصہ',
      'Swipe: cash received': 'سوائپ کریں: رقم وصول',
      'Swipe to mark delivered': 'پہنچانے کے لیے سوائپ کریں',
      'Waiting for pickup': 'پک اپ کا انتظار',
      'Deliver': 'ڈیلیوری',
      'Special Instructions': 'خصوصی ہدایات',
      'No active deliveries': 'کوئی جاری ڈیلیوری نہیں',
      'New orders assigned to you appear here automatically.': 'آپ کو دیے گئے نئے آرڈرز یہاں خود بخود نظر آئیں گے۔',
      'No completed deliveries yet': 'ابھی تک کوئی مکمل ڈیلیوری نہیں',
      'Delivered orders will be listed here by day.': 'مکمل آرڈرز یہاں دن کے حساب سے نظر آئیں گے۔',
      'Paid': 'ادا شدہ',
      'Not paid': 'ادا نہیں ہوا',
      'Payment failed': 'ادائیگی ناکام',
      'Customer Details': 'گاہک کی تفصیل',
      'Items by Store': 'دکان کے حساب سے آئٹمز',
      'No items': 'کوئی آئٹم نہیں',
      'Subtotal': 'ذیلی کل',
      'Items subtotal': 'آئٹمز کا کل',
      'Pricing Breakdown': 'قیمت کی تفصیل',
      'stores': 'دکانیں',
      'Wallet balance': 'والیٹ بیلنس',
      'Total earnings account': 'کل آمدنی کا اکاؤنٹ',
      'Wallet & cash flow refreshed': 'والیٹ اور کیش اپ ڈیٹ ہو گئے',
      'Daily cash': 'روزانہ کیش',
      'Advance, store payments and cash in your pocket': 'ایڈوانس، دکانوں کو ادائیگی اور آپ کی جیب میں رقم',
      'Cash in pocket': 'جیب میں رقم',
      'Shift active': 'شفٹ جاری',
      'Shift closed': 'شفٹ بند',
      'Shift advance': 'شفٹ ایڈوانس',
      'Cash taken from office': 'دفتر سے لی گئی رقم',
      'Customer cash (COD)': 'گاہک سے وصول نقد',
      'Delivered orders cash': 'مکمل آرڈرز کی نقد رقم',
      'Paid at stores': 'دکانوں کو ادا',
      'Cash paid for pickups': 'پک اپ کے لیے ادا کی گئی رقم',
      'Fuel & expenses': 'پیٹرول اور اخراجات',
      'Returned to office': 'دفتر کو واپس',
      'Return Cash to Admin': 'رقم دفتر کو واپس کریں',
      'Day Slip': 'دن کی رسید',
      'Cash movements': 'رقم کی آمد و رفت',
      'No cash movements logged for this day yet.': 'اس دن کی کوئی رقم درج نہیں ہوئی۔',
      'Store payment': 'دکان کو ادائیگی',
      'Fuel expense': 'پیٹرول خرچ',
      'Cash returned to office': 'رقم دفتر کو واپس',
      'Cash movement': 'رقم کا اندراج',
      'Delivered orders': 'مکمل آرڈرز',
      'COD': 'نقد',
      'Store paid': 'دکان کو ادا',
      'Return cash to office': 'رقم دفتر کو واپس کریں',
      'Hand the cash to your dispatch manager or cashier.': 'رقم اپنے ڈسپیچ مینیجر یا کیشیئر کے حوالے کریں۔',
      'The office records it in Rider Day Transactions.': 'دفتر اسے رائیڈر کے روزانہ لین دین میں درج کرے گا۔',
      'Once verified, your cash in pocket updates automatically.': 'تصدیق کے بعد آپ کی جیب کی رقم خود اپ ڈیٹ ہو جائے گی۔',
      'View full statement': 'مکمل اسٹیٹمنٹ دیکھیں',
      'Financial Statistics': 'مالی اعداد و شمار',
      'Daily': 'روزانہ',
      'Weekly': 'ہفتہ وار',
      'Monthly': 'ماہانہ',
      'No stats available': 'کوئی اعداد و شمار نہیں',
      'Cash received (net)': 'وصول نقد (خالص)',
      'Delivery fees': 'ڈیلیوری فیس',
      'Payment Summary': 'ادائیگی کا خلاصہ',
      'Unknown': 'نامعلوم',
      'Current location': 'موجودہ مقام',
      'ID card': 'شناختی کارڈ',
      'Day Transactions': 'روزانہ لین دین',
      'Not submitted cash': 'جمع نہ کرائی گئی رقم',
      'Cash orders not yet handed to the office': 'نقد آرڈرز جن کی رقم ابھی دفتر میں جمع نہیں ہوئی',
      'All cash submitted': 'تمام رقم جمع ہو چکی',
      'No unsubmitted cash orders for this day.': 'اس دن کوئی غیر جمع شدہ نقد آرڈر نہیں۔',
      'Delivery fee': 'ڈیلیوری فیس',
      'Close day': 'دن بند کریں',
      'Close the day for': 'دن بند کریں:',
      'You can still view the summary after closing.': 'بند کرنے کے بعد بھی خلاصہ دیکھ سکتے ہیں۔',
      'Day closed successfully': 'دن کامیابی سے بند ہو گیا',
      'Could not close the day. Please try again.': 'دن بند نہیں ہو سکا۔ دوبارہ کوشش کریں۔',
      'Expected cash with you': 'آپ کے پاس متوقع رقم',
      'Advance + customer cash − store paid − fuel − submitted': 'ایڈوانس + گاہک کی رقم − دکان کو ادا − پیٹرول − جمع شدہ',
      'Customer cash': 'گاہک کی رقم',
      'Not submitted': 'جمع نہیں ہوئی',
      'Fuel': 'پیٹرول',
      'Office advance': 'دفتری ایڈوانس',
      'Submitted to office': 'دفتر میں جمع',
      'Daily Summary': 'روزانہ خلاصہ',
      'Delivery fees earned': 'کمائی گئی ڈیلیوری فیس',
      'Day closed at': 'دن بند ہوا',
      'Could not load stats. Pull to refresh.': 'اعداد و شمار لوڈ نہیں ہو سکے۔ ریفریش کریں۔',
      'Could not load day transactions.': 'روزانہ لین دین لوڈ نہیں ہو سکا۔',
      'Order marked as delivered': 'آرڈر پہنچا دیا گیا',
      'Could not mark delivered. Please try again.': 'ڈیلیوری مارک نہیں ہو سکی۔ دوبارہ کوشش کریں۔',
      'Could not update payment. Please try again.': 'ادائیگی اپ ڈیٹ نہیں ہو سکی۔ دوبارہ کوشش کریں۔',
      'Location updated': 'مقام اپ ڈیٹ ہو گیا',
    };
    if (_isUrdu && localTranslations.containsKey(text)) {
      return localTranslations[text]!;
    }
    return CustomerLanguage.tr(_isUrdu, text);
  }

  /// `3 orders` / Urdu `3 آرڈرز` with the number isolated for RTL.
  String _count(int n, String singular, String plural) {
    final word = _tr(n == 1 ? singular : plural);
    final number = Fmt.number(n);
    return _isUrdu ? '${Fmt.isolate(number)} $word' : '$number $word';
  }

  Future<void> _makeCall(String phoneNumber) async {
    final cleaned = phoneNumber.trim().replaceAll(RegExp(r'[^0-9+]'), '');
    if (cleaned.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_tr('No valid phone number'))));
      }
      return;
    }
    final uri = Uri(scheme: 'tel', path: cleaned);
    if (await canLaunchUrl(uri)) {
      final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!ok && mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_tr('Could not launch dialer'))));
      }
    } else if (mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(_tr('Dialer app not available'))));
    }
  }

  Future<void> _sendSms(String phoneNumber) async {
    final cleaned = phoneNumber.trim().replaceAll(RegExp(r'[^0-9+]'), '');
    if (cleaned.isEmpty) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_tr('No valid phone number'))));
      }
      return;
    }
    // Try 'sms:' first, then fall back to 'smsto:' for wider compatibility
    final smsUri = Uri(scheme: 'sms', path: cleaned);
    final smstoUri = Uri(scheme: 'smsto', path: cleaned);

    bool launched = false;
    if (await canLaunchUrl(smsUri)) {
      launched = await launchUrl(smsUri, mode: LaunchMode.externalApplication);
    } else if (await canLaunchUrl(smstoUri)) {
      launched = await launchUrl(
        smstoUri,
        mode: LaunchMode.externalApplication,
      );
    }

    if (!launched && mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(_tr('SMS app not available'))));
    }
  }

  Future<void> _openWhatsApp(String phoneNumber) async {
    var cleanPhone = phoneNumber.replaceAll(RegExp(r'[^0-9]'), '');
    if (cleanPhone.isEmpty) return;
    if (cleanPhone.startsWith('0') && cleanPhone.length == 11) {
      cleanPhone = '92${cleanPhone.substring(1)}';
    } else if (cleanPhone.startsWith('0092')) {
      cleanPhone = cleanPhone.substring(2);
    }
    final uri = Uri.parse('https://wa.me/$cleanPhone');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_tr('Could not launch WhatsApp'))),
        );
      }
    }
  }

  @override
  void initState() {
    super.initState();
    _loadLanguagePreference();
    _tabController = TabController(length: 4, vsync: this);
    _tabController.addListener(_syncTabIndex);
    _blinkController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    );
    _blinkAnimation = CurvedAnimation(
      parent: _blinkController,
      curve: Curves.easeInOut,
    );
    _blinkController.repeat(reverse: true);
    _loadAllData();
    _startLocationTracking();
    _startAssignmentAutoRefresh();
    _setupNotifications();
  }

  void _syncTabIndex() {
    if (!mounted) return;
    if (_tabController.indexIsChanging) return;
    if (_selectedTabIndex != _tabController.index) {
      setState(() {
        _selectedTabIndex = _tabController.index;
      });
    }
  }

  void _setupNotifications() {
    Provider.of<NotificationProvider>(context, listen: false).addEventListener(
      this,
      (data) {
        _handleNotification(data);
      },
    );
  }

  bool _shouldSkipDuplicateNotification({
    required String? type,
    required String? status,
    required String message,
    required Map<String, dynamic> notification,
    required Map<String, dynamic>? nestedData,
  }) {
    final rawOrderId =
        notification['order_id'] ??
        notification['id'] ??
        nestedData?['order_id'] ??
        nestedData?['id'];
    final rawOrderNumber =
        notification['order_number'] ?? nestedData?['order_number'];
    final eventName =
        (notification['socket_event'] ?? notification['event'] ?? type ?? '')
            .toString()
            .toLowerCase()
            .trim();
    final normalizedType = (type ?? eventName).toLowerCase().trim();
    final normalizedStatus = (status ?? '').toLowerCase().trim();
    final eventClass =
        normalizedType.contains('assign') ||
            normalizedType == 'rider_notification' ||
            eventName.contains('assign') ||
            eventName == 'rider_notification'
        ? 'assignment'
        : normalizedType;
    final entityKey = (rawOrderId ?? rawOrderNumber ?? message)
        .toString()
        .toLowerCase()
        .trim();
    final key = [
      eventClass,
      normalizedStatus,
      entityKey,
      message.toLowerCase().trim(),
    ].where((part) => part.isNotEmpty).join('|');
    if (key.isEmpty) return false;

    final now = DateTime.now();
    _recentNotificationEvents.removeWhere(
      (_, seenAt) => now.difference(seenAt) > _notificationDedupWindow,
    );
    final previous = _recentNotificationEvents[key];
    if (previous != null &&
        now.difference(previous) <= _notificationDedupWindow) {
      return true;
    }
    _recentNotificationEvents[key] = now;
    return false;
  }

  void _handleNotification(Map<String, dynamic> notification) {
    if (!mounted) return;

    final nestedData = (notification['data'] is Map<String, dynamic>)
        ? notification['data'] as Map<String, dynamic>
        : null;
    final type =
        (notification['type'] ??
                notification['event'] ??
                notification['action'] ??
                nestedData?['type'] ??
                nestedData?['event'] ??
                nestedData?['action'])
            ?.toString()
            .toLowerCase();
    final status =
        (notification['status'] ??
                notification['order_status'] ??
                nestedData?['status'] ??
                nestedData?['order_status'])
            ?.toString()
            .toLowerCase();
    final message =
        (notification['message'] ??
                nestedData?['message'] ??
                notification['title'] ??
                'New notification')
            .toString();
    final messageLower = message.toLowerCase();

    final bool hasAssignmentPayload =
        notification['rider_id'] != null ||
        nestedData?['rider_id'] != null ||
        notification['order_number'] != null ||
        nestedData?['order_number'] != null ||
        notification['order_id'] != null ||
        nestedData?['order_id'] != null;
    final bool looksLikeAssignmentByType =
        (type != null &&
        (type.contains('assign') || type.contains('new_order')));
    final bool looksLikeAssignmentByMessage =
        messageLower.contains('assigned') ||
        messageLower.contains('new order') ||
        messageLower.contains('order assigned');

    final bool shouldRefresh =
        type == 'assigned' ||
        type == 'rider_notification' ||
        type == 'order_assigned' ||
        type == 'refresh_orders' ||
        type == 'new_order' ||
        type == 'order_status_update' ||
        type == 'payment_status_update' ||
        status == 'out_for_delivery' ||
        status == 'delivered' ||
        status == 'cancelled' ||
        looksLikeAssignmentByType ||
        looksLikeAssignmentByMessage ||
        hasAssignmentPayload;

    if (shouldRefresh) {
      if (_shouldSkipDuplicateNotification(
        type: type,
        status: status,
        message: message,
        notification: notification,
        nestedData: nestedData,
      )) {
        return;
      }
      final isSilent =
          type == 'refresh_orders' && (message.isEmpty || message == ' ');
      if (!isSilent) {
        ScaffoldMessenger.of(context).clearSnackBars();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(message),
            duration: const Duration(seconds: 3),
            behavior: SnackBarBehavior.floating,
            showCloseIcon: true,
          ),
        );
      }
      _refreshFromNotification();
      _switchToTab(0);
    }
  }

  @override
  void dispose() {
    _tabController.removeListener(_syncTabIndex);
    _tabController.dispose();
    _blinkController.dispose();
    _assignmentRefreshTimer?.cancel();
    _locationStreamSubscription?.cancel();
    Provider.of<NotificationProvider>(
      context,
      listen: false,
    ).removeEventListener(this);
    super.dispose();
  }

  void _switchToTab(int index) {
    if (!mounted) return;
    if (index < 0 || index > 3) return;
    setState(() {
      _selectedTabIndex = index;
    });
    _tabController.animateTo(index);
  }

  void _startAssignmentAutoRefresh() {
    _assignmentRefreshTimer = Timer.periodic(const Duration(seconds: 15), (_) {
      _refreshAssignedDeliveriesOnly();
    });
  }

  Future<void> _refreshAssignedDeliveriesOnly() async {
    try {
      if (!mounted) return;
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;
      await _loadDeliveries(token, 'assigned');
    } catch (_) {}
  }

  Future<void> _refreshFromNotification() async {
    if (_isNotificationRefreshRunning) return;
    _isNotificationRefreshRunning = true;
    try {
      if (!mounted) return;
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;
      // Immediate refresh + delayed refresh handles eventual DB write latency.
      await _loadDeliveries(token, 'assigned');
      await _loadDeliveries(token, 'completed');
      await Future.delayed(const Duration(seconds: 2));
      if (!mounted) return;
      await _loadDeliveries(token, 'assigned');
      await _loadDeliveries(token, 'completed');
    } catch (e) {
      _logger.w('Notification refresh skipped: $e');
    } finally {
      _isNotificationRefreshRunning = false;
    }
  }

  Future<void> _loadAllData() async {
    setState(() => _isLoading = true);
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;

      await Future.wait([
        _loadProfile(token),
        _loadDeliveries(token, 'assigned'),
        _loadDeliveries(token, 'completed'),
        _getCurrentLocation(),
        _loadWalletBalance(token),
        _loadWalletStats(token, 'daily'),
        _loadCashFlowDataForDate(_selectedCashFlowDate),
      ]);
    } catch (e) {
      _logger.e('Error loading rider data: $e');
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _loadCashFlowDataForDate(DateTime date) async {
    final token = Provider.of<AuthProvider>(context, listen: false).token;
    if (token == null) return;
    setState(() {
      _isLoadingCashFlow = true;
      _selectedCashFlowDate = date;
    });
    try {
      final dateStr = _dateOnly(date);
      final data = await ApiService.getRiderFinancialHistory(
        token,
        from: dateStr,
        to: dateStr,
      );
      if (!mounted) return;
      setState(() {
        _cashFlowData = data;
      });
    } catch (e) {
      _logger.w('Error loading rider cash flow for $date: $e');
    } finally {
      if (mounted) {
        setState(() => _isLoadingCashFlow = false);
      }
    }
  }

  void _changeCashFlowDate(int dayOffset) {
    final newDate = _selectedCashFlowDate.add(Duration(days: dayOffset));
    _loadCashFlowDataForDate(newDate);
  }

  Future<void> _pickCashFlowDate() async {
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate:
          _selectedCashFlowDate.isAfter(now) ? now : _selectedCashFlowDate,
      firstDate: DateTime(now.year - 2),
      lastDate: now,
    );
    if (picked != null) {
      _loadCashFlowDataForDate(picked);
    }
  }

  Future<void> _loadProfile(String token) async {
    try {
      final data = await ApiService.getRiderProfile(token);
      if (data['success'] == true) {
        setState(() {
          _riderProfile = data['rider'];
        });
      }
    } catch (e) {
      _logger.e('Error loading profile: $e');
    }
  }

  Future<void> _loadDeliveries(String token, String status) async {
    try {
      final deliveries = await ApiService.getRiderDeliveries(token, status);
      if (!mounted) return;
      setState(() {
        if (status == 'assigned') {
          _assignedDeliveries = deliveries;
        } else {
          _completedDeliveries = deliveries;
        }
      });
      if (status == 'assigned') {
        unawaited(_syncBackgroundTracking(deliveries));
      }
    } catch (e, stackTrace) {
      _logger.e(
        'Error loading $status deliveries',
        error: e,
        stackTrace: stackTrace,
      );
    }
  }

  Future<void> _syncBackgroundTracking(List<dynamic> deliveries) async {
    final token = Provider.of<AuthProvider>(context, listen: false).token;
    if (token == null || token.trim().isEmpty) return;

    if (deliveries.isEmpty) {
      await RiderBackgroundTrackingService.instance.stop();
      return;
    }

    await RiderBackgroundTrackingService.instance.start(token);
    await RiderBackgroundTrackingService.instance.syncCurrentLocationNow();
  }

  Future<void> _loadWalletBalance(String token) async {
    try {
      _logger.d('Loading wallet balance...');
      final data = await ApiService.getWalletBalance(token);
      _logger.d('Wallet API response: $data');

      if (data['success'] != true) {
        _logger.w('Wallet API returned success=false');
        return;
      }

      final wallet = data['wallet'];
      if (wallet == null) {
        _logger.w('Wallet object is null in response');
        return;
      }

      final balance = wallet['balance'];
      if (balance == null) {
        _logger.w('Balance field is null in wallet object');
        setState(() {
          _walletBalance = 0.0;
        });
        return;
      }

      _logger.d('Extracted balance: $balance (type: ${balance.runtimeType})');
      final parsedBalance = double.tryParse(balance.toString());
      _logger.d('Parsed balance: $parsedBalance');

      setState(() {
        _walletBalance = parsedBalance ?? 0.0;
        _logger.d('Set wallet balance to: $_walletBalance');
      });
    } catch (e) {
      _logger.e('Error loading wallet balance: $e');
      setState(() {
        _walletBalance = 0.0;
      });
    }
  }

  Future<void> _loadWalletStats(String token, String period) async {
    try {
      setState(() => _isLoadingStats = true);
      _logger.d('Loading wallet stats for period: $period');
      final data = await ApiService.getRiderWalletStats(token, period);
      _logger.d('Wallet stats API response: $data');

      if (data['success'] != true) {
        _logger.w('Wallet stats API returned success=false');
        return;
      }

      setState(() {
        _walletStats = data['stats'];
        _selectedStatsPeriod = period;
      });
    } catch (e) {
      _logger.e('Error loading wallet stats: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_tr('Could not load stats. Pull to refresh.'))),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isLoadingStats = false);
      }
    }
  }

  String _dateOnly(DateTime dt) {
    final y = dt.year.toString().padLeft(4, '0');
    final m = dt.month.toString().padLeft(2, '0');
    final d = dt.day.toString().padLeft(2, '0');
    return '$y-$m-$d';
  }

  DateTime? _parseOrderTimestamp(dynamic raw) {
    if (raw == null) return null;
    if (raw is DateTime) return raw;
    final value = raw.toString().trim();
    if (value.isEmpty) return null;
    return DateTime.tryParse(value) ??
        DateTime.tryParse(value.replaceFirst(' ', 'T'));
  }

  DateTime _deliverySortDate(Map<String, dynamic> delivery) {
    return _parseOrderTimestamp(delivery['created_at']) ??
        _parseOrderTimestamp(delivery['updated_at']) ??
        DateTime.fromMillisecondsSinceEpoch(0);
  }

  String _deliveryDateKey(Map<String, dynamic> delivery) {
    // Group by the rider's local calendar day.
    return DateFormat(
      'yyyy-MM-dd',
    ).format(_deliverySortDate(delivery).toLocal());
  }

  String _deliveryDateLabel(String dateKey) {
    final date = DateTime.tryParse(dateKey);
    if (date == null) return dateKey;
    return StaffDates.dayLabel(DateTime(date.year, date.month, date.day));
  }

  Future<void> _openRiderFinancialHistory() async {
    final now = DateTime.now();
    await _openRiderFinancialHistoryForDate(
      DateTime(now.year, now.month, now.day),
    );
  }

  Future<void> _openRiderFinancialHistoryForDate(DateTime selectedDate) async {
    final token = Provider.of<AuthProvider>(context, listen: false).token;
    if (token == null) return;
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final fromDate = DateTime(
      selectedDate.year,
      selectedDate.month,
      selectedDate.day,
    );
    final toDate = fromDate;

    try {
      final data = await ApiService.getRiderFinancialHistory(
        token,
        from: _dateOnly(fromDate),
        to: _dateOnly(toDate),
      );
      if (!mounted) return;
      final summary = (data['summary'] as Map<String, dynamic>?) ?? {};
      final movements = (data['movements'] as List?) ?? const [];
      final unsubmittedCashOrders =
          (data['unsubmitted_cash_orders'] as List?) ?? const [];
      final ledgerSummary =
          (data['ledger_summary'] as Map<String, dynamic>?) ?? {};
      final dailySummary =
          (data['daily_summary'] as Map<String, dynamic>?) ??
          <String, dynamic>{};
      Map<String, dynamic>? dayClosing =
          (data['day_closing'] as Map<String, dynamic>?)
              ?.cast<String, dynamic>();
      final summaryDate = (dailySummary['date'] ?? _dateOnly(toDate))
          .toString();
      final finalizedStatuses = <String>{'approved', 'completed'};
      double totalCollection = 0;
      double totalSubmitted = 0;
      for (final raw in movements) {
        final m = (raw as Map?)?.cast<String, dynamic>() ?? {};
        final movementType = (m['movement_type'] ?? '')
            .toString()
            .toLowerCase();
        final movementStatus = (m['status'] ?? '')
            .toString()
            .toLowerCase()
            .trim();
        final amount = _parseDouble(m['amount']);
        final includeInTotals =
            movementStatus.isEmpty ||
            finalizedStatuses.contains(movementStatus);
        if (!includeInTotals) continue;
        if (movementType == 'cash_collection') {
          totalCollection += amount;
        } else if (movementType == 'cash_submission') {
          totalSubmitted += amount;
        }
      }
      if (totalCollection == 0 && movements.isEmpty) {
        totalCollection = _parseDouble(summary['cash_collection']);
      }
      final unsubmittedCashReceived = _parseDouble(
        summary['unsubmitted_cash_received'],
      );
      final unsettledCollection = unsubmittedCashReceived;
      final cashInCustomerRaw = _parseDouble(
        ledgerSummary['cash_in_customer'] ?? summary['cash_in_customer'],
      );
      final cashInCustomer = cashInCustomerRaw > 0
          ? cashInCustomerRaw
          : totalCollection;
      final cashOutStore = _parseDouble(
        ledgerSummary['cash_out_store_paid'] ??
            summary['cash_out_store_paid'] ??
            summary['store_payment'],
      );
      final officeAdvance = _parseDouble(summary['office_advance']);
      final fuelPayment = _parseDouble(summary['fuel_payment']);
      final expectedCashWithRider =
          officeAdvance +
          cashInCustomer -
          cashOutStore -
          fuelPayment -
          totalSubmitted;

      void showNotSubmittedCashOrders() {
        showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          builder: (ctx) {
            return StaffSheet(
              title: _tr('Not submitted cash'),
              subtitle: _tr('Cash orders not yet handed to the office'),
              maxHeightFactor: 0.8,
              trailing: Padding(
                padding: const EdgeInsetsDirectional.only(end: 4),
                child: Text(
                  Fmt.money(unsettledCollection),
                  style: AppText.price.copyWith(color: AppColors.warning),
                ),
              ),
              child: unsubmittedCashOrders.isEmpty
                  ? EmptyState(
                      icon: Icons.task_alt_rounded,
                      title: _tr('All cash submitted'),
                      message: _tr('No unsubmitted cash orders for this day.'),
                      compact: true,
                    )
                  : ListView.separated(
                      shrinkWrap: true,
                      padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                      itemCount: unsubmittedCashOrders.length,
                      separatorBuilder: (_, _) =>
                          const SizedBox(height: AppSpace.sm),
                      itemBuilder: (_, i) {
                        final order =
                            (unsubmittedCashOrders[i] as Map?)
                                ?.cast<String, dynamic>() ??
                            {};
                        final orderNumber = Fmt.orderNumber(
                          order['order_number'],
                          fallbackId: order['id'],
                        );
                        final totalAmount = _parseDouble(
                          order['unsubmitted_amount'] ??
                              order['remaining_amount'] ??
                              order['total_amount'],
                        );
                        final deliveryFee = _parseDouble(
                          order['delivery_fee'],
                        );
                        final method = Fmt.paymentMethod(
                          order['payment_method'],
                        );
                        return AppCard(
                          padding: const EdgeInsets.all(AppSpace.md),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      orderNumber.isEmpty ? '-' : orderNumber,
                                      style: AppText.bodyStrong,
                                    ),
                                  ),
                                  Text(
                                    Fmt.money(totalAmount),
                                    style: AppText.price,
                                  ),
                                ],
                              ),
                              const SizedBox(height: 2),
                              Text(
                                Fmt.dateTime(
                                  order['created_at'],
                                  fallback: '-',
                                ),
                                style: AppText.caption,
                              ),
                              const SizedBox(height: AppSpace.sm),
                              Wrap(
                                spacing: 6,
                                runSpacing: 6,
                                crossAxisAlignment: WrapCrossAlignment.center,
                                children: [
                                  if (method.isNotEmpty)
                                    TonePill.neutral(method),
                                  _paymentStatusPill(order['payment_status']),
                                  Text(
                                    '${_tr('Delivery fee')} ${Fmt.money(deliveryFee)}',
                                    style: AppText.caption,
                                  ),
                                ],
                              ),
                            ],
                          ),
                        );
                      },
                    ),
            );
          },
        );
      }

      showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (ctx) {
          bool isClosingDay = false;
          return StatefulBuilder(
            builder: (ctx, setModalState) {
              final isDayClosed = dayClosing != null;
              final canGoNext = fromDate.isBefore(today);
              void openDayOffset(int offset) {
                Navigator.of(ctx).pop();
                final nextDate = fromDate.add(Duration(days: offset));
                Future.microtask(() {
                  if (mounted) _openRiderFinancialHistoryForDate(nextDate);
                });
              }

              Future<void> closeDay() async {
                final confirmed =
                    await showDialog<bool>(
                      context: context,
                      builder: (dialogCtx) {
                        return AlertDialog(
                          title: Text(_tr('Close day')),
                          content: Text(
                            '${_tr('Close the day for')} ${StaffDates.dateOnly(summaryDate, fallback: summaryDate)}? ${_tr('You can still view the summary after closing.')}',
                          ),
                          actions: [
                            TextButton(
                              onPressed: () =>
                                  Navigator.of(dialogCtx).pop(false),
                              child: Text(_tr('Cancel')),
                            ),
                            FilledButton(
                              onPressed: () =>
                                  Navigator.of(dialogCtx).pop(true),
                              child: Text(_tr('Close day')),
                            ),
                          ],
                        );
                      },
                    ) ??
                    false;
                if (!confirmed) return;
                setModalState(() => isClosingDay = true);
                try {
                  final closeData = await ApiService.closeRiderDay(
                    token,
                    date: summaryDate,
                  );
                  dayClosing = (closeData['day_closing'] as Map<String, dynamic>?)
                      ?.cast<String, dynamic>();
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(_tr('Day closed successfully'))),
                    );
                  }
                } catch (e) {
                  _logger.w('Close day failed: $e');
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(
                          _tr('Could not close the day. Please try again.'),
                        ),
                      ),
                    );
                  }
                } finally {
                  setModalState(() => isClosingDay = false);
                }
              }

              return StaffSheet(
                title: _tr('Day Transactions'),
                child: ListView(
                  shrinkWrap: true,
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
                  children: [
                    DayStepper(
                      date: fromDate,
                      onPrevious: () => openDayOffset(-1),
                      onNext: canGoNext ? () => openDayOffset(1) : null,
                    ),
                    const SizedBox(height: AppSpace.md),
                    _cashHeroBox(
                      label: _tr('Expected cash with you'),
                      amount: expectedCashWithRider,
                      note: _tr(
                        'Advance + customer cash − store paid − fuel − submitted',
                      ),
                    ),
                    const SizedBox(height: AppSpace.md),
                    StaffStatGrid(
                      children: [
                        StaffStat(
                          label: _tr('Customer cash'),
                          value: Fmt.money(cashInCustomer),
                          icon: Icons.payments_outlined,
                          tone: StaffTone.primary,
                        ),
                        StaffStat(
                          label: _tr('Not submitted'),
                          value: Fmt.money(unsettledCollection),
                          icon: Icons.account_balance_wallet_outlined,
                          tone: unsettledCollection > 0
                              ? StaffTone.warning
                              : StaffTone.neutral,
                          onTap: showNotSubmittedCashOrders,
                        ),
                        StaffStat(
                          label: _tr('Store paid'),
                          value: Fmt.money(cashOutStore),
                          icon: Icons.storefront_outlined,
                        ),
                        StaffStat(
                          label: _tr('Fuel'),
                          value: Fmt.money(_parseDouble(summary['fuel_payment'])),
                          icon: Icons.local_gas_station_outlined,
                        ),
                        StaffStat(
                          label: _tr('Office advance'),
                          value: Fmt.money(
                            _parseDouble(summary['office_advance']),
                          ),
                          icon: Icons.request_page_outlined,
                        ),
                        StaffStat(
                          label: _tr('Submitted to office'),
                          value: Fmt.money(totalSubmitted),
                          icon: Icons.assignment_turned_in_outlined,
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpace.md),
                    StaffSection(
                      title: _tr('Daily Summary'),
                      trailing: Text(
                        StaffDates.dateOnly(summaryDate, fallback: summaryDate),
                        style: AppText.caption,
                      ),
                      children: [
                        MoneyRow(
                          label: _tr('Cash collected'),
                          amount: dailySummary['cash_collection'],
                        ),
                        MoneyRow(
                          label: _tr('Store paid'),
                          amount: dailySummary['store_payment'],
                        ),
                        MoneyRow(
                          label: _tr('Fuel'),
                          amount: dailySummary['fuel_payment'],
                        ),
                        MoneyRow(
                          label: _tr('Delivery fees earned'),
                          amount: dailySummary['delivery_fee_earned'],
                          tone: StaffTone.primary,
                        ),
                        const SizedBox(height: AppSpace.md),
                        if (isDayClosed)
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(AppSpace.md),
                            decoration: const BoxDecoration(
                              color: AppColors.successBg,
                              borderRadius: AppRadius.controlAll,
                            ),
                            child: Row(
                              children: [
                                const Icon(
                                  Icons.lock_clock_rounded,
                                  color: AppColors.success,
                                  size: 20,
                                ),
                                const SizedBox(width: AppSpace.sm),
                                Expanded(
                                  child: Text(
                                    '${_tr('Day closed at')} ${Fmt.dateTime(dayClosing?['closed_at'], fallback: '-')}',
                                    style: AppText.bodyStrong.copyWith(
                                      color: AppColors.success,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          )
                        else
                          PrimaryButton(
                            label: _tr('Close day'),
                            icon: Icons.task_alt_rounded,
                            loading: isClosingDay,
                            onPressed: closeDay,
                          ),
                      ],
                    ),
                  ],
                ),
              );
            },
          );
        },
      );
    } catch (e) {
      if (!mounted) return;
      _logger.w('Rider financial history failed: $e');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_tr('Could not load day transactions.'))),
      );
    }
  }

  Future<void> _refreshLocation() async {
    setState(() => _currentLocation = 'Updating...');
    await _getCurrentLocation();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_tr('Location updated'))),
      );
    }
  }

  String _formatCoordinateLabel(Position position) {
    return '${position.latitude.toStringAsFixed(4)}, ${position.longitude.toStringAsFixed(4)}';
  }

  String _locationCacheKeyForPosition(Position position) {
    return '${position.latitude.toStringAsFixed(4)},${position.longitude.toStringAsFixed(4)}';
  }

  Future<String> _resolveLocationLabel(Position position) async {
    final fallback = _formatCoordinateLabel(position);
    final cacheKey = _locationCacheKeyForPosition(position);
    final cached = _locationLabelCache[cacheKey];
    if (cached != null && cached.trim().isNotEmpty) {
      return cached;
    }

    try {
      final placemarks = await placemarkFromCoordinates(
        position.latitude,
        position.longitude,
      );

      if (placemarks.isNotEmpty) {
        final place = placemarks.first;
        final parts = <String>[
          if ((place.street ?? '').trim().isNotEmpty) place.street!.trim(),
          if ((place.subLocality ?? '').trim().isNotEmpty)
            place.subLocality!.trim(),
          if ((place.locality ?? '').trim().isNotEmpty) place.locality!.trim(),
          if ((place.administrativeArea ?? '').trim().isNotEmpty)
            place.administrativeArea!.trim(),
        ];

        final label = parts.toSet().take(3).join(', ');
        if (label.isNotEmpty) {
          _locationLabelCache[cacheKey] = label;
          return label;
        }
      }
    } catch (e) {
      _logger.w('Reverse geocoding skipped: $e');
    }

    _locationLabelCache[cacheKey] = fallback;
    return fallback;
  }

  Future<void> _updateCurrentLocationFromPosition(Position position) async {
    if (!mounted) return;
    final fallback = _formatCoordinateLabel(position);
    if (_currentLocation != fallback) {
      setState(() => _currentLocation = fallback);
    }

    final label = await _resolveLocationLabel(position);
    if (!mounted) return;
    if (_currentLocation != label) {
      setState(() => _currentLocation = label);
    }
  }

  Future<void> _getCurrentLocation() async {
    try {
      bool serviceEnabled;
      LocationPermission permission;

      serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        if (mounted) {
          setState(() => _currentLocation = 'Location services disabled');
        }
        return;
      }

      permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
        if (permission == LocationPermission.denied) {
          if (mounted) {
            setState(() => _currentLocation = 'Location permission denied');
          }
          return;
        }
      }

      if (permission == LocationPermission.deniedForever) {
        if (mounted) {
          setState(
            () => _currentLocation = 'Location permission permanently denied',
          );
        }
        return;
      }

      const currentLocationSettings = LocationSettings(
        accuracy: LocationAccuracy.best,
      );
      final position = await Geolocator.getCurrentPosition(
        locationSettings: currentLocationSettings,
      );
      await _updateCurrentLocationFromPosition(position);
    } catch (e) {
      _logger.e('Error getting location: $e');
      if (mounted) setState(() => _currentLocation = 'Error getting location');
    }
  }

  void _startLocationTracking() {
    _locationStreamSubscription?.cancel();

    const locationSettings = LocationSettings(
      accuracy: LocationAccuracy.bestForNavigation,
      distanceFilter: 2,
    );

    _locationStreamSubscription =
        Geolocator.getPositionStream(locationSettings: locationSettings).listen(
          (position) async {
            await _updateCurrentLocationFromPosition(position);
            if (_assignedDeliveries.isNotEmpty) {
              await RiderBackgroundTrackingService.instance.syncPosition(
                position,
              );
            }
          },
        );
  }

  Future<void> _markAsDelivered(int orderId) async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;

      await ApiService.markOrderAsDelivered(token, orderId);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_tr('Order marked as delivered'))),
        );
        _loadAllData(); // Refresh list
      }
    } catch (e) {
      _logger.e('Error marking delivered: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_tr('Could not mark delivered. Please try again.')),
          ),
        );
      }
    }
  }

  Future<void> _markPaymentReceived(int orderId) async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;

      await ApiService.updatePaymentStatus(token, orderId, 'paid');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_tr('Payment marked as received! Wallet updated.')),
          ),
        );
        _loadAllData();
        await Future.delayed(const Duration(milliseconds: 500));
        if (mounted) {
          await _loadWalletBalance(token);
        }
      }
    } catch (e) {
      _logger.e('Error updating payment: $e');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(_tr('Could not update payment. Please try again.')),
          ),
        );
      }
    }
  }

  double _parseDouble(dynamic value) {
    if (value == null) return 0.0;
    if (value is double) return value;
    if (value is int) return value.toDouble();
    if (value is String) return double.tryParse(value) ?? 0.0;
    return 0.0;
  }

  void _logout() {
    Provider.of<AuthProvider>(context, listen: false).logout();
    Navigator.of(
      context,
    ).pushReplacement(MaterialPageRoute(builder: (_) => const LoginScreen()));
  }

  // ---------------------------------------------------------------------------
  // UI (phase B redesign). Everything below is presentation only; data loading,
  // location tracking and status updates are the methods above.
  // ---------------------------------------------------------------------------

  static const List<String> _tabTitles = [
    'Deliveries',
    'History',
    'Wallet',
    'Profile',
  ];

  String get _riderName {
    final first = (_riderProfile?['first_name'] ?? '').toString().trim();
    final last = (_riderProfile?['last_name'] ?? '').toString().trim();
    final full = '$first $last'.trim();
    return full.isEmpty ? _tr('Rider') : full;
  }

  Future<void> _openMaps(String address) async {
    final query = address.trim();
    if (query.isEmpty) return;
    final uri = Uri.https('www.google.com', '/maps/search/', {
      'api': '1',
      'query': query,
    });
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(_tr('Could not open maps'))));
    }
  }

  Widget _paymentStatusPill(dynamic raw) {
    final value = (raw ?? '').toString().trim().toLowerCase();
    switch (value) {
      case 'paid':
        return TonePill.success(_tr('Paid'));
      case 'failed':
        return TonePill.danger(_tr('Payment failed'));
      case '':
        return const SizedBox.shrink();
      default:
        return TonePill.warning(_tr('Not paid'));
    }
  }

  /// Big green-tinted amount box used for "cash with you" figures.
  Widget _cashHeroBox({
    required String label,
    required double amount,
    String? note,
    Widget? trailing,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpace.lg),
      decoration: BoxDecoration(
        color: AppColors.tint50,
        borderRadius: AppRadius.cardAll,
        border: Border.all(color: AppColors.tint200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: AppText.bodyStrong.copyWith(
                    color: AppColors.primaryDeep,
                  ),
                ),
              ),
              ?trailing,
            ],
          ),
          const SizedBox(height: AppSpace.xs),
          Text(
            Fmt.money(amount),
            style: AppText.price.copyWith(
              fontSize: 30,
              color: AppColors.primaryDeep,
              letterSpacing: -0.5,
            ),
          ),
          if (note != null) ...[
            const SizedBox(height: AppSpace.xs),
            Text(note, style: AppText.caption),
          ],
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return LanguageScope(
      isUrdu: _isUrdu,
      child: Scaffold(
        backgroundColor: AppColors.background,
        drawer: _buildRiderDrawer(),
        appBar: AppBar(
          title: Text(_tr(_tabTitles[_selectedTabIndex.clamp(0, 3)])),
          actions: const [NotificationBellWidget(), SizedBox(width: 4)],
        ),
        bottomNavigationBar: _buildBottomNavigationBar(),
        body: _isLoading
            ? const StaffListSkeleton()
            : TabBarView(
                controller: _tabController,
                physics: const NeverScrollableScrollPhysics(),
                children: [
                  RefreshIndicator(
                    onRefresh: _loadAllData,
                    child: _buildDeliveriesList(_assignedDeliveries, true),
                  ),
                  RefreshIndicator(
                    onRefresh: _loadAllData,
                    child: _buildDeliveriesList(_completedDeliveries, false),
                  ),
                  RefreshIndicator(
                    onRefresh: _loadAllData,
                    child: _buildWalletTab(),
                  ),
                  RefreshIndicator(
                    onRefresh: _loadAllData,
                    child: _buildProfileTab(),
                  ),
                ],
              ),
      ),
    );
  }

  /// Compact rider strip shown once, at the top of the Deliveries tab.
  Widget _buildRiderInfoCard() {
    final vehicle = (_riderProfile?['vehicle_type'] ?? '').toString().trim();
    final riderId = (_riderProfile?['id'] ?? '').toString();
    final name = _riderName;
    final sub = [
      if (riderId.isNotEmpty) '${_tr('ID')} $riderId',
      if (vehicle.isNotEmpty) vehicle,
    ].join(' · ');

    Widget stat(String value, String label, {Color? color}) {
      return Expanded(
        child: Column(
          children: [
            FittedBox(
              fit: BoxFit.scaleDown,
              child: Text(
                value,
                maxLines: 1,
                style: AppText.price.copyWith(
                  fontSize: 16,
                  color: color ?? AppColors.text,
                ),
              ),
            ),
            const SizedBox(height: 2),
            Text(label, style: AppText.caption, maxLines: 1),
          ],
        ),
      );
    }

    Widget divider() =>
        Container(width: 1, height: 28, color: AppColors.border);

    return AppCard(
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      child: Column(
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 20,
                backgroundColor: AppColors.tint100,
                child: Text(
                  name.isNotEmpty ? name.substring(0, 1).toUpperCase() : 'R',
                  style: AppText.title.copyWith(color: AppColors.primaryDeep),
                ),
              ),
              const SizedBox(width: AppSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.title,
                    ),
                    if (sub.isNotEmpty)
                      Text(sub, style: AppText.caption, maxLines: 1),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpace.md),
          Row(
            children: [
              stat(
                Fmt.number(_assignedDeliveries.length),
                _tr('Active'),
                color: _assignedDeliveries.isEmpty
                    ? AppColors.text
                    : AppColors.primaryPressed,
              ),
              divider(),
              stat(Fmt.number(_completedDeliveries.length), _tr('Delivered')),
              divider(),
              stat(Fmt.money(_walletBalance.roundToDouble()), _tr('Wallet')),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildRiderDrawer() {
    final name = _riderName;
    final email = (_riderProfile?['email'] ?? '').toString();

    Widget item(
      IconData icon,
      String label,
      VoidCallback onTap, {
      bool selected = false,
      bool destructive = false,
    }) {
      final color = destructive ? AppColors.danger : AppColors.text;
      return ListTile(
        minTileHeight: 52,
        selected: selected,
        selectedTileColor: AppColors.tint50,
        selectedColor: AppColors.primaryDeep,
        shape: const RoundedRectangleBorder(borderRadius: AppRadius.controlAll),
        leading: Icon(icon, color: selected ? AppColors.primaryPressed : color),
        title: Text(
          label,
          style: AppText.bodyStrong.copyWith(
            color: selected ? AppColors.primaryDeep : color,
          ),
        ),
        onTap: () {
          Navigator.of(context).pop();
          onTap();
        },
      );
    }

    return Drawer(
      backgroundColor: AppColors.surface,
      child: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 20, 20, 12),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 24,
                    backgroundColor: AppColors.tint100,
                    child: Text(
                      name.isNotEmpty ? name.substring(0, 1).toUpperCase() : 'R',
                      style: AppText.h2.copyWith(color: AppColors.primaryDeep),
                    ),
                  ),
                  const SizedBox(width: AppSpace.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          name,
                          style: AppText.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        if (email.isNotEmpty)
                          Text(
                            email,
                            style: AppText.caption,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(AppSpace.sm),
                children: [
                  item(
                    Icons.delivery_dining_outlined,
                    _tr('Home'),
                    () => _switchToTab(0),
                    selected: _selectedTabIndex == 0,
                  ),
                  item(
                    Icons.history_rounded,
                    _tr('History'),
                    () => _switchToTab(1),
                    selected: _selectedTabIndex == 1,
                  ),
                  item(
                    Icons.account_balance_wallet_outlined,
                    _tr('Wallet'),
                    () => _switchToTab(2),
                    selected: _selectedTabIndex == 2,
                  ),
                  item(
                    Icons.query_stats_rounded,
                    _tr('Day Transactions'),
                    _openRiderFinancialHistory,
                  ),
                  item(
                    Icons.person_outline_rounded,
                    _tr('Profile'),
                    () => _switchToTab(3),
                    selected: _selectedTabIndex == 3,
                  ),
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: AppSpace.sm),
                    child: Divider(height: 1),
                  ),
                  item(Icons.refresh_rounded, _tr('Refresh'), _loadAllData),
                  item(
                    Icons.key_outlined,
                    _tr('Change Password'),
                    () => Navigator.of(context).pushNamed('/change-password'),
                  ),
                  item(
                    Icons.logout_rounded,
                    _tr('Logout'),
                    _logout,
                    destructive: true,
                  ),
                ],
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(16, 8, 16, 16),
              child: AppVersionText(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBottomNavigationBar() {
    return DecoratedBox(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.border)),
      ),
      child: NavigationBar(
        selectedIndex: _selectedTabIndex.clamp(0, 3),
        onDestinationSelected: _switchToTab,
        destinations: [
          NavigationDestination(
            icon: Badge(
              isLabelVisible: _assignedDeliveries.isNotEmpty,
              label: Text('${_assignedDeliveries.length}'),
              child: const Icon(Icons.delivery_dining_outlined),
            ),
            selectedIcon: Badge(
              isLabelVisible: _assignedDeliveries.isNotEmpty,
              label: Text('${_assignedDeliveries.length}'),
              child: const Icon(Icons.delivery_dining_rounded),
            ),
            label: _tr('Home'),
            tooltip: _tr('Deliveries'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.history_rounded),
            label: _tr('History'),
            tooltip: _tr('History'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.account_balance_wallet_outlined),
            selectedIcon: const Icon(Icons.account_balance_wallet_rounded),
            label: _tr('Wallet'),
            tooltip: _tr('Wallet'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.person_outline_rounded),
            selectedIcon: const Icon(Icons.person_rounded),
            label: _tr('Profile'),
            tooltip: _tr('Profile'),
          ),
        ],
      ),
    );
  }

  Widget _buildDeliveriesList(List<dynamic> deliveries, bool isAssigned) {
    if (deliveries.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(AppSpace.lg),
        children: [
          if (isAssigned) _buildRiderInfoCard(),
          EmptyState(
            icon: isAssigned
                ? Icons.delivery_dining_outlined
                : Icons.history_rounded,
            title: isAssigned
                ? _tr('No active deliveries')
                : _tr('No completed deliveries yet'),
            message: isAssigned
                ? _tr('New orders assigned to you appear here automatically.')
                : _tr('Delivered orders will be listed here by day.'),
            actionLabel: _tr('Refresh'),
            actionIcon: Icons.refresh_rounded,
            onAction: _loadAllData,
          ),
        ],
      );
    }

    final sortedDeliveries =
        deliveries
            .whereType<Map>()
            .map((delivery) => delivery.cast<String, dynamic>())
            .toList()
          ..sort((a, b) {
            final dateCompare = _deliverySortDate(
              b,
            ).compareTo(_deliverySortDate(a));
            if (dateCompare != 0) return dateCompare;
            final aId = int.tryParse((a['id'] ?? '').toString()) ?? 0;
            final bId = int.tryParse((b['id'] ?? '').toString()) ?? 0;
            return bId.compareTo(aId);
          });

    final deliveriesByDate = <String, List<Map<String, dynamic>>>{};
    for (final delivery in sortedDeliveries) {
      deliveriesByDate
          .putIfAbsent(
            _deliveryDateKey(delivery),
            () => <Map<String, dynamic>>[],
          )
          .add(delivery);
    }

    final dateKeys = deliveriesByDate.keys.toList()
      ..sort((a, b) => b.compareTo(a));

    // Flatten into header / card rows once (not per item build).
    final rows = <Object>[];
    for (final dateKey in dateKeys) {
      rows.add(dateKey);
      rows.addAll(deliveriesByDate[dateKey]!);
    }
    final headerCount = isAssigned ? 1 : 0;

    return ListView.builder(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      itemCount: rows.length + headerCount,
      itemBuilder: (context, index) {
        if (isAssigned && index == 0) return _buildRiderInfoCard();
        final row = rows[index - headerCount];
        if (row is String) {
          final count = deliveriesByDate[row]!.length;
          return Padding(
            padding: const EdgeInsets.only(top: 16, bottom: 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    _tr(_deliveryDateLabel(row)),
                    style: AppText.title,
                  ),
                ),
                Text(
                  _count(count, 'order', 'orders'),
                  style: AppText.caption,
                ),
              ],
            ),
          );
        }
        final delivery = row as Map<String, dynamic>;
        return Padding(
          padding: const EdgeInsets.only(bottom: AppSpace.md),
          child: isAssigned
              ? _buildDeliveryCard(delivery, isAssigned)
              : _buildHistoryCard(delivery),
        );
      },
    );
  }

  Widget _routeStop({
    required IconData icon,
    required Color color,
    required Color background,
    required String label,
    required String title,
    String? subtitle,
    String? extra,
  }) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(color: background, shape: BoxShape.circle),
          child: Icon(icon, size: 18, color: color),
        ),
        const SizedBox(width: AppSpace.md),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label.toUpperCase(), style: AppText.caption.copyWith(
                fontSize: 11,
                letterSpacing: 0.4,
                fontWeight: FontWeight.w700,
              )),
              Text(title, style: AppText.bodyStrong.copyWith(fontSize: 15)),
              if (subtitle != null && subtitle.isNotEmpty)
                Text(subtitle, style: AppText.bodySecondary),
              if (extra != null && extra.isNotEmpty)
                Text(extra, style: AppText.caption),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildDeliveryCard(Map<String, dynamic> delivery, bool isAssigned) {
    final status = (delivery['status'] ?? 'unknown').toString();
    final paymentStatus = (delivery['payment_status'] ?? 'pending').toString();
    final isPaid = paymentStatus == 'paid';
    final isCash = Fmt.isCashPayment(delivery['payment_method']);
    final cashState = !isPaid
        ? CashState.collect
        : (isCash ? CashState.collected : CashState.prepaid);
    final customerPhone = (delivery['phone'] ?? '').toString().trim();
    final instructions = (delivery['special_instructions'] ?? '')
        .toString()
        .trim();
    final preferredTime = (delivery['delivery_time'] ?? '').toString().trim();
    final preferredIsAsap =
        preferredTime.isEmpty || preferredTime.toLowerCase() == 'asap';
    final hasNotice = instructions.isNotEmpty || !preferredIsAsap;
    final statusKey = status.toLowerCase();
    final shouldBlink =
        hasNotice && statusKey != 'delivered' && statusKey != 'cancelled';
    final customerName =
        '${delivery['first_name'] ?? ''} ${delivery['last_name'] ?? ''}'.trim();
    final address = (delivery['delivery_address'] ?? '').toString().trim();
    final storeName = (delivery['store_name'] ?? _tr('Store')).toString();
    final storeLocation = (delivery['store_location'] ?? '').toString().trim();
    final itemCount = ((delivery['items'] as List?) ?? const []).length;
    final total = delivery['total_amount'];

    Widget primaryAction() {
      if (!isAssigned) return const SizedBox.shrink();
      if (status == 'out_for_delivery') {
        if (!isPaid) {
          return SwipeToConfirm(
            label: '${_tr('Swipe: cash received')} ${Fmt.money(total)}',
            color: AppColors.warning,
            onConfirmed: () => _markPaymentReceived(delivery['id']),
          );
        }
        return SwipeToConfirm(
          label: _tr('Swipe to mark delivered'),
          onConfirmed: () => _markAsDelivered(delivery['id']),
        );
      }
      final style = OrderStatusStyle.of(status);
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AppSpace.md),
        decoration: const BoxDecoration(
          color: AppColors.surface3,
          borderRadius: AppRadius.controlAll,
        ),
        child: Row(
          children: [
            const Icon(Icons.hourglass_top_rounded, color: AppColors.text2),
            const SizedBox(width: AppSpace.sm),
            Expanded(
              child: Text(
                '${_tr('Waiting for pickup')} · ${_isUrdu ? style.urduLabel : style.label}',
                style: AppText.bodyStrong.copyWith(color: AppColors.text2),
              ),
            ),
          ],
        ),
      );
    }

    return AppCard(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        Fmt.orderNumber(
                          delivery['order_number'],
                          fallbackId: delivery['id'],
                        ),
                        style: AppText.title,
                      ),
                      Text(
                        Fmt.dateTime(delivery['created_at'], fallback: '-'),
                        style: AppText.caption,
                      ),
                    ],
                  ),
                ),
                StatusPill(status: status, urdu: _isUrdu),
              ],
            ),
          ),
          if (hasNotice)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
              child: Container(
                padding: const EdgeInsets.all(AppSpace.md),
                decoration: const BoxDecoration(
                  color: AppColors.warningBg,
                  borderRadius: AppRadius.controlAll,
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: shouldBlink
                          ? FadeTransition(
                              opacity: _blinkAnimation,
                              child: const Icon(
                                Icons.circle,
                                size: 10,
                                color: AppColors.warning,
                              ),
                            )
                          : const Icon(
                              Icons.circle,
                              size: 10,
                              color: AppColors.warning,
                            ),
                    ),
                    const SizedBox(width: AppSpace.sm),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (!preferredIsAsap)
                            Text(
                              '${_tr('Deliver')}: ${Fmt.deliveryTime(preferredTime)}',
                              style: AppText.bodyStrong.copyWith(
                                color: AppColors.warning,
                              ),
                            ),
                          if (instructions.isNotEmpty) ...[
                            Text(
                              _tr('Special Instructions'),
                              style: AppText.label.copyWith(
                                color: AppColors.warning,
                              ),
                            ),
                            Text(instructions, style: AppText.body),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
            child: Column(
              children: [
                _routeStop(
                  icon: Icons.storefront_rounded,
                  color: AppColors.primaryPressed,
                  background: AppColors.tint100,
                  label: _tr('Pick up'),
                  title: storeName,
                  subtitle: storeLocation,
                ),
                Padding(
                  padding: const EdgeInsetsDirectional.only(start: 17),
                  child: Align(
                    alignment: AlignmentDirectional.centerStart,
                    child: Container(
                      width: 2,
                      height: 14,
                      color: AppColors.border,
                    ),
                  ),
                ),
                _routeStop(
                  icon: Icons.location_on_rounded,
                  color: AppColors.danger,
                  background: AppColors.dangerBg,
                  label: _tr('Drop off'),
                  title: customerName.isEmpty ? _tr('Customer') : customerName,
                  subtitle: address,
                  extra: customerPhone,
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
            child: CashCallout(
              state: cashState,
              amount: total,
              methodLabel: Fmt.paymentMethod(delivery['payment_method']),
              tr: _tr,
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Row(
              children: [
                Expanded(
                  child: ContactButton(
                    icon: Icons.call_rounded,
                    label: _tr('Call'),
                    onTap: customerPhone.isEmpty
                        ? null
                        : () => _makeCall(customerPhone),
                  ),
                ),
                const SizedBox(width: AppSpace.sm),
                Expanded(
                  child: ContactButton(
                    icon: Icons.chat_rounded,
                    label: _tr('WhatsApp'),
                    color: const Color(0xFF128C7E),
                    onTap: customerPhone.isEmpty
                        ? null
                        : () => _openWhatsApp(customerPhone),
                  ),
                ),
                const SizedBox(width: AppSpace.sm),
                Expanded(
                  child: ContactButton(
                    icon: Icons.map_rounded,
                    label: _tr('Maps'),
                    color: AppColors.info,
                    onTap: address.isEmpty ? null : () => _openMaps(address),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 4, 8, 0),
            child: Align(
              alignment: AlignmentDirectional.centerStart,
              child: TextButton.icon(
                onPressed: () => _showOrderInfo(delivery),
                icon: const Icon(Icons.receipt_long_rounded, size: 18),
                label: Text(
                  itemCount > 0
                      ? '${_tr('Summary')} · ${_count(itemCount, 'item', 'items')}'
                      : _tr('Summary'),
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
            child: primaryAction(),
          ),
        ],
      ),
    );
  }

  /// Completed delivery: compact, no contact buttons.
  Widget _buildHistoryCard(Map<String, dynamic> delivery) {
    final status = (delivery['status'] ?? '').toString();
    final customerName =
        '${delivery['first_name'] ?? ''} ${delivery['last_name'] ?? ''}'.trim();
    final storeName = (delivery['store_name'] ?? '').toString();
    final method = Fmt.paymentMethod(delivery['payment_method']);
    return AppCard(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      onTap: () => _showOrderInfo(delivery),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  Fmt.orderNumber(
                    delivery['order_number'],
                    fallbackId: delivery['id'],
                  ),
                  style: AppText.bodyStrong,
                ),
              ),
              StatusPill(status: status, urdu: _isUrdu, dense: true),
            ],
          ),
          const SizedBox(height: AppSpace.xs),
          Text(
            [
              Fmt.time(delivery['created_at']),
              if (storeName.isNotEmpty) storeName,
              if (customerName.isNotEmpty) customerName,
            ].where((s) => s.isNotEmpty).join(' · '),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: AppText.small,
          ),
          const SizedBox(height: AppSpace.sm),
          Row(
            children: [
              if (method.isNotEmpty)
                Text(_tr(method), style: AppText.caption),
              const Spacer(),
              PriceText(delivery['total_amount']),
            ],
          ),
        ],
      ),
    );
  }

  void _showOrderInfo(Map<String, dynamic> delivery) {
    final items = (delivery['items'] as List?) ?? [];
    final deliveryStoreName = delivery['store_name'] ?? 'Unknown Store';

    Map<String, List<dynamic>> itemsByStore = {};
    for (var item in items) {
      final storeName = item['store_name'] ?? deliveryStoreName;
      if (!itemsByStore.containsKey(storeName)) {
        itemsByStore[storeName] = [];
      }
      itemsByStore[storeName]!.add(item);
    }

    // Pricing breakdown (same maths as before).
    double itemsSubtotal = 0;
    final storeIds = <int>{};
    for (var item in items) {
      itemsSubtotal +=
          (double.tryParse(item['price']?.toString() ?? '0') ?? 0) *
          (int.tryParse(item['quantity']?.toString() ?? '1') ?? 1);
      final storeId = item['store_id'] as int?;
      if (storeId != null) storeIds.add(storeId);
    }
    final deliveryFee =
        double.tryParse(delivery['delivery_fee']?.toString() ?? '0') ?? 0;
    final grandTotal = itemsSubtotal + deliveryFee;
    final numStores = storeIds.isNotEmpty ? storeIds.length : 1;

    final customerPhone = (delivery['phone'] ?? '').toString().trim();
    final customerName =
        '${delivery['first_name'] ?? ''} ${delivery['last_name'] ?? ''}'.trim();
    final method = Fmt.paymentMethod(delivery['payment_method']);

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) {
        return LanguageScope(
          isUrdu: _isUrdu,
          child: StaffSheet(
            title: Fmt.orderNumber(
              delivery['order_number'],
              fallbackId: delivery['id'],
            ),
            subtitle: Fmt.dateTime(delivery['created_at']),
            child: ListView(
              shrinkWrap: true,
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 20),
              children: [
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    StatusPill(status: delivery['status'], urdu: _isUrdu),
                    _paymentStatusPill(delivery['payment_status']),
                    if (method.isNotEmpty) TonePill.neutral(_tr(method)),
                  ],
                ),
                const SizedBox(height: AppSpace.lg),
                StaffSection(
                  title: _tr('Customer Details'),
                  children: [
                    Text(
                      customerName.isEmpty ? '-' : customerName,
                      style: AppText.bodyStrong,
                    ),
                    if (customerPhone.isNotEmpty)
                      Text(customerPhone, style: AppText.bodySecondary),
                    const SizedBox(height: AppSpace.xs),
                    Text(
                      (delivery['delivery_address'] ?? '-').toString(),
                      style: AppText.body,
                    ),
                    if (customerPhone.isNotEmpty) ...[
                      const SizedBox(height: AppSpace.md),
                      Row(
                        children: [
                          Expanded(
                            child: ContactButton(
                              icon: Icons.call_rounded,
                              label: _tr('Call'),
                              onTap: () => _makeCall(customerPhone),
                            ),
                          ),
                          const SizedBox(width: AppSpace.sm),
                          Expanded(
                            child: ContactButton(
                              icon: Icons.sms_outlined,
                              label: _tr('SMS'),
                              color: AppColors.text2,
                              onTap: () => _sendSms(customerPhone),
                            ),
                          ),
                          const SizedBox(width: AppSpace.sm),
                          Expanded(
                            child: ContactButton(
                              icon: Icons.chat_rounded,
                              label: _tr('WhatsApp'),
                              color: const Color(0xFF128C7E),
                              onTap: () => _openWhatsApp(customerPhone),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: AppSpace.md),
                StaffSection(
                  title: _tr('Items by Store'),
                  children: [
                    if (itemsByStore.isEmpty)
                      Text(_tr('No items'), style: AppText.bodySecondary),
                    for (final entry in itemsByStore.entries) ...[
                      Builder(
                        builder: (_) {
                          double storeSubtotal = 0;
                          for (var item in entry.value) {
                            final price =
                                double.tryParse(
                                  item['price']?.toString() ?? '0',
                                ) ??
                                0;
                            final quantity =
                                int.tryParse(
                                  item['quantity']?.toString() ?? '1',
                                ) ??
                                1;
                            storeSubtotal += price * quantity;
                          }
                          return Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  const Icon(
                                    Icons.storefront_outlined,
                                    size: 16,
                                    color: AppColors.primaryPressed,
                                  ),
                                  const SizedBox(width: 6),
                                  Expanded(
                                    child: Text(
                                      entry.key.toString(),
                                      style: AppText.bodyStrong.copyWith(
                                        color: AppColors.primaryDeep,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 6),
                              for (final item in entry.value)
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 6),
                                  child: Row(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      SizedBox(
                                        width: 32,
                                        child: Text(
                                          '${item['quantity']}×',
                                          style: AppText.bodyStrong,
                                        ),
                                      ),
                                      Expanded(
                                        child: Text(
                                          [
                                            (item['product_name'] ?? 'Product')
                                                .toString(),
                                            Fmt.unit(
                                              item['variant_label']?.toString(),
                                            ),
                                          ].where((s) => s.isNotEmpty).join(' · '),
                                          style: AppText.body,
                                        ),
                                      ),
                                      Text(
                                        Fmt.money(
                                          (double.tryParse(
                                                    item['price']
                                                            ?.toString() ??
                                                        '0',
                                                  ) ??
                                                  0) *
                                              (int.tryParse(
                                                    item['quantity']
                                                            ?.toString() ??
                                                        '1',
                                                  ) ??
                                                  1),
                                        ),
                                        style: AppText.price.copyWith(
                                          fontSize: 14,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              if (itemsByStore.length > 1)
                                MoneyRow(
                                  label: _tr('Subtotal'),
                                  amount: storeSubtotal,
                                ),
                              const SizedBox(height: AppSpace.sm),
                            ],
                          );
                        },
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: AppSpace.md),
                StaffSection(
                  title: _tr('Pricing Breakdown'),
                  children: [
                    MoneyRow(
                      label: _tr('Items subtotal'),
                      amount: itemsSubtotal,
                    ),
                    MoneyRow(
                      label: numStores > 1
                          ? '${_tr('Delivery Fee')} ($numStores ${_tr('stores')})'
                          : _tr('Delivery Fee'),
                      amount: deliveryFee,
                    ),
                    const Divider(height: 16),
                    MoneyRow(
                      label: _tr('Grand Total'),
                      amount: grandTotal,
                      strong: true,
                      tone: StaffTone.primary,
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildWalletTab() {
    final summary =
        (_cashFlowData?['summary'] as Map<String, dynamic>?) ?? {};
    final ledgerSummary =
        (_cashFlowData?['ledger_summary'] as Map<String, dynamic>?) ?? {};
    final movements = (_cashFlowData?['movements'] as List?) ?? const [];
    final orderLedger = (_cashFlowData?['order_ledger'] as List?) ?? const [];
    final dayClosing = (_cashFlowData?['day_closing'] as Map<String, dynamic>?);

    // 1. Shift Advance (Float from Admin at shift start)
    double officeAdvance = 0.0;
    for (final raw in movements) {
      final m = (raw as Map?)?.cast<String, dynamic>() ?? {};
      final type = (m['movement_type'] ?? '').toString().toLowerCase();
      if (type == 'advance') {
        officeAdvance += _parseDouble(m['amount']);
      }
    }
    if (officeAdvance == 0) {
      officeAdvance = _parseDouble(summary['office_advance']);
    }

    // 2. Customer COD Collected
    double codCollected = _parseDouble(
      ledgerSummary['cash_in_customer'] ??
          summary['cash_in_customer'] ??
          summary['cash_collection'],
    );
    if (codCollected == 0) {
      for (final raw in movements) {
        final m = (raw as Map?)?.cast<String, dynamic>() ?? {};
        if ((m['movement_type'] ?? '').toString().toLowerCase() ==
            'cash_collection') {
          codCollected += _parseDouble(m['amount']);
        }
      }
    }

    // 3. Paid at Stores
    double paidAtStores = _parseDouble(
      ledgerSummary['cash_out_store_paid'] ??
          summary['cash_out_store_paid'] ??
          summary['store_payment'],
    );
    if (paidAtStores == 0) {
      for (final raw in movements) {
        final m = (raw as Map?)?.cast<String, dynamic>() ?? {};
        if ((m['movement_type'] ?? '').toString().toLowerCase() ==
            'store_payment') {
          paidAtStores += _parseDouble(m['amount']);
        }
      }
    }

    // 4. Fuel & Shift Expenses
    double fuelExpenses = _parseDouble(summary['fuel_payment']);
    if (fuelExpenses == 0) {
      for (final raw in movements) {
        final m = (raw as Map?)?.cast<String, dynamic>() ?? {};
        if ((m['movement_type'] ?? '').toString().toLowerCase() ==
            'fuel_payment') {
          fuelExpenses += _parseDouble(m['amount']);
        }
      }
    }

    // 5. Cash Returned / Submitted to Admin
    double returnedToAdmin = 0.0;
    for (final raw in movements) {
      final m = (raw as Map?)?.cast<String, dynamic>() ?? {};
      final type = (m['movement_type'] ?? '').toString().toLowerCase();
      if (type == 'cash_submission') {
        returnedToAdmin += _parseDouble(m['amount']);
      }
    }

    // Net Running Cash In Hand (In-Pocket Balance)
    final cashInHand =
        officeAdvance +
        codCollected -
        paidAtStores -
        fuelExpenses -
        returnedToAdmin;

    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final selectedDay = DateTime(
      _selectedCashFlowDate.year,
      _selectedCashFlowDate.month,
      _selectedCashFlowDate.day,
    );
    final canGoForward = selectedDay.isBefore(today);

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      children: [
        _buildWalletBalanceCard(),
        const SizedBox(height: AppSpace.xl),
        _buildDailyCashFlowHeader(canGoForward),
        const SizedBox(height: AppSpace.md),
        if (_isLoadingCashFlow)
          const Shimmer(
            child: Column(
              children: [
                SkeletonBox(height: 220, radius: AppRadius.card),
                SizedBox(height: AppSpace.md),
                SkeletonBox(height: 120, radius: AppRadius.card),
              ],
            ),
          )
        else ...[
          _buildHeroCashInHandCard(
            officeAdvance: officeAdvance,
            codCollected: codCollected,
            paidAtStores: paidAtStores,
            fuelExpenses: fuelExpenses,
            returnedToAdmin: returnedToAdmin,
            cashInHand: cashInHand,
            dayClosing: dayClosing,
          ),
          const SizedBox(height: AppSpace.md),
          _buildCashFlowMovementsTimeline(movements),
          if (orderLedger.isNotEmpty) ...[
            const SizedBox(height: AppSpace.md),
            _buildOrdersDeliveredCashSummary(orderLedger),
          ],
        ],
        const SizedBox(height: AppSpace.xl),
        Text(_tr('Financial Statistics'), style: AppText.h2),
        const SizedBox(height: AppSpace.md),
        _buildPeriodSelector(),
        const SizedBox(height: AppSpace.md),
        if (_isLoadingStats)
          const Shimmer(
            child: Row(
              children: [
                Expanded(child: SkeletonBox(height: 72, radius: 12)),
                SizedBox(width: AppSpace.sm),
                Expanded(child: SkeletonBox(height: 72, radius: 12)),
              ],
            ),
          )
        else if (_walletStats != null)
          _buildStatsCards()
        else
          AppCard(
            child: Text(
              _tr('No stats available'),
              style: AppText.bodySecondary,
            ),
          ),
      ],
    );
  }

  Widget _buildWalletBalanceCard() {
    return AppCard(
      padding: const EdgeInsets.fromLTRB(16, 12, 8, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.account_balance_wallet_rounded,
                color: AppColors.primaryPressed,
                size: 20,
              ),
              const SizedBox(width: AppSpace.sm),
              Expanded(
                child: Text(_tr('Wallet balance'), style: AppText.bodyStrong),
              ),
              IconButton(
                tooltip: _tr('Refresh'),
                icon: const Icon(Icons.refresh_rounded),
                onPressed: () async {
                  final token = Provider.of<AuthProvider>(
                    context,
                    listen: false,
                  ).token;
                  if (token != null) {
                    await _loadWalletBalance(token);
                    await _loadCashFlowDataForDate(_selectedCashFlowDate);
                    if (mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(_tr('Wallet & cash flow refreshed')),
                        ),
                      );
                    }
                  }
                },
              ),
            ],
          ),
          Text(
            Fmt.money(_walletBalance),
            style: AppText.price.copyWith(fontSize: 30, letterSpacing: -0.5),
          ),
          const SizedBox(height: AppSpace.xs),
          Text(
            _tr('Total earnings account'),
            style: AppText.caption,
          ),
        ],
      ),
    );
  }

  Widget _buildDailyCashFlowHeader(bool canGoForward) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(_tr('Daily cash'), style: AppText.h2),
        Text(
          _tr('Advance, store payments and cash in your pocket'),
          style: AppText.caption,
        ),
        const SizedBox(height: AppSpace.md),
        DayStepper(
          date: _selectedCashFlowDate,
          onPrevious: () => _changeCashFlowDate(-1),
          onNext: canGoForward ? () => _changeCashFlowDate(1) : null,
          onPick: _pickCashFlowDate,
        ),
      ],
    );
  }

  Widget _buildHeroCashInHandCard({
    required double officeAdvance,
    required double codCollected,
    required double paidAtStores,
    required double fuelExpenses,
    required double returnedToAdmin,
    required double cashInHand,
    required Map<String, dynamic>? dayClosing,
  }) {
    final isClosed = dayClosing != null;
    return AppCard(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.all(AppSpace.md),
            child: _cashHeroBox(
              label: _tr('Cash in pocket'),
              amount: cashInHand,
              trailing: isClosed
                  ? TonePill.neutral(
                      _tr('Shift closed'),
                      icon: Icons.lock_rounded,
                    )
                  : TonePill.success(
                      _tr('Shift active'),
                      icon: Icons.circle,
                    ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 4),
            child: Column(
              children: [
                MoneyRow(
                  label: _tr('Shift advance'),
                  note: _tr('Cash taken from office'),
                  amount: officeAdvance,
                  sign: '+',
                ),
                MoneyRow(
                  label: _tr('Customer cash (COD)'),
                  note: _tr('Delivered orders cash'),
                  amount: codCollected,
                  sign: '+',
                  tone: StaffTone.primary,
                ),
                MoneyRow(
                  label: _tr('Paid at stores'),
                  note: _tr('Cash paid for pickups'),
                  amount: paidAtStores,
                  sign: '-',
                ),
                MoneyRow(
                  label: _tr('Fuel & expenses'),
                  amount: fuelExpenses,
                  sign: '-',
                ),
                MoneyRow(
                  label: _tr('Returned to office'),
                  amount: returnedToAdmin,
                  sign: '-',
                ),
                const Divider(height: 16),
                MoneyRow(
                  label: _tr('Cash in pocket'),
                  amount: cashInHand,
                  strong: true,
                  tone: StaffTone.primary,
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
            child: Row(
              children: [
                Expanded(
                  flex: 3,
                  child: FilledButton.icon(
                    onPressed: () => _showSubmitCashToAdminDialog(cashInHand),
                    icon: const Icon(
                      Icons.assignment_turned_in_rounded,
                      size: 18,
                    ),
                    label: Text(
                      _tr('Return Cash to Admin'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ),
                const SizedBox(width: AppSpace.sm),
                Expanded(
                  flex: 2,
                  child: OutlinedButton.icon(
                    onPressed: () =>
                        _openRiderFinancialHistoryForDate(_selectedCashFlowDate),
                    icon: const Icon(Icons.receipt_long_rounded, size: 18),
                    label: Text(
                      _tr('Day Slip'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
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

  String _movementTypeLabel(String type) {
    switch (type) {
      case 'advance':
        return 'Shift advance';
      case 'store_payment':
        return 'Store payment';
      case 'fuel_payment':
        return 'Fuel expense';
      case 'cash_submission':
        return 'Cash returned to office';
      case 'cash_collection':
        return 'Cash collected';
      default:
        final t = type.replaceAll('_', ' ').trim();
        if (t.isEmpty) return 'Cash movement';
        return t[0].toUpperCase() + t.substring(1);
    }
  }

  String _titleCase(String raw) {
    final t = raw.replaceAll('_', ' ').trim().toLowerCase();
    if (t.isEmpty) return t;
    return t[0].toUpperCase() + t.substring(1);
  }

  Widget _buildCashFlowMovementsTimeline(List<dynamic> movements) {
    return StaffSection(
      title: _tr('Cash movements'),
      trailing: TonePill.neutral(_count(movements.length, 'entry', 'entries')),
      children: [
        if (movements.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpace.sm),
            child: Text(
              _tr('No cash movements logged for this day yet.'),
              style: AppText.bodySecondary,
            ),
          )
        else
          for (var index = 0; index < movements.length; index++) ...[
            if (index > 0) const Divider(height: 20),
            Builder(
              builder: (_) {
                final m =
                    (movements[index] as Map?)?.cast<String, dynamic>() ?? {};
                final type = (m['movement_type'] ?? '')
                    .toString()
                    .toLowerCase();
                final amount = _parseDouble(m['amount']);
                final description = (m['description'] ?? '').toString();
                final when =
                    m['movement_at'] ?? m['created_at'] ?? m['movement_date'];
                final status = (m['status'] ?? '').toString();
                final isAdd = type == 'advance' || type == 'cash_collection' ||
                    !(type == 'store_payment' ||
                        type == 'fuel_payment' ||
                        type == 'cash_submission');
                return Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 32,
                      height: 32,
                      decoration: BoxDecoration(
                        color: isAdd ? AppColors.tint100 : AppColors.surface3,
                        shape: BoxShape.circle,
                      ),
                      child: Icon(
                        isAdd
                            ? Icons.south_west_rounded
                            : Icons.north_east_rounded,
                        color: isAdd
                            ? AppColors.primaryPressed
                            : AppColors.text2,
                        size: 16,
                      ),
                    ),
                    const SizedBox(width: AppSpace.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            _tr(_movementTypeLabel(type)),
                            style: AppText.bodyStrong,
                          ),
                          if (description.isNotEmpty)
                            Text(description, style: AppText.small),
                          const SizedBox(height: 2),
                          Text(
                            [
                              Fmt.dateTime(when),
                              if (status.isNotEmpty) _titleCase(status),
                            ].where((s) => s.isNotEmpty).join(' · '),
                            style: AppText.caption,
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: AppSpace.sm),
                    Text(
                      '${isAdd ? '+' : '−'} ${Fmt.money(amount)}',
                      style: AppText.price.copyWith(
                        fontSize: 14,
                        color: isAdd
                            ? AppColors.primaryPressed
                            : AppColors.text,
                      ),
                    ),
                  ],
                );
              },
            ),
          ],
      ],
    );
  }

  Widget _buildOrdersDeliveredCashSummary(List<dynamic> orderLedger) {
    return StaffSection(
      title: _tr('Delivered orders'),
      trailing: TonePill.neutral(
        _count(orderLedger.length, 'order', 'orders'),
      ),
      children: [
        for (var index = 0; index < orderLedger.length; index++) ...[
          if (index > 0) const Divider(height: 16),
          Builder(
            builder: (_) {
              final o =
                  (orderLedger[index] as Map?)?.cast<String, dynamic>() ?? {};
              final orderNumber = Fmt.orderNumber(
                o['order_number'],
                fallbackId: o['order_id'],
              );
              final collected = _parseDouble(o['customer_cash_collected']);
              final paidStore = _parseDouble(o['rider_store_paid']);
              final netEffect = _parseDouble(o['expected_rider_cash_effect']);
              return Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(orderNumber, style: AppText.bodyStrong),
                        Text(
                          '${_tr('COD')} ${Fmt.money(collected)} · ${_tr('Store paid')} ${Fmt.money(paidStore)}',
                          style: AppText.caption,
                        ),
                      ],
                    ),
                  ),
                  Text(
                    '${netEffect >= 0 ? '+' : '−'} ${Fmt.money(netEffect.abs())}',
                    style: AppText.price.copyWith(
                      fontSize: 14,
                      color: netEffect >= 0
                          ? AppColors.primaryPressed
                          : AppColors.danger,
                    ),
                  ),
                ],
              );
            },
          ),
        ],
      ],
    );
  }

  void _showSubmitCashToAdminDialog(double currentCashInHand) {
    showDialog(
      context: context,
      builder: (ctx) {
        Widget step(String n, String text) => Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                radius: 11,
                backgroundColor: AppColors.tint100,
                child: Text(
                  n,
                  style: AppText.label.copyWith(color: AppColors.primaryDeep),
                ),
              ),
              const SizedBox(width: AppSpace.sm),
              Expanded(child: Text(text, style: AppText.small)),
            ],
          ),
        );
        return LanguageScope(
          isUrdu: _isUrdu,
          child: AlertDialog(
            title: Text(_tr('Return cash to office')),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _cashHeroBox(
                  label: _tr('Cash in pocket'),
                  amount: currentCashInHand,
                ),
                const SizedBox(height: AppSpace.lg),
                step('1', _tr('Hand the cash to your dispatch manager or cashier.')),
                step(
                  '2',
                  _tr('The office records it in Rider Day Transactions.'),
                ),
                step(
                  '3',
                  _tr('Once verified, your cash in pocket updates automatically.'),
                ),
              ],
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(ctx).pop(),
                child: Text(_tr('Close')),
              ),
              FilledButton(
                onPressed: () {
                  Navigator.of(ctx).pop();
                  _openRiderFinancialHistoryForDate(_selectedCashFlowDate);
                },
                child: Text(_tr('View full statement')),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildPeriodSelector() {
    return SizedBox(
      width: double.infinity,
      child: SegmentedButton<String>(
        showSelectedIcon: false,
        segments: <ButtonSegment<String>>[
          ButtonSegment<String>(value: 'daily', label: Text(_tr('Daily'))),
          ButtonSegment<String>(value: 'weekly', label: Text(_tr('Weekly'))),
          ButtonSegment<String>(value: 'monthly', label: Text(_tr('Monthly'))),
        ],
        selected: <String>{_selectedStatsPeriod},
        onSelectionChanged: (Set<String> newSelection) async {
          final token = Provider.of<AuthProvider>(context, listen: false).token;
          if (token != null) {
            await _loadWalletStats(token, newSelection.first);
          }
        },
      ),
    );
  }

  Widget _buildStatsCards() {
    if (_walletStats == null) {
      return const SizedBox.shrink();
    }

    final stats = _walletStats!;
    final cashReceived = _parseDouble(stats['cash_received']);
    final deliveryFees = _parseDouble(stats['total_delivery_fees']);
    // Backend already returns cash_received as (cash total - delivery fee),
    // so do not subtract delivery fees again on client.
    final netCashReceived = cashReceived;
    final paymentSummary =
        (stats['payment_summary'] as List?)?.cast<Map<String, dynamic>>() ?? [];

    return Column(
      children: [
        StaffStatGrid(
          children: [
            StaffStat(
              label: _tr('Cash received (net)'),
              value: Fmt.money(netCashReceived),
              icon: Icons.payments_outlined,
              tone: StaffTone.primary,
            ),
            StaffStat(
              label: _tr('Delivery fees'),
              value: Fmt.money(deliveryFees),
              icon: Icons.local_shipping_outlined,
            ),
          ],
        ),
        if (paymentSummary.isNotEmpty) ...[
          const SizedBox(height: AppSpace.md),
          StaffSection(
            title: _tr('Payment Summary'),
            children: [
              for (final summary in paymentSummary)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _tr(
                                Fmt.paymentMethod(summary['payment_method'])
                                        .isEmpty
                                    ? 'Unknown'
                                    : Fmt.paymentMethod(
                                        summary['payment_method'],
                                      ),
                              ),
                              style: AppText.bodyStrong,
                            ),
                            Text(
                              _count(int.tryParse('${summary['order_count'] ?? 0}') ?? 0, 'order', 'orders'),
                              style: AppText.caption,
                            ),
                          ],
                        ),
                      ),
                      Text(
                        Fmt.money(_parseDouble(summary['total_amount'])),
                        style: AppText.price,
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ],
      ],
    );
  }

  Widget _buildProfileTab() {
    final r = _riderProfile;
    final photoUrl = (r?['image_url'] as String?) ?? '';
    final idCardUrl = (r?['id_card_url'] as String?) ?? '';
    final resolvedPhoto = photoUrl.isEmpty
        ? ''
        : ApiService.getImageUrl(photoUrl);
    final resolvedIdCard = idCardUrl.isEmpty
        ? ''
        : ApiService.getImageUrl(idCardUrl);
    final sameImage = resolvedPhoto.isNotEmpty && resolvedPhoto == resolvedIdCard;

    Widget field(IconData icon, String label, String value) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 20, color: AppColors.muted),
            const SizedBox(width: AppSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: AppText.caption),
                  Text(
                    value,
                    style: AppText.bodyStrong,
                    softWrap: true,
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }

    final vehicle = (r?['vehicle_type'] ?? '').toString().trim();
    final riderId = (r?['id'] ?? '').toString();

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
      children: [
        AppCard(
          child: Row(
            children: [
              SizedBox(
                width: 64,
                height: 64,
                child: ClipOval(
                  child: resolvedPhoto.isEmpty
                      ? Container(
                          color: AppColors.tint100,
                          alignment: Alignment.center,
                          child: Text(
                            _riderName.substring(0, 1).toUpperCase(),
                            style: AppText.h1.copyWith(
                              color: AppColors.primaryDeep,
                            ),
                          ),
                        )
                      : AppNetworkImage(
                          url: resolvedPhoto,
                          width: 64,
                          height: 64,
                          placeholderIcon: Icons.person_rounded,
                        ),
                ),
              ),
              const SizedBox(width: AppSpace.lg),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(_riderName, style: AppText.h2),
                    Text(
                      [
                        if (riderId.isNotEmpty) '${_tr('Rider ID')} $riderId',
                        if (vehicle.isNotEmpty) vehicle,
                      ].join(' · '),
                      style: AppText.caption,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpace.md),
        AppCard(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
          child: Column(
            children: [
              field(
                Icons.mail_outline_rounded,
                _tr('Email'),
                (r?['email'] ?? '-').toString(),
              ),
              const Divider(height: 1),
              field(
                Icons.phone_outlined,
                _tr('Phone'),
                (r?['phone'] ?? '-').toString(),
              ),
              const Divider(height: 1),
              field(
                Icons.two_wheeler_rounded,
                _tr('Vehicle'),
                vehicle.isEmpty ? '-' : vehicle,
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpace.md),
        AppCard(
          padding: const EdgeInsets.fromLTRB(16, 8, 8, 8),
          child: Row(
            children: [
              const Icon(
                Icons.my_location_rounded,
                color: AppColors.primaryPressed,
              ),
              const SizedBox(width: AppSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(_tr('Current location'), style: AppText.caption),
                    Text(_currentLocation, style: AppText.bodyStrong),
                  ],
                ),
              ),
              TextButton(
                onPressed: _refreshLocation,
                child: Text(_tr('Refresh')),
              ),
            ],
          ),
        ),
        if (resolvedIdCard.isNotEmpty && !sameImage) ...[
          const SizedBox(height: AppSpace.md),
          StaffSection(
            title: _tr('ID card'),
            children: [
              AspectRatio(
                aspectRatio: 16 / 10,
                child: AppNetworkImage(
                  url: resolvedIdCard,
                  fit: BoxFit.contain,
                  borderRadius: AppRadius.controlAll,
                  placeholderIcon: Icons.badge_outlined,
                ),
              ),
            ],
          ),
        ],
        const SizedBox(height: AppSpace.md),
        AppCard(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Column(
            children: [
              ListTile(
                leading: const Icon(Icons.query_stats_rounded),
                title: Text(_tr('Day Transactions'), style: AppText.bodyStrong),
                trailing: const Icon(Icons.chevron_right_rounded),
                onTap: _openRiderFinancialHistory,
              ),
              ListTile(
                leading: const Icon(Icons.key_outlined),
                title: Text(_tr('Change Password'), style: AppText.bodyStrong),
                trailing: const Icon(Icons.chevron_right_rounded),
                onTap: () => Navigator.of(context).pushNamed('/change-password'),
              ),
              ListTile(
                leading: const Icon(
                  Icons.logout_rounded,
                  color: AppColors.danger,
                ),
                title: Text(
                  _tr('Logout'),
                  style: AppText.bodyStrong.copyWith(color: AppColors.danger),
                ),
                onTap: _logout,
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpace.lg),
        const AppVersionText(),
      ],
    );
  }
}
