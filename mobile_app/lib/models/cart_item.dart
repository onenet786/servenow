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

  bool get isBxgyOffer => variant?.isBxgyOffer ?? product.isBxgyOffer;

  int get bxgyBuyQty => variant?.bxgyBuyQty ?? product.bxgyBuyQty;

  int get bxgyGetQty => variant?.bxgyGetQty ?? product.bxgyGetQty;

  int get bxgyBundleQty => bxgyBuyQty + bxgyGetQty;

  int get freeQuantity {
    if (!isBxgyOffer || bxgyBundleQty <= 0) return 0;
    return (quantity ~/ bxgyBundleQty) * bxgyGetQty;
  }

  int get paidQuantity => quantity - freeQuantity;

  String? get offerBadge => variant?.offerBadge ?? product.offerBadge;

  double get unitPrice {
    if (isBxgyOffer) {
      return variant?.price ?? product.price;
    }
    return variant?.effectivePrice ?? product.effectivePrice;
  }

  String? get variantLabel => variant?.displayLabel;

  double get total => unitPrice * paidQuantity;

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
