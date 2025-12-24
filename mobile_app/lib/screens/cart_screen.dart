import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../services/api_service.dart';
import '../providers/cart_provider.dart';

class CartScreen extends StatelessWidget {
  const CartScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final cart = Provider.of<CartProvider>(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Your Cart'),
        actions: [
          if (cart.items.isNotEmpty)
            IconButton(
              icon: const Icon(Icons.delete_outline),
              onPressed: () {
                showDialog(
                  context: context,
                  builder: (ctx) => AlertDialog(
                    title: const Text('Clear Cart?'),
                    content: const Text(
                      'Are you sure you want to remove all items?',
                    ),
                    actions: [
                      TextButton(
                        child: const Text('No'),
                        onPressed: () => Navigator.of(ctx).pop(),
                      ),
                      TextButton(
                        child: const Text('Yes'),
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
        ],
      ),
      body: cart.items.isEmpty
          ? const Center(
              child: Text(
                'Your cart is empty',
                style: TextStyle(fontSize: 18, color: Colors.grey),
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
                          child: const Icon(Icons.delete, color: Colors.white),
                        ),
                        child: Card(
                          margin: const EdgeInsets.symmetric(
                            horizontal: 15,
                            vertical: 4,
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(8),
                            child: ListTile(
                              leading:
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
                                          const Icon(Icons.image_not_supported),
                                    )
                                  : const Icon(Icons.fastfood, size: 40),
                              title: Text(item.product.name),
                              subtitle: Text(
                                item.variantLabel != null
                                    ? '${item.variantLabel} • Total: PKR ${item.total.toStringAsFixed(2)}'
                                    : 'Total: PKR ${item.total.toStringAsFixed(2)}',
                              ),
                              trailing: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  IconButton(
                                    icon: const Icon(Icons.remove),
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
                                  Text(
                                    '${item.quantity}',
                                    style: const TextStyle(fontSize: 16),
                                  ),
                                  IconButton(
                                    icon: const Icon(Icons.add),
                                    onPressed: () {
                                      cart.updateCartItemQuantity(
                                        item,
                                        item.quantity + 1,
                                      );
                                    },
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                ),
                Card(
                  margin: const EdgeInsets.all(15),
                  child: Padding(
                    padding: const EdgeInsets.all(8),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'Total',
                          style: TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        Text(
                          'PKR ${cart.totalAmount.toStringAsFixed(2)}',
                          style: const TextStyle(
                            fontSize: 20,
                            fontWeight: FontWeight.bold,
                            color: Colors.green,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(16.0),
                  child: SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        backgroundColor: Colors.blueAccent,
                        foregroundColor: Colors.white,
                      ),
                      onPressed: () {
                        Navigator.of(context).pushNamed('/checkout');
                      },
                      child: const Text(
                        'Proceed to Checkout',
                        style: TextStyle(fontSize: 18),
                      ),
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}
