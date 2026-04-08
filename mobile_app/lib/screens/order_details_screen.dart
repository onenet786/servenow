import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../theme/customer_palette.dart';
import '../utils/customer_language.dart';

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
  Map<String, dynamic>? _supportContact;
  bool _isCancelling = false;
  bool _didUpdateOrder = false;

  @override
  void initState() {
    super.initState();
    _order = Map<String, dynamic>.from(widget.order);
    _loadSupportContact();
  }

  String _tr(String text) => CustomerLanguage.tr(widget.isUrdu, text);

  Future<void> _loadSupportContact() async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null || token.trim().isEmpty) return;
      final support = await ApiService.getCustomerSupportContact(token);
      if (!mounted) return;
      setState(() => _supportContact = support);
    } catch (_) {}
  }

  Future<void> _goBack() async {
    Navigator.of(context).pop(_didUpdateOrder);
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
      queryParameters: {'subject': 'ServeNow Support'},
    );
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    }
  }

  List<Map<String, dynamic>> get _items {
    final raw = (_order['items'] as List?) ?? const [];
    return raw.map((entry) => Map<String, dynamic>.from(entry as Map)).toList();
  }

  double get _deliveryFee => _toDouble(_order['delivery_fee']);
  double get _grandTotal => _toDouble(_order['total_amount']);
  double get _subtotal => (_grandTotal - _deliveryFee).clamp(0, double.infinity);

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
        SnackBar(content: Text('${_tr('Failed to cancel order')}: $e')),
      );
    } finally {
      if (mounted) setState(() => _isCancelling = false);
    }
  }

  Future<void> _showTrackingSheet() async {
    final status = (_order['status'] ?? 'pending').toString();
    final riderLocation = (_order['rider_location'] ?? '').toString().trim();
    final deliveryTime = (_order['delivery_time'] ?? '').toString().trim();

    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(18, 6, 18, 18),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _tr('Track Order'),
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 10),
                _infoRow(_tr('Status'), _formatStatus(status)),
                if (deliveryTime.isNotEmpty)
                  _infoRow(_tr('Preferred Time'), deliveryTime),
                _infoRow(
                  _tr('Rider Location'),
                  riderLocation.isNotEmpty
                      ? riderLocation
                      : _tr('Live rider location is not available yet.'),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _contactSupport() async {
    final support = _supportContact ?? const <String, dynamic>{};
    final phone = (support['phone'] ?? '').toString().trim();
    final whatsapp = (support['whatsapp'] ?? phone).toString().trim();
    final email = (support['email'] ?? '').toString().trim();
    if (phone.isEmpty && whatsapp.isEmpty && email.isEmpty) {
      final fallbackPhone = (_order['store_phone'] ?? _order['rider_phone'] ?? '')
          .toString()
          .trim();
      if (fallbackPhone.isNotEmpty) {
        await _makeCall(fallbackPhone);
      }
      return;
    }

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
                  _tr('Contact Support'),
                  style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
                ),
                const SizedBox(height: 10),
                if (phone.isNotEmpty)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: const Icon(Icons.call_outlined),
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
                    leading: const Icon(Icons.chat_outlined),
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
                    leading: const Icon(Icons.email_outlined),
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

  Widget _buildBackdrop() {
    return Stack(
      children: [
        Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                Color(0xFFFFF6EA),
                Color(0xFFF7D4B7),
                Color(0xFFF4C29B),
              ],
            ),
          ),
        ),
        Positioned(
          left: -80,
          top: 90,
          child: _orb(220, const [Color(0xFFFFD58A), Color(0x00FFD58A)]),
        ),
        Positioned(
          right: -80,
          bottom: 50,
          child: _orb(280, const [Color(0xFFF0A35B), Color(0x00F0A35B)]),
        ),
      ],
    );
  }

  Widget _orb(double size, List<Color> colors) {
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

  @override
  Widget build(BuildContext context) {
    final status = (_order['status'] ?? 'pending').toString();
    final deliveryTime = (_order['delivery_time'] ?? '').toString().trim();
    final address = (_order['delivery_address'] ?? '').toString().trim();
    final specialInstructions =
        (_order['special_instructions'] ?? '').toString().trim();

    return Directionality(
      textDirection: CustomerLanguage.textDirection(widget.isUrdu),
      child: Scaffold(
        backgroundColor: Colors.transparent,
        body: Stack(
          children: [
            _buildBackdrop(),
            SafeArea(
              child: SingleChildScrollView(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                child: Center(
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 620),
                    child: Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(36),
                        color: Colors.white.withValues(alpha: 0.78),
                        border: Border.all(
                          color: Colors.white.withValues(alpha: 0.7),
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.12),
                            blurRadius: 26,
                            offset: const Offset(0, 18),
                          ),
                        ],
                      ),
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 14, 16, 20),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                Container(
                                  decoration: BoxDecoration(
                                    color: Colors.white,
                                    borderRadius: BorderRadius.circular(16),
                                  ),
                                  child: IconButton(
                                    onPressed: _goBack,
                                    icon: const Icon(Icons.arrow_back_rounded),
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 10),
                            Center(
                              child: Column(
                                children: [
                                  Image.asset(
                                    'assets/icon/servenow_brand_logo.png',
                                    height: 90,
                                    fit: BoxFit.contain,
                                  ),
                                  const SizedBox(height: 12),
                                  Text(
                                    _tr('Order Details'),
                                    style: const TextStyle(
                                      fontSize: 32,
                                      fontWeight: FontWeight.w900,
                                      color: CustomerPalette.textDark,
                                    ),
                                  ),
                                  const SizedBox(height: 8),
                                  _statusPill(status),
                                ],
                              ),
                            ),
                            const SizedBox(height: 18),
                            _card(
                              title: _tr('Order Summary'),
                              child: Column(
                                children: [
                                  ..._items.map((item) {
                                    final qty = _toInt(item['quantity']);
                                    final price = _toDouble(item['price']);
                                    final label = (item['variant_label'] ?? '')
                                        .toString()
                                        .trim();
                                    return Padding(
                                      padding: const EdgeInsets.only(bottom: 10),
                                      child: Row(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Expanded(
                                            child: Text(
                                              '$qty x ${item['product_name'] ?? _tr('Items')}${label.isNotEmpty ? ' ($label)' : ''}',
                                              style: const TextStyle(
                                                fontSize: 16,
                                                fontWeight: FontWeight.w600,
                                              ),
                                            ),
                                          ),
                                          const SizedBox(width: 10),
                                          Text(
                                            _formatPkr(qty * price),
                                            style: const TextStyle(
                                              fontSize: 16,
                                              fontWeight: FontWeight.w700,
                                            ),
                                          ),
                                        ],
                                      ),
                                    );
                                  }),
                                  const Divider(height: 24),
                                  _summaryRow(_tr('Subtotal'), _formatPkr(_subtotal)),
                                  _summaryRow(_tr('Delivery Fee'), _formatPkr(_deliveryFee)),
                                  _summaryRow(
                                    _tr('Total'),
                                    _formatPkr(_grandTotal),
                                    highlight: true,
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(height: 14),
                            _card(
                              title: _tr('Delivery Information'),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  _infoRow(
                                    _tr('Order'),
                                    (_order['order_number'] ?? '').toString(),
                                  ),
                                  if (deliveryTime.isNotEmpty)
                                    _infoRow(_tr('Preferred Time'), deliveryTime),
                                  if (address.isNotEmpty)
                                    _infoRow(_tr('Address'), address),
                                  if (specialInstructions.isNotEmpty)
                                    _infoRow(
                                      _tr('Instructions'),
                                      specialInstructions,
                                    ),
                                  const SizedBox(height: 12),
                                  Container(
                                    padding: const EdgeInsets.all(14),
                                    decoration: BoxDecoration(
                                      color: const Color(0xFFFFF3E0),
                                      borderRadius: BorderRadius.circular(18),
                                    ),
                                    child: Row(
                                      children: [
                                        Container(
                                          width: 72,
                                          height: 72,
                                          decoration: BoxDecoration(
                                            color: Colors.white,
                                            borderRadius: BorderRadius.circular(16),
                                          ),
                                          child: const Icon(
                                            Icons.map_outlined,
                                            size: 34,
                                            color: CustomerPalette.primaryDark,
                                          ),
                                        ),
                                        const SizedBox(width: 12),
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                widget.userName,
                                                style: const TextStyle(
                                                  fontSize: 18,
                                                  fontWeight: FontWeight.w800,
                                                ),
                                              ),
                                              const SizedBox(height: 4),
                                              Text(
                                                address.isNotEmpty
                                                    ? address
                                                    : _tr('Delivery address will appear here'),
                                                style: const TextStyle(
                                                  color: Colors.black54,
                                                  fontWeight: FontWeight.w600,
                                                  height: 1.3,
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                      ],
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(height: 20),
                            SizedBox(
                              width: double.infinity,
                              child: FilledButton(
                                onPressed: _showTrackingSheet,
                                style: FilledButton.styleFrom(
                                  backgroundColor: CustomerPalette.primary,
                                  foregroundColor: Colors.white,
                                  padding:
                                      const EdgeInsets.symmetric(vertical: 18),
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(999),
                                  ),
                                ),
                                child: Text(
                                  _tr('Track Order'),
                                  style: const TextStyle(
                                    fontSize: 18,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(height: 12),
                            Wrap(
                              alignment: WrapAlignment.center,
                              spacing: 10,
                              runSpacing: 10,
                              children: [
                                TextButton(
                                  onPressed: _canCancel ? _cancelOrder : null,
                                  child: _isCancelling
                                      ? const SizedBox(
                                          width: 16,
                                          height: 16,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                          ),
                                        )
                                      : Text(_tr('Cancel Order')),
                                ),
                                TextButton(
                                  onPressed: () => _makeCall(
                                    (_order['store_phone'] ?? _order['rider_phone'] ?? '')
                                        .toString(),
                                  ),
                                  child: Text(_tr('Call Store')),
                                ),
                                TextButton(
                                  onPressed: _contactSupport,
                                  child: Text(_tr('Contact Support')),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _card({
    required String title,
    required Widget child,
  }) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 16,
            offset: const Offset(0, 10),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 14),
          child,
        ],
      ),
    );
  }

  Widget _statusPill(String status) {
    final normalized = status.toLowerCase();
    final color = normalized == 'delivered'
        ? Colors.green
        : normalized == 'cancelled'
            ? Colors.red
            : CustomerPalette.primaryDark;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        _formatStatus(status),
        style: TextStyle(
          color: color,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }

  Widget _summaryRow(String label, String value, {bool highlight = false}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontSize: highlight ? 18 : 16,
                fontWeight: highlight ? FontWeight.w900 : FontWeight.w700,
              ),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: highlight ? 18 : 16,
              fontWeight: highlight ? FontWeight.w900 : FontWeight.w700,
              color: highlight ? CustomerPalette.primaryDark : Colors.black87,
            ),
          ),
        ],
      ),
    );
  }

  Widget _infoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(
              '$label:',
              style: const TextStyle(
                color: Colors.black54,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                height: 1.3,
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _formatStatus(String status) {
    return _tr(status.toUpperCase().replaceAll('_', ' '));
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

  String _formatPkr(num value) {
    final amount = value.toDouble();
    if (amount == amount.roundToDouble()) {
      return 'PKR ${amount.toInt()}';
    }
    return 'PKR ${amount.toStringAsFixed(2)}';
  }
}
