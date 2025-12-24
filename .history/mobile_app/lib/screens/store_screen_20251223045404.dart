import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/product.dart';
import '../services/api_service.dart';
import '../providers/cart_provider.dart';

class StoreScreen extends StatefulWidget {
  final int storeId;

  const StoreScreen({super.key, required this.storeId});

  @override
  State<StoreScreen> createState() => _StoreScreenState();
}

class _StoreScreenState extends State<StoreScreen> {
  late Future<Map<String, dynamic>> _storeDetailsFuture;
  final Map<int, ProductVariant?> _selectedVariantByProductId = {};

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

          return CustomScrollView(
            slivers: [
              SliverToBoxAdapter(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (ApiService.getImageUrl(store['image_url']).isNotEmpty)
                      Image.network(
                        ApiService.getImageUrl(store['image_url']),
                        height: 200,
                        width: double.infinity,
                        fit: BoxFit.cover,
                        errorBuilder: (ctx, err, _) => Container(
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
                                  style: const TextStyle(color: Colors.grey),
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
                          const SizedBox(height: 16),
                          const Text(
                            'Products',
                            style: TextStyle(
                              fontSize: 20,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              SliverPadding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                sliver: SliverGrid(
                  gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                    crossAxisCount: 2,
                    childAspectRatio: 0.75,
                    crossAxisSpacing: 10,
                    mainAxisSpacing: 10,
                  ),
                  delegate: SliverChildBuilderDelegate((context, index) {
                    final product = products[index];
                    return _buildProductCard(context, product);
                  }, childCount: products.length),
                ),
              ),
              const SliverPadding(padding: EdgeInsets.only(bottom: 20)),
            ],
          );
        },
      ),
    );
  }

  Widget _buildProductCard(BuildContext context, Product product) {
    final variants = product.sizeVariants;
    final selectedVariant = variants.isNotEmpty
        ? (_selectedVariantByProductId[product.id] ?? variants.first)
        : null;
    final displayPrice = selectedVariant?.price ?? product.price;

    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: ClipRRect(
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(10),
              ),
              child: ApiService.getImageUrl(product.imageUrl).isNotEmpty
                  ? Image.network(
                      ApiService.getImageUrl(product.imageUrl),
                      width: double.infinity,
                      fit: BoxFit.cover,
                      errorBuilder: (ctx, err, _) =>
                          const Icon(Icons.image_not_supported, size: 50),
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
          Padding(
            padding: const EdgeInsets.all(8.0),
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
                  const SizedBox(height: 6),
                  if (variants.length == 1)
                    Text(
                      variants.first.displayLabel,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(color: Colors.grey),
                    )
                  else
                    DropdownButtonHideUnderline(
                      child: DropdownButton<ProductVariant>(
                        isExpanded: true,
                        value: selectedVariant,
                        items: variants
                            .map(
                              (v) => DropdownMenuItem<ProductVariant>(
                                value: v,
                                child: Text(
                                  v.displayLabel,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            )
                            .toList(),
                        onChanged: (v) {
                          if (v == null) return;
                          setState(() {
                            _selectedVariantByProductId[product.id] = v;
                          });
                        },
                      ),
                    ),
                ],
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      minimumSize: const Size(0, 30),
                      backgroundColor: Colors.red[900],
                      foregroundColor: Colors.white,
                    ),
                    onPressed: product.isAvailable
                        ? () {
                            try {
                              Provider.of<CartProvider>(
                                context,
                                listen: false,
                              ).addItem(product, 1, variant: selectedVariant);
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text('Added to cart'),
                                  duration: Duration(seconds: 1),
                                ),
                              );
                            } catch (e) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text(e.toString()),
                                  backgroundColor: Colors.red,
                                ),
                              );
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
