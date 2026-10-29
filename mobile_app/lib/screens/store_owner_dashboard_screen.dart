import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:logger/logger.dart';
import '../providers/auth_provider.dart';
import '../providers/notification_provider.dart';
import '../services/api_service.dart';
import '../utils/customer_language.dart';
import '../widgets/notification_bell_widget.dart';
import '../widgets/staff/staff_ui.dart';
import '../widgets/staff/store_financial_sheet.dart';
import 'offer_campaigns_screen.dart';
import 'login_screen.dart';

class StoreOwnerDashboardScreen extends StatefulWidget {
  const StoreOwnerDashboardScreen({super.key});

  @override
  State<StoreOwnerDashboardScreen> createState() =>
      _StoreOwnerDashboardScreenState();
}

class _StoreOwnerDashboardScreenState extends State<StoreOwnerDashboardScreen>
    with SingleTickerProviderStateMixin {
  final Logger _logger = Logger();
  late TabController _tabController;
  bool _isLoading = true;
  List<dynamic> _pendingOrders = [];
  List<dynamic> _activeOrders = []; // Preparing, Ready
  List<dynamic> _historyOrders = []; // Delivered, Cancelled
  Map<String, dynamic> _stats = {};
  bool _isUrdu = false;

  Future<void> _loadLanguagePreference() async {
    final isUrdu = await CustomerLanguage.loadIsUrdu();
    if (!mounted) return;
    setState(() => _isUrdu = isUrdu);
  }

  String _tr(String text) => CustomerLanguage.tr(_isUrdu, text);

  @override
  void initState() {
    super.initState();
    _loadLanguagePreference();
    _tabController = TabController(length: 3, vsync: this);
    _loadOrders();
    _setupNotifications();
  }

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

    final nestedData = (notification['data'] is Map<String, dynamic>)
        ? notification['data'] as Map<String, dynamic>
        : null;
    final message = (notification['message'] ??
                nestedData?['message'] ??
                notification['title'] ??
                'New notification')
            .toString();
    final type =
        (notification['type'] ?? nestedData?['type'])?.toString().toLowerCase();
    final status = (notification['status'] ?? nestedData?['status'])
        ?.toString()
        .toLowerCase();
    final isSilentRefresh = type == 'silent_refresh';
    final isSilentOrderRefresh =
        type == 'refresh_orders' && message.trim().isEmpty;

    if (!isSilentRefresh && !isSilentOrderRefresh) {
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

    final isNewOrder = type == 'new_order';
    final isHistoryUpdate = status == 'delivered' ||
        status == 'cancelled' ||
        status == 'picked_up' ||
        type == 'order_completed' ||
        type == 'delivered';
    final isActiveUpdate = status == 'preparing' ||
        status == 'ready' ||
        status == 'ready_for_pickup' ||
        status == 'out_for_delivery' ||
        type == 'rider_assigned';

    if (isNewOrder ||
        isHistoryUpdate ||
        isActiveUpdate ||
        isSilentRefresh ||
        type == 'refresh_orders' ||
        type == 'order_status_update') {
      _loadOrders();

      if (isNewOrder) {
        _tabController.animateTo(0); // Switch to New Orders tab
      } else if (isHistoryUpdate) {
        _tabController.animateTo(2); // Switch to History tab
      } else if (isActiveUpdate) {
        _tabController.animateTo(1); // Switch to Active tab
      }
    }
  }

  @override
  void dispose() {
    _tabController.dispose();
    Provider.of<NotificationProvider>(
      context,
      listen: false,
    ).removeEventListener(this);
    super.dispose();
  }

  Future<void> _loadOrders() async {
    setState(() => _isLoading = true);
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;

      final data = await ApiService.getStoreOrders(token);
      final orders = (data['orders'] as List?) ?? [];
      final stats = (data['stats'] as Map<String, dynamic>?) ?? {};

      if (mounted) {
        setState(() {
          _stats = stats;
          _pendingOrders = orders
              .where(
                (o) => o['status'] == 'pending' || o['status'] == 'confirmed',
              )
              .toList();
          _activeOrders = orders
              .where(
                (o) =>
                    o['status'] == 'preparing' ||
                    o['status'] == 'ready' ||
                    o['status'] == 'ready_for_pickup' || // Include ready_for_pickup in Active
                    o['status'] == 'out_for_delivery',
              )
              .toList();
          _historyOrders = orders
              .where(
                (o) =>
                    o['status'] == 'delivered' ||
                    o['status'] == 'cancelled' ||
                    o['status'] == 'picked_up' || // Show picked_up in history as it's done for the store
                    o['status'] == 'out_for_delivery', // Also show out_for_delivery in history
              )
              .toList();
        });
      }
    } catch (e) {
      _logger.e('Error loading store orders: $e');
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(
          SnackBar(
            content: Text(_tr('Could not load orders. Pull down to retry.')),
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _updateStatus(int orderId, String newStatus) async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;

      await ApiService.updateOrderStatus(token, orderId, newStatus);
      if (mounted) {
        ScaffoldMessenger.of(context).clearSnackBars();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              '${_tr('Order marked as')} ${OrderStatusStyle.of(newStatus).label}',
            ),
            duration: const Duration(seconds: 3),
            behavior: SnackBarBehavior.floating,
            showCloseIcon: true,
          ),
        );
        if (newStatus == 'ready') {
          _tabController.animateTo(1); // Switch to Active tab
        } else if (newStatus == 'picked_up') {
          _tabController.animateTo(2); // Move to History after pickup confirmation
        }
        _loadOrders();
      }
    } catch (e) {
      _logger.e('Error updating status: $e');
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(
          SnackBar(
            content: Text(_tr('Could not update the order. Please try again.')),
          ),
        );
      }
    }
  }

  Future<void> _openStoreFinancialHistory() async {
    final token = Provider.of<AuthProvider>(context, listen: false).token;
    if (token == null) return;
    await StoreFinancialSheet.show(context, token);
  }

  Future<void> _openStoreStatusMessageDialog() async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;

      final storeId = int.tryParse((_stats['store_id'] ?? '').toString());
      if (storeId == null || storeId <= 0) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Store info not loaded yet')),
        );
        return;
      }

      String initialMessage = '';
      bool initialClosed = false;
      try {
        final status = await ApiService.getStoreStatusMessage(token);
        initialMessage = (status['status_message'] ?? '').toString();
        initialClosed = status['is_closed'] == true;
      } catch (_) {}

      if (!mounted) return;
      final messageCtrl = TextEditingController(text: initialMessage);
      bool isClosed = initialClosed;
      bool saving = false;

      await showDialog<void>(
        context: context,
        builder: (ctx) {
          return StatefulBuilder(
            builder: (dialogContext, setDialogState) {
              return AlertDialog(
                title: Text(_tr('Update Store Status')),
                content: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      SwitchListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(_tr('Mark as Closed')),
                        value: isClosed,
                        onChanged: (v) => setDialogState(() => isClosed = v),
                      ),
                      TextField(
                        controller: messageCtrl,
                        maxLines: 4,
                        maxLength: 500,
                        decoration: InputDecoration(
                          labelText: _tr('Status Message'),
                          hintText: _tr('Store is closed due to maintenance...'),
                        ),
                      ),
                    ],
                  ),
                ),
                actions: [
                  TextButton(
                    onPressed: saving ? null : () => Navigator.of(ctx).pop(),
                    child: Text(_tr('Cancel')),
                  ),
                  ElevatedButton(
                    onPressed: saving
                        ? null
                        : () async {
                            setDialogState(() => saving = true);
                            try {
                              await ApiService.setStoreStatusMessage(
                                token,
                                statusMessage: messageCtrl.text.trim(),
                                isClosed: isClosed,
                              );
                              if (!mounted || !ctx.mounted) return;
                              Navigator.of(ctx).pop();
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text(_tr('Store message updated')),
                                ),
                              );
                            } catch (e) {
                              if (!mounted) return;
                              setDialogState(() => saving = false);
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text(_tr('Could not save. Please try again.')),
                                ),
                              );
                            }
                          },
                    child: Text(_tr('Save')),
                  ),
                ],
              );
            },
          );
        },
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(_tr('Could not open store status. Please try again.')),
        ),
      );
    }
  }

  void _logout() {
    Provider.of<AuthProvider>(context, listen: false).logout();
    Navigator.of(
      context,
    ).pushReplacement(MaterialPageRoute(builder: (_) => const LoginScreen()));
  }

  // ---------------------------------------------------------------------------
  // UI (phase B redesign). Data loading and status updates are above.
  // ---------------------------------------------------------------------------

  void _openProducts() => Navigator.of(context).pushNamed('/manage-products');

  void _openOffers() {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => OfferCampaignsScreen(
          isAdmin: false,
          initialStoreId: int.tryParse((_stats['store_id'] ?? '').toString()),
        ),
      ),
    );
  }

  void _openMoreSheet() {
    final ownerName = (_stats['owner_name'] ?? '').toString().trim();
    final ownerEmail = (_stats['owner_email'] ?? '').toString().trim();
    final ownerPhone = (_stats['owner_phone'] ?? '').toString().trim();
    showStaffMoreSheet(
      context,
      title: _tr('More'),
      items: [
        StaffMoreItem(
          icon: Icons.storefront_outlined,
          label: _tr('Store status'),
          subtitle: _tr('Open or close the store, status message'),
          onTap: _openStoreStatusMessageDialog,
        ),
        StaffMoreItem(
          icon: Icons.refresh_rounded,
          label: _tr('Refresh orders'),
          onTap: _loadOrders,
        ),
        StaffMoreItem(
          icon: Icons.key_outlined,
          label: _tr('Change Password'),
          onTap: () => Navigator.of(context).pushNamed('/change-password'),
        ),
        StaffMoreItem(
          icon: Icons.logout_rounded,
          label: _tr('Logout'),
          destructive: true,
          onTap: _logout,
        ),
      ],
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (ownerName.isNotEmpty || ownerEmail.isNotEmpty || ownerPhone.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_tr('Owner'), style: AppText.caption),
                  if (ownerName.isNotEmpty)
                    Text(ownerName, style: AppText.bodyStrong),
                  if (ownerEmail.isNotEmpty)
                    Text(ownerEmail, style: AppText.small),
                  if (ownerPhone.isNotEmpty)
                    Text(ownerPhone, style: AppText.small),
                ],
              ),
            ),
          const Divider(height: 16),
          const AppVersionText(),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final storeName = (_stats['store_name'] ?? '').toString().trim();
    return LanguageScope(
      isUrdu: _isUrdu,
      child: Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(
          title: Text(
            storeName.isEmpty ? _tr('Store Dashboard') : storeName,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          actions: const [NotificationBellWidget(), SizedBox(width: 4)],
        ),
        bottomNavigationBar: _buildBottomNavigationBar(),
        body: _isLoading && _stats.isEmpty
            ? const StaffListSkeleton()
            : Column(
                children: [
                  _buildDashboardStats(),
                  Material(
                    color: AppColors.surface,
                    child: TabBar(
                      controller: _tabController,
                      tabs: [
                        _tab(_tr('New'), _pendingOrders.length, highlight: true),
                        _tab(_tr('Active'), _activeOrders.length),
                        _tab(_tr('History'), 0),
                      ],
                    ),
                  ),
                  if (_isLoading) const LinearProgressIndicator(minHeight: 2),
                  Expanded(
                    child: TabBarView(
                      controller: _tabController,
                      children: [
                        _buildOrderList(_pendingOrders, showActions: true, kind: 0),
                        _buildOrderList(_activeOrders, showActions: true, kind: 1),
                        _buildOrderList(_historyOrders, showActions: false, kind: 2),
                      ],
                    ),
                  ),
                ],
              ),
      ),
    );
  }

  Widget _tab(String label, int count, {bool highlight = false}) {
    return Tab(
      height: 48,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Flexible(
            child: Text(label, maxLines: 1, overflow: TextOverflow.ellipsis),
          ),
          if (count > 0) ...[
            const SizedBox(width: 6),
            Container(
              constraints: const BoxConstraints(minWidth: 20),
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
              decoration: BoxDecoration(
                color: highlight ? AppColors.primary : AppColors.surface3,
                borderRadius: AppRadius.pillAll,
              ),
              child: Text(
                Fmt.number(count),
                textAlign: TextAlign.center,
                style: AppText.label.copyWith(
                  fontSize: 11,
                  color: highlight ? Colors.white : AppColors.text2,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildBottomNavigationBar() {
    return DecoratedBox(
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppColors.border)),
      ),
      child: NavigationBar(
        selectedIndex: 0,
        onDestinationSelected: (index) {
          switch (index) {
            case 0:
              _loadOrders();
              break;
            case 1:
              _openProducts();
              break;
            case 2:
              _openOffers();
              break;
            case 3:
              _openStoreFinancialHistory();
              break;
            case 4:
              _openMoreSheet();
              break;
          }
        },
        destinations: [
          NavigationDestination(
            icon: const Icon(Icons.receipt_long_outlined),
            selectedIcon: const Icon(Icons.receipt_long_rounded),
            label: _tr('Orders'),
            tooltip: _tr('Orders'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.inventory_2_outlined),
            label: _tr('Products'),
            tooltip: _tr('Products'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.campaign_outlined),
            label: _tr('Offers'),
            tooltip: _tr('Offers'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.account_balance_wallet_outlined),
            label: _tr('Financial'),
            tooltip: _tr('Financial history'),
          ),
          NavigationDestination(
            icon: const Icon(Icons.more_horiz_rounded),
            label: _tr('More'),
            tooltip: _tr('More'),
          ),
        ],
      ),
    );
  }

  /// Compact header: store, payment term and four numbers on two short rows.
  Widget _buildDashboardStats() {
    if (_stats.isEmpty) return const SizedBox.shrink();

    final storeId = _stats['store_id']?.toString() ?? '';
    final ownerName = (_stats['owner_name'] ?? '').toString().trim();
    final paymentTerm = (_stats['payment_term'] ?? '').toString().trim();
    final totalOrders = Fmt.toDouble(_stats['total_orders']).round();
    final delivered = Fmt.toDouble(_stats['delivered']).round();
    final preparing = Fmt.toDouble(_stats['preparing']).round();
    final ready = Fmt.toDouble(_stats['ready']).round();
    final balance = Fmt.toDouble(_stats['received_balance']);

    Widget stat(String value, String label, {Color? color}) {
      return Expanded(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            FittedBox(
              fit: BoxFit.scaleDown,
              alignment: AlignmentDirectional.centerStart,
              child: Text(
                value,
                maxLines: 1,
                style: AppText.price.copyWith(
                  fontSize: 16,
                  color: color ?? AppColors.text,
                ),
              ),
            ),
            Text(label, maxLines: 1, style: AppText.caption),
          ],
        ),
      );
    }

    return Container(
      width: double.infinity,
      color: AppColors.surface,
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  [
                    if (storeId.isNotEmpty) '${_tr('Store')} #$storeId',
                    if (ownerName.isNotEmpty) ownerName,
                  ].join(' · '),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.small,
                ),
              ),
              if (paymentTerm.isNotEmpty) TonePill.neutral(paymentTerm),
            ],
          ),
          const SizedBox(height: AppSpace.sm),
          Row(
            children: [
              stat(
                Fmt.money(balance),
                _tr('Net receivable'),
                color: balance > 0 ? AppColors.primaryPressed : AppColors.text,
              ),
              stat(Fmt.number(totalOrders), _tr('Total orders')),
              stat(Fmt.number(delivered), _tr('Delivered')),
              stat(
                Fmt.number(preparing + ready),
                _tr('In progress'),
                color: preparing + ready > 0 ? AppColors.warning : null,
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildOrderList(
    List<dynamic> orders, {
    required bool showActions,
    required int kind,
  }) {
    if (orders.isEmpty) {
      final IconData icon;
      final String title;
      final String message;
      switch (kind) {
        case 0:
          icon = Icons.notifications_active_outlined;
          title = _tr('No new orders');
          message = _tr(
            'New orders appear here automatically. Keep the app open to hear them.',
          );
          break;
        case 1:
          icon = Icons.soup_kitchen_outlined;
          title = _tr('Nothing in progress');
          message = _tr('Orders you are preparing or that wait for a rider show here.');
          break;
        default:
          icon = Icons.history_rounded;
          title = _tr('No past orders yet');
          message = _tr('Picked-up, delivered and cancelled orders show here.');
      }
      return RefreshIndicator(
        onRefresh: _loadOrders,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            EmptyState(
              icon: icon,
              title: title,
              message: message,
              actionLabel: _tr('Refresh'),
              actionIcon: Icons.refresh_rounded,
              onAction: _loadOrders,
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: _loadOrders,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        itemCount: orders.length,
        separatorBuilder: (_, _) => const SizedBox(height: AppSpace.md),
        itemBuilder: (context, index) {
          return _buildOrderCard(orders[index], showActions);
        },
      ),
    );
  }

  Widget _buildOrderCard(Map<String, dynamic> order, bool showActions) {
    // Use item_status if available (specific to this store), otherwise fallback to global order status
    String displayStatus = order['status'] ?? 'unknown';
    final items = (order['items'] as List?) ?? [];

    if (items.isNotEmpty && items[0]['item_status'] != null) {
      displayStatus = items[0]['item_status'];
    }

    // This store's share of the order (its own items).
    double storeTotal = 0;
    for (final item in items) {
      storeTotal +=
          Fmt.toDouble(item['price']) * Fmt.toDouble(item['quantity'] ?? 1);
    }
    final customerName =
        '${order['first_name'] ?? ''} ${order['last_name'] ?? ''}'.trim();
    final riderName = (order['rider_first_name'] ?? '').toString().trim();
    final action = showActions ? _buildActionButtons(order, displayStatus) : null;

    return AppCard(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      Fmt.orderNumber(order['order_number'], fallbackId: order['id']),
                      style: AppText.title,
                    ),
                    Text(
                      Fmt.dateTime(order['created_at'], fallback: '-'),
                      style: AppText.caption,
                    ),
                  ],
                ),
              ),
              StatusPill(status: displayStatus, urdu: _isUrdu),
            ],
          ),
          const SizedBox(height: AppSpace.md),
          for (final item in items)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 3),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 34,
                    child: Text(
                      '${item['quantity']}×',
                      style: AppText.bodyStrong.copyWith(
                        color: AppColors.primaryDeep,
                      ),
                    ),
                  ),
                  Expanded(
                    child: Text(
                      [
                        (item['product_name'] ?? 'Product').toString(),
                        Fmt.unit(item['variant_label']?.toString()),
                      ].where((s) => s.isNotEmpty).join(' · '),
                      style: AppText.body,
                    ),
                  ),
                ],
              ),
            ),
          const Divider(height: 24),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (customerName.isNotEmpty)
                      Text(
                        customerName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.small,
                      ),
                    Row(
                      children: [
                        Icon(
                          Icons.delivery_dining_rounded,
                          size: 16,
                          color: riderName.isEmpty
                              ? AppColors.muted
                              : AppColors.info,
                        ),
                        const SizedBox(width: 4),
                        Flexible(
                          child: Text(
                            riderName.isEmpty
                                ? _tr('No rider yet')
                                : '${_tr('Rider')}: $riderName',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppText.caption.copyWith(
                              color: riderName.isEmpty
                                  ? AppColors.muted
                                  : AppColors.info,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              if (storeTotal > 0) PriceText(storeTotal),
            ],
          ),
          if (action != null) ...[
            const SizedBox(height: AppSpace.md),
            action,
          ],
        ],
      ),
    );
  }

  /// One primary action per state.
  Widget? _buildActionButtons(Map<String, dynamic> order, String currentStatus) {
    final id = order['id'];
    final hasRider = order['rider_id'] != null;
    if (currentStatus == 'pending' ||
        currentStatus == 'confirmed' ||
        currentStatus == 'preparing') {
      return PrimaryButton(
        label: _tr('Mark Ready'),
        icon: Icons.check_circle_outline_rounded,
        onPressed: () => _updateStatus(id, 'ready'),
      );
    } else if (currentStatus == 'ready' || currentStatus == 'ready_for_pickup') {
      if (hasRider) {
        return PrimaryButton(
          label: _tr('Confirm Picked Up'),
          icon: Icons.handshake_outlined,
          color: AppColors.primaryPressed,
          onPressed: () => _updateStatus(id, 'picked_up'),
        );
      }
      return Container(
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
                _tr('Ready. Waiting for a rider to be assigned.'),
                style: AppText.bodyStrong.copyWith(color: AppColors.text2),
              ),
            ),
          ],
        ),
      );
    }
    return null;
  }
}
