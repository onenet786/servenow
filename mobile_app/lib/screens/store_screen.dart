import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/cart_item.dart';
import '../models/product.dart';
import '../services/api_service.dart';
import '../services/notifier.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../utils/cart_counts.dart';
import '../utils/customer_language.dart';
import '../widgets/ui/ui.dart';
import 'product_detail_screen.dart';

class StoreScreen extends StatefulWidget {
  final int storeId;

  const StoreScreen({super.key, required this.storeId});

  @override
  State<StoreScreen> createState() => _StoreScreenState();
}

class _StoreScreenState extends State<StoreScreen> {
  late Future<Map<String, dynamic>> _storeDetailsFuture;
  Map<String, dynamic>? _globalStatus;
  Timer? _globalStatusRefreshTimer;
  bool _isUrdu = false;
  String? _category;

  @override
  void initState() {
    super.initState();
    _loadLanguagePreference();
    _storeDetailsFuture = ApiService.getStoreDetails(widget.storeId);
    _loadGlobalStatus();
  }

  Future<void> _loadLanguagePreference() async {
    final isUrdu = await CustomerLanguage.loadIsUrdu();
    if (!mounted) return;
    setState(() => _isUrdu = isUrdu);
  }

  String _tr(String text) => CustomerLanguage.tr(_isUrdu, text);

  Future<void> _refresh() async {
    setState(() {
      _storeDetailsFuture = ApiService.getStoreDetails(
        widget.storeId,
        forceRefresh: true,
      );
    });
    await _loadGlobalStatus();
    await _storeDetailsFuture;
  }

  Future<void> _loadGlobalStatus() async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;
      final status = await ApiService.getGlobalDeliveryStatus(token);
      if (!mounted) return;
      setState(() => _globalStatus = status);
      _scheduleGlobalStatusRefresh(status);
    } catch (_) {}
  }

  @override
  void dispose() {
    _globalStatusRefreshTimer?.cancel();
    super.dispose();
  }

  bool _toBool(dynamic value) {
    if (value is bool) return value;
    if (value is num) return value != 0;
    if (value is String) {
      final normalized = value.trim().toLowerCase();
      return normalized == 'true' || normalized == '1' || normalized == 'yes';
    }
    return false;
  }

  DateTime? _parseDateTime(dynamic raw) {
    final value = (raw ?? '').toString().trim();
    if (value.isEmpty) return null;
    return DateTime.tryParse(value)?.toLocal();
  }

  void _scheduleGlobalStatusRefresh(Map<String, dynamic>? status) {
    _globalStatusRefreshTimer?.cancel();
    if (status == null) return;

    final now = DateTime.now();
    final startAt = _parseDateTime(status['start_at']);
    final endAt = _parseDateTime(status['end_at']);
    final candidates = <DateTime>[
      if (startAt != null && startAt.isAfter(now)) startAt,
      if (endAt != null && endAt.isAfter(now)) endAt,
    ];
    if (candidates.isEmpty) return;

    candidates.sort();
    final nextTick = candidates.first;
    final delay = nextTick.difference(now) + const Duration(seconds: 1);
    _globalStatusRefreshTimer = Timer(delay, _loadGlobalStatus);
  }

  bool _isGlobalWindowActive(Map<String, dynamic> status) {
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

  bool _isGlobalStatusVisible(Map<String, dynamic>? status) {
    if (status == null) return false;
    if (!_toBool(status['is_enabled'])) return false;
    return _isGlobalWindowActive(status);
  }

  bool _isGlobalOrderingBlocked(Map<String, dynamic>? status) {
    if (!_isGlobalStatusVisible(status)) return false;
    if (status == null) return false;
    if (_toBool(status['block_ordering_active'])) return true;
    return _toBool(status['block_ordering']) && _isGlobalWindowActive(status);
  }

  String _globalStatusMessage(Map<String, dynamic>? status) {
    if (status == null) return _tr('Ordering is temporarily unavailable.');
    final message = (status['status_message'] ?? '').toString().trim();
    final when = _formatDeliveryWindow(status['start_at'], status['end_at']);
    if (message.isNotEmpty && when.isNotEmpty) return '$message ($when)';
    if (message.isNotEmpty) return message;
    if (when.isNotEmpty) return '${_tr('Delivery update')}: $when';
    final title = (status['title'] ?? '').toString().trim();
    if (title.isNotEmpty) return title;
    return _tr('Ordering is temporarily unavailable.');
  }

  String _formatDeliveryWindow(dynamic startRaw, dynamic endRaw) {
    final start = Fmt.dateTime(startRaw);
    final end = Fmt.dateTime(endRaw);
    if (start.isEmpty || end.isEmpty) return '';
    final window = '$start - $end';
    return _isUrdu ? Fmt.isolate(window) : window;
  }

  // ---------------------------------------------------------------------------
  // Cart actions (same checks as ProductDetailScreen._addToCart)
  // ---------------------------------------------------------------------------

  int _stepFor(Product product, ProductVariant? variant) {
    final isBxgy = variant?.isBxgyOffer ?? product.isBxgyOffer;
    final bundle = variant?.bxgyBundleQty ?? product.bxgyBundleQty;
    return isBxgy && bundle > 1 ? bundle : 1;
  }

  /// Why a product cannot be ordered right now, or null when it can.
  String? _blockReason(Product product, bool storeOpen, bool globalBlocked) {
    if (globalBlocked) return _tr('Unavailable');
    if (!storeOpen) return _tr('Closed');
    if (!product.isAvailable) return _tr('Unavailable');
    if (!product.isTimeAvailable) return _tr('Outside Hours');
    if (product.stockQuantity <= 0) return _tr('Out of stock');
    return null;
  }

  bool _guardCanAdd(Product product, bool storeOpen, bool globalBlocked) {
    if (globalBlocked) {
      Notifier.error(
        context,
        _tr('Ordering is temporarily unavailable.'),
        duration: const Duration(seconds: 4),
        sanitize: false,
      );
      return false;
    }
    if (!storeOpen) {
      Notifier.error(
        context,
        _tr(
          'This store is currently closed. You cannot place orders at this time.',
        ),
        duration: const Duration(seconds: 4),
        sanitize: false,
      );
      return false;
    }
    if (!product.isTimeAvailable) {
      final window = product.availabilityWindow;
      Notifier.info(
        context,
        window != null
            ? '${_tr("Available only during")} $window'
            : _tr('Item is currently outside available hours'),
      );
      return false;
    }
    if (product.stockQuantity <= 0 || !product.isAvailable) {
      Notifier.info(context, _tr('Out of stock'));
      return false;
    }
    return true;
  }

  void _addToCart(
    Product product,
    ProductVariant? variant,
    int quantity, {
    required bool storeOpen,
    required bool globalBlocked,
  }) {
    if (!_guardCanAdd(product, storeOpen, globalBlocked)) return;
    final cart = Provider.of<CartProvider>(context, listen: false);
    final existing = cart.items.firstWhere(
      (item) =>
          item.product.id == product.id &&
          item.variant?.sizeId == variant?.sizeId &&
          item.variant?.unitId == variant?.unitId,
      orElse: () => CartItem(product: product, quantity: 0),
    );
    if (existing.quantity + quantity > product.stockQuantity) {
      Notifier.info(
        context,
        '${_tr('Only')} ${product.stockQuantity} ${_tr('available')}',
      );
      return;
    }
    try {
      final warning = cart.addItem(product, quantity, variant: variant);
      if (warning != null) Notifier.info(context, warning);
    } catch (e) {
      Notifier.error(context, e.toString());
    }
  }

  void _decrementInCart(Product product) {
    final cart = Provider.of<CartProvider>(context, listen: false);
    final lines = cart.items.where((i) => i.product.id == product.id).toList();
    if (lines.isEmpty) return;
    final line = lines.last;
    final step = _stepFor(product, line.variant);
    cart.updateCartItemQuantity(line, line.quantity - step);
  }

  Future<void> _openOptionsSheet(
    Product product, {
    required bool storeOpen,
    required bool globalBlocked,
  }) async {
    final variants = product.sizeVariants;
    var selected = variants.isNotEmpty ? variants.first : null;
    var quantity = _stepFor(product, selected);

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (sheetContext) {
        return LanguageScope(
          isUrdu: _isUrdu,
          child: StatefulBuilder(
            builder: (context, setSheet) {
              final step = _stepFor(product, selected);
              final unit = selected?.effectivePrice ?? product.effectivePrice;
              return SafeArea(
                child: ConstrainedBox(
                  constraints: BoxConstraints(
                    maxHeight: MediaQuery.sizeOf(context).height * 0.8,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: AppSpace.gutter,
                        ),
                        child: Row(
                          children: [
                            AppNetworkImage(
                              url: ApiService.getImageUrl(product.imageUrl),
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
                                    product.name,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: AppText.title,
                                  ),
                                  Text(
                                    _tr('Choose a size'),
                                    style: AppText.small,
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: AppSpace.md),
                      Flexible(
                        child: ListView(
                          shrinkWrap: true,
                          padding: const EdgeInsets.symmetric(
                            horizontal: AppSpace.sm,
                          ),
                          children: variants.map((v) {
                            final isSel =
                                v.sizeId == selected?.sizeId &&
                                v.unitId == selected?.unitId;
                            return ListTile(
                              minTileHeight: 52,
                              onTap: () => setSheet(() {
                                selected = v;
                                quantity = _stepFor(product, v);
                              }),
                              leading: Icon(
                                isSel
                                    ? Icons.radio_button_checked_rounded
                                    : Icons.radio_button_off_rounded,
                                color: isSel
                                    ? AppColors.primary
                                    : AppColors.muted,
                              ),
                              title: Text(
                                Fmt.unit(v.displayLabel).isEmpty
                                    ? v.displayLabel
                                    : Fmt.unit(v.displayLabel),
                              ),
                              trailing: PriceText(
                                v.effectivePrice,
                                original: v.isBxgyOffer
                                    ? null
                                    : (v.originalPrice ?? v.price),
                                urdu: _isUrdu,
                                style: AppText.bodyStrong,
                              ),
                            );
                          }).toList(),
                        ),
                      ),
                      const Divider(),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(
                          AppSpace.gutter,
                          AppSpace.sm,
                          AppSpace.gutter,
                          AppSpace.md,
                        ),
                        child: Row(
                          children: [
                            QuantityStepper(
                              quantity: quantity,
                              onDecrement: quantity - step >= 1
                                  ? () => setSheet(() => quantity -= step)
                                  : null,
                              onIncrement:
                                  quantity + step <= product.stockQuantity
                                  ? () => setSheet(() => quantity += step)
                                  : null,
                            ),
                            const SizedBox(width: AppSpace.md),
                            Expanded(
                              child: PrimaryButton(
                                label:
                                    '${_tr('Add')} · ${Fmt.money(unit * quantity, urdu: _isUrdu)}',
                                onPressed: () {
                                  Navigator.of(sheetContext).pop();
                                  _addToCart(
                                    product,
                                    selected,
                                    quantity,
                                    storeOpen: storeOpen,
                                    globalBlocked: globalBlocked,
                                  );
                                },
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        );
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final cart = context.watch<CartProvider>();
    final units = cart.totalUnits;

    return LanguageScope(
      isUrdu: _isUrdu,
      child: Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(
          title: Text(_tr('Store Details')),
          actions: [
            IconButton(
              tooltip: _tr('Open cart'),
              onPressed: () => Navigator.of(context).pushNamed('/cart'),
              icon: Badge(
                isLabelVisible: units > 0,
                label: Text(units > 99 ? '99+' : '$units'),
                child: const Icon(Icons.shopping_cart_outlined),
              ),
            ),
            const SizedBox(width: AppSpace.xs),
          ],
        ),
        bottomNavigationBar: units > 0
            ? CartBar(
                itemCount: units,
                total: cart.totalAmount,
                label: _tr('View cart'),
                itemsLabel: _isUrdu
                    ? ''
                    : Fmt.count(units, 'item'),
                urdu: _isUrdu,
                onTap: () => Navigator.of(context).pushNamed('/cart'),
              )
            : null,
        body: FutureBuilder<Map<String, dynamic>>(
          future: _storeDetailsFuture,
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return _buildSkeleton();
            } else if (snapshot.hasError) {
              return EmptyState(
                icon: Icons.wifi_off_rounded,
                isError: true,
                title: _tr('Could not load this store'),
                message: _tr('Check your connection and try again.'),
                actionLabel: _tr('Retry'),
                actionIcon: Icons.refresh_rounded,
                onAction: _refresh,
              );
            }

            final data = snapshot.data;
            if (data == null || data['success'] != true) {
              return EmptyState(
                icon: Icons.storefront_outlined,
                title: _tr('Store not found'),
                actionLabel: _tr('Back'),
                actionIcon: Icons.arrow_back_rounded,
                onAction: () => Navigator.of(context).maybePop(),
              );
            }

            final store = Map<String, dynamic>.from(data['store'] as Map);
            final bool isOpen =
                store['is_open'] == true || store['is_open'] == 1;
            final productsList = data['products'] as List<dynamic>? ?? [];
            final activeCampaigns =
                data['active_store_campaigns'] as List<dynamic>? ?? [];
            final products = productsList
                .map((json) => Product.fromJson(json))
                .toList();
            final isGlobalBlocked = _isGlobalOrderingBlocked(_globalStatus);
            final showGlobalBanner = _isGlobalStatusVisible(_globalStatus);

            final categories = <String>[];
            for (final p in products) {
              final c = (p.categoryName ?? '').trim();
              if (c.isNotEmpty && !categories.contains(c)) categories.add(c);
            }
            final visible = _category == null
                ? products
                : products
                      .where((p) => (p.categoryName ?? '').trim() == _category)
                      .toList();

            final width = MediaQuery.sizeOf(context).width;
            final columns = width >= 1000 ? 4 : (width >= 700 ? 3 : 2);
            final tileWidth =
                (width - AppSpace.gutter * 2 - AppSpace.md * (columns - 1)) /
                columns;
            final tileExtent = tileWidth * 3 / 4 + (_isUrdu ? 150 : 118);

            return RefreshIndicator(
              onRefresh: _refresh,
              child: CustomScrollView(
                slivers: [
                  SliverToBoxAdapter(
                    child: _buildStoreHeader(
                      store,
                      isOpen,
                      showGlobalBanner,
                      isGlobalBlocked,
                      activeCampaigns,
                    ),
                  ),
                  if (categories.length > 1)
                    SliverPersistentHeader(
                      pinned: true,
                      delegate: _CategoryTabsDelegate(
                        height: _isUrdu ? 64 : 56,
                        child: _buildCategoryTabs(categories),
                      ),
                    ),
                  SliverToBoxAdapter(
                    child: SectionHeader(
                      title: _category ?? _tr('Menu'),
                      subtitle: _isUrdu
                          ? '${Fmt.isolate('${visible.length}')} ${_tr('Items')}'
                          : Fmt.count(visible.length, 'item'),
                      padding: const EdgeInsets.fromLTRB(
                        AppSpace.gutter,
                        AppSpace.lg,
                        AppSpace.gutter,
                        AppSpace.md,
                      ),
                    ),
                  ),
                  if (visible.isEmpty)
                    SliverToBoxAdapter(
                      child: EmptyState(
                        compact: true,
                        icon: Icons.inventory_2_outlined,
                        title: _tr('No products yet'),
                        message: _tr(
                          'This store has not added products. Please check back later.',
                        ),
                      ),
                    )
                  else
                    SliverPadding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppSpace.gutter,
                      ),
                      sliver: SliverGrid.builder(
                        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: columns,
                          crossAxisSpacing: AppSpace.md,
                          mainAxisSpacing: AppSpace.md,
                          mainAxisExtent: tileExtent,
                        ),
                        itemCount: visible.length,
                        itemBuilder: (context, index) => _buildProductCard(
                          context,
                          visible[index],
                          isOpen,
                          isGlobalBlocked,
                          store: store,
                          storeProducts: products,
                        ),
                      ),
                    ),
                  const SliverToBoxAdapter(
                    child: SizedBox(height: AppSpace.xxxl),
                  ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }

  Widget _buildSkeleton() {
    return Shimmer(
      child: ListView(
        padding: const EdgeInsets.all(AppSpace.gutter),
        physics: const NeverScrollableScrollPhysics(),
        children: [
          const Row(
            children: [
              SkeletonBox(width: 76, height: 76, radius: AppRadius.control),
              SizedBox(width: AppSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SkeletonBox(width: 180, height: 20),
                    SizedBox(height: AppSpace.sm),
                    SkeletonBox(width: 140, height: 12),
                    SizedBox(height: AppSpace.sm),
                    SkeletonBox(width: 60, height: 20, radius: 999),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpace.xl),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            crossAxisSpacing: AppSpace.md,
            mainAxisSpacing: AppSpace.md,
            childAspectRatio: 0.72,
            children: List.generate(
              4,
              (_) => const Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(child: SkeletonBox(radius: AppRadius.card)),
                  SizedBox(height: AppSpace.sm),
                  SkeletonBox(width: 120, height: 14),
                  SizedBox(height: AppSpace.sm),
                  SkeletonBox(width: 70, height: 14),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStoreHeader(
    Map<String, dynamic> store,
    bool isOpen,
    bool showGlobalBanner,
    bool isGlobalBlocked,
    List<dynamic> activeCampaigns,
  ) {
    final closedReason = (store['status_message'] ?? '').toString().trim();
    final rating = Fmt.toDouble(store['rating']);
    final eta = Fmt.eta(store['delivery_time']);
    final hours = Fmt.hours(
      store['opening_time']?.toString(),
      store['closing_time']?.toString(),
    );
    String iso(String s) => _isUrdu ? Fmt.isolate(s) : s;

    Widget meta(IconData icon, String text, {Color? iconColor}) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: iconColor ?? AppColors.muted),
          const SizedBox(width: 4),
          Text(
            text,
            style: AppText.small.copyWith(
              color: AppColors.text,
              fontWeight: FontWeight.w600,
              fontFeatures: AppText.tabular,
            ),
          ),
        ],
      );
    }

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
          if (showGlobalBanner)
            Container(
              width: double.infinity,
              margin: const EdgeInsets.only(bottom: AppSpace.md),
              padding: const EdgeInsets.all(AppSpace.md),
              decoration: BoxDecoration(
                color: isGlobalBlocked
                    ? AppColors.dangerBg
                    : AppColors.warningBg,
                borderRadius: AppRadius.controlAll,
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(
                    isGlobalBlocked
                        ? Icons.block_rounded
                        : Icons.info_outline_rounded,
                    color: isGlobalBlocked
                        ? AppColors.danger
                        : AppColors.warning,
                  ),
                  const SizedBox(width: AppSpace.sm),
                  Expanded(
                    child: Text(
                      _globalStatusMessage(_globalStatus),
                      style: AppText.small.copyWith(
                        color: isGlobalBlocked
                            ? AppColors.danger
                            : AppColors.warning,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                decoration: BoxDecoration(
                  borderRadius: AppRadius.cardAll,
                  border: Border.all(color: AppColors.border),
                ),
                child: AppNetworkImage(
                  url: ApiService.getImageUrl(store['image_url']),
                  width: 84,
                  height: 84,
                  borderRadius: AppRadius.cardAll,
                ),
              ),
              const SizedBox(width: AppSpace.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      (store['name'] ?? _tr('Unknown Store')).toString(),
                      style: AppText.h1,
                    ),
                    const SizedBox(height: 2),
                    if ((store['location'] ?? '').toString().isNotEmpty)
                      Text(
                        (store['location'] ?? '').toString(),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.small,
                      ),
                    const SizedBox(height: AppSpace.sm),
                    OpenBadge(
                      isOpen: isOpen,
                      openLabel: _tr('Open now'),
                      closedLabel: _tr('Closed'),
                    ),
                  ],
                ),
              ),
            ],
          ),
          if (!isOpen && closedReason.isNotEmpty) ...[
            const SizedBox(height: AppSpace.sm),
            Text(
              closedReason,
              style: AppText.small.copyWith(color: AppColors.warning),
            ),
          ],
          const SizedBox(height: AppSpace.md),
          Wrap(
            spacing: AppSpace.lg,
            runSpacing: AppSpace.sm,
            children: [
              if (rating > 0)
                meta(
                  Icons.star_rounded,
                  rating.toStringAsFixed(1),
                  iconColor: AppColors.star,
                ),
              if (eta.isNotEmpty)
                meta(Icons.delivery_dining_outlined, iso(eta)),
              if (hours.isNotEmpty)
                meta(Icons.access_time_rounded, iso(hours)),
            ],
          ),
          if (activeCampaigns.isNotEmpty) ...[
            const SizedBox(height: AppSpace.md),
            _buildStorePromotionsBanner(activeCampaigns),
          ],
        ],
      ),
    );
  }

  Widget _buildStorePromotionsBanner(List<dynamic> campaigns) {
    final visibleCampaigns = campaigns.take(3).toList();

    String badgeFor(dynamic campaign) {
      if (campaign is! Map) return _tr('Offer');
      final rawType = (campaign['campaign_type'] ?? '')
          .toString()
          .toLowerCase();
      if (rawType == 'bxgy') {
        final buy = int.tryParse((campaign['buy_qty'] ?? '').toString()) ?? 1;
        final get = int.tryParse((campaign['get_qty'] ?? '').toString()) ?? 1;
        return 'Buy $buy Get $get Free';
      }
      final value =
          double.tryParse((campaign['discount_value'] ?? '').toString()) ?? 0;
      final discountType = (campaign['discount_type'] ?? '')
          .toString()
          .toLowerCase();
      if (discountType == 'percent') {
        final text = value.truncateToDouble() == value
            ? value.toStringAsFixed(0)
            : value.toStringAsFixed(1);
        return '$text% OFF';
      }
      return '${Fmt.money(value)} OFF';
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpace.md),
      decoration: BoxDecoration(
        color: AppColors.tint50,
        borderRadius: AppRadius.controlAll,
        border: Border.all(color: AppColors.tint200),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.local_offer_outlined,
            color: AppColors.primaryPressed,
            size: 20,
          ),
          const SizedBox(width: AppSpace.sm),
          Expanded(
            child: Wrap(
              spacing: AppSpace.sm,
              runSpacing: AppSpace.xs,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                Text(
                  _tr('Offers'),
                  style: AppText.bodyStrong.copyWith(
                    color: AppColors.primaryDeep,
                  ),
                ),
                ...visibleCampaigns.map(
                  (c) => TonePill.success(
                    _isUrdu ? Fmt.isolate(badgeFor(c)) : badgeFor(c),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCategoryTabs(List<String> categories) {
    final all = <String?>[null, ...categories];
    return Container(
      color: AppColors.background,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpace.gutter,
          vertical: AppSpace.sm,
        ),
        itemCount: all.length,
        separatorBuilder: (_, _) => const SizedBox(width: AppSpace.sm),
        itemBuilder: (context, index) {
          final value = all[index];
          final selected = value == _category;
          return ChoiceChip(
            selected: selected,
            label: Text(value ?? _tr('All')),
            side: BorderSide(
              color: selected ? AppColors.primary : AppColors.border,
            ),
            onSelected: (_) => setState(() => _category = value),
          );
        },
      ),
    );
  }

  Widget _buildProductCard(
    BuildContext context,
    Product product,
    bool isOpen,
    bool isGlobalBlocked, {
    required Map<String, dynamic> store,
    required List<Product> storeProducts,
  }) {
    final variants = product.sizeVariants;
    final multiVariant = variants.length > 1;
    final offerBadge = (product.offerBadge ?? '').trim();
    final blockReason = _blockReason(product, isOpen, isGlobalBlocked);
    final inCart = context.select<CartProvider, int>(
      (c) => c.quantityOf(product.id),
    );

    void openDetail() {
      Navigator.of(context).push(
        MaterialPageRoute(
          builder: (ctx) => ProductDetailScreen(
            product: product,
            store: store,
            isOpen: isOpen,
            isGlobalBlocked: isGlobalBlocked,
            storeProducts: storeProducts,
          ),
        ),
      );
    }

    // Price: single price, or "from" the cheapest option.
    Widget price;
    String? hint;
    if (variants.isEmpty) {
      price = PriceText(
        product.effectivePrice,
        original: product.isBxgyOffer
            ? null
            : (product.originalPrice ?? product.price),
        urdu: _isUrdu,
        style: AppText.bodyStrong.copyWith(fontWeight: FontWeight.w800),
      );
    } else if (!multiVariant) {
      final v = variants.first;
      price = PriceText(
        v.effectivePrice,
        original: v.isBxgyOffer ? null : (v.originalPrice ?? v.price),
        urdu: _isUrdu,
        style: AppText.bodyStrong.copyWith(fontWeight: FontWeight.w800),
      );
      final label = Fmt.unit(v.displayLabel);
      hint = label.isEmpty ? null : (_isUrdu ? Fmt.isolate(label) : label);
    } else {
      final cheapest = variants
          .map((v) => v.effectivePrice)
          .reduce((a, b) => a < b ? a : b);
      price = Text(
        '${_tr('from')} ${Fmt.money(cheapest, urdu: _isUrdu)}',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
        style: AppText.bodyStrong.copyWith(
          fontWeight: FontWeight.w800,
          fontFeatures: AppText.tabular,
        ),
      );
      hint = _isUrdu
          ? '${Fmt.isolate('${variants.length}')} ${_tr('sizes')}'
          : '${variants.length} ${_tr('sizes')}';
    }

    Widget action;
    if (blockReason != null) {
      action = Text(
        blockReason,
        style: AppText.caption.copyWith(fontWeight: FontWeight.w700),
      );
    } else if (inCart > 0) {
      action = QuantityStepper(
        compact: true,
        quantity: inCart,
        onDecrement: () => _decrementInCart(product),
        onIncrement: () {
          if (multiVariant) {
            _openOptionsSheet(
              product,
              storeOpen: isOpen,
              globalBlocked: isGlobalBlocked,
            );
          } else {
            final v = variants.isEmpty ? null : variants.first;
            _addToCart(
              product,
              v,
              _stepFor(product, v),
              storeOpen: isOpen,
              globalBlocked: isGlobalBlocked,
            );
          }
        },
      );
    } else {
      action = Semantics(
        button: true,
        label: '${_tr('Add')} ${product.name}',
        excludeSemantics: true,
        child: SizedBox(
          height: 36,
          child: FilledButton(
            style: FilledButton.styleFrom(
              minimumSize: const Size(56, 36),
              padding: const EdgeInsets.symmetric(horizontal: 12),
              textStyle: AppText.label.copyWith(fontSize: 13),
            ),
            onPressed: () {
              if (multiVariant) {
                _openOptionsSheet(
                  product,
                  storeOpen: isOpen,
                  globalBlocked: isGlobalBlocked,
                );
                return;
              }
              final v = variants.isEmpty ? null : variants.first;
              _addToCart(
                product,
                v,
                _stepFor(product, v),
                storeOpen: isOpen,
                globalBlocked: isGlobalBlocked,
              );
            },
            child: Text(_tr('ADD')),
          ),
        ),
      );
    }

    return ProductCard(
      name: product.name,
      imageUrl: ApiService.getImageUrl(product.imageUrl),
      price: price,
      hint: hint,
      badge: offerBadge.isEmpty ? null : offerBadge,
      action: action,
      dimmed: blockReason != null,
      onTap: openDetail,
    );
  }
}

class _CategoryTabsDelegate extends SliverPersistentHeaderDelegate {
  final double height;
  final Widget child;

  _CategoryTabsDelegate({required this.height, required this.child});

  @override
  double get minExtent => height;

  @override
  double get maxExtent => height;

  @override
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: AppColors.background,
        border: overlapsContent || shrinkOffset > 0
            ? const Border(bottom: BorderSide(color: AppColors.border))
            : null,
      ),
      child: child,
    );
  }

  @override
  bool shouldRebuild(_CategoryTabsDelegate oldDelegate) =>
      oldDelegate.child != child || oldDelegate.height != height;
}
