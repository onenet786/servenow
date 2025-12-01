import 'package:flutter/material.dart';
import '../models/product.dart';

class ProductCard extends StatelessWidget {
  final Product product;
  final VoidCallback onAddToCart;

  const ProductCard({
    super.key,
    required this.product,
    required this.onAddToCart,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Product image
          Expanded(
            flex: 3,
            child: Container(
              width: double.infinity,
              decoration: BoxDecoration(
                borderRadius:
                    const BorderRadius.vertical(top: Radius.circular(12)),
                color: Colors.grey[200],
              ),
              child: product.imageUrl != null
                  ? ClipRRect(
                      borderRadius:
                          const BorderRadius.vertical(top: Radius.circular(12)),
                      child: Image.network(
                        'http://10.0.2.2:3002${product.imageUrl}',
                        fit: BoxFit.cover,
                        errorBuilder: (context, error, stackTrace) {
                          return const Icon(Icons.image,
                              size: 50, color: Colors.grey);
                        },
                      ),
                    )
                  : const Icon(Icons.image, size: 50, color: Colors.grey),
            ),
          ),

          // Product details
          Expanded(
            flex: 2,
            child: Padding(
              padding: const EdgeInsets.all(6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    product.name,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  if (product.description != null)
                    Text(
                      product.description!,
                      style: TextStyle(
                        fontSize: 11,
                        color: Colors.grey[600],
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  const SizedBox(height: 8),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'PKR ${product.price.toStringAsFixed(2).replaceAll('.00', '')}',
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: Colors.green,
                        ),
                      ),
                      ElevatedButton(
                        onPressed: onAddToCart,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.green,
                          minimumSize: const Size(35, 28),
                          padding: const EdgeInsets.symmetric(horizontal: 6),
                        ),
                        child: const Text(
                          'Add',
                          style: TextStyle(fontSize: 11),
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
    );
  }
}
