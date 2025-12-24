import 'product.dart';

class CartItem {
  final Product product;
  final ProductVariant? variant;
  int quantity;

  CartItem({
    required this.product,
    this.variant,
    this.quantity = 1,
  });

  double get unitPrice => variant?.price ?? product.price;

  String? get variantLabel => variant?.displayLabel;

  double get total => unitPrice * quantity;

  Map<String, dynamic> toJson() {
    return {
      'product_id': product.id,
      'quantity': quantity,
      'price': unitPrice,
      'name': product.name,
      'store_id': product.storeId,
      if (variant?.sizeId != null) 'size_id': variant!.sizeId,
      if (variant?.unitId != null) 'unit_id': variant!.unitId,
      if (variantLabel != null) 'variant_label': variantLabel,
    };
  }
}
