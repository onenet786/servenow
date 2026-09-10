import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/product.dart';
import '../services/api_service.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../theme/customer_palette.dart';
import '../utils/customer_language.dart';
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

  int _crossAxisCountFor(double width, Orientation orientation) {
    if (orientation == Orientation.landscape) {
      if (width >= 1000) return 3;
      return 2;
    }
    return 2;
  }

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
    final start = DateTime.tryParse((startRaw ?? '').toString());
    final end = DateTime.tryParse((endRaw ?? '').toString());
    if (start == null || end == null) return '';
    final startLocal = start.toLocal();
    final endLocal = end.toLocal();
    return '${startLocal.toString().substring(0, 16)} - ${endLocal.toString().substring(0, 16)}';
  }

  List<List<T>> _chunk<T>(List<T> list, int size) {
    return List.generate(
      (list.length / size).ceil(),
      (i) => list.sublist(
        i * size,
        (i + 1) * size > list.length ? list.length : (i + 1) * size,
      ),
    );
  }

  Widget _buildStorePromotionsBanner(List<dynamic> campaigns) {
    final visibleCampaigns = campaigns.take(3).toList();

    String badgeFor(dynamic campaign) {
      if (campaign is! Map) return _tr('Offer');
      final rawType = (campaign['campaign_type'] ?? '').toString().toLowerCase();
      if (rawType == 'bxgy') {
        final buy = int.tryParse((campaign['buy_qty'] ?? '').toString()) ?? 1;
        final get = int.tryParse((campaign['get_qty'] ?? '').toString()) ?? 1;
        return 'Buy $buy Get $get Free';
      }
      final value =
          double.tryParse((campaign['discount_value'] ?? '').toString()) ?? 0;
      final discountType =
          (campaign['discount_type'] ?? '').toString().toLowerCase();
      if (discountType == 'percent') {
        final text = value.truncateToDouble() == value
            ? value.toStringAsFixed(0)
            : value.toStringAsFixed(1);
        return '$text% OFF';
      }
      return 'PKR ${value.toStringAsFixed(0)} OFF';
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.98),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(
          color: CustomerPalette.primary.withValues(alpha: 0.22),
        ),
        boxShadow: [
          BoxShadow(
            color: CustomerPalette.primaryDark.withValues(alpha: 0.08),
            blurRadius: 14,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: CustomerPalette.primary.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(
                  Icons.local_offer_rounded,
                  color: CustomerPalette.primary,
                  size: 19,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  _tr('Active Store Promotions'),
                  style: const TextStyle(
                    fontWeight: FontWeight.w900,
                    fontSize: 15,
                    color: CustomerPalette.textDark,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: visibleCampaigns
                .map(
                  (campaign) => Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 7,
                    ),
                    decoration: BoxDecoration(
                      color: CustomerPalette.secondary.withValues(alpha: 0.11),
                      borderRadius: BorderRadius.circular(999),
                      border: Border.all(
                        color: CustomerPalette.secondary.withValues(alpha: 0.22),
                      ),
                    ),
                    child: Text(
                      badgeFor(campaign),
                      style: const TextStyle(
                        color: CustomerPalette.secondaryDark,
                        fontWeight: FontWeight.w800,
                        fontSize: 12,
                      ),
                    ),
                  ),
                )
                .toList(),
          ),
        ],
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
                Color(0xFFFFD8B5),
                Color(0xFFF7B070),
              ],
            ),
          ),
        ),
        Positioned(
          left: -70,
          top: 40,
          child: _buildBlurOrb(
            size: 210,
            colors: const [Color(0x66F2B134), Color(0x00F2B134)],
          ),
        ),
        Positioned(
          right: -30,
          top: 120,
          child: _buildBlurOrb(
            size: 170,
            colors: const [Color(0x55147D7E), Color(0x00147D7E)],
          ),
        ),
        Positioned(
          right: -90,
          bottom: 40,
          child: _buildBlurOrb(
            size: 240,
            colors: const [Color(0x55C9475B), Color(0x00C9475B)],
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
          _tr('Store Details'),
          style: const TextStyle(
            fontWeight: FontWeight.w800,
            color: CustomerPalette.textDark,
          ),
        ),
        actions: [
          Consumer<CartProvider>(
            builder: (ctx, cart, child) => Stack(
              alignment: Alignment.center,
              children: [
                Container(
                  margin: const EdgeInsets.only(right: 10),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.95),
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(color: CustomerPalette.border),
                    boxShadow: [
                      BoxShadow(
                        color: CustomerPalette.primaryDark.withValues(alpha: 0.08),
                        blurRadius: 12,
                        offset: const Offset(0, 6),
                      ),
                    ],
                  ),
                  child: IconButton(
                    icon: const Icon(Icons.shopping_cart_outlined),
                    onPressed: () {
                      Navigator.of(context).pushNamed('/cart');
                    },
                  ),
                ),
                if (cart.itemCount > 0)
                  Positioned(
                    right: 8,
                    top: 6,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 5,
                        vertical: 1,
                      ),
                      decoration: BoxDecoration(
                        color: CustomerPalette.primaryDark,
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
          FutureBuilder<Map<String, dynamic>>(
        future: _storeDetailsFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          } else if (snapshot.hasError) {
            return Center(child: Text('${_tr('Error')}: ${snapshot.error}'));
          }

          final data = snapshot.data;
          if (data == null || data['success'] != true) {
            return Center(child: Text(_tr('Store not found')));
          }

          final store = data['store'];
          final bool isOpen = store['is_open'] == true || store['is_open'] == 1;
          final String closedReason =
              (store['status_message'] ?? '').toString().trim();
          final productsList = data['products'] as List<dynamic>? ?? [];
          final activeCampaigns =
              data['active_store_campaigns'] as List<dynamic>? ?? [];
          final products = productsList
              .map((json) => Product.fromJson(json))
              .toList();
          final media = MediaQuery.of(context);
          final crossAxisCount = _crossAxisCountFor(
            media.size.width,
            media.orientation,
          );

          final chunkedProducts = _chunk(products, crossAxisCount);
          final isGlobalBlocked = _isGlobalOrderingBlocked(_globalStatus);
          final showGlobalBanner = _isGlobalStatusVisible(_globalStatus);

          return RefreshIndicator(
            onRefresh: _refresh,
            child: CustomScrollView(
              slivers: [
                SliverToBoxAdapter(
                  child: Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Column(
                      children: [
                        if (showGlobalBanner)
                          Container(
                            width: double.infinity,
                            margin: const EdgeInsets.only(bottom: 12),
                            padding: const EdgeInsets.all(12),
                            decoration: BoxDecoration(
                              color: Colors.white.withValues(alpha: 0.96),
                              borderRadius: BorderRadius.circular(18),
                              border: Border.all(
                                color: isGlobalBlocked
                                    ? Colors.red.shade200
                                    : CustomerPalette.secondary.withValues(
                                        alpha: 0.28,
                                      ),
                              ),
                            ),
                            child: Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Icon(
                                  isGlobalBlocked
                                      ? Icons.block
                                      : Icons.info_outline,
                                  color: isGlobalBlocked
                                      ? Colors.red.shade700
                                      : Colors.orange.shade800,
                                ),
                                const SizedBox(width: 8),
                                Expanded(
                                  child: Text(
                                    _globalStatusMessage(_globalStatus),
                                    style: TextStyle(
                                      color: isGlobalBlocked
                                          ? Colors.red.shade800
                                          : Colors.orange.shade900,
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        Card(
                          elevation: 2,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(22),
                          ),
                          color: Colors.white.withValues(alpha: 0.98),
                          shadowColor: CustomerPalette.primaryDark.withValues(
                            alpha: 0.12,
                          ),
                          clipBehavior: Clip.antiAlias,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              // Status indicator on a separate row inside the card
                              Container(
                                width: double.infinity,
                                padding: const EdgeInsets.symmetric(
                                  vertical: 4,
                                ),
                                decoration: BoxDecoration(
                                  color: isOpen
                                      ? Colors.green.shade100
                                      : Colors.red.shade100,
                                ),
                                child: Center(
                                  child: Text(
                                    isOpen ? '🟢 ${_tr('OPEN')}' : '🔴 ${_tr('CLOSED')}',
                                    style: TextStyle(
                                      color: isOpen
                                          ? Colors.green.shade800
                                          : Colors.red.shade800,
                                      fontWeight: FontWeight.bold,
                                      fontSize: 10,
                                    ),
                                  ),
                                ),
                              ),
                              if (!isOpen && closedReason.isNotEmpty)
                                Padding(
                                  padding: const EdgeInsets.fromLTRB(12, 6, 12, 0),
                                  child: Text(
                                    closedReason,
                                    style: TextStyle(
                                      color: Colors.red.shade700,
                                      fontSize: 11.5,
                                      fontWeight: FontWeight.w600,
                                    ),
                                  ),
                                ),
                              if (ApiService.getImageUrl(
                                store['image_url'],
                              ).isNotEmpty)
                                Image.network(
                                  ApiService.getImageUrl(store['image_url']),
                                  height: 140,
                                  width: double.infinity,
                                  fit: BoxFit.cover,
                                  errorBuilder: (ctx, err, _) => Container(
                                    height: 140,
                                    color: Colors.grey[300],
                                    child: const Icon(
                                      Icons.store,
                                      size: 64,
                                      color: Colors.grey,
                                    ),
                                  ),
                                ),
                              Padding(
                                padding: const EdgeInsets.all(12.0),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      store['name'],
                                      style: const TextStyle(
                                        fontSize: 20,
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                    const SizedBox(height: 6),
                                    Row(
                                      children: [
                                        const Icon(
                                          Icons.location_on_rounded,
                                          size: 15,
                                          color: Colors.grey,
                                        ),
                                        const SizedBox(width: 4),
                                        Expanded(
                                          child: Text(
                                            store['location'],
                                            style: const TextStyle(
                                      color: CustomerPalette.textMuted,
                                      fontSize: 13,
                                      fontWeight: FontWeight.w500,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 6),
                                    Row(
                                      children: [
                                        const Icon(
                                          Icons.access_time,
                                          size: 15,
                                          color: Colors.green,
                                        ),
                                        const SizedBox(width: 4),
                                        Text(
                                          'Open: ${_formatTimeOnly(store['opening_time'])}',
                                          style: const TextStyle(
                                              color: CustomerPalette.textMuted,
                                              fontSize: 12,
                                              fontWeight: FontWeight.w700,
                                          ),
                                        ),
                                        const SizedBox(width: 12),
                                        const Icon(
                                          Icons.timer_off,
                                          size: 15,
                                          color: Colors.red,
                                        ),
                                        const SizedBox(width: 4),
                                        Text(
                                          'Close: ${_formatTimeOnly(store['closing_time'])}',
                                          style: const TextStyle(
                                              color: CustomerPalette.textMuted,
                                              fontSize: 12,
                                              fontWeight: FontWeight.w700,
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 6),
                                    if (store['rating'] != null)
                                      Row(
                                        children: [
                                          const Icon(
                                            Icons.star_rounded,
                                            size: 15,
                                            color: Colors.amber,
                                          ),
                                          const SizedBox(width: 4),
                                          Text(
                                            '${store['rating']}',
                                            style: const TextStyle(
                                              fontSize: 12.5,
                                              fontWeight: FontWeight.w700,
                                            ),
                                          ),
                                        ],
                                      ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (activeCampaigns.isNotEmpty) ...[
                          const SizedBox(height: 12),
                          _buildStorePromotionsBanner(activeCampaigns),
                        ],
                      ],
                    ),
                  ),
                ),
                SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.symmetric(horizontal: 16.0),
                    child: Text(
                      _tr('Products'),
                      style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w900,
                        color: CustomerPalette.textDark,
                      ),
                    ),
                  ),
                ),
                const SliverToBoxAdapter(child: SizedBox(height: 10)),
                SliverPadding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  sliver: SliverList(
                    delegate: SliverChildBuilderDelegate((context, rowIndex) {
                      final rowItems = chunkedProducts[rowIndex];
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            ...rowItems.map((product) {
                              return Expanded(
                                child: Padding(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 5,
                                  ),
                                  child: _buildProductCard(
                                    context,
                                    product,
                                    crossAxisCount,
                                    isOpen,
                                    isGlobalBlocked,
                                    store: store,
                                    storeProducts: products,
                                  ),
                                ),
                              );
                            }),
                            // Fill empty slots in the last row
                            if (rowItems.length < crossAxisCount)
                              ...List.generate(
                                crossAxisCount - rowItems.length,
                                (index) => const Expanded(child: SizedBox()),
                              ),
                          ],
                        ),
                      );
                    }, childCount: chunkedProducts.length),
                  ),
                ),
                const SliverPadding(padding: EdgeInsets.only(bottom: 50)),
              ],
            ),
          );
        },
      ),
        ],
      ),
    ));
  }

  String _formatTimeOnly(dynamic time) {
    if (time == null) return '--:--';
    final parts = time.toString().split(':');
    if (parts.length >= 2) {
      return '${parts[0]}:${parts[1]}';
    }
    return time.toString();
  }  Widget _buildProductCard(
    BuildContext context,
    Product product,
    int crossAxisCount,
    bool isOpen,
    bool isGlobalBlocked, {
    required Map<String, dynamic> store,
    required List<Product> storeProducts,
  }) {
    final variants = product.sizeVariants;
    final hasVariants = variants.isNotEmpty;

    // Price calculation
    double minPrice = product.effectivePrice;
    double maxPrice = product.effectivePrice;
    if (hasVariants) {
      minPrice = variants
          .map((v) => v.effectivePrice)
          .reduce((a, b) => a < b ? a : b);
      maxPrice = variants
          .map((v) => v.effectivePrice)
          .reduce((a, b) => a > b ? a : b);
    }

    final displayPrice = product.effectivePrice;
    final displayOriginalPrice = product.originalPrice ?? product.price;
    final offerBadge = (product.offerBadge ?? '').trim();
    final isBxgyOffer = product.isBxgyOffer;
    final hasPromo =
        !isBxgyOffer &&
        displayPrice >= 0 &&
        displayPrice + 0.001 < displayOriginalPrice;

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

    if (crossAxisCount == 1) {
      return Card(
        elevation: 2,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        color: Colors.white.withValues(alpha: 0.98),
        shadowColor: CustomerPalette.primaryDark.withValues(alpha: 0.12),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: openDetail,
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Product Image with Offer Badge
                SizedBox(
                  width: 115,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      ApiService.getImageUrl(product.imageUrl).isNotEmpty
                          ? Hero(
                              tag: 'product_image_${product.id}',
                              child: Image.network(
                                ApiService.getImageUrl(product.imageUrl),
                                fit: BoxFit.cover,
                                errorBuilder: (ctx, err, _) => Container(
                                  color: Colors.grey.shade200,
                                  child: const Icon(
                                    Icons.fastfood,
                                    size: 30,
                                    color: Colors.grey,
                                  ),
                                ),
                              ),
                            )
                          : Container(
                              color: Colors.grey.shade200,
                              child: const Center(
                                child: Icon(
                                  Icons.fastfood,
                                  size: 30,
                                  color: Colors.grey,
                                ),
                              ),
                            ),
                      if (offerBadge.isNotEmpty)
                        Positioned(
                          top: 8,
                          left: 8,
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 6,
                              vertical: 3,
                            ),
                            decoration: BoxDecoration(
                              color: CustomerPalette.primary,
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              offerBadge,
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 9,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ),
                        ),
                    ],
                  ),
                ),
                // Product Details
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.all(12.0),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          product.name,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 15,
                            color: CustomerPalette.textDark,
                          ),
                        ),
                        const SizedBox(height: 4),
                        if (hasVariants && minPrice != maxPrice)
                          Text(
                            'PKR ${minPrice.toStringAsFixed(0)} - ${maxPrice.toStringAsFixed(0)}',
                            style: const TextStyle(
                              color: CustomerPalette.primaryDark,
                              fontWeight: FontWeight.w800,
                              fontSize: 14,
                            ),
                          )
                        else if (hasPromo)
                          Row(
                            children: [
                              Text(
                                'PKR ${displayOriginalPrice.toStringAsFixed(0)}',
                                style: const TextStyle(
                                  color: Colors.grey,
                                  fontSize: 12,
                                  decoration: TextDecoration.lineThrough,
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                'PKR ${displayPrice.toStringAsFixed(0)}',
                                style: TextStyle(
                                  color: Colors.red[700],
                                  fontWeight: FontWeight.bold,
                                  fontSize: 14,
                                ),
                              ),
                            ],
                          )
                        else
                          Text(
                            'PKR ${displayPrice.toStringAsFixed(0)}',
                            style: const TextStyle(
                              color: CustomerPalette.primaryDark,
                              fontWeight: FontWeight.bold,
                              fontSize: 14,
                            ),
                          ),
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            if (hasVariants)
                              Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                  vertical: 3,
                                ),
                                decoration: BoxDecoration(
                                  color: CustomerPalette.secondary
                                      .withValues(alpha: 0.12),
                                  borderRadius: BorderRadius.circular(8),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const Icon(
                                      Icons.tune_rounded,
                                      size: 12,
                                      color: CustomerPalette.secondaryDark,
                                    ),
                                    const SizedBox(width: 4),
                                    Text(
                                      '${variants.length} ${_tr('Options')}',
                                      style: const TextStyle(
                                        color: CustomerPalette.secondaryDark,
                                        fontSize: 10.5,
                                        fontWeight: FontWeight.w800,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            const Spacer(),
                            SizedBox(
                              height: 30,
                              child: ElevatedButton(
                                onPressed: (isGlobalBlocked ||
                                        !product.isAvailable ||
                                        product.stockQuantity <= 0)
                                    ? null
                                    : openDetail,
                                style: ElevatedButton.styleFrom(
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 12,
                                  ),
                                  backgroundColor: CustomerPalette.primary,
                                  foregroundColor: Colors.white,
                                  shape: RoundedRectangleBorder(
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  textStyle: const TextStyle(
                                    fontSize: 11.5,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                child: Text(
                                  isGlobalBlocked
                                      ? _tr('Unavailable')
                                      : (!product.isAvailable ||
                                              product.stockQuantity <= 0
                                          ? _tr('Out of stock')
                                          : (hasVariants
                                              ? _tr('Select')
                                              : _tr('Add'))),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    // Grid View Card (crossAxisCount >= 2)
    return Card(
      elevation: 2,
      color: Colors.white.withValues(alpha: 0.98),
      shadowColor: CustomerPalette.primaryDark.withValues(alpha: 0.12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: openDetail,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Image with Offer Badge
            SizedBox(
              height: 100,
              width: double.infinity,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  ApiService.getImageUrl(product.imageUrl).isNotEmpty
                      ? Hero(
                          tag: 'product_image_${product.id}',
                          child: Image.network(
                            ApiService.getImageUrl(product.imageUrl),
                            width: double.infinity,
                            fit: BoxFit.cover,
                            errorBuilder: (ctx, err, _) => Container(
                              color: Colors.grey.shade200,
                              child: const Icon(
                                Icons.fastfood,
                                size: 28,
                                color: Colors.grey,
                              ),
                            ),
                          ),
                        )
                      : Container(
                          color: Colors.grey.shade200,
                          child: const Center(
                            child: Icon(
                              Icons.fastfood,
                              size: 28,
                              color: Colors.grey,
                            ),
                          ),
                        ),
                  if (offerBadge.isNotEmpty)
                    Positioned(
                      top: 6,
                      left: 6,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: CustomerPalette.primary,
                          borderRadius: BorderRadius.circular(6),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.2),
                              blurRadius: 4,
                            ),
                          ],
                        ),
                        child: Text(
                          offerBadge,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 8.5,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                      ),
                    ),
                  if (hasVariants)
                    Positioned(
                      bottom: 6,
                      right: 6,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 2,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.65),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          '${variants.length} ${_tr('Options')}',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 8.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(8.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    product.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 12.5,
                      color: CustomerPalette.textDark,
                    ),
                  ),
                  const SizedBox(height: 3),
                  if (hasVariants && minPrice != maxPrice)
                    Text(
                      'PKR ${minPrice.toStringAsFixed(0)}+',
                      style: const TextStyle(
                        color: CustomerPalette.primaryDark,
                        fontSize: 11.5,
                        fontWeight: FontWeight.w800,
                      ),
                    )
                  else if (hasPromo)
                    Wrap(
                      crossAxisAlignment: WrapCrossAlignment.center,
                      spacing: 4,
                      children: [
                        Text(
                          'PKR ${displayOriginalPrice.toStringAsFixed(0)}',
                          style: const TextStyle(
                            color: Colors.grey,
                            fontSize: 9,
                            decoration: TextDecoration.lineThrough,
                          ),
                        ),
                        Text(
                          'PKR ${displayPrice.toStringAsFixed(0)}',
                          style: TextStyle(
                            color: Colors.red[700],
                            fontSize: 11.5,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    )
                  else
                    Text(
                      'PKR ${displayPrice.toStringAsFixed(0)}',
                      style: const TextStyle(
                        color: CustomerPalette.primaryDark,
                        fontSize: 11.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  const SizedBox(height: 6),
                  SizedBox(
                    width: double.infinity,
                    height: 28,
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        padding: EdgeInsets.zero,
                        backgroundColor: CustomerPalette.primary,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(8),
                        ),
                        elevation: 0,
                      ),
                      onPressed: (isGlobalBlocked ||
                              !product.isAvailable ||
                              product.stockQuantity <= 0)
                          ? null
                          : openDetail,
                      child: Text(
                        isGlobalBlocked
                            ? _tr('Unavailable')
                            : (!product.isAvailable ||
                                    product.stockQuantity <= 0
                                ? _tr('Out of stock')
                                : (hasVariants
                                    ? _tr('Options')
                                    : _tr('Add'))),
                        style: const TextStyle(
                          fontSize: 10,
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
      ),
    );
  }
}
