import 'package:flutter/material.dart';
import 'package:geocoding/geocoding.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';

import '../models/product.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../theme/customer_palette.dart';

class CustomerTileDemoScreen extends StatefulWidget {
  const CustomerTileDemoScreen({super.key});

  @override
  State<CustomerTileDemoScreen> createState() => _CustomerTileDemoScreenState();
}

class _CustomerTileDemoScreenState extends State<CustomerTileDemoScreen> {
  final TextEditingController _searchController = TextEditingController();

  List<Map<String, dynamic>> _stores = [];
  List<Map<String, dynamic>> _filteredStores = [];
  Map<String, dynamic>? _selectedStore;
  List<Product> _products = [];
  double? _userLat;
  double? _userLng;
  String? _userCity;
  bool _isLoadingStores = true;
  bool _isLoadingProducts = false;
  String? _errorMessage;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _loadStores();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadStores() async {
    setState(() {
      _isLoadingStores = true;
      _errorMessage = null;
    });

    try {
      final auth = Provider.of<AuthProvider>(context, listen: false);
      await _resolveLocationContext();
      List<Map<String, dynamic>> rawStores = const <Map<String, dynamic>>[];
      try {
        final response = await ApiService.getStores(
          latitude: _userLat,
          longitude: _userLng,
          city: _userCity,
        );
        rawStores = (response['stores'] as List<dynamic>? ?? const <dynamic>[])
            .whereType<Map>()
            .map((store) => store.cast<String, dynamic>())
            .toList();
      } catch (_) {}

      if (rawStores.isEmpty && auth.token != null) {
        try {
          final adminStores = await ApiService.getStoresForAdmin(
            auth.token!,
            includeInactive: true,
          );
          rawStores = adminStores
              .whereType<Map>()
              .map((store) => store.cast<String, dynamic>())
              .toList();
        } catch (_) {}
      }

      if (rawStores.isEmpty) {
        throw Exception(
          'Store load failed from ${ApiService.baseUrl}. No stores were returned by the customer or admin feed.',
        );
      }

      rawStores.sort(_compareStores);

      if (!mounted) return;
      setState(() {
        _stores = rawStores;
        _filteredStores = _applyQuery(_searchController.text, rawStores);
        _isLoadingStores = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _errorMessage =
            'Store load failed from ${ApiService.baseUrl}: ${error.toString()}';
        _isLoadingStores = false;
      });
    }
  }

  Future<void> _openStore(Map<String, dynamic> store) async {
    final int? storeId = _toInt(store['id']);
    if (storeId == null || storeId <= 0) return;

    setState(() {
      _selectedStore = store;
      _products = [];
      _isLoadingProducts = true;
      _errorMessage = null;
    });

    try {
      final auth = Provider.of<AuthProvider>(context, listen: false);
      Map<String, dynamic> response;
      try {
        response = await ApiService.getStoreDetails(storeId);
      } catch (_) {
        response = await ApiService.getStoreDetails(
          storeId,
          token: auth.token,
          admin: auth.token != null,
        );
      }
      final storeData = (response['store'] is Map)
          ? (response['store'] as Map).cast<String, dynamic>()
          : store;
      final products = (response['products'] as List<dynamic>? ?? const [])
          .whereType<Map>()
          .map((json) => Product.fromJson(json.cast<String, dynamic>()))
          .toList();

      if (!mounted) return;
      setState(() {
        _selectedStore = storeData;
        _products = products;
        _isLoadingProducts = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _errorMessage =
            'Store details failed from ${ApiService.baseUrl}: ${error.toString()}';
        _isLoadingProducts = false;
      });
    }
  }

  Future<void> _refresh() async {
    if (_selectedStore != null) {
      await _openStore(_selectedStore!);
      return;
    }
    await _loadStores();
  }

  void _backToStores() {
    setState(() {
      _selectedStore = null;
      _products = [];
      _errorMessage = null;
    });
  }

  void _handleSearch(String query) {
    setState(() {
      _filteredStores = _applyQuery(query, _stores);
    });
  }

  Future<void> _resolveLocationContext() async {
    try {
      if (_userLat != null && _userLng != null) return;
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) return;
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        return;
      }
      final position = await Geolocator.getCurrentPosition();
      _userLat = position.latitude;
      _userLng = position.longitude;
      try {
        final places = await placemarkFromCoordinates(
          position.latitude,
          position.longitude,
        );
        if (places.isNotEmpty) {
          _userCity =
              (places.first.locality ?? places.first.subAdministrativeArea ?? '')
                  .toString()
                  .trim();
        }
      } catch (_) {}
    } catch (_) {}
  }

  List<Map<String, dynamic>> _applyQuery(
    String query,
    List<Map<String, dynamic>> source,
  ) {
    final q = query.trim().toLowerCase();
    if (q.isEmpty) return List<Map<String, dynamic>>.from(source);
    return source.where((store) {
      final name = (store['name'] ?? '').toString().toLowerCase();
      final location = (store['location'] ?? '').toString().toLowerCase();
      final category = (store['category_name'] ?? '').toString().toLowerCase();
      return name.contains(q) || location.contains(q) || category.contains(q);
    }).toList();
  }

  int _compareStores(Map<String, dynamic> a, Map<String, dynamic> b) {
    final openCompare = _boolToInt(_isOpenStore(b)).compareTo(
      _boolToInt(_isOpenStore(a)),
    );
    if (openCompare != 0) return openCompare;

    final ratingCompare = _readDouble(
      b['rating'],
    ).compareTo(_readDouble(a['rating']));
    if (ratingCompare != 0) return ratingCompare;

    return (a['name'] ?? '').toString().compareTo((b['name'] ?? '').toString());
  }

  int _boolToInt(bool value) => value ? 1 : 0;

  bool _isOpenStore(Map<String, dynamic> store) {
    final value = store['is_open'];
    return value == true || value == 1 || value?.toString() == '1';
  }

  int? _toInt(dynamic value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    return int.tryParse(value?.toString() ?? '');
  }

  double _readDouble(dynamic value) {
    if (value is num) return value.toDouble();
    return double.tryParse(value?.toString() ?? '') ?? 0;
  }

  String _avatarText(String value) {
    final words = value
        .trim()
        .split(RegExp(r'\s+'))
        .where((part) => part.isNotEmpty)
        .toList();
    if (words.isEmpty) return 'SN';
    if (words.length == 1) {
      return words.first.substring(0, words.first.length.clamp(0, 2)).toUpperCase();
    }
    return '${words.first[0]}${words[1][0]}'.toUpperCase();
  }

  ProductVariant? _primaryVariant(Product product) {
    if (product.sizeVariants.isEmpty) return null;
    return product.sizeVariants.first;
  }

  double _displayPrice(Product product) {
    final variant = _primaryVariant(product);
    return variant?.effectivePrice ?? product.effectivePrice;
  }

  String _productSubtitle(Product product) {
    final variant = _primaryVariant(product);
    if (variant != null) return variant.displayLabel;
    final description = (product.description ?? '').trim();
    if (description.isNotEmpty) return description;
    return product.categoryName?.trim().isNotEmpty == true
        ? product.categoryName!.trim()
        : 'Store product';
  }

  List<String> _variantLabels(Product product) {
    final labels = <String>[];
    for (final variant in product.sizeVariants) {
      final label = variant.displayLabel.trim();
      if (label.isNotEmpty && !labels.contains(label)) {
        labels.add(label);
      }
    }
    return labels;
  }

  int _gridCountForWidth(double width) {
    if (width >= 1100) return 4;
    if (width >= 820) return 3;
    return 2;
  }

  double _productAspectRatioForWidth(double width) {
    if (width >= 1100) return 0.82;
    if (width >= 820) return 0.76;
    return 0.54;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(_selectedStore == null ? 'Customer Tile Demo' : 'Store Preview'),
      ),
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              Color(0xFF0D4F96),
              Color(0xFF1761B3),
              Color(0xFFF5E3A7),
            ],
            stops: [0, 0.38, 1],
          ),
        ),
        child: SafeArea(
          child: RefreshIndicator(
            onRefresh: _refresh,
            child: LayoutBuilder(
              builder: (context, constraints) {
                final horizontalPadding = constraints.maxWidth >= 900 ? 28.0 : 16.0;
                return ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: EdgeInsets.fromLTRB(
                    horizontalPadding,
                    18,
                    horizontalPadding,
                    28,
                  ),
                  children: [
                    _buildHeroCard(),
                    const SizedBox(height: 18),
                    if (_selectedStore == null)
                      _buildStoreBrowser(constraints.maxWidth)
                    else
                      _buildSelectedStoreView(constraints.maxWidth),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildHeroCard() {
    final subtitle = _selectedStore == null
        ? 'Live demo using real stores from the current database.'
        : 'Live products for ${(_selectedStore?['name'] ?? 'selected store').toString()}.';

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        gradient: const LinearGradient(
          colors: [Color(0xFFFFF3C7), Color(0xFFFFE3A2)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        border: Border.all(color: const Color(0xFF0A4C8B), width: 3),
        boxShadow: const [
          BoxShadow(
            color: Color(0x2B091B36),
            blurRadius: 24,
            offset: Offset(0, 12),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            decoration: BoxDecoration(
              color: const Color(0xFF0A4C8B),
              borderRadius: BorderRadius.circular(999),
            ),
            child: const Text(
              'Live data preview',
              style: TextStyle(
                color: Colors.white,
                fontWeight: FontWeight.w800,
                letterSpacing: 0.4,
              ),
            ),
          ),
          const SizedBox(height: 12),
          const Text(
            'Alternate customer browse flow',
            style: TextStyle(
              color: Color(0xFF0E3057),
              fontWeight: FontWeight.w900,
              fontSize: 28,
              height: 1.0,
            ),
          ),
          const SizedBox(height: 10),
          Text(
            subtitle,
            style: const TextStyle(
              color: Color(0xFF35556F),
              height: 1.4,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStoreBrowser(double width) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: _sectionDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Store Tiles',
            style: TextStyle(
              color: Color(0xFF1761B3),
              fontWeight: FontWeight.w900,
              letterSpacing: 1.1,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Browse real stores from the database',
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  color: const Color(0xFF102D4B),
                  fontWeight: FontWeight.w900,
                ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Tap any store tile to load its actual products into this alternate customer preview.',
            style: TextStyle(
              color: Color(0xFF47637B),
              height: 1.35,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _searchController,
            onChanged: _handleSearch,
            decoration: InputDecoration(
              hintText: 'Search stores by name or location',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _searchController.text.isEmpty
                  ? null
                  : IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () {
                        _searchController.clear();
                        _handleSearch('');
                      },
                    ),
            ),
          ),
          const SizedBox(height: 14),
          _buildStatusBanner(),
          const SizedBox(height: 12),
          if (_isLoadingStores)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 48),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_filteredStores.isEmpty)
            _buildEmptyState(
              title: 'No stores found',
              subtitle: _stores.isEmpty
                  ? 'There are no stores available right now.'
                  : 'Try a different search term.',
            )
          else
            GridView.builder(
              itemCount: _filteredStores.length,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: _gridCountForWidth(width),
                mainAxisSpacing: 14,
                crossAxisSpacing: 14,
                childAspectRatio: 0.68,
              ),
              itemBuilder: (context, index) {
                return _buildStoreTile(_filteredStores[index], index);
              },
            ),
        ],
      ),
    );
  }

  Widget _buildSelectedStoreView(double width) {
    final store = _selectedStore!;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: _sectionDecoration(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(
            spacing: 10,
            runSpacing: 10,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              OutlinedButton.icon(
                onPressed: _backToStores,
                icon: const Icon(Icons.arrow_back),
                label: const Text('Back to stores'),
              ),
              _pill(
                _isOpenStore(store) ? 'Open now' : 'Closed',
                _isOpenStore(store)
                    ? const Color(0xFF166534)
                    : const Color(0xFFB91C1C),
              ),
              if (((store['delivery_time'] ?? '').toString().trim()).isNotEmpty)
                _pill(
                  '${store['delivery_time']} min',
                  const Color(0xFF0F766E),
                ),
              if (_readDouble(store['rating']) > 0)
                _pill(
                  '${_readDouble(store['rating']).toStringAsFixed(1)} rating',
                  const Color(0xFFD97706),
                ),
            ],
          ),
          const SizedBox(height: 14),
          _buildStoreHero(store),
          const SizedBox(height: 18),
          Row(
            children: [
              Expanded(
                child: Text(
                  'Products',
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        color: const Color(0xFF102D4B),
                        fontWeight: FontWeight.w900,
                      ),
                ),
              ),
              Text(
                '${_products.length} items',
                style: const TextStyle(
                  color: Color(0xFF47637B),
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          _buildStatusBanner(),
          const SizedBox(height: 12),
          if (_isLoadingProducts)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 48),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_products.isEmpty)
            _buildEmptyState(
              title: 'No products available',
              subtitle: 'This store does not have products to preview yet.',
            )
          else
            GridView.builder(
              itemCount: _products.length,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: _gridCountForWidth(width),
                mainAxisSpacing: 14,
                crossAxisSpacing: 14,
                childAspectRatio: _productAspectRatioForWidth(width),
              ),
              itemBuilder: (context, index) {
                return _buildProductTile(_products[index], index);
              },
            ),
        ],
      ),
    );
  }

  Widget _buildStoreHero(Map<String, dynamic> store) {
    final imageUrl = ApiService.getImageUrl(store['image_url']?.toString());
    final location = (store['location'] ?? 'Location not available').toString();
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.92),
        borderRadius: BorderRadius.circular(24),
        border: Border.all(color: const Color(0xFFD4C293), width: 2),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildMediaFrame(
            title: (store['name'] ?? 'Store').toString(),
            imageUrl: imageUrl,
            size: 92,
            accent: const Color(0xFF3B82F6),
            soft: const Color(0xFFBFDBFE),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  (store['name'] ?? 'Store').toString(),
                  style: const TextStyle(
                    fontWeight: FontWeight.w900,
                    fontSize: 24,
                    color: Color(0xFF11385D),
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  location,
                  style: const TextStyle(
                    color: Color(0xFF5B6F7F),
                    height: 1.3,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                if (((store['status_message'] ?? '').toString().trim()).isNotEmpty)
                  Text(
                    (store['status_message'] ?? '').toString(),
                    style: TextStyle(
                      color: _isOpenStore(store)
                          ? const Color(0xFF14532D)
                          : const Color(0xFF991B1B),
                      fontWeight: FontWeight.w700,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStoreTile(Map<String, dynamic> store, int index) {
    final featured = index == 0;
    final imageUrl = ApiService.getImageUrl(store['image_url']?.toString());
    final theme = _paletteForIndex(index);
    final deliveryLabel = ((store['delivery_time'] ?? '').toString().trim()).isNotEmpty
        ? '${store['delivery_time']} min'
        : 'Preview';

    return InkWell(
      borderRadius: BorderRadius.circular(24),
      onTap: () => _openStore(store),
      child: Stack(
        clipBehavior: Clip.none,
        children: [
          Container(
            padding: const EdgeInsets.fromLTRB(14, 28, 14, 14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(24),
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: featured
                    ? [const Color(0xFFB7F05A), const Color(0xFF85CC2F)]
                    : [const Color(0xFFF8EDD1), const Color(0xFFEEDCB6)],
              ),
              border: Border.all(
                color: featured ? const Color(0xFF4D8F22) : const Color(0xFFD5C49F),
                width: 2.5,
              ),
              boxShadow: const [
                BoxShadow(
                  color: Color(0x26000000),
                  blurRadius: 12,
                  offset: Offset(0, 8),
                ),
              ],
            ),
            child: Column(
              children: [
                _buildMediaFrame(
                  title: (store['name'] ?? 'Store').toString(),
                  imageUrl: imageUrl,
                  size: 70,
                  accent: theme.accent,
                  soft: theme.soft,
                ),
                const SizedBox(height: 12),
                Text(
                  (store['name'] ?? 'Store').toString(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontWeight: FontWeight.w900,
                    fontSize: 17,
                    color: Color(0xFF11385D),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  (store['location'] ?? 'Unknown location').toString(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: 11.5,
                    color: Color(0xFF5B6F7F),
                  ),
                ),
                const SizedBox(height: 10),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      _isOpenStore(store) ? Icons.verified : Icons.lock_clock,
                      size: 14,
                      color: _isOpenStore(store)
                          ? const Color(0xFF166534)
                          : const Color(0xFFB91C1C),
                    ),
                    const SizedBox(width: 4),
                    Flexible(
                      child: Text(
                        _isOpenStore(store) ? 'Open now' : 'Closed',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontWeight: FontWeight.w800,
                          fontSize: 11,
                          color: _isOpenStore(store)
                              ? const Color(0xFF166534)
                              : const Color(0xFFB91C1C),
                        ),
                      ),
                    ),
                  ],
                ),
                const Spacer(),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(14),
                    gradient: LinearGradient(
                      colors: featured
                          ? [const Color(0xFF6DA728), const Color(0xFF4A8218)]
                          : [const Color(0xFFE4D7BC), const Color(0xFFD7C9A7)],
                    ),
                    border: Border.all(
                      color: featured ? const Color(0xFF477616) : const Color(0xFFC1B18B),
                    ),
                  ),
                  child: Text(
                    deliveryLabel,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontWeight: FontWeight.w900,
                      fontSize: 18,
                      color: featured ? Colors.white : const Color(0xFF21384E),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Positioned(
            top: -10,
            left: 12,
            child: _buildRankBadge(index + 1),
          ),
          if (featured)
            const Positioned(
              top: 78,
              right: -8,
              child: Icon(
                Icons.auto_awesome,
                size: 28,
                color: CustomerPalette.accent,
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildProductTile(Product product, int index) {
    final featured = index == 0;
    final theme = _paletteForIndex(index + 1);
    final imageUrl = ApiService.getImageUrl(product.imageUrl);
    final priceLabel = 'PKR ${_displayPrice(product).toStringAsFixed(0)}';
    final variantLabels = _variantLabels(product);
    final previewLabels =
        variantLabels.length > 3 ? variantLabels.take(3).toList() : variantLabels;

    return Stack(
      clipBehavior: Clip.none,
      children: [
        Container(
          padding: const EdgeInsets.fromLTRB(14, 24, 14, 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(24),
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: featured
                  ? [const Color(0xFFFFD18B), const Color(0xFFF5A43C)]
                  : [const Color(0xFFF8EDD1), const Color(0xFFEEDCB6)],
            ),
            border: Border.all(
              color: featured ? const Color(0xFFC96A13) : const Color(0xFFD5C49F),
              width: 2.5,
            ),
            boxShadow: const [
              BoxShadow(
                color: Color(0x26000000),
                blurRadius: 12,
                offset: Offset(0, 8),
              ),
            ],
          ),
          child: Column(
            children: [
              _buildMediaFrame(
                title: product.name,
                imageUrl: imageUrl,
                size: 70,
                accent: theme.accent,
                soft: theme.soft,
              ),
              const SizedBox(height: 10),
              Text(
                product.name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontWeight: FontWeight.w900,
                  fontSize: 15.5,
                  color: Color(0xFF11385D),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                _productSubtitle(product),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 11,
                  color: Color(0xFF5B6F7F),
                ),
              ),
              if (previewLabels.isNotEmpty) ...[
                const SizedBox(height: 8),
                Wrap(
                  alignment: WrapAlignment.center,
                  spacing: 6,
                  runSpacing: 4,
                  children: [
                    ...previewLabels.map(_buildVariantChip),
                    if (variantLabels.length > previewLabels.length)
                      _buildVariantChip(
                        '+${variantLabels.length - previewLabels.length} more',
                      ),
                  ],
                ),
              ],
              const SizedBox(height: 8),
              if (product.hasActiveOffer || product.offerBadge?.trim().isNotEmpty == true)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFEF3C7),
                    borderRadius: BorderRadius.circular(999),
                    border: Border.all(color: const Color(0xFFF59E0B)),
                  ),
                  child: Text(
                    product.offerBadge?.trim().isNotEmpty == true
                        ? product.offerBadge!.trim()
                        : 'Offer',
                    style: const TextStyle(
                      color: Color(0xFF92400E),
                      fontWeight: FontWeight.w800,
                      fontSize: 11,
                    ),
                  ),
                ),
              const Spacer(),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.symmetric(vertical: 7),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(14),
                  gradient: const LinearGradient(
                    colors: [Color(0xFF0F6CC9), Color(0xFF0A4B89)],
                  ),
                  border: Border.all(color: const Color(0xFF0A3B69)),
                ),
                child: Text(
                  priceLabel,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                    color: Colors.white,
                  ),
                ),
              ),
            ],
          ),
        ),
        Positioned(
          top: -10,
          left: 12,
          child: _buildRankBadge(index + 1),
        ),
      ],
    );
  }

  Widget _buildMediaFrame({
    required String title,
    required String imageUrl,
    required double size,
    required Color accent,
    required Color soft,
  }) {
    return Container(
      width: size,
      height: size,
      padding: const EdgeInsets.all(5),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(18),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [soft, accent],
        ),
        border: Border.all(color: Colors.white, width: 2.5),
      ),
      child: Container(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(13),
          gradient: const LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [Color(0xFFF4F8FC), Color(0xFFD1DDE8)],
          ),
          border: Border.all(color: const Color(0xFF6C879D), width: 2),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(11),
          child: imageUrl.isNotEmpty
              ? Image.network(
                  imageUrl,
                  fit: BoxFit.cover,
                  errorBuilder: (_, _, _) => _buildAvatarFallback(title, accent),
                )
              : _buildAvatarFallback(title, accent),
        ),
      ),
    );
  }

  Widget _buildVariantChip(String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.84),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: const Color(0xFFD4C293)),
      ),
      child: Text(
        label,
        style: const TextStyle(
          color: Color(0xFF6B4F1D),
          fontWeight: FontWeight.w800,
          fontSize: 10.5,
        ),
      ),
    );
  }

  Widget _buildAvatarFallback(String title, Color accent) {
    return Center(
      child: Text(
        _avatarText(title),
        style: TextStyle(
          color: accent,
          fontWeight: FontWeight.w900,
          fontSize: 18,
          letterSpacing: 0.6,
        ),
      ),
    );
  }

  Widget _buildRankBadge(int rank) {
    return Container(
      width: 42,
      height: 42,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color(0xFF277AD7), Color(0xFF0A4B89)],
        ),
        border: Border.all(color: const Color(0xFFE9CE5D), width: 3),
        boxShadow: const [
          BoxShadow(
            color: Color(0x3F051528),
            blurRadius: 10,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Center(
        child: Text(
          '$rank',
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w900,
            fontSize: 18,
          ),
        ),
      ),
    );
  }

  Widget _buildStatusBanner() {
    if (_errorMessage == null || _errorMessage!.trim().isEmpty) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: const Color(0xFFE0F2FE),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: const Color(0xFF7DD3FC)),
        ),
        child: Text(
          _selectedStore == null
              ? '${_filteredStores.length} stores ready for preview'
              : '${_products.length} products loaded from live data',
          style: const TextStyle(
            color: Color(0xFF075985),
            fontWeight: FontWeight.w800,
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: const Color(0xFFFEF2F2),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFFFCA5A5)),
      ),
      child: Text(
        _errorMessage!,
        style: const TextStyle(
          color: Color(0xFF991B1B),
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }

  Widget _buildEmptyState({
    required String title,
    required String subtitle,
  }) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.86),
        borderRadius: BorderRadius.circular(22),
        border: Border.all(color: const Color(0xFFD5C49F), width: 2),
      ),
      child: Column(
        children: [
          const Icon(Icons.inbox_outlined, size: 34, color: Color(0xFF47637B)),
          const SizedBox(height: 10),
          Text(
            title,
            style: const TextStyle(
              fontWeight: FontWeight.w900,
              color: Color(0xFF11385D),
              fontSize: 18,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            subtitle,
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: Color(0xFF5B6F7F),
              fontWeight: FontWeight.w700,
              height: 1.35,
            ),
          ),
        ],
      ),
    );
  }

  Widget _pill(String text, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: color,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }

  BoxDecoration _sectionDecoration() {
    return BoxDecoration(
      color: Colors.white.withValues(alpha: 0.88),
      borderRadius: BorderRadius.circular(28),
      border: Border.all(color: const Color(0xFF0A4C8B), width: 3),
    );
  }

  _TilePalette _paletteForIndex(int index) {
    const palettes = <_TilePalette>[
      _TilePalette(Color(0xFF0F6CC9), Color(0xFF7ED8FF)),
      _TilePalette(Color(0xFF2E6ACF), Color(0xFFB6E2FF)),
      _TilePalette(Color(0xFFCB7A25), Color(0xFFFFD57A)),
      _TilePalette(Color(0xFF9B6BFF), Color(0xFFF1C2FF)),
      _TilePalette(Color(0xFF3B9F1E), Color(0xFFA7F55C)),
      _TilePalette(Color(0xFFDC2626), Color(0xFFFFCAA9)),
      _TilePalette(Color(0xFF0F766E), Color(0xFF99F6E4)),
    ];
    return palettes[index % palettes.length];
  }
}

class _TilePalette {
  final Color accent;
  final Color soft;

  const _TilePalette(this.accent, this.soft);
}
