import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api_service.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../theme/customer_palette.dart';
import '../utils/customer_language.dart';

class CartScreen extends StatefulWidget {
  const CartScreen({super.key});

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  static const int _activeBottomIndex = 3;
  bool _isUrdu = false;

  @override
  void initState() {
    super.initState();
    _loadLanguagePreference();
  }

  Future<void> _loadLanguagePreference() async {
    final isUrdu = await CustomerLanguage.loadIsUrdu();
    if (!mounted) return;
    setState(() => _isUrdu = isUrdu);
  }

  String _tr(String text) => CustomerLanguage.tr(_isUrdu, text);

  Future<void> _promptGuestRegistration() async {
    final shouldRegister = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(_tr('Register Required')),
        content: Text(
          _tr(
            'Guest users can add items to cart, but registration is required before placing an order.',
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: Text(_tr('Later')),
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

  Future<void> _refresh() async {
    await Future.delayed(const Duration(milliseconds: 500));
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
          left: -70,
          top: 60,
          child: _buildBlurOrb(
            size: 220,
            colors: const [Color(0x66F2B134), Color(0x00F2B134)],
          ),
        ),
        Positioned(
          right: -30,
          bottom: 80,
          child: _buildBlurOrb(
            size: 220,
            colors: const [Color(0x55C9475B), Color(0x00C9475B)],
          ),
        ),
        Positioned(
          right: -50,
          top: 110,
          child: _buildBlurOrb(
            size: 170,
            colors: const [Color(0x55147D7E), Color(0x00147D7E)],
          ),
        ),
      ],
    );
  }

  Widget _buildBlurOrb({required double size, required List<Color> colors}) {
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
    return Consumer<CartProvider>(
      builder: (context, cart, child) {
        final uniqueStoreCount = cart.items
            .map(
              (item) =>
                  item.product.storeId?.toString() ??
                  'name:${item.product.storeName ?? item.product.id}',
            )
            .toSet()
            .length;
        final totalProductsCount = cart.items.fold<int>(
          0,
          (sum, item) => sum + item.quantity,
        );

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
              _tr('Your Cart'),
              style: const TextStyle(
                fontWeight: FontWeight.w800,
                color: CustomerPalette.textDark,
              ),
            ),
            actions: [
              if (cart.items.isNotEmpty)
                Container(
                  margin: const EdgeInsets.only(right: 10),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.86),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: CustomerPalette.primary.withValues(alpha: 0.18),
                    ),
                  ),
                  child: IconButton(
                    icon: const Icon(Icons.delete_outline),
                    onPressed: () {
                      showDialog(
                        context: context,
                        builder: (ctx) => AlertDialog(
                          title: Text(_tr('Clear Cart?')),
                          content: Text(
                            _tr('Are you sure you want to remove all items?'),
                          ),
                          actions: [
                            TextButton(
                              child: Text(_tr('No')),
                              onPressed: () => Navigator.of(ctx).pop(),
                            ),
                            TextButton(
                              child: Text(_tr('Yes')),
                              onPressed: () {
                                cart.clear();
                                Navigator.of(ctx).pop();
                              },
                            ),
                          ],
                        ),
                      );
                    },
                  ),
                ),
            ],
          ),
          body: Stack(
            children: [
              _buildBackdrop(),
              RefreshIndicator(
            onRefresh: _refresh,
            child: cart.items.isEmpty
                ? Center(
                    child: Container(
                      margin: const EdgeInsets.symmetric(horizontal: 20),
                      padding: const EdgeInsets.all(24),
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.95),
                        borderRadius: BorderRadius.circular(24),
                        border: Border.all(color: CustomerPalette.border),
                      ),
                      child: Text(
                        _tr('Your cart is empty'),
                        style: TextStyle(
                          fontSize: 18,
                          color: Colors.grey.shade700,
                          fontWeight: FontWeight.w700,
                        ),
                        textAlign: TextAlign.center,
                      ),
                    ),
                  )
                : Column(
                    children: [
                    Expanded(
                      child: ListView.builder(
                        itemCount: cart.items.length,
                        itemBuilder: (context, index) {
                          final item = cart.items[index];
                          final dismissKey =
                              '${item.product.id}-${item.variant?.sizeId ?? 'n'}-${item.variant?.unitId ?? 'n'}';
                          return Dismissible(
                            key: ValueKey(dismissKey),
                            direction: DismissDirection.endToStart,
                            onDismissed: (_) {
                              cart.removeCartItem(item);
                            },
                            background: Container(
                              color: Colors.red,
                              alignment: Alignment.centerRight,
                              padding: const EdgeInsets.only(right: 20),
                              child:
                                  const Icon(Icons.delete, color: Colors.white),
                            ),
                            child: Card(
                              margin: const EdgeInsets.symmetric(
                                horizontal: 15,
                                vertical: 4,
                              ),
                               color: Colors.white.withValues(alpha: 0.97),
                               elevation: 2,
                               shape: RoundedRectangleBorder(
                                 borderRadius: BorderRadius.circular(18),
                               ),
                               shadowColor: CustomerPalette.primaryDark.withValues(
                                 alpha: 0.12,
                               ),
                              child: Padding(
                                padding: const EdgeInsets.all(12),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      item.product.name,
                                      style: const TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w600,
                                      ),
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      item.product.storeName ?? _tr('Unknown Store'),
                                       style: const TextStyle(
                                         fontSize: 12,
                                         color: CustomerPalette.secondaryDark,
                                         fontWeight: FontWeight.w500,
                                       ),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                    const SizedBox(height: 8),
                                    Row(
                                      children: [
                                        ApiService.getImageUrl(
                                          item.product.imageUrl,
                                        ).isNotEmpty
                                            ? Image.network(
                                                ApiService.getImageUrl(
                                                  item.product.imageUrl,
                                                ),
                                                width: 50,
                                                height: 50,
                                                fit: BoxFit.cover,
                                                errorBuilder: (ctx, err, _) =>
                                                    const Icon(Icons
                                                        .image_not_supported),
                                              )
                                            : const Icon(Icons.fastfood,
                                                size: 50),
                                        const SizedBox(width: 8),
                                        Expanded(
                                          child: Text(
                                            item.variantLabel != null
                                                ? '${item.variantLabel} • PKR ${item.total.toStringAsFixed(2)}'
                                                : '${_tr('Total')}: ${_tr('PKR')} ${item.total.toStringAsFixed(2)}',
                                            style: const TextStyle(fontSize: 13),
                                          ),
                                        ),
                                        if (item.isBxgyOffer &&
                                            item.offerBadge != null) ...[
                                          const SizedBox(width: 4),
                                          Container(
                                            constraints: const BoxConstraints(
                                              maxWidth: 118,
                                            ),
                                            padding: const EdgeInsets.symmetric(
                                              horizontal: 7,
                                              vertical: 4,
                                            ),
                                            decoration: BoxDecoration(
                                              color: CustomerPalette.secondary
                                                  .withValues(alpha: 0.12),
                                              borderRadius:
                                                  BorderRadius.circular(999),
                                            ),
                                            child: Text(
                                              'Pay ${item.paidQuantity}, Free ${item.freeQuantity}',
                                              maxLines: 2,
                                              overflow: TextOverflow.ellipsis,
                                              style: const TextStyle(
                                                color: CustomerPalette
                                                    .secondaryDark,
                                                fontSize: 10,
                                                fontWeight: FontWeight.w800,
                                              ),
                                            ),
                                          ),
                                        ],
                                        const SizedBox(width: 4),
                                        Row(
                                          mainAxisSize: MainAxisSize.min,
                                          children: [
                                            SizedBox(
                                              width: 28,
                                              height: 28,
                                              child: IconButton(
                                                padding: EdgeInsets.zero,
                                                icon: const Icon(Icons.remove,
                                                    size: 16),
                                                onPressed: () {
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
                                            ),
                                            SizedBox(
                                              width: 24,
                                              child: Center(
                                                child: Text(
                                                  '${item.quantity}',
                                                  style: const TextStyle(
                                                      fontSize: 14, fontWeight: FontWeight.bold),
                                                ),
                                              ),
                                            ),
                                            SizedBox(
                                              width: 28,
                                              height: 28,
                                              child: IconButton(
                                                padding: EdgeInsets.zero,
                                                icon: const Icon(Icons.add,
                                                    size: 16),
                                                onPressed: () {
                                                  final warning = cart.updateCartItemQuantity(
                                                    item,
                                                    item.quantity + 1,
                                                  );
                                                  if (warning != null) {
                                                    ScaffoldMessenger.of(context).showSnackBar(
                                                      SnackBar(content: Text(warning)),
                                                    );
                                                  }
                                                },
                                              ),
                                            ),
                                          ],
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                    Card(
                      margin: const EdgeInsets.all(15),
                       color: Colors.white.withValues(alpha: 0.98),
                       elevation: 2,
                       shape: RoundedRectangleBorder(
                         borderRadius: BorderRadius.circular(20),
                       ),
                       shadowColor: CustomerPalette.primaryDark.withValues(
                         alpha: 0.12,
                       ),
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          children: [
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Text(
                                  _tr('Total'),
                                  style: TextStyle(
                                    fontSize: 20,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                Text(
                                  '${_tr('PKR')} ${cart.totalAmount.toStringAsFixed(2)}',
                                  style: const TextStyle(
                                    fontSize: 20,
                                    fontWeight: FontWeight.bold,
                                     color: CustomerPalette.secondaryDark,
                                   ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 8),
                            Row(
                              children: [
                                Expanded(
                                  child: _buildSummaryMetaTile(
                                    label: _tr('Total Stores'),
                                    value: '$uniqueStoreCount',
                                    icon: Icons.storefront,
                                  ),
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: _buildSummaryMetaTile(
                                    label: _tr('Total Products'),
                                    value: '$totalProductsCount',
                                    icon: Icons.shopping_bag_outlined,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16.0, 16.0, 16.0, 80.0),
                      child: SizedBox(
                        width: double.infinity,
                        child: ElevatedButton(
                          style: ElevatedButton.styleFrom(
                            padding: const EdgeInsets.symmetric(vertical: 16),
                            backgroundColor: CustomerPalette.primary,
                            foregroundColor: Colors.white,
                            elevation: 0,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(999),
                            ),
                          ),
                          onPressed: () {
                            final auth = Provider.of<AuthProvider>(
                              context,
                              listen: false,
                            );
                            if (auth.isGuest) {
                              _promptGuestRegistration();
                              return;
                            }
                            Navigator.of(context).pushNamed('/checkout');
                          },
                          child: Text(
                            _tr('Proceed to Checkout'),
                            style: const TextStyle(fontSize: 18),
                          ),
                        ),
                      ),
                    ),
                  ],
            ),
          ),
            ],
          ),
          bottomNavigationBar: _buildBottomBar(),
        ));
      },
    );
  }

  Widget _buildSummaryMetaTile({
    required String label,
    required String value,
    required IconData icon,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: CustomerPalette.secondary.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(
          color: CustomerPalette.secondary.withValues(alpha: 0.18),
        ),
      ),
      child: Row(
        children: [
          Icon(icon, size: 16, color: CustomerPalette.secondaryDark),
          const SizedBox(width: 6),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  value,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: CustomerPalette.secondaryDark,
                  ),
                ),
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 11,
                    color: CustomerPalette.textMuted,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBottomBar() {
    return SafeArea(
      top: false,
      child: Container(
        margin: const EdgeInsets.fromLTRB(12, 0, 12, 8),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: Colors.white.withValues(alpha: 0.97),
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: CustomerPalette.border),
          boxShadow: [
            BoxShadow(
              color: CustomerPalette.primaryDark.withValues(alpha: 0.12),
              blurRadius: 16,
              offset: const Offset(0, 6),
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
              onTap: () => Navigator.of(context).pushReplacementNamed('/orders'),
            ),
            _buildBottomIcon(
              index: 3,
              icon: Icons.shopping_cart,
              label: _tr('Cart'),
              onTap: () {},
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
}
