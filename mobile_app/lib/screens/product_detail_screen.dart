import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/product.dart';
import '../models/cart_item.dart';
import '../providers/cart_provider.dart';
import '../services/api_service.dart';
import 'package:servenow/services/notifier.dart';
import '../theme/customer_palette.dart';
import '../utils/customer_language.dart';

class ProductDetailScreen extends StatefulWidget {
  final Product product;
  final Map<String, dynamic> store;
  final bool isOpen;
  final bool isGlobalBlocked;
  final List<Product> storeProducts;

  const ProductDetailScreen({
    super.key,
    required this.product,
    required this.store,
    required this.isOpen,
    required this.isGlobalBlocked,
    this.storeProducts = const [],
  });

  @override
  State<ProductDetailScreen> createState() => _ProductDetailScreenState();
}

class _ProductDetailScreenState extends State<ProductDetailScreen> {
  ProductVariant? _selectedVariant;
  int _quantity = 1;
  bool _isUrdu = false;

  @override
  void initState() {
    super.initState();
    _loadLanguagePreference();
    if (widget.product.sizeVariants.isNotEmpty) {
      _selectedVariant = widget.product.sizeVariants.first;
    }
  }

  Future<void> _loadLanguagePreference() async {
    final isUrdu = await CustomerLanguage.loadIsUrdu();
    if (!mounted) return;
    setState(() => _isUrdu = isUrdu);
  }

  String _tr(String text) => CustomerLanguage.tr(_isUrdu, text);

  double get _currentEffectivePrice {
    if (_selectedVariant != null) {
      return _selectedVariant!.effectivePrice;
    }
    return widget.product.effectivePrice;
  }

  double get _currentOriginalPrice {
    if (_selectedVariant != null) {
      return _selectedVariant!.originalPrice ?? _selectedVariant!.price;
    }
    return widget.product.originalPrice ?? widget.product.price;
  }

  String get _currentOfferBadge {
    return (_selectedVariant?.offerBadge ?? widget.product.offerBadge ?? '')
        .trim();
  }

  bool get _isBxgyOffer {
    return _selectedVariant?.isBxgyOffer ?? widget.product.isBxgyOffer;
  }

  int get _bxgyBundleQty {
    return _selectedVariant?.bxgyBundleQty ?? widget.product.bxgyBundleQty;
  }

  int get _availableStock => widget.product.stockQuantity;

  void _incrementQuantity() {
    final step = _isBxgyOffer && _bxgyBundleQty > 1 ? _bxgyBundleQty : 1;
    if (_quantity + step <= _availableStock) {
      setState(() => _quantity += step);
    } else {
      Notifier.info(
        context,
        '${_tr('Only')} $_availableStock ${_tr('available')}',
      );
    }
  }

  void _decrementQuantity() {
    final step = _isBxgyOffer && _bxgyBundleQty > 1 ? _bxgyBundleQty : 1;
    if (_quantity - step >= 1) {
      setState(() => _quantity -= step);
    }
  }

  void _addToCart() {
    if (widget.isGlobalBlocked) {
      Notifier.error(
        context,
        _tr('Ordering is temporarily unavailable.'),
        duration: const Duration(seconds: 4),
        sanitize: false,
      );
      return;
    }

    if (!widget.isOpen) {
      Notifier.error(
        context,
        _tr('This store is currently closed. You cannot place orders at this time.'),
        duration: const Duration(seconds: 4),
        sanitize: false,
      );
      return;
    }

    if (_availableStock <= 0 || !widget.product.isAvailable) {
      Notifier.info(context, _tr('Out of stock'));
      return;
    }

    final cart = Provider.of<CartProvider>(context, listen: false);

    // Check existing cart quantity for this exact variant
    final existingItem = cart.items.firstWhere(
      (item) =>
          item.product.id == widget.product.id &&
          item.variant?.sizeId == _selectedVariant?.sizeId &&
          item.variant?.unitId == _selectedVariant?.unitId,
      orElse: () => CartItem(product: widget.product, quantity: 0),
    );

    if (existingItem.quantity + _quantity > _availableStock) {
      Notifier.info(
        context,
        '${_tr('Only')} $_availableStock ${_tr('available')} (${existingItem.quantity} already in cart)',
      );
      return;
    }

    try {
      final warning = cart.addItem(
        widget.product,
        _quantity,
        variant: _selectedVariant,
      );
      if (warning != null) {
        Notifier.info(context, warning);
      } else {
        Notifier.success(
          context,
          _tr('Added to cart'),
          duration: const Duration(seconds: 2),
        );
      }
    } catch (e) {
      Notifier.error(context, e.toString());
    }
  }

  List<Product> get _relatedProducts {
    final all = widget.storeProducts
        .where((p) => p.id != widget.product.id && p.isAvailable)
        .toList();

    // Prioritize same category if available
    final sameCategory = all
        .where((p) =>
            widget.product.categoryId != null &&
            p.categoryId == widget.product.categoryId)
        .toList();
    final otherCategory = all
        .where((p) =>
            widget.product.categoryId == null ||
            p.categoryId != widget.product.categoryId)
        .toList();

    return [...sameCategory, ...otherCategory];
  }

  @override
  Widget build(BuildContext context) {
    final hasPromo =
        !_isBxgyOffer &&
        _currentEffectivePrice >= 0 &&
        _currentEffectivePrice + 0.001 < _currentOriginalPrice;

    final savingsAmount = hasPromo
        ? (_currentOriginalPrice - _currentEffectivePrice)
        : 0.0;

    final discountPercent = hasPromo && _currentOriginalPrice > 0
        ? ((savingsAmount / _currentOriginalPrice) * 100).round()
        : 0;

    final totalPrice = _currentEffectivePrice * _quantity;
    final isStoreOpen = widget.isOpen;
    final canAddToCart =
        isStoreOpen && !widget.isGlobalBlocked && widget.product.isAvailable && _availableStock > 0;

    final relatedItems = _relatedProducts;

    return Directionality(
      textDirection: CustomerLanguage.textDirection(_isUrdu),
      child: Scaffold(
        backgroundColor: CustomerPalette.background,
        appBar: AppBar(
          backgroundColor: CustomerPalette.background,
          elevation: 0,
          scrolledUnderElevation: 0,
          surfaceTintColor: Colors.transparent,
          foregroundColor: CustomerPalette.textDark,
          title: Text(
            widget.product.name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontWeight: FontWeight.w800,
              fontSize: 18,
              color: CustomerPalette.textDark,
            ),
          ),
          actions: [
            Consumer<CartProvider>(
              builder: (ctx, cart, child) => Stack(
                alignment: Alignment.center,
                children: [
                  Container(
                    margin: const EdgeInsets.only(right: 12),
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.95),
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: CustomerPalette.border),
                      boxShadow: [
                        BoxShadow(
                          color: CustomerPalette.primaryDark.withValues(alpha: 0.08),
                          blurRadius: 10,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: IconButton(
                      icon: const Icon(Icons.shopping_cart_outlined),
                      color: CustomerPalette.textDark,
                      onPressed: () {
                        Navigator.of(context).pushNamed('/cart');
                      },
                    ),
                  ),
                  if (cart.itemCount > 0)
                    Positioned(
                      right: 10,
                      top: 6,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 5,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: CustomerPalette.primary,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        constraints: const BoxConstraints(
                          minWidth: 16,
                          minHeight: 16,
                        ),
                        child: Text(
                          '${cart.itemCount}',
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 10,
                            color: Colors.white,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
        body: Stack(
          children: [
            _buildBackdrop(),
            SafeArea(
              child: Column(
                children: [
                  Expanded(
                    child: SingleChildScrollView(
                      physics: const BouncingScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // 1. Hero Image Card
                          _buildImageCard(context),
                          const SizedBox(height: 16),

                          // 2. Product Header & Badges
                          _buildHeaderSection(hasPromo, discountPercent),
                          const SizedBox(height: 16),

                          // 3. Price Card
                          _buildPriceCard(hasPromo, savingsAmount, discountPercent),
                          const SizedBox(height: 18),

                          // 4. Description if available
                          if (widget.product.description != null &&
                              widget.product.description!.trim().isNotEmpty) ...[
                            _buildDescriptionCard(),
                            const SizedBox(height: 18),
                          ],

                          // 5. Variants Selector Section
                          if (widget.product.sizeVariants.isNotEmpty) ...[
                            _buildVariantsSection(),
                            const SizedBox(height: 18),
                          ],

                          // 6. Quantity Selector
                          _buildQuantitySection(),
                          const SizedBox(height: 24),

                          // 7. Related Items Section
                          if (relatedItems.isNotEmpty) ...[
                            _buildRelatedItemsSection(relatedItems),
                            const SizedBox(height: 20),
                          ],
                        ],
                      ),
                    ),
                  ),

                  // Fixed Bottom Add to Cart Bar
                  _buildBottomBar(canAddToCart, totalPrice),
                ],
              ),
            ),
          ],
        ),
      ),
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
                Color(0xFFFFF6EC),
                Color(0xFFFFE8D6),
                Color(0xFFFFF4EA),
              ],
            ),
          ),
        ),
        Positioned(
          left: -80,
          top: 30,
          child: IgnorePointer(
            child: Container(
              width: 220,
              height: 220,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [Color(0x3DF2B134), Color(0x00F2B134)],
                ),
              ),
            ),
          ),
        ),
        Positioned(
          right: -60,
          top: 200,
          child: IgnorePointer(
            child: Container(
              width: 200,
              height: 200,
              decoration: const BoxDecoration(
                shape: BoxShape.circle,
                gradient: RadialGradient(
                  colors: [Color(0x3D147D7E), Color(0x00147D7E)],
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildImageCard(BuildContext context) {
    final imageUrl = ApiService.getImageUrl(widget.product.imageUrl);
    final offerBadge = _currentOfferBadge;

    return Container(
      width: double.infinity,
      height: 240,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: CustomerPalette.border.withValues(alpha: 0.5)),
        boxShadow: [
          BoxShadow(
            color: CustomerPalette.primaryDark.withValues(alpha: 0.08),
            blurRadius: 18,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(24),
        child: Stack(
          children: [
            Positioned.fill(
              child: imageUrl.isNotEmpty
                  ? Hero(
                      tag: 'product_image_${widget.product.id}',
                      child: Image.network(
                        imageUrl,
                        fit: BoxFit.cover,
                        errorBuilder: (ctx, err, _) => Container(
                          color: const Color(0xFFF7EFE9),
                          child: const Center(
                            child: Icon(
                              Icons.fastfood_rounded,
                              size: 72,
                              color: Colors.black26,
                            ),
                          ),
                        ),
                      ),
                    )
                  : Container(
                      color: const Color(0xFFF7EFE9),
                      child: const Center(
                        child: Icon(
                          Icons.fastfood_rounded,
                          size: 72,
                          color: Colors.black26,
                        ),
                      ),
                    ),
            ),

            // Top Badges
            Positioned(
              top: 14,
              left: 14,
              right: 14,
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  if (offerBadge.isNotEmpty)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [
                            CustomerPalette.primary,
                            CustomerPalette.primaryDark,
                          ],
                        ),
                        borderRadius: BorderRadius.circular(20),
                        boxShadow: [
                          BoxShadow(
                            color: CustomerPalette.primary.withValues(alpha: 0.35),
                            blurRadius: 8,
                            offset: const Offset(0, 3),
                          ),
                        ],
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(
                            Icons.local_offer_rounded,
                            color: Colors.white,
                            size: 14,
                          ),
                          const SizedBox(width: 5),
                          Text(
                            offerBadge,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 12,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
                    )
                  else
                    const SizedBox.shrink(),

                  // Stock Status Badge
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 5,
                    ),
                    decoration: BoxDecoration(
                      color: _availableStock > 0
                          ? Colors.green.shade50
                          : Colors.red.shade50,
                      borderRadius: BorderRadius.circular(16),
                      border: Border.all(
                        color: _availableStock > 0
                            ? Colors.green.shade300
                            : Colors.red.shade300,
                      ),
                    ),
                    child: Text(
                      _availableStock > 0
                          ? '${_tr('In Stock')} ($_availableStock)'
                          : _tr('Out of stock'),
                      style: TextStyle(
                        color: _availableStock > 0
                            ? Colors.green.shade800
                            : Colors.red.shade800,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeaderSection(bool hasPromo, int discountPercent) {
    final storeName = (widget.store['name'] ?? widget.product.storeName ?? '').toString();
    final categoryName = widget.product.categoryName ?? '';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            if (storeName.isNotEmpty)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: CustomerPalette.secondary.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(
                      Icons.storefront_rounded,
                      size: 14,
                      color: CustomerPalette.secondaryDark,
                    ),
                    const SizedBox(width: 5),
                    Text(
                      storeName,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: CustomerPalette.secondaryDark,
                      ),
                    ),
                  ],
                ),
              ),
            if (storeName.isNotEmpty && categoryName.isNotEmpty)
              const SizedBox(width: 8),
            if (categoryName.isNotEmpty)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(
                    color: CustomerPalette.border.withValues(alpha: 0.6),
                  ),
                ),
                child: Text(
                  categoryName,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: CustomerPalette.textMuted,
                  ),
                ),
              ),
          ],
        ),
        const SizedBox(height: 10),
        Text(
          widget.product.name,
          style: const TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w900,
            color: CustomerPalette.textDark,
            height: 1.25,
          ),
        ),
      ],
    );
  }

  Widget _buildPriceCard(
    bool hasPromo,
    double savingsAmount,
    int discountPercent,
  ) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: CustomerPalette.border.withValues(alpha: 0.6)),
        boxShadow: [
          BoxShadow(
            color: CustomerPalette.primaryDark.withValues(alpha: 0.05),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _tr('Price'),
                style: const TextStyle(
                  fontSize: 12,
                  color: CustomerPalette.textMuted,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 4),
              Row(
                crossAxisAlignment: CrossAxisAlignment.baseline,
                textBaseline: TextBaseline.alphabetic,
                children: [
                  Text(
                    'PKR ${_currentEffectivePrice.toStringAsFixed(0)}',
                    style: const TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w900,
                      color: CustomerPalette.primaryDark,
                    ),
                  ),
                  if (hasPromo) ...[
                    const SizedBox(width: 8),
                    Text(
                      'PKR ${_currentOriginalPrice.toStringAsFixed(0)}',
                      style: const TextStyle(
                        fontSize: 14,
                        color: Colors.grey,
                        decoration: TextDecoration.lineThrough,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),
          if (hasPromo && discountPercent > 0)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              decoration: BoxDecoration(
                color: Colors.red.shade50,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: Colors.red.shade200),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    '$discountPercent% OFF',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w900,
                      color: Colors.red.shade800,
                    ),
                  ),
                  Text(
                    'Save PKR ${savingsAmount.toStringAsFixed(0)}',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: Colors.red.shade700,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildDescriptionCard() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: CustomerPalette.border.withValues(alpha: 0.6)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.info_outline_rounded,
                size: 18,
                color: CustomerPalette.primary,
              ),
              const SizedBox(width: 8),
              Text(
                _tr('Description'),
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  color: CustomerPalette.textDark,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            widget.product.description!.trim(),
            style: const TextStyle(
              fontSize: 13.5,
              color: CustomerPalette.textDark,
              height: 1.5,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildVariantsSection() {
    final variants = widget.product.sizeVariants;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: CustomerPalette.border.withValues(alpha: 0.6)),
        boxShadow: [
          BoxShadow(
            color: CustomerPalette.primaryDark.withValues(alpha: 0.05),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  const Icon(
                    Icons.tune_rounded,
                    size: 18,
                    color: CustomerPalette.primary,
                  ),
                  const SizedBox(width: 8),
                  Text(
                    _tr('Select Variant / Size'),
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      color: CustomerPalette.textDark,
                    ),
                  ),
                ],
              ),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: CustomerPalette.primary.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '${variants.length} ${_tr('Options')}',
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: CustomerPalette.primaryDark,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),

          // Variant Cards Grid/Wrap
          Wrap(
            spacing: 10,
            runSpacing: 10,
            children: variants.map((variant) {
              final isSelected = _selectedVariant?.sizeId == variant.sizeId &&
                  _selectedVariant?.unitId == variant.unitId;
              final variantEffectivePrice = variant.effectivePrice;
              final variantOriginalPrice =
                  variant.originalPrice ?? variant.price;
              final hasVariantPromo =
                  variantEffectivePrice < variantOriginalPrice;

              return InkWell(
                onTap: () {
                  setState(() {
                    _selectedVariant = variant;
                  });
                },
                borderRadius: BorderRadius.circular(14),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 200),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    color: isSelected
                        ? CustomerPalette.primary.withValues(alpha: 0.10)
                        : Colors.grey.shade50,
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(
                      color: isSelected
                          ? CustomerPalette.primary
                          : Colors.grey.shade300,
                      width: isSelected ? 2 : 1,
                    ),
                    boxShadow: isSelected
                        ? [
                            BoxShadow(
                              color: CustomerPalette.primary.withValues(alpha: 0.15),
                              blurRadius: 8,
                              offset: const Offset(0, 2),
                            ),
                          ]
                        : null,
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        isSelected
                            ? Icons.radio_button_checked
                            : Icons.radio_button_off,
                        size: 18,
                        color: isSelected
                            ? CustomerPalette.primary
                            : Colors.grey.shade400,
                      ),
                      const SizedBox(width: 8),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            variant.displayLabel,
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: isSelected
                                  ? FontWeight.w800
                                  : FontWeight.w600,
                              color: isSelected
                                  ? CustomerPalette.primaryDark
                                  : CustomerPalette.textDark,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Row(
                            children: [
                              Text(
                                'PKR ${variantEffectivePrice.toStringAsFixed(0)}',
                                style: TextStyle(
                                  fontSize: 12,
                                  fontWeight: FontWeight.bold,
                                  color: isSelected
                                      ? CustomerPalette.primary
                                      : CustomerPalette.textMuted,
                                ),
                              ),
                              if (hasVariantPromo) ...[
                                const SizedBox(width: 4),
                                Text(
                                  'PKR ${variantOriginalPrice.toStringAsFixed(0)}',
                                  style: TextStyle(
                                    fontSize: 10,
                                    color: Colors.grey.shade500,
                                    decoration: TextDecoration.lineThrough,
                                  ),
                                ),
                              ],
                            ],
                          ),
                        ],
                      ),
                      if (variant.offerBadge != null &&
                          variant.offerBadge!.trim().isNotEmpty) ...[
                        const SizedBox(width: 8),
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 6,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: CustomerPalette.secondary.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            variant.offerBadge!,
                            style: const TextStyle(
                              fontSize: 9.5,
                              color: CustomerPalette.secondaryDark,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildQuantitySection() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: CustomerPalette.border.withValues(alpha: 0.6)),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _tr('Quantity'),
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  color: CustomerPalette.textDark,
                ),
              ),
              if (_isBxgyOffer)
                Text(
                  'Bundle: $_bxgyBundleQty pcs',
                  style: const TextStyle(
                    fontSize: 11,
                    color: CustomerPalette.secondaryDark,
                    fontWeight: FontWeight.w700,
                  ),
                ),
            ],
          ),
          Container(
            decoration: BoxDecoration(
              color: CustomerPalette.background,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: CustomerPalette.border),
            ),
            child: Row(
              children: [
                IconButton(
                  icon: const Icon(Icons.remove_rounded),
                  color: _quantity > 1 ? CustomerPalette.primary : Colors.grey,
                  iconSize: 20,
                  onPressed: _quantity > 1 ? _decrementQuantity : null,
                ),
                Container(
                  constraints: const BoxConstraints(minWidth: 36),
                  alignment: Alignment.center,
                  child: Text(
                    '$_quantity',
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w900,
                      color: CustomerPalette.textDark,
                    ),
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.add_rounded),
                  color: _quantity < _availableStock
                      ? CustomerPalette.primary
                      : Colors.grey,
                  iconSize: 20,
                  onPressed: _quantity < _availableStock
                      ? _incrementQuantity
                      : null,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRelatedItemsSection(List<Product> relatedItems) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Row(
              children: [
                const Icon(
                  Icons.auto_awesome_rounded,
                  size: 18,
                  color: CustomerPalette.secondary,
                ),
                const SizedBox(width: 8),
                Text(
                  _tr('Related Items'),
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                    color: CustomerPalette.textDark,
                  ),
                ),
              ],
            ),
            Text(
              '${relatedItems.length} ${_tr('Items')}',
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: CustomerPalette.textMuted,
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),

        // Horizontal scrolling related cards
        SizedBox(
          height: 190,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            physics: const BouncingScrollPhysics(),
            itemCount: relatedItems.length,
            separatorBuilder: (context, index) => const SizedBox(width: 12),
            itemBuilder: (ctx, index) {
              final item = relatedItems[index];
              return _buildRelatedProductCard(item);
            },
          ),
        ),
      ],
    );
  }

  Widget _buildRelatedProductCard(Product item) {
    final itemImage = ApiService.getImageUrl(item.imageUrl);
    final variantCount = item.sizeVariants.length;

    return Container(
      width: 130,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: CustomerPalette.border.withValues(alpha: 0.5)),
        boxShadow: [
          BoxShadow(
            color: CustomerPalette.primaryDark.withValues(alpha: 0.05),
            blurRadius: 8,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(16),
          onTap: () {
            // Push detail screen for related item
            Navigator.of(context).push(
              MaterialPageRoute(
                builder: (ctx) => ProductDetailScreen(
                  product: item,
                  store: widget.store,
                  isOpen: widget.isOpen,
                  isGlobalBlocked: widget.isGlobalBlocked,
                  storeProducts: widget.storeProducts,
                ),
              ),
            );
          },
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Image
              ClipRRect(
                borderRadius: const BorderRadius.vertical(top: Radius.circular(16)),
                child: SizedBox(
                  height: 85,
                  width: double.infinity,
                  child: itemImage.isNotEmpty
                      ? Image.network(
                          itemImage,
                          fit: BoxFit.cover,
                          errorBuilder: (ctx, err, _) => Container(
                            color: Colors.grey.shade200,
                            child: const Icon(
                              Icons.fastfood_rounded,
                              size: 28,
                              color: Colors.grey,
                            ),
                          ),
                        )
                      : Container(
                          color: Colors.grey.shade200,
                          child: const Icon(
                            Icons.fastfood_rounded,
                            size: 28,
                            color: Colors.grey,
                          ),
                        ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(8.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: CustomerPalette.textDark,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'PKR ${item.effectivePrice.toStringAsFixed(0)}',
                      style: const TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w800,
                        color: CustomerPalette.primary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    if (variantCount > 1)
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 5,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: CustomerPalette.secondary.withValues(alpha: 0.1),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          '$variantCount ${_tr('Options')}',
                          style: const TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.w700,
                            color: CustomerPalette.secondaryDark,
                          ),
                        ),
                      )
                    else
                      Text(
                        _tr('View Details'),
                        style: const TextStyle(
                          fontSize: 9.5,
                          color: CustomerPalette.textMuted,
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBottomBar(bool canAddToCart, double totalPrice) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 16,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: Row(
        children: [
          // Total price section
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                _tr('Total'),
                style: const TextStyle(
                  fontSize: 12,
                  color: CustomerPalette.textMuted,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'PKR ${totalPrice.toStringAsFixed(0)}',
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w900,
                  color: CustomerPalette.primaryDark,
                ),
              ),
            ],
          ),
          const SizedBox(width: 20),

          // Add to Cart Button
          Expanded(
            child: SizedBox(
              height: 50,
              child: ElevatedButton.icon(
                onPressed: canAddToCart ? _addToCart : null,
                icon: const Icon(Icons.add_shopping_cart_rounded, size: 20),
                label: Text(
                  widget.isGlobalBlocked
                      ? _tr('Unavailable')
                      : (!widget.isOpen
                          ? _tr('CLOSED')
                          : (_availableStock > 0
                              ? _tr('Add to Cart')
                              : _tr('Out of stock'))),
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                style: ElevatedButton.styleFrom(
                  backgroundColor: CustomerPalette.primary,
                  foregroundColor: Colors.white,
                  disabledBackgroundColor: Colors.grey.shade300,
                  disabledForegroundColor: Colors.grey.shade600,
                  elevation: canAddToCart ? 2 : 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
