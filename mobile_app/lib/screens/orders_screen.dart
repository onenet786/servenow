import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../providers/notification_provider.dart';
import 'order_details_screen.dart';
import '../services/api_service.dart';
import '../theme/customer_palette.dart';
import '../utils/customer_language.dart';
import '../widgets/notification_bell_widget.dart';

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  static const int _activeBottomIndex = 2;
  bool _isLoading = true;
  List<dynamic> _orders = [];
  String? _error;
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
            backgroundColor:
                type == 'payment_status_update' ? Colors.green : CustomerPalette.primaryDark,
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
      if (auth.isGuest) {
        if (!mounted) return;
        setState(() {
          _orders = [];
          _isLoading = false;
          _error = _tr(
            'Guest users need to register before they can view order history.',
          );
        });
        return;
      }

      final token = auth.token;
      if (token == null) return;

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
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _isLoading = false;
      });
    }
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

  List<dynamic> get _visibleOrders {
    if (_statusFilter == 'all') return _orders;
    if (_statusFilter == 'active') {
      return _orders.where((order) {
        final status = (order['status'] ?? '').toString().toLowerCase();
        return status != 'delivered' && status != 'cancelled';
      }).toList();
    }
    return _orders.where((order) {
      final status = (order['status'] ?? '').toString().toLowerCase();
      return status == 'delivered' || status == 'cancelled';
    }).toList();
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
    final authProvider = Provider.of<AuthProvider>(context);
    final userName = authProvider.user?.firstName ?? 'Customer';
    final activeCount = _orders.where((o) {
      final status = (o['status'] ?? '').toString().toLowerCase();
      return status != 'delivered' && status != 'cancelled';
    }).length;
    final completedCount = _orders.where((o) {
      final status = (o['status'] ?? '').toString().toLowerCase();
      return status == 'delivered';
    }).length;

    return Directionality(
      textDirection: CustomerLanguage.textDirection(_isUrdu),
      child: Scaffold(
      backgroundColor: CustomerPalette.background,
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
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
          IconButton(icon: const Icon(Icons.refresh), onPressed: _fetchOrders),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _fetchOrders,
        child: _isLoading
            ? const Center(child: CircularProgressIndicator())
            : _error != null
                ? _buildErrorState()
                : Column(
                    children: [
                      _buildSummaryCard(
                        userName: userName,
                        total: _orders.length,
                        active: activeCount,
                        completed: completedCount,
                      ),
                      _buildFilterChips(),
                      const SizedBox(height: 6),
                      Expanded(
                        child: _visibleOrders.isEmpty
                            ? Center(child: Text(_tr('No orders found.')))
                            : ListView.builder(
                                padding: const EdgeInsets.fromLTRB(14, 4, 14, 18),
                                itemCount: _visibleOrders.length,
                                itemBuilder: (context, index) {
                                  final order = Map<String, dynamic>.from(
                                    _visibleOrders[index] as Map,
                                  );
                                  return _buildOrderCard(order);
                                },
                              ),
                      ),
                    ],
                  ),
      ),
      bottomNavigationBar: _buildBottomBar(),
    ));
  }

  Widget _buildBottomBar() {
    return SafeArea(
      top: false,
      child: Container(
        margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: CustomerPalette.card,
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
            _buildBottomIcon(
              index: 0,
              icon: Icons.home_filled,
              label: _tr('Home'),
              onTap: () => Navigator.of(context).pushReplacementNamed('/home'),
            ),
            _buildBottomIcon(
              index: 1,
              icon: Icons.storefront,
              label: _tr('Stores'),
              onTap: () => Navigator.of(context).pushReplacementNamed('/home'),
            ),
            _buildBottomIcon(
              index: 2,
              icon: Icons.shopping_bag,
              label: _tr('Orders'),
              onTap: () {},
            ),
            _buildBottomIcon(
              index: 3,
              icon: Icons.shopping_cart,
              label: _tr('Cart'),
              onTap: () => Navigator.of(context).pushReplacementNamed('/cart'),
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
    required VoidCallback onTap,
  }) {
    final active = _activeBottomIndex == index;
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 22,
              color:
                  active ? CustomerPalette.primaryDark : Colors.grey.shade600,
            ),
            const SizedBox(height: 2),
            Text(
              label,
              style: TextStyle(
                fontSize: 10,
                fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                color:
                    active ? CustomerPalette.primaryDark : Colors.grey.shade700,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildErrorState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, color: Colors.redAccent, size: 34),
            const SizedBox(height: 8),
            Text(
              '${_tr('Failed to load orders')}\n$_error',
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 10),
            FilledButton.icon(
              onPressed: _fetchOrders,
              icon: const Icon(Icons.refresh),
              label: Text(_tr('Retry')),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSummaryCard({
    required String userName,
    required int total,
    required int active,
    required int completed,
  }) {
    return Container(
      margin: const EdgeInsets.fromLTRB(14, 14, 14, 10),
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [CustomerPalette.primary, CustomerPalette.primaryDark],
        ),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        children: [
          Row(
            children: [
              const Icon(Icons.receipt_long, color: Colors.white),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  '${_tr('Customer')}: $userName',
                  style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.w700,
                    fontSize: 16,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(child: _buildMetricTile(_tr('Total'), '$total')),
              const SizedBox(width: 8),
              Expanded(child: _buildMetricTile(_tr('Active'), '$active')),
              const SizedBox(width: 8),
              Expanded(child: _buildMetricTile(_tr('Completed'), '$completed')),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMetricTile(String label, String value) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 8),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.15),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        children: [
          Text(
            value,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w800,
              fontSize: 16,
            ),
          ),
          Text(
            label,
            style: const TextStyle(
              color: Colors.white70,
              fontWeight: FontWeight.w600,
              fontSize: 12,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterChips() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12),
      child: Row(
        children: [
          _filterChip('all', _tr('All')),
          const SizedBox(width: 8),
          _filterChip('active', _tr('Active')),
          const SizedBox(width: 8),
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
      onSelected: (_) {
        setState(() => _statusFilter = id);
      },
      selectedColor: CustomerPalette.primaryDark,
      backgroundColor: Colors.white,
      labelStyle: TextStyle(
        color: selected ? Colors.white : Colors.black87,
        fontWeight: FontWeight.w700,
      ),
    );
  }

  Widget _buildOrderCard(Map<String, dynamic> order) {
    final isGroup = order['is_group'] == true;
    final subOrders = (order['sub_orders'] as List?) ?? const [];
    final orderNumber = (order['order_number'] ?? '').toString();
    final status = (order['status'] ?? 'pending').toString();
    final createdAt = DateTime.tryParse((order['created_at'] ?? '').toString());

    final deliveryFee = _toDouble(order['delivery_fee']);
    final grandTotal = _toDouble(order['total_amount']);
    final subtotal = (grandTotal - deliveryFee).clamp(0, double.infinity);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 8,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 8),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${_tr('Orders')} #$orderNumber',
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        createdAt != null
                            ? _formatDateTime(createdAt)
                            : _tr('Order Date'),
                        style: const TextStyle(
                          fontSize: 12,
                          color: Colors.black54,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                _buildStatusBadge(status),
              ],
            ),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 12, 8),
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: _amountBlock(
                        label: _tr('Subtotal'),
                        value: _formatPkr(subtotal),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _amountBlock(
                        label: _tr('Delivery'),
                        value: _formatPkr(deliveryFee),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: _amountBlock(
                        label: _tr('Grand Total'),
                        value: _formatPkr(grandTotal),
                        highlight: true,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                _lineInfo(
                  icon: Icons.location_on_outlined,
                  label: _tr('Address'),
                  value: (order['delivery_address'] ?? 'N/A').toString(),
                ),
                if (isGroup)
                  _lineInfo(
                    icon: Icons.store_mall_directory_outlined,
                    label: _tr('Shipments'),
                    value: '${subOrders.length} ${_tr('Stores')}',
                  )
                else
                  _lineInfo(
                    icon: Icons.storefront_outlined,
                    label: _tr('Store'),
                    value: (order['store_name'] ?? 'N/A').toString(),
                  ),
                if ((order['payment_method'] ?? '').toString().trim().isNotEmpty)
                  _lineInfo(
                    icon: Icons.payments_outlined,
                    label: _tr('Payment'),
                    value: '${order['payment_method']}',
                  ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () => _openOrderDetails(order),
              icon: const Icon(Icons.open_in_new_rounded),
              label: Text(_tr('View details')),
            ),
          ),
        ],
      ),
    );
  }

  Widget _amountBlock({
    required String label,
    required String value,
    bool highlight = false,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
      decoration: BoxDecoration(
        color: highlight ? const Color(0xFFFFEEDD) : const Color(0xFFFFF7EF),
        borderRadius: BorderRadius.circular(10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            label,
            style: const TextStyle(fontSize: 11, color: Colors.black54),
          ),
          const SizedBox(height: 2),
          Text(
            value,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w800,
              color: highlight ? CustomerPalette.primaryDark : Colors.black87,
            ),
          ),
        ],
      ),
    );
  }

  Widget _lineInfo({
    required IconData icon,
    required String label,
    required String value,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 15, color: Colors.grey[700]),
          const SizedBox(width: 6),
          SizedBox(
            width: 70,
            child: Text(
              '$label:',
              style: const TextStyle(
                color: Colors.black54,
                fontWeight: FontWeight.w600,
                fontSize: 12,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                color: Colors.black87,
                fontWeight: FontWeight.w600,
                fontSize: 12,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusBadge(String status) {
    final normalized = status.toLowerCase();
    Color color;
    switch (normalized) {
      case 'pending':
        color = Colors.orange;
        break;
      case 'confirmed':
        color = CustomerPalette.primaryDark;
        break;
      case 'preparing':
        color = Colors.deepPurple;
        break;
      case 'ready':
      case 'ready_for_pickup':
        color = Colors.indigo;
        break;
      case 'picked_up':
      case 'out_for_delivery':
        color = Colors.teal;
        break;
      case 'delivered':
        color = Colors.green;
        break;
      case 'cancelled':
        color = Colors.red;
        break;
      default:
        color = Colors.grey;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.6)),
      ),
      child: Text(
        _tr(status.toUpperCase().replaceAll('_', ' ')),
        style: TextStyle(
          color: color,
          fontWeight: FontWeight.w800,
          fontSize: 10,
        ),
      ),
    );
  }

  String _formatDateTime(DateTime dt) {
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ];
    final m = months[dt.month - 1];
    final hh = dt.hour.toString().padLeft(2, '0');
    final mm = dt.minute.toString().padLeft(2, '0');
    return '${dt.day} $m ${dt.year}, $hh:$mm';
  }

  double _toDouble(dynamic value) {
    if (value is num) return value.toDouble();
    return double.tryParse(value.toString()) ?? 0;
  }

  String _formatPkr(num value) {
    final doubleV = value.toDouble();
    if (doubleV == doubleV.roundToDouble()) {
      return 'PKR ${doubleV.toInt()}';
    }
    return 'PKR ${doubleV.toStringAsFixed(2)}';
  }
}
