import '../providers/cart_provider.dart';

/// Read-only cart counts for badges and the cart bar, so every counter in the
/// app shows the same number (total units, not number of lines).
extension CartCounts on CartProvider {
  /// Total number of units in the cart (what every badge shows).
  int get totalUnits {
    var units = 0;
    for (final item in items) {
      units += item.quantity;
    }
    return units;
  }

  /// Quantity of one product (all variants) in the cart.
  int quantityOf(int productId) {
    var units = 0;
    for (final item in items) {
      if (item.product.id == productId) units += item.quantity;
    }
    return units;
  }
}
