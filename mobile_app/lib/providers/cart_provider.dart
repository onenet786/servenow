import 'package:flutter/foundation.dart';
import '../models/product.dart';
import '../models/cart_item.dart';

class CartProvider with ChangeNotifier {
  final List<CartItem> _items = [];

  List<CartItem> get items => [..._items];

  int get itemCount => _items.length;

  double get totalAmount {
    var total = 0.0;
    for (var item in _items) {
      total += item.total;
    }
    return total;
  }

  int? get currentStoreId {
    if (_items.isEmpty) return null;
    return _items.first.product.storeId;
  }

  bool _sameVariant(ProductVariant? a, ProductVariant? b) {
    return a?.sizeId == b?.sizeId && a?.unitId == b?.unitId;
  }

  void addItem(Product product, int quantity, {ProductVariant? variant}) {
    final existingIndex = _items.indexWhere(
      (item) => item.product.id == product.id && _sameVariant(item.variant, variant),
    );
    if (existingIndex >= 0) {
      _items[existingIndex].quantity += quantity;
    } else {
      _items.add(CartItem(product: product, variant: variant, quantity: quantity));
    }
    notifyListeners();
  }

  void removeCartItem(CartItem item) {
    _items.remove(item);
    notifyListeners();
  }

  void updateCartItemQuantity(CartItem item, int quantity) {
    final index = _items.indexOf(item);
    if (index >= 0) {
      if (quantity <= 0) {
        _items.removeAt(index);
      } else {
        _items[index].quantity = quantity;
      }
      notifyListeners();
    }
  }

  void clear() {
    _items.clear();
    notifyListeners();
  }
}
