import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../services/api_service.dart';
import '../models/product.dart';
import '../widgets/product_card.dart';
import '../widgets/category_card.dart';
import '../widgets/cart_badge.dart';
import 'cart_screen.dart';
import 'orders_screen.dart';
import 'profile_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with TickerProviderStateMixin {
  late TabController _tabController;
  List<Product> _products = [];
  List<dynamic> _categories = [];
  bool _isLoading = true;
  String _selectedCategory = '';
  int _cartItemCount = 0;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _loadData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() => _isLoading = true);

    try {
      final categories = await ApiService.getCategories();
      final products = await ApiService.getProducts();

      setState(() {
        _categories = categories;
        _products = products;
      });
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to load data: $e')),
        );
      }
    } finally {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _loadProductsByCategory(String category) async {
    setState(() => _isLoading = true);

    try {
      final products = await ApiService.getProducts(category: category);
      setState(() {
        _products = products;
        _selectedCategory = category;
      });
    } catch (e) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to load products: $e')),
      );
    } finally {
      setState(() => _isLoading = false);
    }
  }

  void _updateCartBadge() {
    final cartProvider = Provider.of<CartProvider>(context, listen: false);
    setState(() {
      _cartItemCount = cartProvider.itemCount;
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('ServeNow'),
        backgroundColor: Colors.green,
        actions: [
          IconButton(
            icon: CartBadge(
              count: _cartItemCount,
              child: const Icon(Icons.shopping_cart),
            ),
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const CartScreen()),
              ).then((_) => _updateCartBadge());
            },
          ),
          IconButton(
            icon: const Icon(Icons.logout),
            onPressed: () async {
              final authProvider = Provider.of<AuthProvider>(context, listen: false);
              await authProvider.logout();
              if (mounted) {
                Navigator.of(context).pushReplacementNamed('/login');
              }
            },
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(icon: Icon(Icons.home), text: 'Home'),
            Tab(icon: Icon(Icons.store), text: 'Stores'),
            Tab(icon: Icon(Icons.receipt), text: 'Orders'),
            Tab(icon: Icon(Icons.person), text: 'Profile'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildHomeTab(),
          _buildStoresTab(),
          const OrdersScreen(),
          const ProfileScreen(),
        ],
      ),
    );
  }

  Widget _buildHomeTab() {
    return RefreshIndicator(
      onRefresh: _loadData,
      child: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Categories
                  const Text(
                    'Shop by Category',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    height: 100,
                    child: ListView.builder(
                      scrollDirection: Axis.horizontal,
                      itemCount: _categories.length,
                      itemBuilder: (context, index) {
                        final category = _categories[index];
                        return CategoryCard(
                          category: category,
                          isSelected: _selectedCategory == category['name'],
                          onTap: () => _loadProductsByCategory(category['name']),
                        );
                      },
                    ),
                  ),

                  const SizedBox(height: 24),

                  // Products
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        _selectedCategory.isEmpty
                            ? 'All Products'
                            : '$_selectedCategory Products',
                        style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                      ),
                      if (_selectedCategory.isNotEmpty)
                        TextButton(
                          onPressed: () {
                            setState(() => _selectedCategory = '');
                            _loadData();
                          },
                          child: const Text('Show All'),
                        ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  GridView.builder(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: 2,
                      childAspectRatio: 0.75,
                      crossAxisSpacing: 16,
                      mainAxisSpacing: 16,
                    ),
                    itemCount: _products.length,
                    itemBuilder: (context, index) {
                      final product = _products[index];
                      return ProductCard(
                        product: product,
                        onAddToCart: () {
                          final cartProvider = Provider.of<CartProvider>(context, listen: false);
                          cartProvider.addItem(product);
                          _updateCartBadge();
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('${product.name} added to cart')),
                          );
                        },
                      );
                    },
                  ),
                ],
              ),
            ),
    );
  }

  Widget _buildStoresTab() {
    return const Center(
      child: Text('Stores coming soon...'),
    );
  }
}
