import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/cart_provider.dart';
import '../providers/auth_provider.dart';
import '../models/cart_item.dart';
import 'checkout_screen.dart';

class CartScreen extends StatefulWidget {
  const CartScreen({super.key});

  @override
  State<CartScreen> createState() => _CartScreenState();
}

class _CartScreenState extends State<CartScreen> {
  bool _isPlacingOrder = false;

  @override
  Widget build(BuildContext context) {
    final cartProvider = Provider.of<CartProvider>(context);
    final authProvider = Provider.of<AuthProvider>(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Cart'),
        backgroundColor: Colors.green,
      ),
      body: cartProvider.items.isEmpty
          ? const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.shopping_cart_outlined,
                    size: 80,
                    color: Colors.grey,
                  ),
                  SizedBox(height: 16),
                  Text(
                    'Your cart is empty',
                    style: TextStyle(
                      fontSize: 18,
                      color: Colors.grey,
                    ),
                  ),
                ],
              ),
            )
          : Column(
              children: [
                Expanded(
                  child: ListView.builder(
                    itemCount: cartProvider.items.length,
                    itemBuilder: (context, index) {
                      final cartItem = cartProvider.items[index];
                      return _CartItemWidget(
                        cartItem: cartItem,
                        onUpdateQuantity: (quantity) {
                          cartProvider.updateQuantity(cartItem.product.id, quantity);
                        },
                        onRemove: () {
                          cartProvider.removeItem(cartItem.product.id);
                        },
                      );
                    },
                  ),
                ),
                _CartSummary(
                  totalAmount: cartProvider.totalAmount,
                  onCheckout: () async {
                    if (!authProvider.isAuthenticated) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(content: Text('Please login to place order')),
                      );
                      return;
                    }

                    Navigator.push(
                      context,
                      MaterialPageRoute(builder: (_) => const CheckoutScreen()),
                    );
                  },
                  isPlacingOrder: _isPlacingOrder,
                ),
              ],
            ),
    );
  }
}

class _CartItemWidget extends StatelessWidget {
  final CartItem cartItem;
  final Function(int) onUpdateQuantity;
  final VoidCallback onRemove;

  const _CartItemWidget({
    required this.cartItem,
    required this.onUpdateQuantity,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            // Product image
            Container(
              width: 60,
              height: 60,
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(8),
                color: Colors.grey[200],
              ),
              child: cartItem.product.imageUrl != null
                  ? ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: Image.network(
                        'http://10.0.2.2:3002${cartItem.product.imageUrl}',
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stackTrace) {
                          return const Icon(Icons.image, size: 30, color: Colors.grey);
                        },
                      ),
                    )
                  : const Icon(Icons.image, size: 30, color: Colors.grey),
            ),

            const SizedBox(width: 16),

            // Product details
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    cartItem.product.name,
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '\$${cartItem.product.price.toStringAsFixed(2)}',
                    style: const TextStyle(
                      color: Colors.green,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Total: \$${cartItem.totalPrice.toStringAsFixed(2)}',
                    style: const TextStyle(
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),

            // Quantity controls
            Column(
              children: [
                Row(
                  children: [
                    IconButton(
                      onPressed: () => onUpdateQuantity(cartItem.quantity - 1),
                      icon: const Icon(Icons.remove),
                      iconSize: 20,
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                      decoration: BoxDecoration(
                        border: Border.all(color: Colors.grey),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Text(
                        cartItem.quantity.toString(),
                        style: const TextStyle(fontWeight: FontWeight.w500),
                      ),
                    ),
                    IconButton(
                      onPressed: () => onUpdateQuantity(cartItem.quantity + 1),
                      icon: const Icon(Icons.add),
                      iconSize: 20,
                    ),
                  ],
                ),
                TextButton(
                  onPressed: onRemove,
                  style: TextButton.styleFrom(
                    foregroundColor: Colors.red,
                    padding: EdgeInsets.zero,
                    minimumSize: const Size(50, 30),
                  ),
                  child: const Text('Remove'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _CartSummary extends StatelessWidget {
  final double totalAmount;
  final VoidCallback onCheckout;
  final bool isPlacingOrder;

  const _CartSummary({
    required this.totalAmount,
    required this.onCheckout,
    required this.isPlacingOrder,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(top: BorderSide(color: Colors.grey[300]!)),
        boxShadow: [
          BoxShadow(
            color: Colors.grey.withValues(alpha: 0.1),
            spreadRadius: 1,
            blurRadius: 4,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Total Amount:',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                ),
              ),
              Text(
                '\$${totalAmount.toStringAsFixed(2)}',
                style: const TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: Colors.green,
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: isPlacingOrder ? null : onCheckout,
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.green,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
              ),
              child: isPlacingOrder
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                      ),
                    )
                  : const Text(
                      'Proceed to Checkout',
                      style: TextStyle(fontSize: 16),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}
