import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/material.dart';
import 'package:in_app_review/in_app_review.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../providers/auth_provider.dart';
import '../providers/notification_provider.dart';
import 'order_details_screen.dart';
import '../services/api_service.dart';
import '../utils/customer_language.dart';
import '../widgets/customer_bottom_nav.dart';
import '../widgets/notification_bell_widget.dart';
import '../widgets/ui/ui.dart';

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  static const String _reviewFlagKey = 'in_app_review_requested_v1';

  bool _isLoading = true;
  List<dynamic> _orders = [];
  String? _error;
  bool _isGuestView = false;
  String _statusFilter = 'all';
  bool _isUrdu = false;

  @override
  void initState() {
    super.initState();
    _loadLanguagePreference();
    _fetchOrders();
    _setupNotifications();
  }

  Future<void> _loadLanguagePreference() async {
    final isUrdu = await CustomerLanguage.loadIsUrdu();
    if (!mounted) return;
    setState(() => _isUrdu = isUrdu);
  }

  String _tr(String text) => CustomerLanguage.tr(_isUrdu, text);

  void _setupNotifications() {
    Provider.of<NotificationProvider>(context, listen: false).addEventListener(
      this,
      (data) {
        _handleNotification(data);
      },
    );
  }

  void _handleNotification(Map<String, dynamic> notification) {
    if (!mounted) return;

    final type = (notification['type'] ?? '').toString().toLowerCase();
    final message = (notification['message'] ?? _tr('Order update')).toString();
    if (type == 'order_update' ||
        type == 'refresh_orders' ||
        type == 'payment_status_update' ||
        type == 'order_completed') {
      ScaffoldMessenger.of(context)
        ..clearSnackBars()
        ..showSnackBar(
          SnackBar(
            content: Text(message),
            backgroundColor: type == 'payment_status_update'
                ? AppColors.primaryPressed
                : AppColors.text,
            duration: const Duration(seconds: 4),
            behavior: SnackBarBehavior.floating,
            showCloseIcon: true,
          ),
        );
      _fetchOrders();
    }
  }

  Future<void> _fetchOrders() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final auth = Provider.of<AuthProvider>(context, listen: false);
      final token = auth.token;
      if (auth.isGuest || token == null) {
        if (!mounted) return;
        setState(() {
          _orders = [];
          _isLoading = false;
          _isGuestView = true;
        });
        return;
      }

      final orders = await ApiService.getMyOrders(token);
      orders.sort((a, b) {
        final aDate = DateTime.tryParse((a['created_at'] ?? '').toString());
        final bDate = DateTime.tryParse((b['created_at'] ?? '').toString());
        if (aDate == null && bDate == null) return 0;
        if (aDate == null) return 1;
        if (bDate == null) return -1;
        return bDate.compareTo(aDate);
      });
      if (!mounted) return;
      setState(() {
        _orders = orders;
        _isGuestView = false;
        _isLoading = false;
      });
      _maybeRequestReview();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
  }

  /// Asks for a Play review once, only after the customer's 2nd successful
  /// delivery. Never behind a button, never on web.
  Future<void> _maybeRequestReview() async {
    if (kIsWeb) return;
    try {
      final delivered = _orders
          .where(
            (o) =>
                OrderStatusStyle.normalize((o as Map)['status']) == 'delivered',
          )
          .length;
      if (delivered < 2) return;
      final prefs = await SharedPreferences.getInstance();
      if (prefs.getBool(_reviewFlagKey) ?? false) return;
      final review = InAppReview.instance;
      if (!await review.isAvailable()) return;
      await prefs.setBool(_reviewFlagKey, true);
      await review.requestReview();
    } catch (_) {}
  }

  Future<void> _openOrderDetails(Map<String, dynamic> order) async {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    final updated = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => OrderDetailsScreen(
          order: order,
          isUrdu: _isUrdu,
          userName:
              '${auth.user?.firstName ?? _tr('Customer')} ${auth.user?.lastName ?? ''}'
                  .trim(),
        ),
      ),
    );
    if (updated == true) {
      _fetchOrders();
    }
  }

  bool _isActive(dynamic order) =>
      OrderStatusStyle.of((order as Map)['status']).isActive;

  List<dynamic> get _visibleOrders {
    if (_statusFilter == 'all') return _orders;
    if (_statusFilter == 'active') {
      return _orders.where(_isActive).toList();
    }
    return _orders.where((o) => !_isActive(o)).toList();
  }

  @override
  void dispose() {
    Provider.of<NotificationProvider>(
      context,
      listen: false,
    ).removeEventListener(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final activeCount = _orders.where(_isActive).length;
    final completedCount = _orders
        .where(
          (o) =>
              OrderStatusStyle.normalize((o as Map)['status']) == 'delivered',
        )
        .length;

    Widget body;
    if (_isLoading) {
      body = const SkeletonList(count: 4);
    } else if (_isGuestView) {
      body = _scrollable(
        EmptyState(
          icon: Icons.receipt_long_outlined,
          title: _tr('Sign in to see your orders'),
          message: _tr(
            'Create a free account to place orders and track them live.',
          ),
          actionLabel: _tr('Sign in'),
          actionIcon: Icons.login_rounded,
          onAction: () => Navigator.of(context).pushNamed('/login'),
          secondaryLabel: _tr('Register'),
          onSecondary: () => Navigator.of(context).pushNamed('/register'),
        ),
      );
    } else if (_error != null) {
      body = _scrollable(
        EmptyState(
          icon: Icons.cloud_off_rounded,
          isError: true,
          title: _tr('Could not load your orders'),
          message: _tr('Check your internet connection and try again.'),
          actionLabel: _tr('Retry'),
          actionIcon: Icons.refresh_rounded,
          onAction: _fetchOrders,
        ),
      );
    } else {
      final visible = _visibleOrders;
      body = CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
          SliverToBoxAdapter(
            child: _buildSummaryRow(
              total: _orders.length,
              active: activeCount,
              completed: completedCount,
            ),
          ),
          SliverToBoxAdapter(child: _buildFilterChips()),
          if (visible.isEmpty)
            SliverFillRemaining(
              hasScrollBody: false,
              child: EmptyState(
                compact: true,
                icon: Icons.receipt_long_outlined,
                title: _tr('No orders found.'),
                message: _orders.isEmpty
                    ? _tr('Your orders will appear here after you order.')
                    : null,
                actionLabel: _orders.isEmpty ? _tr('Browse stores') : null,
                actionIcon: Icons.storefront_outlined,
                onAction: _orders.isEmpty
                    ? () => CustomerNav.go(
                        context,
                        CustomerTab.stores,
                        from: CustomerTab.orders,
                      )
                    : null,
              ),
            )
          else
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(
                AppSpace.gutter,
                AppSpace.xs,
                AppSpace.gutter,
                AppSpace.xxl,
              ),
              sliver: SliverList.separated(
                itemCount: visible.length,
                separatorBuilder: (_, _) => const SizedBox(height: AppSpace.md),
                itemBuilder: (context, index) {
                  final order = Map<String, dynamic>.from(
                    visible[index] as Map,
                  );
                  return _buildOrderCard(order);
                },
              ),
            ),
        ],
      );
    }

    return LanguageScope(
      isUrdu: _isUrdu,
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(
            tooltip: MaterialLocalizations.of(context).backButtonTooltip,
            icon: const BackButtonIcon(),
            onPressed: () {
              if (Navigator.of(context).canPop()) {
                Navigator.of(context).pop();
              } else {
                Navigator.of(context).pushReplacementNamed('/home');
              }
            },
          ),
          title: Text(_tr('My Orders')),
          actions: [
            const NotificationBellWidget(),
            IconButton(
              tooltip: _tr('Refresh'),
              icon: const Icon(Icons.refresh_rounded),
              onPressed: _fetchOrders,
            ),
          ],
        ),
        body: RefreshIndicator(onRefresh: _fetchOrders, child: body),
        bottomNavigationBar: CustomerBottomNav(
          current: CustomerTab.orders,
          isUrdu: _isUrdu,
        ),
      ),
    );
  }

  /// Keeps pull-to-refresh working on single-widget states.
  Widget _scrollable(Widget child) {
    return LayoutBuilder(
      builder: (context, constraints) => SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: ConstrainedBox(
          constraints: BoxConstraints(minHeight: constraints.maxHeight),
          child: child,
        ),
      ),
    );
  }

  Widget _buildSummaryRow({
    required int total,
    required int active,
    required int completed,
  }) {
    Widget metric(String label, int value, Color color) {
      return Expanded(
        child: Column(
          children: [
            Text(
              '$value',
              style: AppText.h2.copyWith(
                color: color,
                fontFeatures: AppText.tabular,
              ),
            ),
            Text(label, style: AppText.caption),
          ],
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpace.gutter,
        AppSpace.md,
        AppSpace.gutter,
        0,
      ),
      child: AppCard(
        padding: const EdgeInsets.symmetric(vertical: AppSpace.md),
        child: IntrinsicHeight(
          child: Row(
            children: [
              metric(_tr('Total'), total, AppColors.text),
              const VerticalDivider(width: 1),
              metric(_tr('Active'), active, AppColors.info),
              const VerticalDivider(width: 1),
              metric(_tr('Completed'), completed, AppColors.success),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildFilterChips() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppSpace.gutter,
        AppSpace.md,
        AppSpace.gutter,
        AppSpace.sm,
      ),
      child: Wrap(
        spacing: AppSpace.sm,
        children: [
          _filterChip('all', _tr('All')),
          _filterChip('active', _tr('Active')),
          _filterChip('history', _tr('History')),
        ],
      ),
    );
  }

  Widget _filterChip(String id, String label) {
    final selected = _statusFilter == id;
    return ChoiceChip(
      selected: selected,
      label: Text(label),
      side: BorderSide(color: selected ? AppColors.primary : AppColors.border),
      onSelected: (_) {
        setState(() => _statusFilter = id);
      },
    );
  }

  String _storeLabel(Map<String, dynamic> order) {
    final isGroup = order['is_group'] == true;
    final subOrders = (order['sub_orders'] as List?) ?? const [];
    if (isGroup && subOrders.isNotEmpty) {
      final names = subOrders
          .map((s) => ((s as Map)['store_name'] ?? '').toString().trim())
          .where((n) => n.isNotEmpty)
          .toList();
      if (names.isNotEmpty) return names.join(', ');
    }
    final name = (order['store_name'] ?? '').toString().trim();
    return name.isEmpty ? _tr('Store') : name;
  }

  int _itemUnits(Map<String, dynamic> order) {
    final items = (order['items'] as List?) ?? const [];
    var units = 0;
    for (final raw in items) {
      if (raw is! Map) continue;
      final q = int.tryParse((raw['quantity'] ?? '').toString()) ?? 1;
      units += q > 0 ? q : 1;
    }
    return units;
  }

  Widget _buildOrderCard(Map<String, dynamic> order) {
    final status = (order['status'] ?? 'pending').toString();
    final grandTotal = Fmt.toDouble(order['total_amount']);
    final units = _itemUnits(order);
    final date = Fmt.dateTime(order['created_at']);
    final orderNo = Fmt.orderNumber(
      order['order_number'],
      fallbackId: order['id'],
    );
    final payment = Fmt.paymentMethod(order['payment_method']);
    final meta = <String>[
      if (date.isNotEmpty) Fmt.isolate(date),
      if (units > 0)
        _isUrdu
            ? '${Fmt.isolate('$units')} ${_tr('items')}'
            : Fmt.count(units, 'item'),
      if (payment.isNotEmpty) _tr(payment),
    ];

    return AppCard(
      onTap: () => _openOrderDetails(order),
      padding: const EdgeInsets.fromLTRB(
        AppSpace.lg,
        AppSpace.md,
        AppSpace.sm,
        AppSpace.xs,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsetsDirectional.only(end: AppSpace.sm),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _storeLabel(order),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.title,
                      ),
                      Text(
                        Fmt.isolate(orderNo),
                        style: AppText.caption.copyWith(
                          fontFeatures: AppText.tabular,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: AppSpace.sm),
                StatusPill(status: status, urdu: _isUrdu),
              ],
            ),
          ),
          const SizedBox(height: AppSpace.sm),
          Padding(
            padding: const EdgeInsetsDirectional.only(end: AppSpace.sm),
            child: Text(
              meta.join('  ·  '),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: AppText.small,
            ),
          ),
          Row(
            children: [
              Expanded(
                child: PriceText(
                  grandTotal,
                  urdu: _isUrdu,
                  style: const TextStyle(fontSize: 16),
                ),
              ),
              TextButton.icon(
                onPressed: () => _openOrderDetails(order),
                icon: const Icon(Icons.chevron_right_rounded),
                label: Text(_tr('View details')),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
