import 'dart:io';
import 'package:flutter/material.dart';
import '../models/product.dart';
import '../services/image_cache_service.dart';

class ProductCard extends StatefulWidget {
  final Product product;
  final VoidCallback onAddToCart;

  const ProductCard({
    super.key,
    required this.product,
    required this.onAddToCart,
  });

  @override
  State<ProductCard> createState() => _ProductCardState();
}

class _ProductCardState extends State<ProductCard> {
  String? _localImagePath;

  @override
  void initState() {
    super.initState();
    _loadImage();
  }

  Future<void> _loadImage() async {
    if (widget.product.imageUrl != null) {
      final fullUrl = 'http://10.0.2.2:3002${widget.product.imageUrl}';
      final fileName = ImageCacheService.getFileNameFromUrl(fullUrl);
      final localPath = await ImageCacheService.getLocalImagePath(fullUrl, fileName);
      if (mounted) {
        setState(() {
          _localImagePath = localPath;
        });
      }
    }
  }

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
              child: widget.product.imageUrl != null
                  ? ClipRRect(
                      borderRadius:
                          const BorderRadius.vertical(top: Radius.circular(12)),
                      child: _localImagePath != null
                          ? Image.file(
                              File(_localImagePath!),
                              fit: BoxFit.cover,
                              errorBuilder: (context, error, stackTrace) =>
                                  const Icon(Icons.image, size: 50, color: Colors.grey),
                            )
                          : Image.network(
                              'http://10.0.2.2:3002${widget.product.imageUrl}',
                              fit: BoxFit.cover,
                              loadingBuilder: (context, child, loadingProgress) {
                                if (loadingProgress == null) return child;
                                return const Center(child: CircularProgressIndicator());
                              },
                              errorBuilder: (context, error, stackTrace) =>
                                  const Icon(Icons.image, size: 50, color: Colors.grey),
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
                    widget.product.name,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  if (widget.product.description != null)
                    Text(
                      widget.product.description!,
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
                        'PKR ${widget.product.price.toStringAsFixed(2).replaceAll('.00', '')}',
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.bold,
                          color: Colors.green,
                        ),
                      ),
                      ElevatedButton(
                        onPressed: widget.onAddToCart,
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
