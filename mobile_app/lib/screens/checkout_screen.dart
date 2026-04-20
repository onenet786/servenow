import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../models/cart_item.dart';
import '../providers/wallet_provider.dart';
import '../services/api_service.dart';
import 'package:servenow/services/notifier.dart';
import '../theme/customer_palette.dart';
import '../utils/customer_language.dart';

class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key});

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  static const double _defaultDeliveryFeeBase = 70;
  static const double _defaultDeliveryFeeAdditional = 30;

  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _addressController = TextEditingController();
  final _instructionsController = TextEditingController();
  String _paymentMethod = 'cash';
  String? _selectedDeliveryTime = 'asap';
  bool _isLoading = false;
  bool _isDeliveryFeeConfigLoading = true;
  double? _walletBalance;
  bool _isUrdu = false;
  double _deliveryFeeBase = _defaultDeliveryFeeBase;
  double _deliveryFeeAdditional = _defaultDeliveryFeeAdditional;

  @override
  void initState() {
    super.initState();
    _loadLanguagePreference();
    _loadDeliveryFeeConfig();
    final user = Provider.of<AuthProvider>(context, listen: false).user;
    if (user != null) {
      _nameController.text = '${user.firstName} ${user.lastName}'.trim();
      if (user.phone != null) {
        _phoneController.text = user.phone!;
      }
      if (user.address != null) {
        _addressController.text = user.address!;
      }
    }
    _loadWalletBalance();
  }

  Future<void> _loadLanguagePreference() async {
    final isUrdu = await CustomerLanguage.loadIsUrdu();
    if (!mounted) return;
    setState(() => _isUrdu = isUrdu);
  }

  String _tr(String text) => CustomerLanguage.tr(_isUrdu, text);

  OutlineInputBorder _fieldBorder([Color? color]) {
    return OutlineInputBorder(
      borderRadius: BorderRadius.circular(16),
      borderSide: BorderSide(
        color: color ?? CustomerPalette.primary.withValues(alpha: 0.18),
      ),
    );
  }

  Widget _sectionCard({required Widget child}) {
    return Card(
      elevation: 2,
      color: Colors.white.withValues(alpha: 0.98),
      shadowColor: CustomerPalette.primaryDark.withValues(alpha: 0.12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: child,
      ),
    );
  }

  Future<void> _promptGuestRegistration() async {
    final shouldRegister = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(_tr('Register Required')),
        content: Text(
          _tr(
            'You are using guest mode. Please register your account before placing an order.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(_tr('Cancel')),
          ),
          ElevatedButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: Text(_tr('Register')),
          ),
        ],
      ),
    );

    if (shouldRegister == true && mounted) {
      Navigator.of(context).pushNamed('/register');
    }
  }

  Future<void> _loadDeliveryFeeConfig() async {
    try {
      final data = await ApiService.getDeliveryFeeConfig();
      final base = _parseAmount(data['base_fee']);
      final additional = _parseAmount(data['additional_per_store']);
      if (!mounted) return;
      setState(() {
        if (base != null && base >= 0) {
          _deliveryFeeBase = base;
        }
        if (additional != null && additional >= 0) {
          _deliveryFeeAdditional = additional;
        }
        _isDeliveryFeeConfigLoading = false;
      });
    } catch (e) {
      debugPrint('Error loading delivery fee config: $e');
      if (!mounted) return;
      setState(() {
        _isDeliveryFeeConfigLoading = false;
      });
    }
  }

  double? _parseAmount(dynamic value) {
    if (value is num) return value.toDouble();
    return double.tryParse(value?.toString() ?? '');
  }

  int _getStoreCount(CartProvider cart) {
    return cart.items
        .map((item) => item.product.storeId ?? item.product.storeName ?? item.product.id)
        .toSet()
        .length;
  }

  double _calculateDeliveryFee(int storeCount) {
    if (storeCount <= 0) return 0;
    return _deliveryFeeBase + ((storeCount - 1) * _deliveryFeeAdditional);
  }

  double _calculateGrandTotal(CartProvider cart) {
    return cart.totalAmount + _calculateDeliveryFee(_getStoreCount(cart));
  }

  Future<void> _loadWalletBalance() async {
    try {
      final auth = Provider.of<AuthProvider>(context, listen: false);
      final wallet = Provider.of<WalletProvider>(context, listen: false);

      if (auth.token != null) {
        await wallet.loadWalletBalance(auth.token!);
        if (wallet.wallet != null) {
          setState(() {
            _walletBalance = wallet.wallet!.balance;
          });
        }
      }
    } catch (e) {
      debugPrint('Error loading wallet balance: $e');
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _addressController.dispose();
    _instructionsController.dispose();
    super.dispose();
  }

  Widget _buildPaymentOption({
    required String title,
    required String value,
    required IconData icon,
    String? subtitle,
  }) {
    final isSelected = _paymentMethod == value;
    return InkWell(
      onTap: () => setState(() => _paymentMethod = value),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          border: Border.all(
            color:
                isSelected
                    ? CustomerPalette.secondary
                    : CustomerPalette.border,
            width: isSelected ? 2 : 1,
          ),
          color: isSelected
              ? CustomerPalette.secondary.withValues(alpha: 0.1)
              : Colors.white.withValues(alpha: 0.92),
        ),
        child: Row(
          children: [
            Icon(
              icon,
              color:
                  isSelected
                      ? CustomerPalette.secondaryDark
                      : CustomerPalette.textDark,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _tr(title),
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color:
                          isSelected
                              ? CustomerPalette.secondaryDark
                              : CustomerPalette.textDark,
                    ),
                  ),
                  if (subtitle != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        _tr(subtitle),
                        style: const TextStyle(
                          fontSize: 12,
                          color: CustomerPalette.textMuted,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            Radio<String>(
              value: value,
              activeColor: CustomerPalette.secondary,
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
          ],
        ),
      ),
    );
  }

  bool _checkIsOpen(dynamic openTimeStr, dynamic closeTimeStr) {
    if (openTimeStr == null || closeTimeStr == null) return false;

    try {
      final now = DateTime.now();
      final currentTime = TimeOfDay.fromDateTime(now);

      TimeOfDay parseTime(String timeStr) {
        final parts = timeStr.split(':');
        return TimeOfDay(
          hour: int.parse(parts[0]),
          minute: int.parse(parts[1]),
        );
      }

      final openTime = parseTime(openTimeStr.toString());
      final closeTime = parseTime(closeTimeStr.toString());

      final double nowDouble = currentTime.hour + currentTime.minute / 60.0;
      final double openDouble = openTime.hour + openTime.minute / 60.0;
      final double closeDouble = closeTime.hour + closeTime.minute / 60.0;

      if (openDouble <= closeDouble) {
        return nowDouble >= openDouble && nowDouble <= closeDouble;
      } else {
        // Handle overnight hours (e.g., 22:00 - 04:00)
        return nowDouble >= openDouble || nowDouble <= closeDouble;
      }
    } catch (e) {
      return false;
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

  bool _isWindowActive(Map<String, dynamic> status) {
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

  bool _isGlobalOrderingBlocked(Map<String, dynamic> status) {
    final enabled = _toBool(status['is_enabled']);
    if (!enabled) return false;
    if (_toBool(status['block_ordering_active'])) return true;
    final blockOrdering = _toBool(status['block_ordering']);
    return blockOrdering && _isWindowActive(status);
  }

  String _formatDeliveryWindow(dynamic startRaw, dynamic endRaw) {
    final start = DateTime.tryParse((startRaw ?? '').toString());
    final end = DateTime.tryParse((endRaw ?? '').toString());
    if (start == null || end == null) return '';
    final startLocal = start.toLocal();
    final endLocal = end.toLocal();
    return '${startLocal.toString().substring(0, 16)} - ${endLocal.toString().substring(0, 16)}';
  }

  Future<void> _submitOrder() async {
    if (!_formKey.currentState!.validate()) return;

    final cart = Provider.of<CartProvider>(context, listen: false);
    final auth = Provider.of<AuthProvider>(context, listen: false);

    if (cart.items.isEmpty) return;
    if (auth.isGuest) {
      await _promptGuestRegistration();
      return;
    }

    final grandTotal = _calculateGrandTotal(cart);

    setState(() {
      _isLoading = true;
    });

    // Check if website-wide delivery status blocks ordering
    try {
      if (auth.token != null) {
        final data = await ApiService.getGlobalDeliveryStatus(auth.token!);
        final status = (data['status'] is Map<String, dynamic>)
            ? (data['status'] as Map<String, dynamic>)
            : (data['global_status'] is Map<String, dynamic>)
                ? (data['global_status'] as Map<String, dynamic>)
                : data;

        if (_isGlobalOrderingBlocked(status)) {
          final title = (status['title'] ?? '').toString().trim();
          final message = (status['status_message'] ?? '').toString().trim();
          final when = _formatDeliveryWindow(status['start_at'], status['end_at']);
          final displayMessage = message.isNotEmpty
              ? (when.isNotEmpty ? '$message ($when)' : message)
              : (title.isNotEmpty
                    ? (when.isNotEmpty ? '$title ($when)' : title)
                    : _tr('Ordering is temporarily unavailable.'));
          if (!mounted) return;
          setState(() {
            _isLoading = false;
          });
          Notifier.error(
            context,
            displayMessage,
            duration: const Duration(seconds: 4),
            sanitize: false,
          );
          return;
        }
      }
    } catch (e) {
      debugPrint('Error checking global delivery status: $e');
    }

    // Check if stores are open
    try {
      final uniqueStoreIds = cart.items
          .map((e) => e.product.storeId)
          .whereType<int>()
          .toSet();

      for (final storeId in uniqueStoreIds) {
        final data = await ApiService.getStoreDetails(storeId);
        if (data['success'] == true) {
          final store = data['store'];
          final bool isOpen = store['is_open'] == true || store['is_open'] == 1;
          if (!isOpen || !_checkIsOpen(store['opening_time'], store['closing_time'])) {
            final reason = (store['status_message'] ?? '').toString().trim();
            if (!mounted) return;
            setState(() {
              _isLoading = false;
            });
            Notifier.error(
              context,
              reason.isNotEmpty
                  ? '${_tr('Store')}: "${store['name']}" ${_tr('Closed')}. $reason'
                  : '${_tr('Store')}: "${store['name']}" ${_tr('This store is currently closed. You cannot place orders at this time.')}',
              duration: const Duration(seconds: 4),
              sanitize: false,
            );
            Navigator.of(
              context,
            ).pushNamedAndRemoveUntil('/home', (route) => false);
            return;
          }
        }
      }
    } catch (e) {
      debugPrint('Error checking store status: $e');
    }

    if (_paymentMethod == 'wallet' && _walletBalance != null) {
      if (_walletBalance! < grandTotal) {
        if (!mounted) return;
        Notifier.error(
          context,
          '${_tr('Insufficient wallet balance. Need')} ${_tr('PKR')} ${(grandTotal - _walletBalance!).toStringAsFixed(2)} ${_tr('more.')}',
          sanitize: false,
        );
        return;
      }
    }

    setState(() {
      _isLoading = true;
    });

    try {
      final List<Map<String, dynamic>> orderItems = [];

      for (var item in cart.items) {
        final payload = <String, dynamic>{
          'product_id': item.product.id,
          'quantity': item.quantity,
        };
        if (item.variant?.sizeId != null) {
          payload['size_id'] = item.variant!.sizeId;
        }
        if (item.variant?.unitId != null) {
          payload['unit_id'] = item.variant!.unitId;
        }
        if (item.variantLabel != null) {
          payload['variant_label'] = item.variantLabel;
        }
        orderItems.add(payload);
      }

      String combinedInstructions = _instructionsController.text;
      if (_nameController.text.isNotEmpty || _phoneController.text.isNotEmpty) {
        String contactInfo =
            'Contact: ${_nameController.text} (${_phoneController.text})';
        combinedInstructions = combinedInstructions.isEmpty
            ? contactInfo
            : '$contactInfo\n$combinedInstructions';
      }

      await ApiService.createOrder(
        auth.token!,
        storeId: null, // Let backend handle store splitting
        items: orderItems,
        deliveryAddress: _addressController.text,
        paymentMethod: _paymentMethod,
        deliveryTime: _selectedDeliveryTime,
        specialInstructions: combinedInstructions.isNotEmpty
            ? combinedInstructions
            : null,
      );

      // Clear cart
      cart.clear();

      if (!mounted) return;

      // Show success toast and redirect
      Notifier.success(
        context,
        'Your order has been successfully placed.',
        duration: const Duration(seconds: 3),
      );
      Navigator.of(
        context,
      ).pushNamedAndRemoveUntil('/orders', (route) => false);
    } catch (e) {
      if (!mounted) return;
      if (auth.sessionExpired) return;
      Notifier.error(context, '${_tr('Failed to place order')}: $e');
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
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
                Color(0xFFFFF6EC),
                Color(0xFFFFD8B5),
                Color(0xFFF7B070),
              ],
            ),
          ),
        ),
        Positioned(
          left: -80,
          top: 70,
          child: _buildBlurOrb(
            size: 220,
            colors: const [Color(0x66F2B134), Color(0x00F2B134)],
          ),
        ),
        Positioned(
          right: -40,
          top: 130,
          child: _buildBlurOrb(
            size: 180,
            colors: const [Color(0x55147D7E), Color(0x00147D7E)],
          ),
        ),
        Positioned(
          right: -100,
          bottom: 30,
          child: _buildBlurOrb(
            size: 280,
            colors: const [Color(0x55C9475B), Color(0x00C9475B)],
          ),
        ),
      ],
    );
  }

  Widget _buildBlurOrb({
    required double size,
    required List<Color> colors,
  }) {
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
    final cart = Provider.of<CartProvider>(context);

    if (cart.items.isEmpty) {
      return Directionality(
        textDirection: CustomerLanguage.textDirection(_isUrdu),
        child: Scaffold(
          backgroundColor: const Color(0xFFFFF6EC),
          appBar: AppBar(
            backgroundColor: const Color(0xFFFFF6EC),
            elevation: 0,
            scrolledUnderElevation: 0,
            surfaceTintColor: Colors.transparent,
            foregroundColor: CustomerPalette.textDark,
            title: Text(
              _tr('Checkout'),
              style: const TextStyle(
                fontWeight: FontWeight.w800,
                color: CustomerPalette.textDark,
              ),
            ),
          ),
          body: Center(child: Text(_tr('Your cart is empty'))),
        ),
      );
    }

    return Directionality(
      textDirection: CustomerLanguage.textDirection(_isUrdu),
      child: Scaffold(
      backgroundColor: const Color(0xFFFFF6EC),
      appBar: AppBar(
        backgroundColor: const Color(0xFFFFF6EC),
        elevation: 0,
        scrolledUnderElevation: 0,
        surfaceTintColor: Colors.transparent,
        foregroundColor: CustomerPalette.textDark,
        title: Row(
          children: [
            const Icon(
              Icons.shopping_cart_outlined,
              size: 22,
              color: CustomerPalette.textDark,
            ),
            const SizedBox(width: 10),
            Text(
              _tr('Checkout'),
              style: const TextStyle(
                fontWeight: FontWeight.w800,
                color: CustomerPalette.textDark,
              ),
            ),
          ],
        ),
      ),
      resizeToAvoidBottomInset: true,
      body: Stack(
        children: [
          _buildBackdrop(),
          (_isLoading || _isDeliveryFeeConfigLoading)
          ? const Center(child: CircularProgressIndicator())
          : SafeArea(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final isWide = constraints.maxWidth >= 760;
                  final sidePadding = isWide
                      ? (constraints.maxWidth - 620) / 2
                      : 0.0;

                  final content = Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Selector<AuthProvider, bool>(
                          selector: (_, auth) => auth.isGuest,
                          builder: (context, isGuest, child) {
                            if (!isGuest) return const SizedBox.shrink();
                            return Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: Container(
                                width: double.infinity,
                                padding: const EdgeInsets.all(14),
                                decoration: BoxDecoration(
                                  color: Colors.orange.shade50,
                                  borderRadius: BorderRadius.circular(12),
                                  border: Border.all(
                                    color: Colors.orange.shade200,
                                  ),
                                ),
                                child: Row(
                                  children: [
                                    Icon(
                                      Icons.info_outline,
                                      color: Colors.orange.shade800,
                                    ),
                                    const SizedBox(width: 10),
                                    Expanded(
                                      child: Text(
                                        _tr(
                                          'Guest mode is for browsing only. Register to place your order.',
                                        ),
                                        style: TextStyle(
                                          color: Colors.orange.shade900,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ),
                                    TextButton(
                                      onPressed: _promptGuestRegistration,
                                      child: Text(_tr('Register')),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                        // Order Summary Card
                        _sectionCard(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    const Icon(Icons.receipt_long, size: 20),
                                    const SizedBox(width: 8),
                                    Text(
                                      _tr('Order Summary'),
                                      style: TextStyle(
                                        fontSize: 18,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 12),
                                Builder(
                                  builder: (context) {
                                    final Map<String, List<CartItem>>
                                    itemsByStore = {};
                                    for (var item in cart.items) {
                                      final store =
                                          item.product.storeName ??
                                          _tr('Unknown Store');
                                      if (!itemsByStore.containsKey(store)) {
                                        itemsByStore[store] = [];
                                      }
                                      itemsByStore[store]!.add(item);
                                    }

                                    final numStores = itemsByStore.length;
                                    final deliveryFee =
                                        _calculateDeliveryFee(numStores);
                                    double grandTotal =
                                        cart.totalAmount + deliveryFee;

                                    List<Widget> allChildren = [];

                                    for (var entry in itemsByStore.entries) {
                                      double storeSubtotal = entry.value.fold(
                                        0.0,
                                        (sum, item) => sum + item.total,
                                      );

                                      allChildren.add(
                                        Padding(
                                          padding: const EdgeInsets.only(
                                            top: 8.0,
                                            bottom: 8.0,
                                          ),
                                          child: Container(
                                            width: double.infinity,
                                            padding: const EdgeInsets.all(8),
                                            decoration: BoxDecoration(
                                              color: Theme.of(context)
                                                  .primaryColor
                                                  .withAlpha(
                                                    (0.15 * 255).round(),
                                                  ),
                                              borderRadius:
                                                  BorderRadius.circular(4),
                                              border: Border(
                                                left: BorderSide(
                                                  color: Theme.of(
                                                    context,
                                                  ).primaryColor,
                                                  width: 3,
                                                ),
                                              ),
                                            ),
                                            child: Text(
                                              entry.key,
                                              style: TextStyle(
                                                fontWeight: FontWeight.bold,
                                                fontSize: 14,
                                                color: Theme.of(
                                                  context,
                                                ).primaryColor,
                                              ),
                                            ),
                                          ),
                                        ),
                                      );

                                      for (var item in entry.value) {
                                        allChildren.add(
                                          Padding(
                                            padding: const EdgeInsets.symmetric(
                                              vertical: 6.0,
                                            ),
                                            child: Row(
                                              crossAxisAlignment:
                                                  CrossAxisAlignment.start,
                                              children: [
                                                Expanded(
                                                  child: Column(
                                                    crossAxisAlignment:
                                                        CrossAxisAlignment
                                                            .start,
                                                    children: [
                                                      Text(
                                                        item.product.name,
                                                        style: const TextStyle(
                                                          fontWeight:
                                                              FontWeight.w500,
                                                        ),
                                                        maxLines: 2,
                                                        overflow: TextOverflow
                                                            .ellipsis,
                                                      ),
                                                      Text(
                                                        item.variantLabel !=
                                                                null
                                                            ? '${item.variantLabel} • ${item.quantity} x PKR ${item.unitPrice}'
                                                            : '${item.quantity} x PKR ${item.unitPrice}',
                                                        style: TextStyle(
                                                          fontSize: 12,
                                                          color:
                                                              Colors.grey[600],
                                                        ),
                                                      ),
                                                    ],
                                                  ),
                                                ),
                                                const SizedBox(width: 8),
                                                Text(
                                                  'PKR ${item.total.toStringAsFixed(2)}',
                                                  style: const TextStyle(
                                                    fontWeight: FontWeight.w600,
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ),
                                        );
                                      }

                                      allChildren.add(
                                        Padding(
                                          padding: const EdgeInsets.only(
                                            top: 8.0,
                                            bottom: 4.0,
                                          ),
                                          child: Row(
                                            mainAxisAlignment:
                                                MainAxisAlignment.spaceBetween,
                                            crossAxisAlignment:
                                                CrossAxisAlignment.start,
                                            children: [
                                              Expanded(
                                                child: Text(
                                                  '${_tr('Subtotal')} (${entry.key}):',
                                                  style: const TextStyle(
                                                    fontWeight: FontWeight.w600,
                                                  ),
                                                  overflow:
                                                      TextOverflow.ellipsis,
                                                  maxLines: 2,
                                                ),
                                              ),
                                              const SizedBox(width: 8),
                                              Text(
                                                'PKR ${storeSubtotal.toStringAsFixed(2)}',
                                                style: const TextStyle(
                                                  fontWeight: FontWeight.w600,
                                                ),
                                              ),
                                            ],
                                          ),
                                        ),
                                      );

                                      allChildren.add(
                                        const Divider(height: 12),
                                      );
                                    }

                                    allChildren.add(const SizedBox(height: 8));

                                    allChildren.add(
                                      Padding(
                                        padding: const EdgeInsets.only(
                                          bottom: 8.0,
                                        ),
                                        child: Row(
                                          mainAxisAlignment:
                                              MainAxisAlignment.spaceBetween,
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            Expanded(
                                              child: Text(
                                                '${_tr('Delivery Fee')} ($numStores ${_tr('Stores')}):',
                                                style: const TextStyle(
                                                  fontSize: 13,
                                                  color: Colors.grey,
                                                ),
                                                overflow: TextOverflow.ellipsis,
                                                maxLines: 2,
                                              ),
                                            ),
                                            const SizedBox(width: 8),
                                            Text(
                                              'PKR ${deliveryFee.toStringAsFixed(2)}',
                                              style: const TextStyle(
                                                fontSize: 13,
                                                color: Colors.grey,
                                                fontWeight: FontWeight.w500,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                    );

                                    allChildren.add(
                                      Container(
                                        padding: const EdgeInsets.only(top: 8),
                                        decoration: BoxDecoration(
                                          border: Border(
                                            top: BorderSide(
                                              color: Colors.grey[300]!,
                                              width: 2,
                                            ),
                                          ),
                                        ),
                                        child: Row(
                                          mainAxisAlignment:
                                              MainAxisAlignment.spaceBetween,
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            Expanded(
                                              child: Text(
                                                _tr('Grand Total'),
                                                style: TextStyle(
                                                  fontSize: 16,
                                                  fontWeight: FontWeight.w700,
                                                ),
                                                overflow: TextOverflow.ellipsis,
                                                maxLines: 2,
                                              ),
                                            ),
                                            const SizedBox(width: 8),
                                            Text(
                                              'PKR ${grandTotal.toStringAsFixed(2)}',
                                              style: TextStyle(
                                                fontSize: 16,
                                                fontWeight: FontWeight.w700,
                                                color: Theme.of(
                                                  context,
                                                ).colorScheme.primary,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                    );

                                    return Column(
                                      crossAxisAlignment:
                                          CrossAxisAlignment.start,
                                      children: allChildren,
                                    );
                                  },
                                ),
                              ],
                            ),
                        ),
                        const SizedBox(height: 16),

                        // Delivery Details Card
                        _sectionCard(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    const Icon(Icons.local_shipping, size: 20),
                                    const SizedBox(width: 8),
                                    Text(
                                      _tr('Delivery Details'),
                                      style: TextStyle(
                                        fontSize: 18,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 12),
                                TextFormField(
                                  controller: _nameController,
                                  decoration: InputDecoration(
                                    label: Text(
                                      _tr('Full Name'),
                                      overflow: TextOverflow.ellipsis,
                                      maxLines: 2,
                                    ),
                                    filled: true,
                                    fillColor: CustomerPalette.background,
                                    border: _fieldBorder(),
                                    enabledBorder: _fieldBorder(),
                                    focusedBorder: _fieldBorder(
                                      CustomerPalette.primary,
                                    ),
                                    prefixIcon: const Icon(Icons.person),
                                  ),
                                  validator: (value) {
                                    if (value == null || value.isEmpty) {
                                      return _tr('Full Name');
                                    }
                                    return null;
                                  },
                                ),
                                const SizedBox(height: 12),
                                TextFormField(
                                  controller: _phoneController,
                                  decoration: InputDecoration(
                                    label: Text(
                                      _tr('Phone Number'),
                                      overflow: TextOverflow.ellipsis,
                                      maxLines: 2,
                                    ),
                                    filled: true,
                                    fillColor: CustomerPalette.background,
                                    border: _fieldBorder(),
                                    enabledBorder: _fieldBorder(),
                                    focusedBorder: _fieldBorder(
                                      CustomerPalette.primary,
                                    ),
                                    prefixIcon: const Icon(Icons.phone),
                                  ),
                                  keyboardType: TextInputType.phone,
                                  validator: (value) {
                                    if (value == null || value.isEmpty) {
                                      return _tr('Phone Number');
                                    }
                                    return null;
                                  },
                                ),
                                const SizedBox(height: 12),
                                TextFormField(
                                  controller: _addressController,
                                  decoration: InputDecoration(
                                    label: Text(
                                      _tr('Delivery Address'),
                                      overflow: TextOverflow.ellipsis,
                                      maxLines: 2,
                                    ),
                                    filled: true,
                                    fillColor: CustomerPalette.background,
                                    border: _fieldBorder(),
                                    enabledBorder: _fieldBorder(),
                                    focusedBorder: _fieldBorder(
                                      CustomerPalette.primary,
                                    ),
                                    prefixIcon: const Icon(Icons.location_on),
                                  ),
                                  maxLines: 2,
                                  validator: (value) {
                                    if (value == null || value.isEmpty) {
                                      return _tr('Delivery Address');
                                    }
                                    return null;
                                  },
                                ),
                                const SizedBox(height: 12),
                                DropdownButtonFormField<String>(
                                  initialValue: _selectedDeliveryTime,
                                  decoration: InputDecoration(
                                    label: Text(
                                      _tr('Preferred Delivery Time'),
                                      overflow: TextOverflow.ellipsis,
                                      maxLines: 2,
                                    ),
                                    filled: true,
                                    fillColor: CustomerPalette.background,
                                    border: _fieldBorder(),
                                    enabledBorder: _fieldBorder(),
                                    focusedBorder: _fieldBorder(
                                      CustomerPalette.primary,
                                    ),
                                    prefixIcon: const Icon(Icons.access_time),
                                  ),
                                  items: [
                                    DropdownMenuItem(
                                      value: 'asap',
                                      child: Text(_tr('ASAP (30-45 mins)')),
                                    ),
                                    DropdownMenuItem(
                                      value: '1hour',
                                      child: Text(_tr('Within 1 hour')),
                                    ),
                                    DropdownMenuItem(
                                      value: '2hours',
                                      child: Text(_tr('Within 2 hours')),
                                    ),
                                    DropdownMenuItem(
                                      value: 'tomorrow',
                                      child: Text(_tr('Tomorrow')),
                                    ),
                                  ],
                                  onChanged: (value) {
                                    setState(() {
                                      _selectedDeliveryTime = value;
                                    });
                                  },
                                ),
                                const SizedBox(height: 12),
                                TextFormField(
                                  controller: _instructionsController,
                                  decoration: InputDecoration(
                                    label: Text(
                                      _tr('Special Instructions'),
                                      overflow: TextOverflow.ellipsis,
                                      maxLines: 2,
                                    ),
                                    filled: true,
                                    fillColor: CustomerPalette.background,
                                    border: _fieldBorder(),
                                    enabledBorder: _fieldBorder(),
                                    focusedBorder: _fieldBorder(
                                      CustomerPalette.primary,
                                    ),
                                    prefixIcon: const Icon(Icons.note),
                                  ),
                                  maxLines: 2,
                                ),
                              ],
                            ),
                        ),

                        const SizedBox(height: 16),

                        // Payment Method Card
                        _sectionCard(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    const Icon(Icons.payment, size: 20),
                                    const SizedBox(width: 8),
                                    Text(
                                      _tr('Payment Method'),
                                      style: TextStyle(
                                        fontSize: 18,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 12),
                                RadioGroup<String>(
                                  groupValue: _paymentMethod,
                                  onChanged: (newValue) {
                                    if (newValue != null) {
                                      setState(() => _paymentMethod = newValue);
                                    }
                                  },
                                  child: Column(
                                    children: [
                                      _buildPaymentOption(
                                        title: 'Cash on Delivery',
                                        value: 'cash',
                                        icon: Icons.delivery_dining,
                                        subtitle: 'Pay with cash at delivery',
                                      ),
                                      const SizedBox(height: 8),
                                      _buildPaymentOption(
                                        title: 'Credit/Debit Card',
                                        value: 'card',
                                        icon: Icons.credit_card,
                                        subtitle: 'Pay securely with your card',
                                      ),
                                      const SizedBox(height: 8),
                                      _buildPaymentOption(
                                        title: 'Wallet',
                                        value: 'wallet',
                                        icon: Icons.account_balance_wallet,
                                        subtitle: 'Use your in-app wallet',
                                      ),
                                    ],
                                  ),
                                ),
                                if (_paymentMethod == 'wallet' &&
                                    _walletBalance != null)
                                  Padding(
                                    padding: const EdgeInsets.only(
                                      top: 12,
                                      left: 4,
                                      right: 4,
                                    ),
                                    child: Container(
                                      padding: const EdgeInsets.all(12),
                                      decoration: BoxDecoration(
                                        borderRadius: BorderRadius.circular(12),
                                        color:
                                            _walletBalance! >=
                                                _calculateGrandTotal(cart)
                                            ? Colors.green.shade50
                                            : Colors.red.shade50,
                                        border: Border.all(
                                          color:
                                              _walletBalance! >=
                                                  _calculateGrandTotal(cart)
                                              ? Colors.green
                                              : Colors.red,
                                        ),
                                      ),
                                      child: Row(
                                        children: [
                                          Icon(
                                            _walletBalance! >=
                                                    _calculateGrandTotal(cart)
                                                ? Icons.check_circle
                                                : Icons.error,
                                            color:
                                                _walletBalance! >=
                                                    _calculateGrandTotal(cart)
                                                ? Colors.green
                                                : Colors.red,
                                          ),
                                          const SizedBox(width: 8),
                                          Expanded(
                                            child: Column(
                                              crossAxisAlignment:
                                                  CrossAxisAlignment.start,
                                              children: [
                                                Text(
                                                  '${_tr('Wallet')}: ${_tr('PKR')} ${_walletBalance!.toStringAsFixed(2)}',
                                                  style: TextStyle(
                                                    fontWeight: FontWeight.bold,
                                                    color:
                                                        _walletBalance! >=
                                                            _calculateGrandTotal(
                                                              cart,
                                                            )
                                                        ? Colors.green
                                                        : Colors.red,
                                                  ),
                                                ),
                                                if (_walletBalance! <
                                                    _calculateGrandTotal(cart))
                                                  Padding(
                                                    padding:
                                                        const EdgeInsets.only(
                                                          top: 4,
                                                        ),
                                                    child: Text(
                                                      '${_tr('Insufficient wallet balance. Need')} ${_tr('PKR')} ${(_calculateGrandTotal(cart) - _walletBalance!).toStringAsFixed(2)} ${_tr('more.')}',
                                                      style: const TextStyle(
                                                        fontSize: 12,
                                                        color: Colors.red,
                                                      ),
                                                    ),
                                                  ),
                                              ],
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                        ),

                        const SizedBox(height: 24),
                        SizedBox(
                          width: double.infinity,
                          child: ElevatedButton.icon(
                            icon: const Icon(Icons.lock_outline),
                            style: ElevatedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(vertical: 18),
                              backgroundColor: CustomerPalette.primary,
                              foregroundColor: Colors.white,
                              elevation: 0,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(999),
                              ),
                            ),
                            onPressed: _submitOrder,
                            label: Text(
                              _tr('Place Order'),
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 40),
                      ],
                    ),
                  );

                  return SingleChildScrollView(
                    padding: EdgeInsets.fromLTRB(
                      16 + sidePadding,
                      18,
                      16 + sidePadding,
                      28,
                    ),
                    child: Container(
                      decoration: BoxDecoration(
                        borderRadius: BorderRadius.circular(34),
                        color: Colors.white.withValues(alpha: 0.9),
                        border: Border.all(
                          color: CustomerPalette.border,
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: CustomerPalette.primaryDark.withValues(
                              alpha: 0.14,
                            ),
                            blurRadius: 26,
                            offset: const Offset(0, 18),
                          ),
                        ],
                      ),
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(16, 18, 16, 20),
                        child: content,
                      ),
                    ),
                  );
                },
              ),
            ),
        ],
      ),
    ));
  }
}
