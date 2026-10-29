import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/cart_item.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../services/api_service.dart';
import '../utils/cart_counts.dart';
import '../utils/customer_language.dart';
import '../widgets/customer_bottom_nav.dart';
import '../widgets/ui/ui.dart';

class CartScreen extends StatefulWidget {
  const CartScreen({super.key});

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  // Same defaults and formula as CheckoutScreen, so the total shown here is
  // the all-in total the customer will pay (no surprise fee at checkout).
  static const double _defaultDeliveryFeeBase = 70;
  static const double _defaultDeliveryFeeAdditional = 30;

  bool _isUrdu = false;
  double _deliveryFeeBase = _defaultDeliveryFeeBase;
  double _deliveryFeeAdditional = _defaultDeliveryFeeAdditional;

  @override
  void initState() {
    super.initState();
    _loadLanguagePreference();
    _loadDeliveryFeeConfig();
  }

  Future<void> _loadLanguagePreference() async {
    final isUrdu = await CustomerLanguage.loadIsUrdu();
    if (!mounted) return;
    setState(() => _isUrdu = isUrdu);
  }

  Future<void> _loadDeliveryFeeConfig() async {
    try {
      final data = await ApiService.getDeliveryFeeConfig();
      double? parse(dynamic v) =>
          v is num ? v.toDouble() : double.tryParse(v?.toString() ?? '');
      final base = parse(data['base_fee']);
      final additional = parse(data['additional_per_store']);
      if (!mounted) return;
      setState(() {
        if (base != null && base >= 0) _deliveryFeeBase = base;
        if (additional != null && additional >= 0) {
          _deliveryFeeAdditional = additional;
        }
      });
    } catch (_) {}
  }

  String _tr(String text) => CustomerLanguage.tr(_isUrdu, text);

  String _money(num value) => Fmt.money(value, urdu: _isUrdu);

  double _deliveryFee(int storeCount) {
    if (storeCount <= 0) return 0;
    return _deliveryFeeBase + ((storeCount - 1) * _deliveryFeeAdditional);
  }

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
              'Guest users can add items to cart, but registration is required before placing an order.',
            ),
            textAlign: TextAlign.center,
          ),
          actionsAlignment: MainAxisAlignment.center,
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: Text(_tr('Later')),
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

  Future<void> _confirmClear(CartProvider cart) async {
    final clear = await showDialog<bool>(
      context: context,
      builder: (ctx) => LanguageScope(
        isUrdu: _isUrdu,
        child: AlertDialog(
          title: Text(_tr('Clear Cart?')),
          content: Text(_tr('Are you sure you want to remove all items?')),
          actions: [
            TextButton(
              style: TextButton.styleFrom(foregroundColor: AppColors.text2),
              onPressed: () => Navigator.of(ctx).pop(false),
              child: Text(_tr('Cancel')),
            ),
            FilledButton.icon(
              style: FilledButton.styleFrom(backgroundColor: AppColors.danger),
              onPressed: () => Navigator.of(ctx).pop(true),
              icon: const Icon(Icons.delete_outline_rounded, size: 18),
              label: Text(_tr('Clear')),
            ),
          ],
        ),
      ),
    );
    if (clear == true) cart.clear();
  }

  void _showWarning(String? warning) {
    if (warning == null || !mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(warning)));
  }

  Map<String, List<CartItem>> _groupByStore(List<CartItem> items) {
    final groups = <String, List<CartItem>>{};
    for (final item in items) {
      final store = (item.product.storeName ?? '').trim().isNotEmpty
          ? item.product.storeName!.trim()
          : _tr('Unknown Store');
      groups.putIfAbsent(store, () => []).add(item);
    }
    return groups;
  }

  void _proceed() {
    final auth = Provider.of<AuthProvider>(context, listen: false);
    if (auth.isGuest) {
      _promptGuestRegistration();
      return;
    }
    Navigator.of(context).pushNamed('/checkout');
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<CartProvider>(
      builder: (context, cart, child) {
        final items = cart.items;
        final groups = _groupByStore(items);
        final storeCount = items
            .map(
              (item) =>
                  item.product.storeId?.toString() ??
                  'name:${item.product.storeName ?? item.product.id}',
            )
            .toSet()
            .length;
        final fee = _deliveryFee(storeCount);
        final grandTotal = cart.totalAmount + fee;
        final units = cart.totalUnits;

        return LanguageScope(
          isUrdu: _isUrdu,
          child: Scaffold(
            appBar: AppBar(
              title: Text(_tr('Your Cart')),
              actions: [
                if (items.isNotEmpty)
                  IconButton(
                    tooltip: _tr('Clear Cart?'),
                    icon: const Icon(Icons.delete_outline_rounded),
                    onPressed: () => _confirmClear(cart),
                  ),
                const SizedBox(width: AppSpace.xs),
              ],
            ),
            body: items.isEmpty
                ? EmptyState(
                    icon: Icons.shopping_cart_outlined,
                    title: _tr('Your cart is empty'),
                    message: _tr(
                      'Add items from a store and they will show up here.',
                    ),
                    actionLabel: _tr('Browse stores'),
                    actionIcon: Icons.storefront_outlined,
                    onAction: () => CustomerNav.go(
                      context,
                      CustomerTab.stores,
                      from: CustomerTab.cart,
                    ),
                  )
                : ListView(
                    padding: const EdgeInsets.fromLTRB(
                      AppSpace.gutter,
                      AppSpace.md,
                      AppSpace.gutter,
                      AppSpace.xxl,
                    ),
                    children: [
                      for (final entry in groups.entries) ...[
                        _StoreGroup(
                          storeName: entry.key,
                          children: [
                            for (final item in entry.value)
                              _CartLine(
                                item: item,
                                isUrdu: _isUrdu,
                                tr: _tr,
                                onIncrement: () => _showWarning(
                                  cart.updateCartItemQuantity(
                                    item,
                                    item.quantity + 1,
                                  ),
                                ),
                                onDecrement: () {
                                  if (item.quantity > 1) {
                                    cart.updateCartItemQuantity(
                                      item,
                                      item.quantity - 1,
                                    );
                                  } else {
                                    cart.removeCartItem(item);
                                  }
                                },
                              ),
                          ],
                        ),
                        const SizedBox(height: AppSpace.md),
                      ],
                      AppCard(
                        child: Column(
                          children: [
                            _SummaryRow(
                              label:
                                  '${_tr('Subtotal')} (${_itemsLabel(units)})',
                              value: _money(cart.totalAmount),
                            ),
                            _SummaryRow(
                              label: storeCount > 1
                                  ? '${_tr('Delivery Fee')} (${Fmt.isolate('$storeCount')} ${_tr('stores')})'
                                  : _tr('Delivery Fee'),
                              value: _money(fee),
                            ),
                            const Padding(
                              padding: EdgeInsets.symmetric(
                                vertical: AppSpace.sm,
                              ),
                              child: Divider(),
                            ),
                            _SummaryRow(
                              label: _tr('Total'),
                              value: _money(grandTotal),
                              strong: true,
                            ),
                            const SizedBox(height: AppSpace.xs),
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
                                    _tr(
                                      'All-in price. No hidden charges at checkout.',
                                    ),
                                    style: AppText.caption,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
            bottomNavigationBar: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (items.isNotEmpty)
                  Container(
                    decoration: const BoxDecoration(
                      color: AppColors.surface,
                      border: Border(top: BorderSide(color: AppColors.border)),
                    ),
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
                            label: _tr('Proceed to Checkout'),
                            onPressed: _proceed,
                          ),
                        ),
                      ],
                    ),
                  ),
                CustomerBottomNav(current: CustomerTab.cart, isUrdu: _isUrdu),
              ],
            ),
          ),
        );
      },
    );
  }

  String _itemsLabel(int units) {
    if (_isUrdu) return '${Fmt.isolate('$units')} ${_tr('items')}';
    return Fmt.count(units, 'item');
  }
}

class _StoreGroup extends StatelessWidget {
  final String storeName;
  final List<Widget> children;

  const _StoreGroup({required this.storeName, required this.children});

  @override
  Widget build(BuildContext context) {
    return AppCard(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpace.lg,
              AppSpace.md,
              AppSpace.lg,
              AppSpace.xs,
            ),
            child: Row(
              children: [
                const Icon(
                  Icons.storefront_outlined,
                  size: 18,
                  color: AppColors.primary,
                ),
                const SizedBox(width: AppSpace.sm),
                Expanded(
                  child: Text(
                    storeName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.title,
                  ),
                ),
              ],
            ),
          ),
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0)
              const Divider(indent: AppSpace.lg, endIndent: AppSpace.lg),
            children[i],
          ],
        ],
      ),
    );
  }
}

class _CartLine extends StatelessWidget {
  final CartItem item;
  final bool isUrdu;
  final String Function(String) tr;
  final VoidCallback onIncrement;
  final VoidCallback onDecrement;

  const _CartLine({
    required this.item,
    required this.isUrdu,
    required this.tr,
    required this.onIncrement,
    required this.onDecrement,
  });

  @override
  Widget build(BuildContext context) {
    final variant = Fmt.unit(item.variantLabel);
    final hasVariant = variant.isNotEmpty && variant != 'Default';
    final unit = '${Fmt.money(item.unitPrice, urdu: isUrdu)} ${tr('each')}';
    return Padding(
      padding: const EdgeInsets.all(AppSpace.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          AppNetworkImage(
            url: ApiService.getImageUrl(item.product.imageUrl),
            width: 64,
            height: 64,
            borderRadius: AppRadius.controlAll,
            placeholderIcon: Icons.fastfood_outlined,
          ),
          const SizedBox(width: AppSpace.md),
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
                if (hasVariant)
                  Text(
                    isUrdu ? Fmt.isolate(variant) : variant,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.caption,
                  ),
                Text(unit, style: AppText.caption),
                if (item.isBxgyOffer && item.offerBadge != null) ...[
                  const SizedBox(height: 4),
                  TonePill.success(
                    '${tr('Pay')} ${item.paidQuantity} · ${tr('Free')} ${item.freeQuantity}',
                    icon: Icons.local_offer_outlined,
                  ),
                ],
                const SizedBox(height: AppSpace.sm),
                Row(
                  children: [
                    QuantityStepper(
                      quantity: item.quantity,
                      compact: true,
                      onIncrement: onIncrement,
                      onDecrement: onDecrement,
                      incrementTooltip: tr('Increase quantity'),
                      decrementTooltip: tr('Decrease quantity'),
                    ),
                    const Spacer(),
                    PriceText(item.total, urdu: isUrdu),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SummaryRow extends StatelessWidget {
  final String label;
  final String value;
  final bool strong;

  const _SummaryRow({
    required this.label,
    required this.value,
    this.strong = false,
  });

  @override
  Widget build(BuildContext context) {
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
            value,
            style: strong
                ? AppText.price.copyWith(fontSize: 17)
                : AppText.bodyStrong.copyWith(fontFeatures: AppText.tabular),
          ),
        ],
      ),
    );
  }
}
