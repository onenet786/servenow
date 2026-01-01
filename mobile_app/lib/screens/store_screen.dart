import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/product.dart';
import '../services/api_service.dart';
import '../providers/cart_provider.dart';
import 'package:servenow/services/notifier.dart';

class StoreScreen extends StatefulWidget {
  final int storeId;

  const StoreScreen({super.key, required this.storeId});

  @override
  State<StoreScreen> createState() => _StoreScreenState();
}

class _StoreScreenState extends State<StoreScreen> {
  late Future<Map<String, dynamic>> _storeDetailsFuture;
  final Map<int, String> _selectedVariantKeyByProductId = {};

  String _variantKey(ProductVariant v) {
    return '${v.sizeId ?? 'n'}:${v.unitId ?? 'n'}';
  }

  int _crossAxisCountFor(double width, Orientation orientation) {
    if (orientation == Orientation.landscape) {
      if (width >= 1000) return 2;
      return 1;
    }
    return 1;
  }

  double _mainAxisExtentFor(double width, int crossAxisCount) {
    if (crossAxisCount == 1) return 180; // Horizontal layout height
    const horizontalPadding = 32.0;
    const spacing = 10.0;
    final cardWidth =
        (width - horizontalPadding - (crossAxisCount - 1) * spacing) /
        crossAxisCount;
    if (cardWidth >= 260) return 275;
    if (cardWidth >= 210) return 259;
    return 251;
  }

  @override
  void initState() {
    super.initState();
    _storeDetailsFuture = ApiService.getStoreDetails(widget.storeId);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Store Details'),
        actions: [
          Consumer<CartProvider>(
            builder: (ctx, cart, child) => Stack(
              alignment: Alignment.center,
              children: [
                IconButton(
                  icon: const Icon(Icons.shopping_cart),
                  onPressed: () {
                    Navigator.of(context).pushNamed('/cart');
                  },
                ),
                if (cart.itemCount > 0)
                  Positioned(
                    right: 8,
                    top: 8,
                    child: Container(
                      padding: const EdgeInsets.all(2),
                      decoration: BoxDecoration(
                        color: Colors.red,
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
      body: FutureBuilder<Map<String, dynamic>>(
        future: _storeDetailsFuture,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator());
          } else if (snapshot.hasError) {
            return Center(child: Text('Error: ${snapshot.error}'));
          } else if (!snapshot.hasData || snapshot.data!['success'] != true) {
            return const Center(child: Text('Store not found'));
          }

          final store = snapshot.data!['store'];
          final productsList = snapshot.data!['products'] as List<dynamic>;
          final products = productsList
              .map((json) => Product.fromJson(json))
              .toList();
          final media = MediaQuery.of(context);
          final crossAxisCount = _crossAxisCountFor(
            media.size.width,
            media.orientation,
          );
          final mainAxisExtent = _mainAxisExtentFor(
            media.size.width,
            crossAxisCount,
          );

          return CustomScrollView(
            slivers: [
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: Card(
                    elevation: 4,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(15),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (ApiService.getImageUrl(store['image_url'])
                            .isNotEmpty)
                          Image.network(
                            ApiService.getImageUrl(store['image_url']),
                            height: 200,
                            width: double.infinity,
                            fit: BoxFit.cover,
                            errorBuilder:
                                (ctx, err, _) => Container(
                                  height: 200,
                                  color: Colors.grey[300],
                                  child: const Icon(
                                    Icons.store,
                                    size: 80,
                                    color: Colors.grey,
                                  ),
                                ),
                          ),
                        Padding(
                          padding: const EdgeInsets.all(16.0),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                store['name'],
                                style: const TextStyle(
                                  fontSize: 24,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              const SizedBox(height: 8),
                              Row(
                                children: [
                                  const Icon(
                                    Icons.location_on,
                                    size: 16,
                                    color: Colors.grey,
                                  ),
                                  const SizedBox(width: 4),
                                  Expanded(
                                    child: Text(
                                      store['location'],
                                      style: const TextStyle(
                                        color: Colors.grey,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 4),
                              if (store['rating'] != null)
                                Row(
                                  children: [
                                    const Icon(
                                      Icons.star,
                                      size: 16,
                                      color: Colors.amber,
                                    ),
                                    const SizedBox(width: 4),
                                    Text(
                                      '${store['rating']}',
                                      style: const TextStyle(
                                        fontWeight: FontWeight.bold,
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
                ),
              ),
              const SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.symmetric(horizontal: 16.0),
                  child: Text(
                    'Products',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                ),
              ),
              const SliverToBoxAdapter(child: SizedBox(height: 10)),
              SliverPadding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                sliver: SliverGrid(
                  gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: crossAxisCount,
                    mainAxisExtent: mainAxisExtent,
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                  ),
                  delegate: SliverChildBuilderDelegate((context, index) {
                    final product = products[index];
                    return _buildProductCard(context, product, crossAxisCount);
                  }, childCount: products.length),
                ),
              ),
              const SliverPadding(padding: EdgeInsets.only(bottom: 50)),
            ],
          );
        },
      ),
    );
  }

  Widget _buildProductCard(
    BuildContext context,
    Product product,
    int crossAxisCount,
  ) {
    final variants = product.sizeVariants;
    final selectedVariant =
        variants.isNotEmpty
            ? (() {
              final selectedKey = _selectedVariantKeyByProductId[product.id];
              if (selectedKey == null) return variants.first;
              return variants.firstWhere(
                (v) => _variantKey(v) == selectedKey,
                orElse: () => variants.first,
              );
            })()
            : null;
    final displayPrice = selectedVariant?.price ?? product.price;

    if (crossAxisCount == 1) {
      return Card(
        elevation: 2,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        child: Row(
          children: [
            // Product Image
            SizedBox(
              width: 130,
              height: double.infinity,
              child: ClipRRect(
                borderRadius: const BorderRadius.horizontal(
                  left: Radius.circular(12),
                ),
                child:
                    ApiService.getImageUrl(product.imageUrl).isNotEmpty
                        ? Image.network(
                          ApiService.getImageUrl(product.imageUrl),
                          fit: BoxFit.cover,
                          errorBuilder:
                              (ctx, err, _) => const Icon(
                                Icons.image_not_supported,
                                size: 40,
                              ),
                        )
                        : Container(
                          color: Colors.grey[200],
                          child: const Center(
                            child: Icon(
                              Icons.fastfood,
                              size: 40,
                              color: Colors.grey,
                            ),
                          ),
                        ),
              ),
            ),
            // Product Details
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(12.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      product.name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontWeight: FontWeight.bold,
                        fontSize: 16,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'PKR $displayPrice',
                      style: TextStyle(
                        color: Colors.green[700],
                        fontWeight: FontWeight.bold,
                        fontSize: 15,
                      ),
                    ),
                    if (variants.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      if (variants.length == 1)
                        Text(
                          variants.first.displayLabel,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.grey,
                            fontSize: 12,
                          ),
                        )
                      else
                        SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: Row(
                            children:
                                variants.map((v) {
                                  final key = _variantKey(v);
                                  final isSelected =
                                      selectedVariant != null &&
                                      _variantKey(selectedVariant) == key;
                                  return InkWell(
                                    onTap: () {
                                      setState(() {
                                        _selectedVariantKeyByProductId[product
                                            .id] = key;
                                      });
                                    },
                                    child: Padding(
                                      padding: const EdgeInsets.only(
                                        right: 12.0,
                                      ),
                                      child: Row(
                                        mainAxisSize: MainAxisSize.min,
                                        children: [
                                          SizedBox(
                                            height: 32,
                                            width: 32,
                                            child: // ignore: deprecated_member_use
                                              Radio<String>(
                                              value: key,
                                              // ignore: deprecated_member_use
                                              groupValue:
                                                  selectedVariant == null
                                                      ? null
                                                      : _variantKey(
                                                        selectedVariant,
                                                      ),
                                              // ignore: deprecated_member_use
                                              onChanged: (value) {
                                                if (value == null) return;
                                                setState(() {
                                                  _selectedVariantKeyByProductId[product
                                                      .id] = value;
                                                });
                                              },
                                              materialTapTargetSize:
                                                  MaterialTapTargetSize
                                                      .shrinkWrap,
                                              visualDensity: const VisualDensity(
                                                horizontal:
                                                    VisualDensity.minimumDensity,
                                                vertical:
                                                    VisualDensity.minimumDensity,
                                              ),
                                            ),
                                          ),
                                          const SizedBox(width: 4),
                                          Text(
                                            v.displayLabel,
                                            style: TextStyle(
                                              fontSize: 12,
                                              fontWeight:
                                                  isSelected
                                                      ? FontWeight.bold
                                                      : FontWeight.normal,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  );
                                }).toList(),
                          ),
                        ),
                    ],
                    const Spacer(),
                    SizedBox(
                      width: double.infinity,
                      height: 36,
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.red[900],
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(8),
                          ),
                        ),
                        onPressed:
                            product.isAvailable
                                ? () {
                                  try {
                                    Provider.of<CartProvider>(
                                      context,
                                      listen: false,
                                    ).addItem(
                                      product,
                                      1,
                                      variant: selectedVariant,
                                    );
                                    Notifier.success(context, 'Added to cart', duration: const Duration(seconds: 1));
                                  } catch (e) {
                                    Notifier.error(context, e.toString());
                                  }
                                }
                                : null,
                        child: Text(
                          product.isAvailable ? 'Add to Cart' : 'Unavailable',
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      );
    }

    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            height: 97,
            width: double.infinity,
            child: ClipRRect(
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(10),
              ),
              child:
                  ApiService.getImageUrl(product.imageUrl).isNotEmpty
                      ? Image.network(
                        ApiService.getImageUrl(product.imageUrl),
                        width: double.infinity,
                        fit: BoxFit.cover,
                        errorBuilder:
                            (ctx, err, _) => const Icon(
                              Icons.image_not_supported,
                              size: 40,
                            ),
                      )
                      : Container(
                        color: Colors.grey[200],
                        child: const Center(
                          child: Icon(
                            Icons.fastfood,
                            size: 30,
                            color: Colors.grey,
                          ),
                        ),
                      ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(6.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  product.name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
                Text(
                  'PKR $displayPrice',
                  style: const TextStyle(color: Colors.green),
                ),
                if (variants.isNotEmpty) ...[
                  const SizedBox(height: 4),
                  if (variants.length == 1)
                    Text(
                      variants.first.displayLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Colors.grey),
                    )
                  else
                        SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.start,
                            children:
                                variants.map((v) {
                                  final key = _variantKey(v);
                                  final isSelected =
                                      selectedVariant != null &&
                                      _variantKey(selectedVariant) == key;
                                  return InkWell(
                                    onTap: () {
                                      setState(() {
                                        _selectedVariantKeyByProductId[product
                                            .id] = key;
                                      });
                                    },
                                    child: Padding(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 4.0,
                                      ),
                                      child: Column(
                                        mainAxisSize: MainAxisSize.min,
                                        crossAxisAlignment:
                                            CrossAxisAlignment.center,
                                        children: [
                                          // ignore: deprecated_member_use
                                          Radio<String>(
                                            value: key,
                                            // ignore: deprecated_member_use
                                            groupValue:
                                                selectedVariant == null
                                                    ? null
                                                    : _variantKey(
                                                      selectedVariant,
                                                    ),
                                            // ignore: deprecated_member_use
                                            onChanged: (value) {
                                              if (value == null) return;
                                              setState(() {
                                                _selectedVariantKeyByProductId[product
                                                    .id] = value;
                                              });
                                            },
                                            materialTapTargetSize:
                                                MaterialTapTargetSize.shrinkWrap,
                                            visualDensity: const VisualDensity(
                                              horizontal:
                                                  VisualDensity.minimumDensity,
                                              vertical:
                                                  VisualDensity.minimumDensity,
                                            ),
                                          ),
                                          Text(
                                            v.displayLabel,
                                            style: TextStyle(
                                              fontSize: 9,
                                              fontWeight:
                                                  isSelected
                                                      ? FontWeight.w600
                                                      : FontWeight.w400,
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  );
                                }).toList(),
                          ),
                        ),
                ],
                const SizedBox(height: 5),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      minimumSize: const Size(0, 24),
                      backgroundColor: Colors.red[900],
                      foregroundColor: Colors.white,
                    ),
                    onPressed:
                        product.isAvailable
                            ? () {
                              try {
                                Provider.of<CartProvider>(
                                  context,
                                  listen: false,
                                ).addItem(product, 1, variant: selectedVariant);
                                Notifier.success(context, 'Added to cart', duration: const Duration(seconds: 1));
                              } catch (e) {
                                Notifier.error(context, e.toString());
                              }
                            }
                            : null,
                    child: Text(product.isAvailable ? 'Add' : 'Unavailable'),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
