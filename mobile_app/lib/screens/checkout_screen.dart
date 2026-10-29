import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../models/cart_item.dart';
import '../providers/wallet_provider.dart';
import '../services/api_service.dart';
import 'package:servenow/services/notifier.dart';
import '../utils/cart_counts.dart';
import '../utils/customer_language.dart';
import '../widgets/ui/ui.dart';

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
  // Cash on delivery is the default payment method.
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

  String _money(num value) => Fmt.money(value, urdu: _isUrdu);

  Future<void> _promptGuestRegistration() async {
    final shouldRegister = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => LanguageScope(
        isUrdu: _isUrdu,
        child: AlertDialog(
          icon: Container(
            width: 56,
            height: 56,
            decoration: const BoxDecoration(
              color: AppColors.tint100,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.person_add_alt_1_outlined,
              color: AppColors.primary,
              size: 28,
            ),
          ),
          title: Text(_tr('Register Required'), textAlign: TextAlign.center),
          content: Text(
            _tr(
              'You are using guest mode. Please register your account before placing an order.',
            ),
            textAlign: TextAlign.center,
          ),
          actionsAlignment: MainAxisAlignment.center,
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: Text(_tr('Cancel')),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: Text(_tr('Register')),
            ),
          ],
        ),
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
    } catch (_) {
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
        .map(
          (item) =>
              item.product.storeId ?? item.product.storeName ?? item.product.id,
        )
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
          final when = _formatDeliveryWindow(
            status['start_at'],
            status['end_at'],
          );
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
          if (!isOpen ||
              !_checkIsOpen(store['opening_time'], store['closing_time'])) {
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
        setState(() => _isLoading = false);
        Notifier.error(
          context,
          '${_tr('Insufficient wallet balance. Need')} ${_money(grandTotal - _walletBalance!)} ${_tr('more.')}',
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

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  Widget _section({
    required IconData icon,
    required String title,
    required Widget child,
    Widget? trailing,
  }) {
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 20, color: AppColors.primary),
              const SizedBox(width: AppSpace.sm),
              Expanded(child: Text(title, style: AppText.title)),
              ?trailing,
            ],
          ),
          const SizedBox(height: AppSpace.md),
          child,
        ],
      ),
    );
  }

  Widget _buildPaymentOption({
    required String title,
    required String value,
    required IconData icon,
    String? subtitle,
    Widget? extra,
  }) {
    final isSelected = _paymentMethod == value;
    return Semantics(
      selected: isSelected,
      button: true,
      child: Material(
        color: isSelected ? AppColors.tint50 : AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: AppRadius.controlAll,
          side: BorderSide(
            color: isSelected ? AppColors.primary : AppColors.border,
            width: isSelected ? 1.6 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () => setState(() => _paymentMethod = value),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(12, 10, 4, 10),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: isSelected ? AppColors.tint100 : AppColors.surface3,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(
                    icon,
                    size: 20,
                    color: isSelected
                        ? AppColors.primaryPressed
                        : AppColors.text2,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_tr(title), style: AppText.bodyStrong),
                      if (subtitle != null)
                        Text(_tr(subtitle), style: AppText.caption),
                      ?extra,
                    ],
                  ),
                ),
                Radio<String>(value: value),
              ],
            ),
          ),
        ),
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
                ? AppText.price.copyWith(fontSize: 17, color: AppColors.text)
                : AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular),
          ),
        ],
      ),
    );
  }

  Widget _buildOrderSummary(CartProvider cart) {
    final Map<String, List<CartItem>> itemsByStore = {};
    for (var item in cart.items) {
      final store = item.product.storeName ?? _tr('Unknown Store');
      itemsByStore.putIfAbsent(store, () => []).add(item);
    }

    final numStores = itemsByStore.length;
    final deliveryFee = _calculateDeliveryFee(numStores);
    final grandTotal = cart.totalAmount + deliveryFee;
    final units = cart.totalUnits;

    final children = <Widget>[];
    for (final entry in itemsByStore.entries) {
      final storeSubtotal = entry.value.fold<double>(
        0.0,
        (sum, item) => sum + item.total,
      );
      children.add(
        Padding(
          padding: const EdgeInsets.only(top: 4, bottom: 4),
          child: Row(
            children: [
              const Icon(
                Icons.storefront_outlined,
                size: 16,
                color: AppColors.muted,
              ),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  entry.key,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.label.copyWith(color: AppColors.text),
                ),
              ),
              if (itemsByStore.length > 1)
                Text(
                  _money(storeSubtotal),
                  style: AppText.caption.copyWith(
                    fontFeatures: AppText.tabular,
                  ),
                ),
            ],
          ),
        ),
      );
      for (final item in entry.value) {
        final variant = Fmt.unit(item.variantLabel);
        final hasVariant = variant.isNotEmpty && variant != 'Default';
        children.add(
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.product.name,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.bodyStrong,
                      ),
                      Text(
                        hasVariant
                            ? '${_isUrdu ? Fmt.isolate(variant) : variant} · ${_money(item.unitPrice)} ${_tr('each')}'
                            : '${_money(item.unitPrice)} ${_tr('each')}',
                        style: AppText.caption,
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: AppSpace.sm),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    QuantityStepper(
                      quantity: item.quantity,
                      compact: true,
                      incrementTooltip: _tr('Increase quantity'),
                      decrementTooltip: _tr('Decrease quantity'),
                      onIncrement: () {
                        final warning = cart.updateCartItemQuantity(
                          item,
                          item.quantity + 1,
                        );
                        if (warning != null) {
                          ScaffoldMessenger.of(
                            context,
                          ).showSnackBar(SnackBar(content: Text(warning)));
                        }
                      },
                      onDecrement: () {
                        if (item.quantity > 1) {
                          cart.updateCartItemQuantity(item, item.quantity - 1);
                        } else {
                          cart.removeCartItem(item);
                        }
                      },
                    ),
                    const SizedBox(height: 4),
                    Text(
                      _money(item.total),
                      style: AppText.bodyStrong.copyWith(
                        fontFeatures: AppText.tabular,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        );
      }
      children.add(const Divider(height: 16));
    }

    final feeLabel = numStores > 1
        ? '${_tr('Delivery Fee')} (${Fmt.isolate('$numStores')} ${_tr('stores')})'
        : _tr('Delivery Fee');
    final itemsLabel = _isUrdu
        ? '${_tr('Subtotal')} (${Fmt.isolate('$units')} ${_tr('items')})'
        : '${_tr('Subtotal')} (${Fmt.count(units, 'item')})';

    children
      ..add(_amountRow(itemsLabel, cart.totalAmount))
      ..add(_amountRow(feeLabel, deliveryFee))
      ..add(
        const Padding(
          padding: EdgeInsets.symmetric(vertical: 6),
          child: Divider(),
        ),
      )
      ..add(_amountRow(_tr('Grand Total'), grandTotal, strong: true))
      ..add(const SizedBox(height: 4))
      ..add(
        Row(
          children: [
            const Icon(
              Icons.verified_outlined,
              size: 16,
              color: AppColors.primary,
            ),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                _tr('All-in price. No hidden charges at checkout.'),
                style: AppText.caption,
              ),
            ),
          ],
        ),
      );

    return _section(
      icon: Icons.receipt_long_outlined,
      title: _tr('Order Summary'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: children,
      ),
    );
  }

  Widget _buildDeliveryDetails() {
    return _section(
      icon: Icons.local_shipping_outlined,
      title: _tr('Delivery Details'),
      child: Column(
        children: [
          TextFormField(
            controller: _nameController,
            textInputAction: TextInputAction.next,
            decoration: InputDecoration(
              labelText: _tr('Full Name'),
              prefixIcon: const Icon(Icons.person_outline_rounded),
            ),
            validator: (value) {
              if (value == null || value.isEmpty) {
                return _tr('Full Name');
              }
              return null;
            },
          ),
          const SizedBox(height: AppSpace.md),
          TextFormField(
            controller: _phoneController,
            textInputAction: TextInputAction.next,
            decoration: InputDecoration(
              labelText: _tr('Phone Number'),
              prefixIcon: const Icon(Icons.phone_outlined),
            ),
            keyboardType: TextInputType.phone,
            textDirection: TextDirection.ltr,
            validator: (value) {
              if (value == null || value.isEmpty) {
                return _tr('Phone Number');
              }
              return null;
            },
          ),
          const SizedBox(height: AppSpace.md),
          TextFormField(
            controller: _addressController,
            decoration: InputDecoration(
              labelText: _tr('Delivery Address'),
              prefixIcon: const Icon(Icons.location_on_outlined),
            ),
            minLines: 1,
            maxLines: 3,
            validator: (value) {
              if (value == null || value.isEmpty) {
                return _tr('Delivery Address');
              }
              return null;
            },
          ),
          const SizedBox(height: AppSpace.md),
          DropdownButtonFormField<String>(
            initialValue: _selectedDeliveryTime,
            isExpanded: true,
            decoration: InputDecoration(
              labelText: _tr('Preferred Delivery Time'),
              prefixIcon: const Icon(Icons.schedule_rounded),
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
              DropdownMenuItem(value: 'tomorrow', child: Text(_tr('Tomorrow'))),
            ],
            onChanged: (value) {
              setState(() {
                _selectedDeliveryTime = value;
              });
            },
          ),
          const SizedBox(height: AppSpace.md),
          TextFormField(
            controller: _instructionsController,
            decoration: InputDecoration(
              labelText: _tr('Special Instructions'),
              hintText: _tr('e.g. Ring the bell, leave at the gate'),
              prefixIcon: const Icon(Icons.sticky_note_2_outlined),
            ),
            minLines: 1,
            maxLines: 3,
          ),
        ],
      ),
    );
  }

  Widget _buildPayment(CartProvider cart) {
    final grandTotal = _calculateGrandTotal(cart);
    Widget? walletExtra;
    if (_walletBalance != null) {
      final enough = _walletBalance! >= grandTotal;
      walletExtra = Padding(
        padding: const EdgeInsets.only(top: 4),
        child: Text(
          enough
              ? '${_tr('Balance')}: ${_money(_walletBalance!)}'
              : '${_tr('Balance')}: ${_money(_walletBalance!)} · ${_tr('Insufficient wallet balance. Need')} ${_money(grandTotal - _walletBalance!)} ${_tr('more.')}',
          style: AppText.caption.copyWith(
            color: enough ? AppColors.success : AppColors.danger,
            fontWeight: FontWeight.w600,
            fontFeatures: AppText.tabular,
          ),
        ),
      );
    }

    return _section(
      icon: Icons.payments_outlined,
      title: _tr('Payment Method'),
      child: RadioGroup<String>(
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
              icon: Icons.payments_outlined,
              subtitle: 'Pay with cash at delivery',
            ),
            const SizedBox(height: AppSpace.sm),
            _buildPaymentOption(
              title: 'Credit/Debit Card',
              value: 'card',
              icon: Icons.credit_card_rounded,
              subtitle: 'Pay securely with your card',
            ),
            const SizedBox(height: AppSpace.sm),
            _buildPaymentOption(
              title: 'Wallet',
              value: 'wallet',
              icon: Icons.account_balance_wallet_outlined,
              subtitle: 'Use your in-app wallet',
              extra: _paymentMethod == 'wallet' ? walletExtra : null,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildGuestNotice() {
    return Selector<AuthProvider, bool>(
      selector: (_, auth) => auth.isGuest,
      builder: (context, isGuest, child) {
        if (!isGuest) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.only(bottom: AppSpace.md),
          child: AppCard(
            color: AppColors.warningBg,
            borderColor: AppColors.warningBg,
            padding: const EdgeInsets.fromLTRB(14, 8, 8, 8),
            child: Row(
              children: [
                const Icon(
                  Icons.info_outline_rounded,
                  color: AppColors.warning,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    _tr(
                      'Guest mode is for browsing only. Register to place your order.',
                    ),
                    style: AppText.small.copyWith(
                      color: AppColors.warning,
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
    );
  }

  Widget _buildBottomBar(CartProvider cart) {
    final grandTotal = _calculateGrandTotal(cart);
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.border)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpace.gutter,
            AppSpace.md,
            AppSpace.gutter,
            AppSpace.md,
          ),
          child: Row(
            children: [
              Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(_tr('Total'), style: AppText.caption),
                  Text(
                    _money(grandTotal),
                    style: AppText.price.copyWith(fontSize: 18),
                  ),
                ],
              ),
              const SizedBox(width: AppSpace.md),
              Expanded(
                child: PrimaryButton(
                  label: _tr('Place Order'),
                  icon: Icons.lock_outline_rounded,
                  loading: _isLoading,
                  onPressed: _isDeliveryFeeConfigLoading ? null : _submitOrder,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildLoadingSkeleton() {
    return const Shimmer(
      child: SingleChildScrollView(
        physics: NeverScrollableScrollPhysics(),
        padding: EdgeInsets.all(AppSpace.gutter),
        child: Column(
          children: [
            SkeletonCard(),
            SizedBox(height: AppSpace.md),
            SkeletonCard(),
            SizedBox(height: AppSpace.md),
            SkeletonCard(),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cart = Provider.of<CartProvider>(context);

    if (cart.items.isEmpty) {
      return LanguageScope(
        isUrdu: _isUrdu,
        child: Scaffold(
          appBar: AppBar(title: Text(_tr('Checkout'))),
          body: EmptyState(
            icon: Icons.shopping_cart_outlined,
            title: _tr('Your cart is empty'),
            actionLabel: _tr('Browse stores'),
            actionIcon: Icons.storefront_outlined,
            onAction: () => Navigator.of(
              context,
            ).pushNamedAndRemoveUntil('/home', (route) => false),
          ),
        ),
      );
    }

    return LanguageScope(
      isUrdu: _isUrdu,
      child: Scaffold(
        appBar: AppBar(title: Text(_tr('Checkout'))),
        resizeToAvoidBottomInset: true,
        bottomNavigationBar: _buildBottomBar(cart),
        body: _isDeliveryFeeConfigLoading
            ? _buildLoadingSkeleton()
            : LayoutBuilder(
                builder: (context, constraints) {
                  final isWide = constraints.maxWidth >= 760;
                  final sidePadding = isWide
                      ? (constraints.maxWidth - 620) / 2
                      : 0.0;
                  return AbsorbPointer(
                    absorbing: _isLoading,
                    child: SingleChildScrollView(
                      padding: EdgeInsets.fromLTRB(
                        AppSpace.gutter + sidePadding,
                        AppSpace.md,
                        AppSpace.gutter + sidePadding,
                        AppSpace.xxl,
                      ),
                      child: Form(
                        key: _formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            _buildGuestNotice(),
                            _buildOrderSummary(cart),
                            const SizedBox(height: AppSpace.md),
                            _buildDeliveryDetails(),
                            const SizedBox(height: AppSpace.md),
                            _buildPayment(cart),
                          ],
                        ),
                      ),
                    ),
                  );
                },
              ),
      ),
    );
  }
}
