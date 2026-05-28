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
    };
    if (_isUrdu && localTranslations.containsKey(text)) {
      return localTranslations[text]!;
    }
    return CustomerLanguage.tr(_isUrdu, text);
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
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(_tr('Could not launch dialer'))),
        );
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
    final cleanPhone = phoneNumber.replaceAll(RegExp(r'[^0-9]'), '');
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
    if (previous != null && now.difference(previous) <= _notificationDedupWindow) {
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
    final type = (notification['type'] ??
            notification['event'] ??
            notification['action'] ??
            nestedData?['type'] ??
            nestedData?['event'] ??
            nestedData?['action'])
        ?.toString()
        .toLowerCase();
    final status = (notification['status'] ??
            notification['order_status'] ??
            nestedData?['status'] ??
            nestedData?['order_status'])
        ?.toString()
        .toLowerCase();
    final message = (notification['message'] ??
                nestedData?['message'] ??
                notification['title'] ??
                'New notification')
            .toString();
    final messageLower = message.toLowerCase();

    final bool hasAssignmentPayload = notification['rider_id'] != null ||
        nestedData?['rider_id'] != null ||
        notification['order_number'] != null ||
        nestedData?['order_number'] != null ||
        notification['order_id'] != null ||
        nestedData?['order_id'] != null;
    final bool looksLikeAssignmentByType =
        (type != null && (type.contains('assign') || type.contains('new_order')));
    final bool looksLikeAssignmentByMessage =
        messageLower.contains('assigned') ||
        messageLower.contains('new order') ||
        messageLower.contains('order assigned');

    final bool shouldRefresh = type == 'assigned' ||
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
            backgroundColor: Color(0xFFE65100),
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
      ]);
    } catch (e) {
      _logger.e('Error loading rider data: $e');
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
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
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Failed to load stats: $e')));
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

  String _fmtDateTime(dynamic raw) {
    if (raw == null) return '-';
    final value = raw.toString().trim();
    if (value.isEmpty) return '-';
    final parsed = DateTime.tryParse(value) ??
        DateTime.tryParse(value.replaceFirst(' ', 'T'));
    if (parsed == null) return value;
    final dt = parsed.isUtc ? parsed.toLocal() : parsed;
    final y = dt.year.toString().padLeft(4, '0');
    final m = dt.month.toString().padLeft(2, '0');
    final d = dt.day.toString().padLeft(2, '0');
    final hh = dt.hour.toString().padLeft(2, '0');
    final mm = dt.minute.toString().padLeft(2, '0');
    return '$y-$m-$d $hh:$mm';
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
    return DateFormat('yyyy-MM-dd').format(_deliverySortDate(delivery));
  }

  String _deliveryDateLabel(String dateKey) {
    final date = DateTime.tryParse(dateKey);
    if (date == null) return dateKey;
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final orderDay = DateTime(date.year, date.month, date.day);

    if (orderDay == today) return 'Today';
    if (orderDay == today.subtract(const Duration(days: 1))) return 'Yesterday';
    return DateFormat('EEE, MMM d, yyyy').format(orderDay);
  }

  // ignore: unused_element
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
      final orderLedger = (data['order_ledger'] as List?) ?? const [];
      final ledgerSummary =
          (data['ledger_summary'] as Map<String, dynamic>?) ?? {};
      final dailySummary =
          (data['daily_summary'] as Map<String, dynamic>?) ?? <String, dynamic>{};
      Map<String, dynamic>? dayClosing =
          (data['day_closing'] as Map<String, dynamic>?)
              ?.cast<String, dynamic>();
      final summaryDate =
          (dailySummary['date'] ?? _dateOnly(toDate)).toString();
      final finalizedStatuses = <String>{'approved', 'completed'};
      double totalCollection = 0;
      double totalSubmitted = 0;
      for (final raw in movements) {
        final m = (raw as Map?)?.cast<String, dynamic>() ?? {};
        final movementType = (m['movement_type'] ?? '').toString().toLowerCase();
        final movementStatus = (m['status'] ?? '').toString().toLowerCase().trim();
        final amount = _parseDouble(m['amount']);
        final includeInTotals =
            movementStatus.isEmpty || finalizedStatuses.contains(movementStatus);
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
      final unsubmittedCashReceived =
          _parseDouble(summary['unsubmitted_cash_received']);
      final unsettledCollection = unsubmittedCashReceived;
      final cashInCustomerRaw =
          _parseDouble(ledgerSummary['cash_in_customer'] ?? summary['cash_in_customer']);
      final cashInCustomer = cashInCustomerRaw > 0 ? cashInCustomerRaw : totalCollection;
      final cashOutStore = _parseDouble(
        ledgerSummary['cash_out_store_paid'] ?? summary['cash_out_store_paid'] ?? summary['store_payment'],
      );
      final payableLater = _parseDouble(
        ledgerSummary['store_payable_later'] ?? summary['store_payable_later'],
      );
      final storePayableNow = _parseDouble(
        ledgerSummary['rider_store_payable_now'] ??
            summary['rider_store_payable_now'],
      );
      final missingStorePayment = _parseDouble(
        ledgerSummary['missing_rider_store_payment'] ??
            summary['missing_rider_store_payment'],
      );
      final profitAdjustment = _parseDouble(
        ledgerSummary['company_profit_adjustment'] ??
            summary['company_profit_adjustment'],
      );
      final officeAdvance = _parseDouble(summary['office_advance']);
      final fuelPayment = _parseDouble(summary['fuel_payment']);
      final expectedCashWithRider = officeAdvance +
          cashInCustomer -
          cashOutStore -
          fuelPayment -
          totalSubmitted;

      Color movementColor(String type) {
        final t = type.toLowerCase();
        if (t.contains('cash_collection')) return const Color(0xFF15803D);
        if (t.contains('store_payment')) return const Color(0xFF1D4ED8);
        if (t.contains('fuel')) return const Color(0xFFD97706);
        if (t.contains('advance')) return const Color(0xFF7C3AED);
        if (t.contains('settlement')) return const Color(0xFF0F766E);
        return Colors.grey;
      }

      Widget summaryTile({
        required String label,
        required dynamic value,
        required IconData icon,
        required Color color,
        VoidCallback? onTap,
      }) {
        final amount = _parseDouble(value).toStringAsFixed(2);
        return Expanded(
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(12),
            child: Container(
              padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: color.withValues(alpha: 0.25)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Icon(icon, color: color, size: 14),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          label,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 9.5,
                            color: Colors.black54,
                            fontWeight: FontWeight.w600,
                            height: 1.0,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 3),
                  Text(
                    'PKR $amount',
                    style: TextStyle(
                      fontSize: 12.5,
                      color: color,
                      fontWeight: FontWeight.bold,
                      height: 1.0,
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      }

      Widget ledgerRow(
        String label,
        dynamic value, {
        Color color = Colors.black87,
        bool strong = false,
      }) {
        return Padding(
          padding: const EdgeInsets.symmetric(vertical: 3),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 12,
                    color: strong ? Colors.black87 : Colors.black54,
                    fontWeight: strong ? FontWeight.w800 : FontWeight.w600,
                  ),
                ),
              ),
              Text(
                'PKR ${_parseDouble(value).toStringAsFixed(2)}',
                style: TextStyle(
                  fontSize: 12,
                  color: color,
                  fontWeight: strong ? FontWeight.w900 : FontWeight.w700,
                ),
              ),
            ],
          ),
        );
      }

      Widget sectionBox({
        required String title,
        required List<Widget> children,
        Color color = const Color(0xFFF8FAFC),
        Color borderColor = const Color(0xFFE2E8F0),
        bool isExpanded = true,
        VoidCallback? onToggle,
        Widget? headerTrailing,
      }) {
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: color,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: borderColor),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              InkWell(
                onTap: onToggle,
                borderRadius: BorderRadius.circular(8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        title,
                        style: const TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 14,
                        ),
                      ),
                    ),
                    if (headerTrailing != null) ...[
                      headerTrailing,
                      const SizedBox(width: 6),
                    ],
                    Icon(
                      isExpanded
                          ? Icons.keyboard_arrow_up
                          : Icons.keyboard_arrow_down,
                      color: Colors.black54,
                    ),
                  ],
                ),
              ),
              if (isExpanded) ...[
                const SizedBox(height: 8),
                ...children,
              ],
            ],
          ),
        );
      }

      Widget orderLedgerCard(Map<String, dynamic> order) {
        final stores = (order['stores'] as List?) ?? const [];
        final orderNumber =
            (order['order_number'] ?? '#${order['order_id'] ?? '-'}').toString();
        final cashEffect = _parseDouble(order['expected_rider_cash_effect']);
        return Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: const Color(0xFFE2E8F0)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      orderNumber,
                      style: const TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  Text(
                    'Cash effect PKR ${cashEffect.toStringAsFixed(2)}',
                    style: const TextStyle(
                      color: Color(0xFF0F766E),
                      fontSize: 11.5,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                _fmtDateTime(order['created_at']),
                style: const TextStyle(
                  color: Colors.black54,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 8),
              ledgerRow(
                'Customer cash collected',
                order['customer_cash_collected'],
                color: const Color(0xFF15803D),
              ),
              ledgerRow(
                'Store payable now',
                order['rider_store_payable_now'],
                color: const Color(0xFFE65100),
              ),
              ledgerRow(
                'Store paid by rider',
                order['rider_store_paid'],
                color: const Color(0xFFB91C1C),
              ),
              if (_parseDouble(order['missing_rider_store_payment']) > 0)
                ledgerRow(
                  'Missing store payment record',
                  order['missing_rider_store_payment'],
                  color: const Color(0xFFB91C1C),
                  strong: true,
                ),
              ledgerRow(
                'Store payable later',
                order['store_payable_later'],
                color: const Color(0xFF1D4ED8),
              ),
              ledgerRow(
                'Profit/discount adjustment',
                order['company_profit_adjustment'],
                color: const Color(0xFF7C3AED),
              ),
              const SizedBox(height: 8),
              ...stores.map((rawStore) {
                final store = (rawStore as Map?)?.cast<String, dynamic>() ?? {};
                final mode = (store['settlement_mode'] ?? '').toString();
                final isCredit = mode == 'office_credit_later';
                return Container(
                  margin: const EdgeInsets.only(top: 6),
                  padding: const EdgeInsets.all(9),
                  decoration: BoxDecoration(
                    color: isCredit
                        ? const Color(0xFFEFF6FF)
                        : const Color(0xFFFFF7ED),
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              (store['store_name'] ?? 'Store').toString(),
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                          Text(
                            isCredit ? 'Credit later' : 'Paid now',
                            style: TextStyle(
                              color: isCredit
                                  ? const Color(0xFF1D4ED8)
                                  : const Color(0xFFE65100),
                              fontSize: 11,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        (store['payment_term'] ?? '-').toString(),
                        style: const TextStyle(
                          color: Colors.black54,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 4),
                      ledgerRow('Item total', store['customer_items_total']),
                      ledgerRow('Store payable', store['store_payable']),
                      if (_parseDouble(store['store_payable_now']) > 0)
                        ledgerRow(
                          'Payable now',
                          store['store_payable_now'],
                          color: const Color(0xFFE65100),
                        ),
                      ledgerRow('Rider paid now', store['rider_paid_now']),
                      if (_parseDouble(store['missing_rider_payment']) > 0)
                        ledgerRow(
                          'Missing paid record',
                          store['missing_rider_payment'],
                          color: const Color(0xFFB91C1C),
                          strong: true,
                        ),
                    ],
                  ),
                );
              }),
            ],
          ),
        );
      }

      void showNotSubmittedCashOrders() {
        showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          backgroundColor: Colors.transparent,
          builder: (ctx) {
            return SafeArea(
              child: Container(
                constraints: BoxConstraints(
                  maxHeight: MediaQuery.of(ctx).size.height * 0.78,
                ),
                decoration: const BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
                ),
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                  child: Column(
                    children: [
                      Container(
                        width: 42,
                        height: 4,
                        decoration: BoxDecoration(
                          color: Colors.grey.shade300,
                          borderRadius: BorderRadius.circular(100),
                        ),
                      ),
                      const SizedBox(height: 12),
                      Row(
                        children: [
                          const Expanded(
                            child: Text(
                              'Not Submitted Cash Orders',
                              style: TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                          Text(
                            'PKR ${unsettledCollection.toStringAsFixed(2)}',
                            style: const TextStyle(
                              color: Color(0xFFE65100),
                              fontSize: 13,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Expanded(
                        child: unsubmittedCashOrders.isEmpty
                            ? const Center(
                                child: Text('No unsubmitted cash orders found.'),
                              )
                            : ListView.separated(
                                itemCount: unsubmittedCashOrders.length,
                                separatorBuilder: (_, _) => const SizedBox(height: 8),
                                itemBuilder: (_, i) {
                                  final order = (unsubmittedCashOrders[i] as Map?)
                                          ?.cast<String, dynamic>() ??
                                      {};
                                  final orderNumber =
                                      (order['order_number'] ?? '#${order['id'] ?? '-'}')
                                          .toString();
                                  final totalAmount = _parseDouble(
                                    order['unsubmitted_amount'] ??
                                        order['remaining_amount'] ??
                                        order['total_amount'],
                                  );
                                  final deliveryFee =
                                      _parseDouble(order['delivery_fee']);
                                  return Container(
                                    padding: const EdgeInsets.all(12),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFFFF7ED),
                                      borderRadius: BorderRadius.circular(12),
                                      border: Border.all(
                                        color: const Color(0xFFFED7AA),
                                      ),
                                    ),
                                    child: Column(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        Row(
                                          children: [
                                            Expanded(
                                              child: Text(
                                                orderNumber,
                                                style: const TextStyle(
                                                  fontSize: 14,
                                                  fontWeight: FontWeight.w800,
                                                ),
                                              ),
                                            ),
                                            Text(
                                              'PKR ${totalAmount.toStringAsFixed(2)}',
                                              style: const TextStyle(
                                                color: Color(0xFFE65100),
                                                fontWeight: FontWeight.w800,
                                              ),
                                            ),
                                          ],
                                        ),
                                        const SizedBox(height: 6),
                                        Text(
                                          _fmtDateTime(order['created_at']),
                                          style: const TextStyle(
                                            color: Colors.black54,
                                            fontSize: 12,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                        const SizedBox(height: 6),
                                        Text(
                                          'Payment: ${(order['payment_method'] ?? '-').toString().toUpperCase()}  |  Status: ${(order['payment_status'] ?? '-').toString().toUpperCase()}',
                                          style: const TextStyle(
                                            color: Colors.black87,
                                            fontSize: 12,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                        const SizedBox(height: 4),
                                        Text(
                                          'Delivery Fee: PKR ${deliveryFee.toStringAsFixed(2)}',
                                          style: const TextStyle(
                                            color: Colors.black54,
                                            fontSize: 12,
                                            fontWeight: FontWeight.w600,
                                          ),
                                        ),
                                      ],
                                    ),
                                  );
                                },
                              ),
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      }

      showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        backgroundColor: Colors.transparent,
        builder: (ctx) {
          bool isClosingDay = false;
          bool isCashPositionExpanded = true;
          bool isDailySummaryExpanded = false;
          bool isOrderLedgerExpanded = false;
          bool isCashMovementExpanded = false;
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

              return SafeArea(
                child: Container(
                  constraints: BoxConstraints(
                    maxHeight: MediaQuery.of(ctx).size.height * 0.9,
                  ),
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
                    child: Column(
                      children: [
                        Container(
                          width: 42,
                          height: 4,
                          decoration: BoxDecoration(
                            color: Colors.grey.shade300,
                            borderRadius: BorderRadius.circular(100),
                          ),
                        ),
                        const SizedBox(height: 12),
                        const Text(
                          'Day Transactions',
                          style: TextStyle(fontSize: 19, fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 8),
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
                          decoration: BoxDecoration(
                            color: const Color(0xFFFFF3E0),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Row(
                            children: [
                              IconButton(
                                onPressed: () => openDayOffset(-1),
                                icon: const Icon(Icons.chevron_left),
                                color: const Color(0xFFE65100),
                                tooltip: 'Previous day',
                                visualDensity: VisualDensity.compact,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Column(
                                  children: [
                                    Text(
                                      _deliveryDateLabel(_dateOnly(fromDate)),
                                      textAlign: TextAlign.center,
                                      style: const TextStyle(
                                        color: Color(0xFFE65100),
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      _dateOnly(fromDate),
                                      textAlign: TextAlign.center,
                                      style: const TextStyle(
                                        color: Colors.black54,
                                        fontSize: 12,
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(width: 8),
                              IconButton(
                                onPressed: canGoNext ? () => openDayOffset(1) : null,
                                icon: const Icon(Icons.chevron_right),
                                color: const Color(0xFFE65100),
                                tooltip: 'Next day',
                                visualDensity: VisualDensity.compact,
                              ),
                            ],
                          ),
                        ),
                        const SizedBox(height: 8),
                        Expanded(
                          child: ListView(
                            padding: EdgeInsets.zero,
                            children: [
                              Row(
                                children: [
                                  summaryTile(
                                    label: 'Customer Cash',
                                    value: cashInCustomer,
                                    icon: Icons.payments_outlined,
                                    color: const Color(0xFF15803D),
                                  ),
                                  const SizedBox(width: 8),
                                  summaryTile(
                                    label: 'Not Submitted',
                                    value: unsettledCollection,
                                    icon: Icons.account_balance_wallet_outlined,
                                    color: const Color(0xFFE65100),
                                    onTap: showNotSubmittedCashOrders,
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  summaryTile(
                                    label: 'Expected Cash',
                                    value: expectedCashWithRider,
                                    icon: Icons.savings_outlined,
                                    color: const Color(0xFF0F766E),
                                  ),
                                  const SizedBox(width: 8),
                                  summaryTile(
                                    label: 'Store Paid Now',
                                    value: cashOutStore,
                                    icon: Icons.storefront_outlined,
                                    color: const Color(0xFF1D4ED8),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  summaryTile(
                                    label: 'Fuel Payment',
                                    value: summary['fuel_payment'],
                                    icon: Icons.local_gas_station_outlined,
                                    color: const Color(0xFFD97706),
                                  ),
                                  const SizedBox(width: 8),
                                  summaryTile(
                                    label: 'Office Advance',
                                    value: summary['office_advance'],
                                    icon: Icons.request_page_outlined,
                                    color: const Color(0xFF7C3AED),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 12),
                              sectionBox(
                                title: 'Cash Position',
                                color: const Color(0xFFF0FDFA),
                                borderColor: const Color(0xFF99F6E4),
                                isExpanded: isCashPositionExpanded,
                                onToggle: () => setModalState(
                                  () => isCashPositionExpanded =
                                      !isCashPositionExpanded,
                                ),
                                children: [
                                  ledgerRow(
                                    'Office advance',
                                    officeAdvance,
                                    color: const Color(0xFF7C3AED),
                                  ),
                                  ledgerRow(
                                    'Customer cash collected',
                                    cashInCustomer,
                                    color: const Color(0xFF15803D),
                                  ),
                                  ledgerRow(
                                    'Store paid by rider',
                                    cashOutStore,
                                    color: const Color(0xFFB91C1C),
                                  ),
                                  ledgerRow(
                                    'Store payable now',
                                    storePayableNow,
                                    color: const Color(0xFFE65100),
                                  ),
                                  if (missingStorePayment > 0)
                                    ledgerRow(
                                      'Missing store payment record',
                                      missingStorePayment,
                                      color: const Color(0xFFB91C1C),
                                      strong: true,
                                    ),
                                  ledgerRow(
                                    'Fuel / expense',
                                    fuelPayment,
                                    color: const Color(0xFFD97706),
                                  ),
                                  ledgerRow(
                                    'Submitted to office',
                                    totalSubmitted,
                                    color: const Color(0xFF475569),
                                  ),
                                  const Divider(height: 14),
                                  ledgerRow(
                                    'Expected cash with rider',
                                    expectedCashWithRider,
                                    color: const Color(0xFF0F766E),
                                    strong: true,
                                  ),
                                  const SizedBox(height: 6),
                                  ledgerRow(
                                    'Store payable later (credit)',
                                    payableLater,
                                    color: const Color(0xFF1D4ED8),
                                  ),
                                  ledgerRow(
                                    'Profit/discount adjustment',
                                    profitAdjustment,
                                    color: const Color(0xFF7C3AED),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 12),
                              Container(
                                width: double.infinity,
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: const Color(0xFFF8FAFC),
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(
                                    color: const Color(0xFFE2E8F0),
                                  ),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    InkWell(
                                      onTap: () => setModalState(
                                        () => isDailySummaryExpanded =
                                            !isDailySummaryExpanded,
                                      ),
                                      borderRadius: BorderRadius.circular(8),
                                      child: Row(
                                        children: [
                                          const Expanded(
                                            child: Text(
                                              'Daily Summary',
                                              style: TextStyle(
                                                fontWeight: FontWeight.w700,
                                                fontSize: 14,
                                              ),
                                            ),
                                          ),
                                          Text(
                                            summaryDate,
                                            style: const TextStyle(
                                              color: Colors.black54,
                                              fontWeight: FontWeight.w600,
                                              fontSize: 12,
                                            ),
                                          ),
                                          const SizedBox(width: 6),
                                          Icon(
                                            isDailySummaryExpanded
                                                ? Icons.keyboard_arrow_up
                                                : Icons.keyboard_arrow_down,
                                            color: Colors.black54,
                                          ),
                                        ],
                                      ),
                                    ),
                                    if (isDailySummaryExpanded) ...[
                                      const SizedBox(height: 8),
                                      Text(
                                        'Cash PKR ${_parseDouble(dailySummary['cash_collection']).toStringAsFixed(2)}  |  Store Paid PKR ${_parseDouble(dailySummary['store_payment']).toStringAsFixed(2)}',
                                        style: const TextStyle(
                                          fontSize: 12,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        'Fuel PKR ${_parseDouble(dailySummary['fuel_payment']).toStringAsFixed(2)}  |  Delivery Fee PKR ${_parseDouble(dailySummary['delivery_fee_earned']).toStringAsFixed(2)}',
                                        style: const TextStyle(
                                          fontSize: 12,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                      const SizedBox(height: 10),
                                      if (isDayClosed)
                                        Container(
                                          width: double.infinity,
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 10,
                                            vertical: 8,
                                          ),
                                          decoration: BoxDecoration(
                                            color: const Color(0xFFDCFCE7),
                                            borderRadius: BorderRadius.circular(8),
                                          ),
                                          child: Text(
                                            'Day closed at ${_fmtDateTime(dayClosing?['closed_at'])}',
                                            style: const TextStyle(
                                              color: Color(0xFF166534),
                                              fontWeight: FontWeight.w700,
                                              fontSize: 12,
                                            ),
                                          ),
                                        )
                                      else
                                        SizedBox(
                                          width: double.infinity,
                                          child: FilledButton.icon(
                                          onPressed: isClosingDay
                                              ? null
                                              : () async {
                                                  setModalState(
                                                    () => isClosingDay = true,
                                                  );
                                                  try {
                                                    final closeData =
                                                        await ApiService
                                                            .closeRiderDay(
                                                      token,
                                                      date: summaryDate,
                                                    );
                                                    dayClosing =
                                                        (closeData['day_closing']
                                                                as Map<String,
                                                                    dynamic>?)
                                                            ?.cast<String,
                                                                dynamic>();
                                                    if (mounted) {
                                                      ScaffoldMessenger.of(context)
                                                          .showSnackBar(
                                                        const SnackBar(
                                                          content: Text(
                                                            'Day closed successfully',
                                                          ),
                                                        ),
                                                      );
                                                    }
                                                  } catch (e) {
                                                    if (mounted) {
                                                      ScaffoldMessenger.of(context)
                                                          .showSnackBar(
                                                        SnackBar(
                                                          content: Text(
                                                            'Failed to close day: $e',
                                                          ),
                                                        ),
                                                      );
                                                    }
                                                  } finally {
                                                    setModalState(
                                                      () => isClosingDay = false,
                                                    );
                                                  }
                                                },
                                          icon: isClosingDay
                                              ? const SizedBox(
                                                  width: 14,
                                                  height: 14,
                                                  child:
                                                      CircularProgressIndicator(
                                                    strokeWidth: 2,
                                                  ),
                                                )
                                              : const Icon(Icons.task_alt_outlined),
                                          label: Text(
                                            isClosingDay
                                                ? 'Closing...'
                                                : 'Close Day',
                                          ),
                                          style: FilledButton.styleFrom(
                                            backgroundColor:
                                                const Color(0xFFE65100),
                                            foregroundColor: Colors.white,
                                          ),
                                        ),
                                      ),
                                  ],
                                  ],
                                ),
                              ),
                              const SizedBox(height: 12),
                              if (orderLedger.isNotEmpty) ...[
                                sectionBox(
                                  title: 'Order-wise Ledger',
                                  isExpanded: isOrderLedgerExpanded,
                                  onToggle: () => setModalState(
                                    () => isOrderLedgerExpanded =
                                        !isOrderLedgerExpanded,
                                  ),
                                  children: [
                                    for (final rawOrder in orderLedger) ...[
                                      orderLedgerCard(
                                        (rawOrder as Map?)?.cast<String, dynamic>() ?? {},
                                      ),
                                      const SizedBox(height: 8),
                                    ],
                                  ],
                                ),
                                const SizedBox(height: 12),
                              ],
                              sectionBox(
                                title: 'Cash Movement Log',
                                isExpanded: isCashMovementExpanded,
                                onToggle: () => setModalState(
                                  () => isCashMovementExpanded =
                                      !isCashMovementExpanded,
                                ),
                                children: movements.isEmpty
                                    ? [
                                        const Padding(
                                          padding: EdgeInsets.symmetric(vertical: 16),
                                          child: Center(
                                            child: Text('No financial movements found'),
                                          ),
                                        ),
                                      ]
                                    : [
                                        for (final rawMovement in movements) ...[
                                          Builder(
                                            builder: (_) {
                                              final m = (rawMovement as Map?)
                                                      ?.cast<String, dynamic>() ??
                                                  {};
                                              final type =
                                                  (m['movement_type'] ?? '-').toString();
                                              final clr = movementColor(type);
                                              final amount = _parseDouble(m['amount'])
                                                  .toStringAsFixed(2);
                                              final status =
                                                  (m['status'] ?? '-').toString();
                                              return Container(
                                                padding: const EdgeInsets.all(12),
                                                decoration: BoxDecoration(
                                                  color: Colors.white,
                                                  borderRadius:
                                                      BorderRadius.circular(12),
                                                  border: Border.all(
                                                    color: Colors.grey.shade200,
                                                  ),
                                                ),
                                                child: Column(
                                                  crossAxisAlignment:
                                                      CrossAxisAlignment.start,
                                                  children: [
                                                    Row(
                                                      children: [
                                                        Expanded(
                                                          child: Text(
                                                            type
                                                                .replaceAll('_', ' ')
                                                                .toUpperCase(),
                                                            style: const TextStyle(
                                                              fontWeight:
                                                                  FontWeight.w700,
                                                              fontSize: 13,
                                                            ),
                                                          ),
                                                        ),
                                                        Container(
                                                          padding:
                                                              const EdgeInsets.symmetric(
                                                            horizontal: 8,
                                                            vertical: 4,
                                                          ),
                                                          decoration: BoxDecoration(
                                                            color: clr.withValues(
                                                              alpha: 0.12,
                                                            ),
                                                            borderRadius:
                                                                BorderRadius.circular(8),
                                                          ),
                                                          child: Text(
                                                            'PKR $amount',
                                                            style: TextStyle(
                                                              color: clr,
                                                              fontWeight:
                                                                  FontWeight.w700,
                                                              fontSize: 11,
                                                            ),
                                                          ),
                                                        ),
                                                      ],
                                                    ),
                                                    const SizedBox(height: 6),
                                                    Text(
                                                      _fmtDateTime(
                                                        m['movement_at'] ??
                                                            m['created_at'] ??
                                                            m['movement_date'],
                                                      ),
                                                      style: const TextStyle(
                                                        color: Colors.black54,
                                                        fontSize: 12,
                                                      ),
                                                    ),
                                                    if ((m['description'] ?? '')
                                                        .toString()
                                                        .trim()
                                                        .isNotEmpty) ...[
                                                      const SizedBox(height: 4),
                                                      Text(
                                                        (m['description'] ?? '')
                                                            .toString(),
                                                        style: const TextStyle(
                                                          color: Colors.black87,
                                                          fontSize: 12,
                                                          fontWeight: FontWeight.w500,
                                                        ),
                                                      ),
                                                    ],
                                                    const SizedBox(height: 6),
                                                    Text(
                                                      'Status: ${status.toUpperCase()}',
                                                      style: const TextStyle(
                                                        color: Colors.black45,
                                                        fontSize: 11,
                                                        fontWeight: FontWeight.w600,
                                                      ),
                                                    ),
                                                  ],
                                                ),
                                              );
                                            },
                                          ),
                                          const SizedBox(height: 8),
                                        ],
                                      ],
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              );
            },
          );
        },
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to load financial history: $e')),
      );
    }
  }

  Future<void> _refreshLocation() async {
    setState(() => _currentLocation = 'Updating...');
    await _getCurrentLocation();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Location updated successfully!')),
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

    _locationStreamSubscription = Geolocator.getPositionStream(
      locationSettings: locationSettings,
    ).listen((position) async {
      await _updateCurrentLocationFromPosition(position);
      if (_assignedDeliveries.isNotEmpty) {
        await RiderBackgroundTrackingService.instance.syncPosition(position);
      }
    });
  }

  Future<void> _markAsDelivered(int orderId) async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;

      await ApiService.markOrderAsDelivered(token, orderId);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Order marked as delivered!')),
        );
        _loadAllData(); // Refresh list
      }
    } catch (e) {
      _logger.e('Error marking delivered: $e');
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Failed to update status: $e')));
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
          const SnackBar(
            content: Text('Payment marked as received! Wallet updated.'),
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
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Failed to update payment: $e')));
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

  @override
  Widget build(BuildContext context) {
    return Directionality(
      textDirection: CustomerLanguage.textDirection(_isUrdu),
      child: Scaffold(
        drawer: _buildRiderDrawer(),
        appBar: AppBar(
          title: Text(_tr('Rider Dashboard')),
          actions: [
            const NotificationBellWidget(),
          ],
        ),
        bottomNavigationBar: _buildBottomNavigationBar(),
        body: RefreshIndicator(
          onRefresh: _loadAllData,
          child: _isLoading
              ? const Center(child: CircularProgressIndicator())
              : Column(
                  children: [
                    // Rider Info Section
                    _buildRiderInfoCard(),

                    // Tab Content
                    Expanded(
                      child: TabBarView(
                        controller: _tabController,
                        physics: const NeverScrollableScrollPhysics(),
                        children: [
                          _buildDeliveriesList(_assignedDeliveries, true),
                          _buildDeliveriesList(_completedDeliveries, false),
                          _buildWalletTab(),
                          _buildProfileTab(),
                        ],
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }

  Widget _buildRiderInfoCard() {
    final name = _riderProfile == null
        ? _tr('Rider')
        : '${_riderProfile?['first_name'] ?? ''} ${_riderProfile?['last_name'] ?? ''}'
              .trim()
              .isEmpty
        ? (_riderProfile?['first_name'] ?? _tr('Rider'))
        : '${_riderProfile?['first_name'] ?? ''} ${_riderProfile?['last_name'] ?? ''}'
              .trim();
    final vehicle = _riderProfile?['vehicle_type'] ?? 'N/A';
    final riderId = (_riderProfile?['id'] ?? '-').toString();

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 10),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(16),
        gradient: LinearGradient(
          colors: [Color(0xFFE65100), Color(0xFFBF360C)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.15),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _tr('Welcome Rider'),
            style: TextStyle(
              color: Colors.white70,
              fontSize: 14,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 24,
              fontWeight: FontWeight.bold,
            ),
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              const Icon(Icons.badge, color: Colors.white70, size: 16),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  '${_tr('ID')}: $riderId  |  ${_tr('Vehicle')}: $vehicle',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _buildRiderMiniStat(
                label: _tr('Assigned'),
                value: _assignedDeliveries.length.toString(),
              ),
              const SizedBox(width: 8),
              _buildRiderMiniStat(
                label: _tr('Completed'),
                value: _completedDeliveries.length.toString(),
              ),
              const SizedBox(width: 8),
              _buildRiderMiniStat(
                label: _tr('Wallet'),
                value: 'PKR ${_walletBalance.toStringAsFixed(0)}',
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildRiderDrawer() {
    final name = _riderProfile == null
        ? _tr('Rider')
        : '${_riderProfile?['first_name'] ?? ''} ${_riderProfile?['last_name'] ?? ''}'
              .trim()
              .isEmpty
        ? (_riderProfile?['first_name'] ?? _tr('Rider'))
        : '${_riderProfile?['first_name'] ?? ''} ${_riderProfile?['last_name'] ?? ''}'
              .trim();
    final email = (_riderProfile?['email'] ?? '').toString();
    return Drawer(
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          UserAccountsDrawerHeader(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [Color(0xFFE65100), Color(0xFFBF360C)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
            ),
            accountName: Text(name),
            accountEmail: Text(email),
            currentAccountPicture: CircleAvatar(
              backgroundColor: Colors.white,
              child: Text(
                name.isNotEmpty ? name.substring(0, 1).toUpperCase() : 'R',
                style: const TextStyle(
                  color: Colors.indigo,
                  fontSize: 24,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ),
          ),
          ListTile(
            leading: const Icon(Icons.home_outlined),
            title: Text(_tr('Home')),
            onTap: () {
              Navigator.of(context).pop();
              _switchToTab(0);
            },
          ),
          ListTile(
            leading: const Icon(Icons.history),
            title: Text(_tr('History')),
            onTap: () {
              Navigator.of(context).pop();
              _switchToTab(1);
            },
          ),
          ListTile(
            leading: const Icon(Icons.account_balance_wallet_outlined),
            title: Text(_tr('Wallet')),
            onTap: () {
              Navigator.of(context).pop();
              _switchToTab(2);
            },
          ),
          ListTile(
            leading: const Icon(Icons.person_outline),
            title: Text(_tr('Profile')),
            onTap: () {
              Navigator.of(context).pop();
              _switchToTab(3);
            },
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.refresh),
            title: Text(_tr('Refresh')),
            onTap: () {
              Navigator.of(context).pop();
              _loadAllData();
            },
          ),
          ListTile(
            leading: const Icon(Icons.key),
            title: Text(_tr('Change Password')),
            onTap: () {
              Navigator.of(context).pop();
              Navigator.of(context).pushNamed('/change-password');
            },
          ),
          ListTile(
            leading: const Icon(Icons.logout, color: Colors.red),
            title: Text(_tr('Logout'), style: const TextStyle(color: Colors.red)),
            onTap: () {
              Navigator.of(context).pop();
              _logout();
            },
          ),
        ],
      ),
    );
  }

  Widget _buildBottomNavigationBar() {
    return SafeArea(
      top: false,
      child: Container(
        margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(16),
          boxShadow: [
            BoxShadow(
              color: Colors.black.withValues(alpha: 0.08),
              blurRadius: 12,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: [
            _buildBottomNavItem(0, Icons.home_filled, _tr('Home')),
            _buildBottomNavItem(1, Icons.history, _tr('History')),
            _buildBottomNavItem(2, Icons.account_balance_wallet, _tr('Wallet')),
            _buildBottomNavItem(3, Icons.person, _tr('Profile')),
          ],
        ),
      ),
    );
  }

  Widget _buildBottomNavItem(int index, IconData icon, String label) {
    final active = _selectedTabIndex == index;
    return InkWell(
      onTap: () => _switchToTab(index),
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 22,
              color: active ? Color(0xFFE65100) : Colors.grey.shade600,
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: active ? Color(0xFFE65100) : Colors.grey.shade600,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRiderMiniStat({required String label, required String value}) {
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 7),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.18),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: Colors.white.withValues(alpha: 0.3)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              value,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.bold,
                fontSize: 12,
              ),
            ),
            const SizedBox(height: 1),
            Text(
              label,
              style: const TextStyle(color: Colors.white70, fontSize: 10),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDeliveriesList(List<dynamic> deliveries, bool isAssigned) {
    if (deliveries.isEmpty) {
      return const Center(child: Text('No deliveries found.'));
    }

    final sortedDeliveries = deliveries
        .whereType<Map>()
        .map((delivery) => delivery.cast<String, dynamic>())
        .toList()
      ..sort((a, b) {
        final dateCompare = _deliverySortDate(b).compareTo(_deliverySortDate(a));
        if (dateCompare != 0) return dateCompare;
        final aId = int.tryParse((a['id'] ?? '').toString()) ?? 0;
        final bId = int.tryParse((b['id'] ?? '').toString()) ?? 0;
        return bId.compareTo(aId);
      });

    final deliveriesByDate = <String, List<Map<String, dynamic>>>{};
    for (final delivery in sortedDeliveries) {
      deliveriesByDate
          .putIfAbsent(_deliveryDateKey(delivery), () => <Map<String, dynamic>>[])
          .add(delivery);
    }

    final dateKeys = deliveriesByDate.keys.toList()
      ..sort((a, b) => b.compareTo(a));
    int totalItems = dateKeys.length;
    for (final dateKey in dateKeys) {
      totalItems += deliveriesByDate[dateKey]!.length;
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: totalItems,
      itemBuilder: (context, index) {
        int currentIndex = 0;

        for (int i = 0; i < dateKeys.length; i++) {
          final dateKey = dateKeys[i];
          final dateDeliveries = deliveriesByDate[dateKey]!;

          if (currentIndex == index) {
            return Padding(
              padding: const EdgeInsets.only(top: 12, bottom: 8),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    _deliveryDateLabel(dateKey),
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                      color: Color(0xFFFF7043),
                    ),
                  ),
                  Text(
                    '${dateDeliveries.length} order${dateDeliveries.length == 1 ? '' : 's'}',
                    style: TextStyle(
                      color: Colors.grey.shade600,
                      fontWeight: FontWeight.w600,
                      fontSize: 12,
                    ),
                  ),
                ],
              ),
            );
          }
          currentIndex++;

          for (int j = 0; j < dateDeliveries.length; j++) {
            if (currentIndex == index) {
              return _buildDeliveryCard(dateDeliveries[j], isAssigned);
            }
            currentIndex++;
          }
        }

        return const SizedBox.shrink();
      },
    );
  }

  Widget _buildDeliveryCard(Map<String, dynamic> delivery, bool isAssigned) {
    final status = delivery['status'] ?? 'unknown';
    final paymentStatus = delivery['payment_status'] ?? 'pending';
    final customerPhone = (delivery['phone'] ?? '').toString();
    final instructions =
        (delivery['special_instructions'] ?? '').toString().trim();
    final preferredTime = (delivery['delivery_time'] ?? '').toString().trim();
    final hasNotice = instructions.isNotEmpty || preferredTime.isNotEmpty;
    final statusColor = _getStatusColor(status);
    final shouldBlink = hasNotice &&
        status.toString().toLowerCase() != 'delivered' &&
        status.toString().toLowerCase() != 'cancelled';

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Order #${delivery['order_number']}',
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      if (shouldBlink)
                        Padding(
                          padding: const EdgeInsets.only(top: 4),
                          child: Row(
                            children: [
                              FadeTransition(
                                opacity: _blinkAnimation,
                                child: Icon(
                                  Icons.circle,
                                  size: 10,
                                  color: statusColor,
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                'Special Instructions',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w700,
                                  color: statusColor,
                                ),
                              ),
                            ],
                          ),
                        ),
                      const SizedBox(height: 4),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 4,
                        ),
                        decoration: BoxDecoration(
                          color: statusColor.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: statusColor),
                        ),
                        child: Text(
                          status.toUpperCase(),
                          style: TextStyle(
                            color: statusColor,
                            fontWeight: FontWeight.bold,
                            fontSize: 12,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const Divider(),

            // Details
            _buildDetailRow(
              'Customer',
              '${delivery['first_name']} ${delivery['last_name']}',
            ),
            _buildDetailRow(
              'Store',
              '${delivery['store_name'] ?? 'Unknown Store'}',
            ),
            _buildDetailRow('Order Time', _fmtDateTime(delivery['created_at'])),

            // Simplified Summary Card
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Color(0xFFFFF3E0).withValues(alpha: 0.5),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Color(0xFFFFE0B2)),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'Grand Total',
                        style: TextStyle(fontSize: 12, color: Colors.brown),
                      ),
                      Text(
                        'PKR ${delivery['total_amount']}',
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: Color(0xFFE65100),
                        ),
                      ),
                    ],
                  ),
                  ElevatedButton.icon(
                    onPressed: () => _showOrderInfo(delivery),
                    icon: const Icon(Icons.receipt_long, size: 16),
                    label: const Text('Summary'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Color(0xFFE65100),
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
                      minimumSize: Size.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            _buildDetailRow('Address', '${delivery['delivery_address']}'),
            _buildDetailRow('Phone', '${delivery['phone'] ?? 'N/A'}'),
            if (preferredTime.isNotEmpty)
              _buildDetailRow(
                'Preferred',
                preferredTime,
                valueColor: const Color(0xFF2563EB),
              ),
            if (instructions.isNotEmpty)
              _buildDetailRow(
                'Notes',
                instructions,
                valueColor: const Color(0xFFE65100),
              ),
            if (customerPhone.isNotEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8.0),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceAround,
                  children: [
                    _contactAction(
                      icon: Icons.phone,
                      color: Color(0xFFE65100),
                      label: 'Call',
                      onTap: () => _makeCall(customerPhone),
                    ),
                    _contactAction(
                      icon: Icons.message,
                      color: Colors.orange,
                      label: 'SMS',
                      onTap: () => _sendSms(customerPhone),
                    ),
                    _contactAction(
                      icon: Icons.chat,
                      color: Colors.green,
                      label: 'WhatsApp',
                      onTap: () => _openWhatsApp(customerPhone),
                    ),
                  ],
                ),
              ),
            _buildDetailRow(
              'Payment',
              paymentStatus,
              valueColor: paymentStatus == 'paid'
                  ? Colors.green
                  : Colors.orange,
            ),

            if (delivery['rider_location'] != null)
              _buildDetailRow('My Location', '${delivery['rider_location']}'),

            // Actions
            if (isAssigned && status == 'out_for_delivery') ...[
              Row(
                children: [
                  if (paymentStatus != 'paid')
                    Expanded(
                      child: ElevatedButton(
                        onPressed: () => _markPaymentReceived(delivery['id']),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Color(0xFFE65100),
                          foregroundColor: Colors.white,
                        ),
                        child: const Text('Payment Recvd'),
                      ),
                    ),
                  if (paymentStatus != 'paid') const SizedBox(width: 8),
                  Expanded(
                    child: ElevatedButton(
                      onPressed: paymentStatus == 'paid'
                          ? () => _markAsDelivered(delivery['id'])
                          : null,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.green,
                        foregroundColor: Colors.white,
                      ),
                      child: const Text('Mark Delivered'),
                    ),
                  ),
                ],
              ),
              if (paymentStatus != 'paid')
                const Padding(
                  padding: EdgeInsets.only(top: 8),
                  child: Text(
                    'Mark payment received first to enable delivery.',
                    style: TextStyle(
                      fontSize: 12,
                      color: Colors.orange,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildDetailRow(String label, String value, {Color? valueColor}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 80,
            child: Text(
              '$label:',
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                color: Colors.grey,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                color: valueColor ?? Colors.black87,
                fontWeight: valueColor != null
                    ? FontWeight.bold
                    : FontWeight.normal,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Color _getStatusColor(String status) {
    switch (status.toLowerCase()) {
      case 'delivered':
        return Colors.green;
      case 'cancelled':
        return Colors.red;
      case 'out_for_delivery':
        return Color(0xFFE65100);
      case 'preparing':
        return Colors.orange;
      case 'pending':
        return Colors.amber;
      default:
        return Colors.grey;
    }
  }

  Widget _contactAction({
    required IconData icon,
    required Color color,
    required String label,
    required VoidCallback onTap,
  }) {
    return SizedBox(
      height: 36,
      child: OutlinedButton.icon(
        onPressed: onTap,
        style: OutlinedButton.styleFrom(
          foregroundColor: color,
          side: BorderSide(color: color.withValues(alpha: 0.6)),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(20),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 10),
        ),
        icon: Icon(icon, size: 18),
        label: Text(
          label,
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
        ),
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

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) {
        return SingleChildScrollView(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
            child: SafeArea(
              top: false,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.receipt_long, color: Colors.brown),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          'Order #${delivery['order_number']}',
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close),
                        onPressed: () => Navigator.of(ctx).pop(),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  _buildDetailRow('Status', '${delivery['status']}'),
                  _buildDetailRow(
                    'Payment',
                    '${delivery['payment_status'] ?? 'unknown'}',
                  ),
                  const SizedBox(height: 12),
                  const Divider(),
                  const Text(
                    'Customer Details',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                      color: Colors.brown,
                    ),
                  ),
                  const SizedBox(height: 8),
                  _buildDetailRow(
                    'Name',
                    '${delivery['first_name'] ?? ''} ${delivery['last_name'] ?? ''}',
                  ),
                  _buildDetailRow('Phone', '${delivery['phone'] ?? 'N/A'}'),
                  _buildDetailRow(
                    'Delivery Address',
                    '${delivery['delivery_address'] ?? 'N/A'}',
                  ),
                  const SizedBox(height: 12),
                  const Divider(),
                  const Text(
                    'Items by Store',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                      color: Colors.brown,
                    ),
                  ),
                  const SizedBox(height: 8),
                  ...itemsByStore.entries.map((entry) {
                    final storeName = entry.key;
                    final storeItems = entry.value;
                    double storeSubtotal = 0;
                    for (var item in storeItems) {
                      final price =
                          double.tryParse(item['price']?.toString() ?? '0') ??
                          0;
                      final quantity =
                          int.tryParse(item['quantity']?.toString() ?? '1') ??
                          1;
                      storeSubtotal += price * quantity;
                    }

                    return Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.symmetric(
                            horizontal: 10,
                            vertical: 8,
                          ),
                          decoration: BoxDecoration(
                            color: Color(0xFFE65100).withAlpha((0.15 * 255).round()),
                            borderRadius: BorderRadius.circular(4),
                            border: Border(
                              left: BorderSide(
                                color: Color(0xFFE65100),
                                width: 3,
                              ),
                            ),
                          ),
                          child: Text(
                            storeName,
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 14,
                              color: Color(0xFFE65100),
                            ),
                          ),
                        ),
                        const SizedBox(height: 8),
                        ...storeItems.map(
                          (item) => Padding(
                            padding: const EdgeInsets.only(bottom: 4, left: 8),
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Expanded(
                                  child: Text(
                                    '${item['quantity']}x ${item['product_name'] ?? 'Product'}${item['variant_label'] != null ? ' (${item['variant_label']})' : ''}',
                                    style: const TextStyle(fontSize: 13),
                                  ),
                                ),
                                Text(
                                  'PKR ${(double.tryParse(item['price']?.toString() ?? '0') ?? 0) * (int.tryParse(item['quantity']?.toString() ?? '1') ?? 1)}',
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.only(
                            top: 4,
                            bottom: 12,
                            left: 8,
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(
                                child: Text(
                                  'Subtotal ($storeName):',
                                  style: const TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Text(
                                'PKR ${storeSubtotal.toStringAsFixed(2)}',
                                style: const TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    );
                  }),
                  const SizedBox(height: 12),
                  const Divider(),
                  const Text(
                    'Pricing Breakdown',
                    style: TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 14,
                      color: Colors.brown,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Builder(
                    builder: (ctx) {
                      double itemsSubtotal = 0;
                      final storeIds = <int>{};
                      final allItems = (delivery['items'] as List?) ?? [];

                      for (var item in allItems) {
                        itemsSubtotal +=
                            (double.tryParse(
                                  item['price']?.toString() ?? '0',
                                ) ??
                                0) *
                            (int.tryParse(
                                  item['quantity']?.toString() ?? '1',
                                ) ??
                                1);
                        final storeId = item['store_id'] as int?;
                        if (storeId != null) storeIds.add(storeId);
                      }

                      final deliveryFee =
                          double.tryParse(
                            delivery['delivery_fee']?.toString() ?? '0',
                          ) ??
                          0;
                      final grandTotal = itemsSubtotal + deliveryFee;
                      final numStores = storeIds.isNotEmpty
                          ? storeIds.length
                          : 1;

                      return Column(
                        children: [
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const Text(
                                'Items Subtotal:',
                                style: TextStyle(fontSize: 13),
                              ),
                              Flexible(
                                child: Text(
                                  'PKR ${itemsSubtotal.toStringAsFixed(2)}',
                                  style: const TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w500,
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                'Delivery Fee ($numStores store${numStores > 1 ? 's' : ''}):',
                                style: const TextStyle(fontSize: 13),
                              ),
                              Flexible(
                                child: Text(
                                  'PKR ${deliveryFee.toStringAsFixed(2)}',
                                  style: const TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w500,
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 8),
                          Divider(color: Colors.grey[400]),
                          const SizedBox(height: 4),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.spaceBetween,
                            children: [
                              const Text(
                                'Grand Total:',
                                style: TextStyle(
                                  fontSize: 14,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              Flexible(
                                child: Text(
                                  'PKR ${grandTotal.toStringAsFixed(2)}',
                                  style: const TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.bold,
                                    color: Color(0xFFE65100),
                                  ),
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            ],
                          ),
                        ],
                      );
                    },
                  ),
                  const SizedBox(height: 8),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildWalletTab() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Card(
            elevation: 4,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(16),
            ),
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(16),
                gradient: LinearGradient(
                  colors: [Colors.green.shade600, Colors.teal.shade600],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
              ),
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'Wallet Balance',
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w600,
                          color: Colors.white70,
                        ),
                      ),
                      Row(
                        children: [
                          Icon(
                            Icons.account_balance_wallet,
                            color: Colors.white.withValues(alpha: 0.8),
                            size: 28,
                          ),
                          const SizedBox(width: 8),
                          IconButton(
                            icon: const Icon(
                              Icons.refresh,
                              color: Colors.white,
                            ),
                            onPressed: () async {
                              final token = Provider.of<AuthProvider>(
                                context,
                                listen: false,
                              ).token;
                              if (token != null) {
                                await _loadWalletBalance(token);
                                if (mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    const SnackBar(
                                      content: Text('Wallet updated'),
                                    ),
                                  );
                                }
                              }
                            },
                            iconSize: 20,
                          ),
                        ],
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'PKR ${_walletBalance.toStringAsFixed(2)}',
                    style: const TextStyle(
                      fontSize: 36,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 6,
                    ),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.info_outline,
                          color: Colors.white,
                          size: 16,
                        ),
                        const SizedBox(width: 6),
                        const Text(
                          'Tap refresh to update balance',
                          style: TextStyle(color: Colors.white, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          const Text(
            'Financial Statistics',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 12),
          _buildPeriodSelector(),
          const SizedBox(height: 16),
          if (_isLoadingStats)
            const Center(child: CircularProgressIndicator())
          else if (_walletStats != null)
            _buildStatsCards()
          else
            Card(
              color: Colors.grey.shade50,
              child: const Padding(
                padding: EdgeInsets.all(16),
                child: Center(child: Text('No stats available')),
              ),
            ),
          const SizedBox(height: 24),
          _walletBalance == 0
              ? Card(
                  color: Color(0xFFFFF3E0),
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(
                      children: [
                        Icon(Icons.info, color: Color(0xFFEF6C00)),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'No earnings yet',
                                style: TextStyle(fontWeight: FontWeight.bold),
                              ),
                              const SizedBox(height: 4),
                              const Text(
                                'Complete deliveries and mark payments as received to earn',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: Colors.grey,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                )
              : const SizedBox.shrink(),
          const SizedBox(height: 24),
          const Text(
            'Wallet Information',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildWalletInfoRow('Account Type', 'Rider Wallet'),
                  const Divider(),
                  _buildWalletInfoRow('Status', 'Active'),
                  const Divider(),
                  _buildWalletInfoRow(
                    'Balance',
                    'PKR ${_walletBalance.toStringAsFixed(2)}',
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 24),
          const Text(
            'How it works',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildHowItWorksItem(
                    '1',
                    'Complete Deliveries',
                    'Accept and complete delivery orders',
                  ),
                  const SizedBox(height: 12),
                  _buildHowItWorksItem(
                    '2',
                    'Mark Payment Received',
                    'Confirm when customer pays you',
                  ),
                  const SizedBox(height: 12),
                  _buildHowItWorksItem(
                    '3',
                    'Wallet Updated',
                    'Amount instantly credited to your wallet',
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
        ],
      ),
    );
  }

  Widget _buildWalletInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: const TextStyle(
              color: Colors.grey,
              fontWeight: FontWeight.w500,
            ),
          ),
          Text(value, style: const TextStyle(fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildHowItWorksItem(String number, String title, String description) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(
            color: Color(0xFFFFE0B2),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Center(
            child: Text(
              number,
              style: TextStyle(
                color: Color(0xFFEF6C00),
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(height: 4),
              Text(
                description,
                style: const TextStyle(fontSize: 12, color: Colors.grey),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildPeriodSelector() {
    return Row(
      children: [
        Expanded(
          child: SegmentedButton<String>(
            segments: const <ButtonSegment<String>>[
              ButtonSegment<String>(value: 'daily', label: Text('Daily')),
              ButtonSegment<String>(value: 'weekly', label: Text('Weekly')),
              ButtonSegment<String>(value: 'monthly', label: Text('Monthly')),
            ],
            selected: <String>{_selectedStatsPeriod},
            onSelectionChanged: (Set<String> newSelection) async {
              final token = Provider.of<AuthProvider>(
                context,
                listen: false,
              ).token;
              if (token != null) {
                await _loadWalletStats(token, newSelection.first);
              }
            },
          ),
        ),
      ],
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
        Row(
          children: [
            Expanded(
              child: _buildStatCard(
                title: 'Cash Received (Net)',
                value: 'PKR ${netCashReceived.toStringAsFixed(2)}',
                icon: Icons.payments_outlined,
                backgroundColor: Colors.green.shade50,
                iconColor: Colors.green,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: _buildStatCard(
                title: 'Delivery Fees',
                value: 'PKR ${deliveryFees.toStringAsFixed(2)}',
                icon: Icons.local_shipping,
                backgroundColor: Color(0xFFFFF3E0),
                iconColor: Color(0xFFE65100),
              ),
            ),
          ],
        ),
        const SizedBox(height: 16),
        if (paymentSummary.isNotEmpty)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Payment Summary',
                    style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 12),
                  ...paymentSummary.map((summary) {
                    final method = summary['payment_method'] ?? 'Unknown';
                    final count = summary['order_count'] ?? 0;
                    final amount = _parseDouble(summary['total_amount']);
                    return Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                method.replaceFirst(
                                  method[0],
                                  method[0].toUpperCase(),
                                ),
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              Text(
                                '$count order${count != 1 ? 's' : ''}',
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: Colors.grey,
                                ),
                              ),
                            ],
                          ),
                          Text(
                            'PKR ${amount.toStringAsFixed(2)}',
                            style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 14,
                            ),
                          ),
                        ],
                      ),
                    );
                  }),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildStatCard({
    required String title,
    required String value,
    required IconData icon,
    required Color backgroundColor,
    required Color iconColor,
  }) {
    return Card(
      color: backgroundColor,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 12,
                    color: Colors.grey,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                Icon(icon, color: iconColor, size: 20),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              value,
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
                color: iconColor,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildProfileTab() {
    final r = _riderProfile;
    final photoUrl = (r?['image_url'] as String?) ?? '';
    final idCardUrl = (r?['id_card_url'] as String?) ?? '';

    // Image tile without label (clean top row)
    Widget imageTile(String? url) {
      final resolved = (url == null || url.isEmpty)
          ? null
          : ApiService.getImageUrl(url);
      return ClipRRect(
        borderRadius: BorderRadius.circular(12),
        child: Container(
          height: 162,
          color: Colors.grey[200],
          child: resolved == null
              ? _imagePlaceholder()
              : Image.network(
                  resolved,
                  fit: BoxFit.fill,
                  errorBuilder: (ctx, err, stack) => _imagePlaceholder(),
                ),
        ),
      );
    }

    // Two-column detail row (label left, value right)
    Widget detail2Col(String label, String value, {Color? valueColor}) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: [
            Expanded(
              child: Text(
                label,
                style: const TextStyle(
                  fontWeight: FontWeight.bold,
                  color: Colors.grey,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                value,
                textAlign: TextAlign.right,
                style: TextStyle(
                  color: valueColor ?? Colors.black87,
                  fontWeight: valueColor != null
                      ? FontWeight.bold
                      : FontWeight.normal,
                ),
              ),
            ),
          ],
        ),
      );
    }

    final fullName = '${r?['first_name'] ?? ''} ${r?['last_name'] ?? ''}'
        .trim();

    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Card(
        elevation: 2,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Images row at top: user image (left), ID card (right)
              Row(
                children: [
                  Expanded(flex: 4, child: imageTile(photoUrl)),
                  const SizedBox(width: 12),
                  Expanded(flex: 6, child: imageTile(idCardUrl)),
                ],
              ),
              const SizedBox(height: 16),
              // Details with label left, value right
              detail2Col('Name', fullName.isEmpty ? 'N/A' : fullName),
              detail2Col('Email', '${r?['email'] ?? 'N/A'}'),
              detail2Col('Phone', '${r?['phone'] ?? 'N/A'}'),
              detail2Col('Vehicle', '${r?['vehicle_type'] ?? 'N/A'}'),
              const SizedBox(height: 8),
              Row(
                children: [
                  const Icon(Icons.location_on, color: Color(0xFFE65100), size: 20),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      _currentLocation,
                      style: const TextStyle(fontWeight: FontWeight.w500),
                    ),
                  ),
                  TextButton(
                    onPressed: _refreshLocation,
                    child: const Text('Refresh'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _imagePlaceholder() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: const [
          Icon(Icons.image_not_supported, color: Colors.grey, size: 36),
          SizedBox(height: 6),
          Text('No image', style: TextStyle(color: Colors.grey)),
        ],
      ),
    );
  }
}



