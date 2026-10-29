import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../config/support_contact.dart';
import '../providers/auth_provider.dart';
import '../providers/notification_provider.dart';
import '../services/api_service.dart';
import '../services/notifier.dart';
import '../utils/customer_language.dart';
import '../widgets/ui/ui.dart';

class OrderDetailsScreen extends StatefulWidget {
  final Map<String, dynamic> order;
  final bool isUrdu;
  final String userName;

  const OrderDetailsScreen({
    super.key,
    required this.order,
    required this.isUrdu,
    required this.userName,
  });

  @override
  State<OrderDetailsScreen> createState() => _OrderDetailsScreenState();
}

class _OrderDetailsScreenState extends State<OrderDetailsScreen> {
  late Map<String, dynamic> _order;
  SupportContact? _supportContact;
  bool _isCancelling = false;
  bool _didUpdateOrder = false;
  bool _isRefreshingOrder = false;
  final GlobalKey _trackingKey = GlobalKey();

  @override
  void initState() {
    super.initState();
    _order = Map<String, dynamic>.from(widget.order);
    _setupLiveTracking();
    _loadSupportContact();
    _refreshOrderDetails(silent: true);
  }

  bool get _isUrdu => widget.isUrdu;

  String _tr(String text) => CustomerLanguage.tr(widget.isUrdu, text);

  String _money(num value) => Fmt.money(value, urdu: _isUrdu);

  void _setupLiveTracking() {
    Provider.of<NotificationProvider>(
      context,
      listen: false,
    ).addEventListener(this, _handleLiveEvent);
  }

  void _handleLiveEvent(Map<String, dynamic> event) {
    if (!mounted || !_isEventRelevant(event)) return;

    final type = (event['type'] ?? event['event'] ?? '')
        .toString()
        .trim()
        .toLowerCase();
    if (type == 'rider_location_update') {
      _applyLiveRiderLocation(event);
      return;
    }

    if (type == 'order_status_update' ||
        type == 'order_completed' ||
        type == 'payment_status_update' ||
        type == 'refresh_orders') {
      _refreshOrderDetails(silent: true);
    }
  }

  bool _isEventRelevant(Map<String, dynamic> event) {
    final currentOrderId = _toNullableInt(_order['id']);
    final currentRiderId = _toNullableInt(_order['rider_id']);
    final currentOrderNumber = (_order['order_number'] ?? '')
        .toString()
        .trim()
        .toLowerCase();

    final eventOrderId = _toNullableInt(event['order_id'] ?? event['id']);
    if (currentOrderId != null && eventOrderId != null) {
      return currentOrderId == eventOrderId;
    }

    final orderIds = event['order_ids'];
    if (currentOrderId != null && orderIds is List) {
      for (final entry in orderIds) {
        if (_toNullableInt(entry) == currentOrderId) {
          return true;
        }
      }
    }

    final eventOrderNumber = (event['order_number'] ?? '')
        .toString()
        .trim()
        .toLowerCase();
    if (currentOrderNumber.isNotEmpty && eventOrderNumber.isNotEmpty) {
      return currentOrderNumber == eventOrderNumber;
    }

    final eventRiderId = _toNullableInt(event['rider_id']);
    if (currentRiderId != null && eventRiderId != null) {
      final isActiveOrder = !_isClosedStatus(
        (_order['status'] ?? '').toString().toLowerCase(),
      );
      return isActiveOrder && currentRiderId == eventRiderId;
    }

    return false;
  }

  void _applyLiveRiderLocation(Map<String, dynamic> event) {
    final location = (event['location'] ?? '').toString().trim();
    final latitude = event['latitude'];
    final longitude = event['longitude'];

    setState(() {
      if (location.isNotEmpty) {
        _order['rider_location'] = location;
      }
      if (latitude != null) {
        _order['rider_latitude'] = latitude;
      }
      if (longitude != null) {
        _order['rider_longitude'] = longitude;
      }
      _didUpdateOrder = true;
    });
  }

  Future<void> _refreshOrderDetails({bool silent = false}) async {
    if (_isRefreshingOrder) return;
    final token = Provider.of<AuthProvider>(context, listen: false).token;
    final orderId = _toNullableInt(_order['id']);
    if (token == null || token.trim().isEmpty || orderId == null) return;

    _isRefreshingOrder = true;
    try {
      final latestOrder = await ApiService.getOrderDetails(token, orderId);
      if (!mounted || latestOrder.isEmpty) return;
      setState(() {
        _order = {..._order, ...latestOrder};
        _didUpdateOrder = true;
      });
    } catch (_) {
      if (!silent && mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(_tr('Failed to refresh order'))));
      }
    } finally {
      _isRefreshingOrder = false;
    }
  }

  bool get _canCancel {
    final status = (_order['status'] ?? '').toString().toLowerCase();
    return status == 'pending' ||
        status == 'confirmed' ||
        status == 'preparing' ||
        status == 'ready';
  }

  Future<void> _cancelOrder() async {
    if (!_canCancel || _isCancelling) return;
    final token = Provider.of<AuthProvider>(context, listen: false).token;
    final orderId = _order['id'];
    if (token == null || orderId is! int) return;

    setState(() => _isCancelling = true);
    try {
      await ApiService.updateOrderStatus(token, orderId, 'cancelled');
      if (!mounted) return;
      setState(() {
        _order['status'] = 'cancelled';
        _didUpdateOrder = true;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(_tr('Order cancelled successfully'))),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            '${_tr('Failed to cancel order')}: ${Notifier.sanitizeMessage(e.toString())}',
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _isCancelling = false);
    }
  }

  Future<void> _loadSupportContact() async {
    final token = Provider.of<AuthProvider>(context, listen: false).token;
    final contact = await SupportContact.load(token);
    if (!mounted) return;
    setState(() => _supportContact = contact);
  }

  Future<void> _goBack() async {
    Navigator.of(context).pop(_didUpdateOrder);
  }

  List<Map<String, dynamic>> get _items {
    final raw = (_order['items'] as List?) ?? const [];
    return raw.map((entry) => Map<String, dynamic>.from(entry as Map)).toList();
  }

  double get _deliveryFee => _toDouble(_order['delivery_fee']);
  double get _grandTotal => _toDouble(_order['total_amount']);
  double get _subtotal =>
      (_grandTotal - _deliveryFee).clamp(0, double.infinity);

  String get _statusKey =>
      OrderStatusStyle.normalize(_order['status'] ?? 'pending');

  String get _riderName {
    final direct = (_order['rider_name'] ?? '').toString().trim();
    if (direct.isNotEmpty) return direct;
    return '${_order['rider_first_name'] ?? ''} ${_order['rider_last_name'] ?? ''}'
        .trim();
  }

  String get _riderPhone => (_order['rider_phone'] ?? '').toString().trim();

  /// Expected arrival window. Only derived for "as soon as possible" orders,
  /// from the promise made at checkout ("ASAP (30-45 mins)").
  String get _etaWindow {
    final style = OrderStatusStyle.of(_order['status']);
    if (!style.isActive) return '';
    final pref = (_order['delivery_time'] ?? '')
        .toString()
        .trim()
        .toLowerCase();
    if (pref != 'asap') return '';
    final created = Fmt.parseDate(_order['created_at']);
    if (created == null) return '';
    final from = created.add(const Duration(minutes: 30));
    final to = created.add(const Duration(minutes: 45));
    if (DateTime.now().isAfter(to)) return '';
    return '${Fmt.time(from)} – ${Fmt.time(to)}';
  }

  Future<void> _contactSupport() async {
    var contact = _supportContact;
    if (contact == null || contact.isEmpty) {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      contact = await SupportContact.load(token, refresh: true);
      if (!mounted) return;
      setState(() => _supportContact = contact);
    }
    if (contact.isEmpty) {
      // Existing fallback: call the rider when no support contact exists.
      if (_riderPhone.isNotEmpty) {
        await SupportContact.dial(_riderPhone);
      }
      return;
    }
    if (!mounted) return;
    await showSupportContactSheet(
      context,
      contact: contact,
      isUrdu: _isUrdu,
      title: _tr('Contact Support'),
    );
  }

  // ---------------------------------------------------------------------------
  // Tracking
  // ---------------------------------------------------------------------------

  Widget _buildStepper() {
    final current = OrderStatusStyle.of(_order['status']);
    if (current.key == 'cancelled') {
      return Row(
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: const BoxDecoration(
              color: AppColors.dangerBg,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.close_rounded,
              size: 18,
              color: AppColors.danger,
            ),
          ),
          const SizedBox(width: AppSpace.md),
          Expanded(
            child: Text(
              _tr('This order was cancelled.'),
              style: AppText.bodyStrong.copyWith(color: AppColors.danger),
            ),
          ),
        ],
      );
    }

    // Collapse "Ready" and "Picked up" into the flow a customer cares about.
    const steps = [
      'pending',
      'confirmed',
      'preparing',
      'out_for_delivery',
      'delivered',
    ];
    final flowIndex = current.flowIndex;
    int reached;
    if (flowIndex < 0) {
      reached = 0;
    } else {
      final full = OrderStatusStyle.flow;
      reached = 0;
      for (var i = 0; i < steps.length; i++) {
        if (full.indexOf(steps[i]) <= flowIndex) reached = i;
      }
    }

    return Column(
      children: [
        for (var i = 0; i < steps.length; i++)
          _stepRow(
            style: OrderStatusStyle.of(steps[i]),
            done: i < reached || (i == reached && steps[i] == 'delivered'),
            active: i == reached && steps[i] != 'delivered',
            isLast: i == steps.length - 1,
            labelOverride: i == reached && steps[i] != current.key
                ? (_isUrdu ? current.urduLabel : current.label)
                : null,
          ),
      ],
    );
  }

  Widget _stepRow({
    required OrderStatusStyle style,
    required bool done,
    required bool active,
    required bool isLast,
    String? labelOverride,
  }) {
    final reached = done || active;
    final color = reached ? AppColors.primary : AppColors.borderStrong;
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 32,
            child: Column(
              children: [
                Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: done
                        ? AppColors.primary
                        : (active ? AppColors.tint100 : AppColors.surface),
                    shape: BoxShape.circle,
                    border: Border.all(color: color, width: 2),
                  ),
                  child: Icon(
                    done ? Icons.check_rounded : style.icon,
                    size: 15,
                    color: done
                        ? Colors.white
                        : (active ? AppColors.primaryPressed : AppColors.muted),
                  ),
                ),
                if (!isLast)
                  Expanded(
                    child: Container(
                      width: 2,
                      margin: const EdgeInsets.symmetric(vertical: 2),
                      color: done ? AppColors.primary : AppColors.border,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: AppSpace.md),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(top: 4, bottom: isLast ? 0 : 14),
              child: Text(
                labelOverride ?? (_isUrdu ? style.urduLabel : style.label),
                style: active
                    ? AppText.bodyStrong.copyWith(color: AppColors.primaryDeep)
                    : AppText.body.copyWith(
                        color: reached ? AppColors.text : AppColors.muted,
                      ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRiderCard() {
    final name = _riderName;
    final phone = _riderPhone;
    if (name.isEmpty && phone.isEmpty) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(top: AppSpace.md),
      padding: const EdgeInsets.all(AppSpace.md),
      decoration: BoxDecoration(
        color: AppColors.surface2,
        borderRadius: AppRadius.controlAll,
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: const BoxDecoration(
                  color: AppColors.tint100,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.delivery_dining_rounded,
                  color: AppColors.primaryPressed,
                ),
              ),
              const SizedBox(width: AppSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(_tr('Your rider'), style: AppText.caption),
                    Text(
                      name.isNotEmpty ? name : _tr('Rider'),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.title,
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (phone.isNotEmpty) ...[
            const SizedBox(height: AppSpace.md),
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => SupportContact.dial(phone),
                    icon: const Icon(Icons.call_rounded, size: 18),
                    label: Text(_tr('Call')),
                  ),
                ),
                const SizedBox(width: AppSpace.sm),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => SupportContact.openWhatsApp(phone),
                    icon: const Icon(Icons.chat_outlined, size: 18),
                    label: Text(_tr('WhatsApp')),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  /// Location line of the tracking sheet. It must agree with the status
  /// pill next to it: never "once the rider is on the way" while the pill
  /// already says "Out for delivery".
  String _trackingNote(String riderLocation, bool hasCoords) {
    if (riderLocation.isNotEmpty) return riderLocation;
    if (hasCoords) return _tr('Rider location is being shared.');
    switch (OrderStatusStyle.normalize(_order['status'])) {
      case 'picked_up':
      case 'out_for_delivery':
        return _tr(
          'Your rider is on the way. Live location is not available for this order.',
        );
      case 'delivered':
        return _tr('This order has been delivered.');
      case 'cancelled':
        return _tr('This order was cancelled.');
      default:
        return _tr('Live location appears here once the rider is on the way.');
    }
  }

  Future<void> _showTrackingSheet() async {
    final riderLocation = (_order['rider_location'] ?? '').toString().trim();
    final hasCoords =
        _toNullableDouble(_order['rider_latitude']) != null &&
        _toNullableDouble(_order['rider_longitude']) != null;
    final lastUpdated = Fmt.dateTime(
      _order['updated_at'] ?? _order['created_at'],
    );
    final eta = _etaWindow;

    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheetContext) {
        return LanguageScope(
          isUrdu: _isUrdu,
          child: SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(
                AppSpace.gutter,
                0,
                AppSpace.gutter,
                AppSpace.lg,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(_tr('Track Order'), style: AppText.h2),
                      ),
                      StatusPill(status: _order['status'], urdu: _isUrdu),
                    ],
                  ),
                  if (eta.isNotEmpty) ...[
                    const SizedBox(height: AppSpace.xs),
                    Text(
                      '${_tr('Expected')} ${Fmt.isolate(eta)}',
                      style: AppText.small,
                    ),
                  ],
                  const SizedBox(height: AppSpace.lg),
                  _buildStepper(),
                  _buildRiderCard(),
                  const SizedBox(height: AppSpace.md),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(
                        Icons.my_location_rounded,
                        size: 16,
                        color: AppColors.muted,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          _trackingNote(riderLocation, hasCoords),
                          style: AppText.caption,
                        ),
                      ),
                    ],
                  ),
                  if (lastUpdated.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      '${_tr('Last Updated')}: ${Fmt.isolate(lastUpdated)}',
                      style: AppText.caption,
                    ),
                  ],
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Page
  // ---------------------------------------------------------------------------

  Widget _section({required String title, required Widget child, Key? key}) {
    return AppCard(
      key: key,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(header: true, child: Text(title, style: AppText.title)),
          const SizedBox(height: AppSpace.md),
          child,
        ],
      ),
    );
  }

  Widget _buildHeader() {
    final eta = _etaWindow;
    final date = Fmt.dateTime(_order['created_at']);
    final storeName = (_order['store_name'] ?? '').toString().trim();
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (storeName.isNotEmpty)
                      Text(
                        storeName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.h2,
                      ),
                    Text(
                      Fmt.isolate(
                        Fmt.orderNumber(
                          _order['order_number'],
                          fallbackId: _order['id'],
                        ),
                      ),
                      style: AppText.small.copyWith(
                        fontFeatures: AppText.tabular,
                      ),
                    ),
                    if (date.isNotEmpty)
                      Text(Fmt.isolate(date), style: AppText.caption),
                  ],
                ),
              ),
              const SizedBox(width: AppSpace.sm),
              StatusPill(status: _order['status'], urdu: _isUrdu),
            ],
          ),
          if (eta.isNotEmpty) ...[
            const SizedBox(height: AppSpace.md),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpace.md,
                vertical: AppSpace.sm,
              ),
              decoration: const BoxDecoration(
                color: AppColors.tint50,
                borderRadius: AppRadius.controlAll,
              ),
              child: Row(
                children: [
                  const Icon(
                    Icons.schedule_rounded,
                    size: 18,
                    color: AppColors.primaryPressed,
                  ),
                  const SizedBox(width: AppSpace.sm),
                  Expanded(
                    child: Text(
                      '${_tr('Expected')} ${Fmt.isolate(eta)}',
                      style: AppText.bodyStrong.copyWith(
                        color: AppColors.primaryDeep,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildPaymentBlock() {
    if (_statusKey == 'cancelled') return const SizedBox.shrink();
    final method = _order['payment_method'];
    final isCash = Fmt.isCashPayment(method);
    final paymentStatus = (_order['payment_status'] ?? '')
        .toString()
        .trim()
        .toLowerCase();
    final isPaid = paymentStatus == 'paid';
    final methodLabel = _tr(
      Fmt.paymentMethod(method).isEmpty
          ? 'Cash on delivery'
          : Fmt.paymentMethod(method),
    );

    late final Color bg;
    late final Color fg;
    late final IconData icon;
    late final String title;
    late final String subtitle;
    if (isPaid) {
      bg = AppColors.successBg;
      fg = AppColors.success;
      icon = Icons.verified_rounded;
      title = _tr('PAID — nothing to pay');
      subtitle = methodLabel;
    } else if (isCash) {
      bg = AppColors.warningBg;
      fg = AppColors.warning;
      icon = Icons.payments_rounded;
      title = '${_tr('Pay rider')}: ${_money(_grandTotal)}';
      subtitle = _tr('Cash on delivery. Please keep change ready.');
    } else {
      bg = AppColors.infoBg;
      fg = AppColors.info;
      icon = Icons.hourglass_top_rounded;
      title = '${_tr('Payment pending')}: ${_money(_grandTotal)}';
      subtitle = methodLabel;
    }

    return Container(
      padding: const EdgeInsets.all(AppSpace.md),
      decoration: BoxDecoration(color: bg, borderRadius: AppRadius.cardAll),
      child: Row(
        children: [
          Icon(icon, color: fg, size: 28),
          const SizedBox(width: AppSpace.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: AppText.title.copyWith(
                    color: fg,
                    fontWeight: FontWeight.w800,
                    fontFeatures: AppText.tabular,
                  ),
                ),
                Text(subtitle, style: AppText.small.copyWith(color: fg)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _amountRow(String label, num value, {bool strong = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: strong ? AppText.title : AppText.bodySecondary,
            ),
          ),
          Text(
            _money(value),
            style: strong
                ? AppText.price.copyWith(fontSize: 17)
                : AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular),
          ),
        ],
      ),
    );
  }

  Widget _buildItems() {
    final items = _items;
    final children = <Widget>[];
    if (items.isEmpty) {
      children.add(
        Text(_tr('No items found for this order'), style: AppText.small),
      );
    }
    for (final item in items) {
      final qty = _toInt(item['quantity']);
      final price = _toDouble(item['price']);
      final label = Fmt.unit((item['variant_label'] ?? '').toString());
      final name = (item['product_name'] ?? _tr('Item')).toString();
      children.add(
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                constraints: const BoxConstraints(minWidth: 34),
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: const BoxDecoration(
                  color: AppColors.surface3,
                  borderRadius: AppRadius.smallAll,
                ),
                child: Text(
                  Fmt.isolate('${qty}x'),
                  textAlign: TextAlign.center,
                  style: AppText.label.copyWith(
                    color: AppColors.text,
                    fontFeatures: AppText.tabular,
                  ),
                ),
              ),
              const SizedBox(width: AppSpace.sm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, style: AppText.bodyStrong),
                    if (label.isNotEmpty)
                      Text(
                        _isUrdu ? Fmt.isolate(label) : label,
                        style: AppText.caption,
                      ),
                  ],
                ),
              ),
              const SizedBox(width: AppSpace.sm),
              Text(
                _money(qty * price),
                style: AppText.bodyStrong.copyWith(
                  fontFeatures: AppText.tabular,
                ),
              ),
            ],
          ),
        ),
      );
    }
    children
      ..add(const Divider(height: 20))
      ..add(_amountRow(_tr('Subtotal'), _subtotal))
      ..add(_amountRow(_tr('Delivery Fee'), _deliveryFee))
      ..add(const SizedBox(height: 4))
      ..add(_amountRow(_tr('Total'), _grandTotal, strong: true));
    return _section(
      title: _tr('Order Summary'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: children,
      ),
    );
  }

  Widget _buildDeliveryInfo() {
    final deliveryTime = Fmt.deliveryTime(_order['delivery_time']);
    final address = (_order['delivery_address'] ?? '').toString().trim();
    final specialInstructions = (_order['special_instructions'] ?? '')
        .toString()
        .trim();
    final payment = Fmt.paymentMethod(_order['payment_method']);

    Widget line(IconData icon, String label, String value) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 18, color: AppColors.muted),
            const SizedBox(width: AppSpace.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: AppText.caption),
                  Text(value, style: AppText.bodyStrong),
                ],
              ),
            ),
          ],
        ),
      );
    }

    return _section(
      title: _tr('Delivery Information'),
      child: Column(
        children: [
          line(
            Icons.person_outline_rounded,
            _tr('Deliver to'),
            widget.userName.isNotEmpty ? widget.userName : _tr('Customer'),
          ),
          if (address.isNotEmpty)
            line(Icons.location_on_outlined, _tr('Address'), address),
          if (deliveryTime.isNotEmpty)
            line(
              Icons.schedule_rounded,
              _tr('Preferred Time'),
              _tr(deliveryTime),
            ),
          if (payment.isNotEmpty)
            line(Icons.payments_outlined, _tr('Payment'), _tr(payment)),
          if (specialInstructions.isNotEmpty)
            line(
              Icons.sticky_note_2_outlined,
              _tr('Instructions'),
              specialInstructions,
            ),
        ],
      ),
    );
  }

  Widget _buildActions() {
    final status = OrderStatusStyle.of(_order['status']);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        PrimaryButton(
          label: _tr('Track Order'),
          icon: Icons.near_me_outlined,
          onPressed: _showTrackingSheet,
        ),
        const SizedBox(height: AppSpace.sm),
        SizedBox(
          height: 52,
          child: OutlinedButton.icon(
            onPressed: _contactSupport,
            icon: const Icon(Icons.support_agent_rounded),
            label: Text(_tr('Contact Support')),
          ),
        ),
        const SizedBox(height: AppSpace.sm),
        if (_canCancel)
          TextButton.icon(
            style: TextButton.styleFrom(foregroundColor: AppColors.danger),
            onPressed: _isCancelling ? null : _confirmCancel,
            icon: _isCancelling
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.cancel_outlined),
            label: Text(_tr('Cancel Order')),
          )
        else if (status.isActive)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpace.sm),
            child: Text(
              _tr(
                'This order can no longer be cancelled because it is on its way. Contact support if you need help.',
              ),
              textAlign: TextAlign.center,
              style: AppText.caption,
            ),
          ),
      ],
    );
  }

  Future<void> _confirmCancel() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => LanguageScope(
        isUrdu: _isUrdu,
        child: AlertDialog(
          title: Text(_tr('Cancel this order?')),
          content: Text(_tr('The store will be told not to prepare it.')),
          actions: [
            TextButton(
              style: TextButton.styleFrom(foregroundColor: AppColors.text2),
              onPressed: () => Navigator.of(ctx).pop(false),
              child: Text(_tr('Keep order')),
            ),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
              onPressed: () => Navigator.of(ctx).pop(true),
              child: Text(_tr('Cancel Order')),
            ),
          ],
        ),
      ),
    );
    if (confirm == true) await _cancelOrder();
  }

  @override
  Widget build(BuildContext context) {
    final status = OrderStatusStyle.of(_order['status']);
    return LanguageScope(
      isUrdu: _isUrdu,
      child: PopScope<bool>(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) {
          if (!didPop) _goBack();
        },
        child: Scaffold(
          appBar: AppBar(
            leading: IconButton(
              tooltip: MaterialLocalizations.of(context).backButtonTooltip,
              icon: const BackButtonIcon(),
              onPressed: _goBack,
            ),
            title: Text(_tr('Order Details')),
          ),
          body: RefreshIndicator(
            onRefresh: () => _refreshOrderDetails(),
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.fromLTRB(
                AppSpace.gutter,
                AppSpace.md,
                AppSpace.gutter,
                AppSpace.xxxl,
              ),
              children: [
                Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 620),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        _buildHeader(),
                        const SizedBox(height: AppSpace.md),
                        _buildPaymentBlock(),
                        if (_statusKey != 'cancelled')
                          const SizedBox(height: AppSpace.md),
                        _section(
                          key: _trackingKey,
                          title: status.key == 'delivered'
                              ? _tr('Delivered')
                              : _tr('Order progress'),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              _buildStepper(),
                              if (status.isActive) _buildRiderCard(),
                            ],
                          ),
                        ),
                        const SizedBox(height: AppSpace.md),
                        _buildItems(),
                        const SizedBox(height: AppSpace.md),
                        _buildDeliveryInfo(),
                        const SizedBox(height: AppSpace.lg),
                        _buildActions(),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  bool _isClosedStatus(String status) {
    return status == 'delivered' || status == 'cancelled';
  }

  int? _toNullableInt(dynamic value) {
    if (value == null) return null;
    if (value is int) return value;
    if (value is double) return value.round();
    return int.tryParse(value.toString());
  }

  double? _toNullableDouble(dynamic value) {
    if (value == null) return null;
    if (value is num) return value.toDouble();
    return double.tryParse(value.toString());
  }

  int _toInt(dynamic value) {
    if (value is int) return value;
    if (value is double) return value.round();
    return int.tryParse(value.toString()) ?? 0;
  }

  double _toDouble(dynamic value) {
    if (value is num) return value.toDouble();
    return double.tryParse(value.toString()) ?? 0;
  }

  @override
  void dispose() {
    Provider.of<NotificationProvider>(
      context,
      listen: false,
    ).removeEventListener(this);
    super.dispose();
  }
}
