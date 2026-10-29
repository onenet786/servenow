import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../models/product.dart';
import '../models/cart_item.dart';
import '../providers/cart_provider.dart';
import '../services/api_service.dart';
import 'package:servenow/services/notifier.dart';
import '../utils/cart_counts.dart';
import '../utils/customer_language.dart';
import '../widgets/ui/ui.dart';

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

    if (!widget.product.isTimeAvailable) {
      final window = widget.product.availabilityWindow;
      Notifier.info(
        context,
        window != null
            ? '${_tr("Available only during")} $window'
            : _tr('Item is currently outside available hours'),
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
        isStoreOpen &&
        !widget.isGlobalBlocked &&
        widget.product.isCurrentlyAvailable &&
        _availableStock > 0;

    final relatedItems = _relatedProducts;
    final units = context.select<CartProvider, int>((c) => c.totalUnits);
    final storeName = (widget.store['name'] ?? '').toString();

    return LanguageScope(
      isUrdu: _isUrdu,
      child: Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(
          title: Text(
            storeName,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppText.title,
          ),
          actions: [
            CartIconButton(
              count: units,
              tooltip: _tr('Open cart'),
              onPressed: () => Navigator.of(context).pushNamed('/cart'),
            ),
            const SizedBox(width: AppSpace.xs),
          ],
        ),
        bottomNavigationBar: _buildBottomBar(canAddToCart, totalPrice),
        body: ListView(
          padding: const EdgeInsets.only(bottom: AppSpace.xxl),
          children: [
            _buildImageCard(context, discountPercent),
            Container(
              color: AppColors.surface,
              padding: const EdgeInsets.fromLTRB(
                AppSpace.gutter,
                AppSpace.lg,
                AppSpace.gutter,
                AppSpace.lg,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildHeaderSection(hasPromo, savingsAmount),
                  if (widget.product.description != null &&
                      widget.product.description!.trim().isNotEmpty) ...[
                    const SizedBox(height: AppSpace.md),
                    _buildDescription(),
                  ],
                ],
              ),
            ),
            // One option is not a choice: its unit is shown under the name
            // instead of a one-row "Select Variant / Size" list.
            if (widget.product.sizeVariants.length > 1) ...[
              const SizedBox(height: AppSpace.sm),
              _buildVariantsSection(),
            ],
            const SizedBox(height: AppSpace.sm),
            _buildQuantitySection(),
            if (relatedItems.isNotEmpty) ...[
              const SizedBox(height: AppSpace.sm),
              _buildRelatedItemsSection(relatedItems),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildImageCard(BuildContext context, int discountPercent) {
    final badge = _currentOfferBadge;
    return AspectRatio(
      aspectRatio: 4 / 3,
      child: Stack(
        fit: StackFit.expand,
        children: [
          Hero(
            tag: 'product_image_${widget.product.id}',
            child: AppNetworkImage(
              url: ApiService.getImageUrl(widget.product.imageUrl),
              placeholderIcon: Icons.fastfood_outlined,
            ),
          ),
          if (badge.isNotEmpty || discountPercent > 0)
            PositionedDirectional(
              top: AppSpace.md,
              start: AppSpace.md,
              child: TonePill.warning(
                badge.isNotEmpty ? badge : '$discountPercent% OFF',
                icon: Icons.local_offer_outlined,
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildHeaderSection(bool hasPromo, double savingsAmount) {
    final product = widget.product;
    final String? stockNote;
    if (!widget.isOpen) {
      stockNote = _tr('Store is closed');
    } else if (!product.isAvailable || _availableStock <= 0) {
      stockNote = _tr('Out of stock');
    } else if (!product.isTimeAvailable) {
      stockNote = product.availabilityWindow != null
          ? '${_tr('Available only during')} ${product.availabilityWindow}'
          : _tr('Outside Hours');
    } else if (_availableStock <= 10) {
      stockNote = '${_tr('Only')} $_availableStock ${_tr('left')}';
    } else {
      stockNote = null;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        BidiText(product.name, style: AppText.h1),
        if ((product.categoryName ?? '').trim().isNotEmpty) ...[
          const SizedBox(height: 2),
          Text(product.categoryName!.trim(), style: AppText.small),
        ],
        if (product.sizeVariants.length == 1 &&
            Fmt.unit(product.sizeVariants.first.displayLabel).isNotEmpty) ...[
          const SizedBox(height: 2),
          Text(
            _variantLabel(product.sizeVariants.first.displayLabel),
            style: AppText.small.copyWith(color: AppColors.text),
          ),
        ],
        const SizedBox(height: AppSpace.md),
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Expanded(
              child: PriceText(
                _currentEffectivePrice,
                original: hasPromo ? _currentOriginalPrice : null,
                urdu: _isUrdu,
                style: AppText.h2.copyWith(fontWeight: FontWeight.w800),
              ),
            ),
            if (hasPromo)
              TonePill.success(
                '${_tr('You save')} ${Fmt.money(savingsAmount, urdu: _isUrdu)}',
              ),
          ],
        ),
        if (_isBxgyOffer) ...[
          const SizedBox(height: AppSpace.sm),
          TonePill.success(
            _currentOfferBadge.isNotEmpty
                ? _currentOfferBadge
                : _tr('Bundle offer'),
            icon: Icons.redeem_outlined,
          ),
        ],
        if (stockNote != null) ...[
          const SizedBox(height: AppSpace.sm),
          TonePill.warning(stockNote),
        ],
      ],
    );
  }

  Widget _buildDescription() {
    final text = widget.product.description!.trim();
    final latin = Fmt.isMostlyLatin(text);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(_tr('Description'), style: AppText.label),
        const SizedBox(height: 4),
        // The description keeps its own script direction and line height:
        // English prose reads left-aligned at 1.5 even on the Urdu screen,
        // Urdu prose right-aligned at the Nastaliq line height.
        Directionality(
          textDirection: latin ? TextDirection.ltr : TextDirection.rtl,
          child: SizedBox(
            width: double.infinity,
            child: Text(
              text,
              textAlign: TextAlign.start,
              style: AppText.bodySecondary.copyWith(
                height: latin ? 1.5 : AppText.urduLineHeight,
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _sectionCard({required String title, required Widget child}) {
    return Container(
      color: AppColors.surface,
      padding: const EdgeInsets.fromLTRB(
        AppSpace.gutter,
        AppSpace.lg,
        AppSpace.gutter,
        AppSpace.lg,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: AppText.title),
          const SizedBox(height: AppSpace.md),
          child,
        ],
      ),
    );
  }

  /// `1Piece` -> `1 Piece`, kept as one left-to-right run in Urdu so it
  /// does not render as "Piece 1".
  String _variantLabel(String raw) {
    final label = Fmt.unit(raw).isEmpty ? raw : Fmt.unit(raw);
    return _isUrdu ? Fmt.isolate(label) : label;
  }

  Widget _buildVariantsSection() {
    final variants = widget.product.sizeVariants;
    return _sectionCard(
      title: _tr('Select Variant / Size'),
      child: Column(
        children: variants.map((variant) {
          final isSelected =
              _selectedVariant?.sizeId == variant.sizeId &&
              _selectedVariant?.unitId == variant.unitId;
          return Padding(
            padding: const EdgeInsets.only(bottom: AppSpace.sm),
            child: Material(
              color: isSelected ? AppColors.tint50 : AppColors.surface,
              shape: RoundedRectangleBorder(
                borderRadius: AppRadius.controlAll,
                side: BorderSide(
                  color: isSelected ? AppColors.primary : AppColors.border,
                  width: isSelected ? 1.5 : 1,
                ),
              ),
              child: InkWell(
                borderRadius: AppRadius.controlAll,
                onTap: () {
                  setState(() {
                    _selectedVariant = variant;
                    final step = _isBxgyOffer && _bxgyBundleQty > 1
                        ? _bxgyBundleQty
                        : 1;
                    _quantity = step;
                  });
                },
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppSpace.md,
                    vertical: AppSpace.md,
                  ),
                  child: Row(
                    children: [
                      Icon(
                        isSelected
                            ? Icons.radio_button_checked_rounded
                            : Icons.radio_button_off_rounded,
                        color: isSelected
                            ? AppColors.primary
                            : AppColors.muted,
                        size: 22,
                      ),
                      const SizedBox(width: AppSpace.md),
                      Expanded(
                        child: Text(
                          _variantLabel(variant.displayLabel),
                          style: AppText.bodyStrong,
                        ),
                      ),
                      PriceText(
                        variant.effectivePrice,
                        original: variant.isBxgyOffer
                            ? null
                            : (variant.originalPrice ?? variant.price),
                        urdu: _isUrdu,
                        style: AppText.bodyStrong,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildQuantitySection() {
    final step = _isBxgyOffer && _bxgyBundleQty > 1 ? _bxgyBundleQty : 1;
    return _sectionCard(
      title: _tr('Quantity'),
      child: Row(
        children: [
          QuantityStepper(
            quantity: _quantity,
            onDecrement: _quantity - step >= 1 ? _decrementQuantity : null,
            onIncrement: _incrementQuantity,
          ),
          const SizedBox(width: AppSpace.md),
          if (step > 1)
            Expanded(
              child: Text(
                '${_tr('Sold in bundles of')} $step',
                style: AppText.small,
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildRelatedItemsSection(List<Product> relatedItems) {
    return Container(
      color: AppColors.surface,
      padding: const EdgeInsets.only(top: AppSpace.lg, bottom: AppSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
            child: Text(_tr('Related Items'), style: AppText.title),
          ),
          const SizedBox(height: AppSpace.md),
          SizedBox(
            height: _isUrdu ? 236 : 214,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: AppSpace.gutter),
              itemCount: relatedItems.length,
              separatorBuilder: (_, _) => const SizedBox(width: AppSpace.md),
              itemBuilder: (context, index) =>
                  _buildRelatedProductCard(relatedItems[index]),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRelatedProductCard(Product item) {
    final variants = item.sizeVariants;
    final price = variants.isEmpty
        ? item.effectivePrice
        : variants.map((v) => v.effectivePrice).reduce((a, b) => a < b ? a : b);
    final priceLabel = variants.length > 1
        ? '${_tr('from')} ${Fmt.money(price, urdu: _isUrdu)}'
        : Fmt.money(price, urdu: _isUrdu);
    return SizedBox(
      width: 148,
      child: Material(
        color: AppColors.surface,
        shape: const RoundedRectangleBorder(
          borderRadius: AppRadius.cardAll,
          side: BorderSide(color: AppColors.border),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () {
            Navigator.of(context).pushReplacement(
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
              AspectRatio(
                aspectRatio: 4 / 3,
                child: AppNetworkImage(
                  url: ApiService.getImageUrl(item.imageUrl),
                  placeholderIcon: Icons.fastfood_outlined,
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(AppSpace.sm + 2),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.small.copyWith(
                        color: AppColors.text,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      priceLabel,
                      maxLines: 1,
                      style: AppText.bodyStrong.copyWith(
                        fontWeight: FontWeight.w800,
                        fontFeatures: AppText.tabular,
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
    String? reason;
    if (!canAddToCart) {
      if (widget.isGlobalBlocked) {
        reason = _tr('Ordering is temporarily unavailable.');
      } else if (!widget.isOpen) {
        reason = _tr('Store is closed');
      } else if (!widget.product.isTimeAvailable) {
        reason = _tr('Outside Hours');
      } else {
        reason = _tr('Out of stock');
      }
    }
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.border)),
      ),
      child: SafeArea(
        top: false,
        minimum: const EdgeInsets.fromLTRB(
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
                  Fmt.money(totalPrice, urdu: _isUrdu),
                  style: AppText.h2.copyWith(
                    fontWeight: FontWeight.w800,
                    fontFeatures: AppText.tabular,
                  ),
                ),
              ],
            ),
            const SizedBox(width: AppSpace.lg),
            Expanded(
              child: PrimaryButton(
                label: canAddToCart ? _tr('Add to Cart') : reason!,
                icon: canAddToCart ? Icons.add_shopping_cart_rounded : null,
                onPressed: canAddToCart
                    ? () {
                        HapticFeedback.lightImpact();
                        _addToCart();
                      }
                    : null,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
