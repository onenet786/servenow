class Product {
  final int id;
  final String name;
  final String? description;
  final double price;
  final String? imageUrl;
  final int? imageBgR;
  final int? imageBgG;
  final int? imageBgB;
  final double? imageOverlayAlpha;
  final String? imageContrast;
  final String? categoryName;
  final String? storeName;
  final String? storeLocation;
  final int stockQuantity;
  final bool isAvailable;
  final int? storeId;
  final int? categoryId;

  Product({
    required this.id,
    required this.name,
    this.description,
    required this.price,
    this.imageUrl,
    this.imageBgR,
    this.imageBgG,
    this.imageBgB,
    this.imageOverlayAlpha,
    this.imageContrast,
    this.categoryName,
    this.storeName,
    this.storeLocation,
    required this.stockQuantity,
    required this.isAvailable,
    this.storeId,
    this.categoryId,
  });

  factory Product.fromJson(Map<String, dynamic> json) {
    return Product(
      id: json['id'],
      name: json['name'],
      description: json['description'],
      price: double.parse(json['price'].toString()),
      imageUrl: json['image_url'],
      imageBgR: json['image_bg_r'],
      imageBgG: json['image_bg_g'],
      imageBgB: json['image_bg_b'],
      imageOverlayAlpha: json['image_overlay_alpha'] != null
          ? double.tryParse(json['image_overlay_alpha'].toString())
          : null,
      imageContrast: json['image_contrast'],
      categoryName: json['category_name'],
      storeName: json['store_name'],
      storeLocation: json['store_location'],
      stockQuantity: json['stock_quantity'] is int
          ? json['stock_quantity']
          : int.tryParse(json['stock_quantity'].toString()) ?? 0,
      isAvailable: json['is_available'] is bool
          ? json['is_available']
          : (json['is_available'] == 1 || json['is_available'] == 'true'),
      storeId: json['store_id'],
      categoryId: json['category_id'],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'description': description,
      'price': price,
      'image_url': imageUrl,
      'image_bg_r': imageBgR,
      'image_bg_g': imageBgG,
      'image_bg_b': imageBgB,
      'image_overlay_alpha': imageOverlayAlpha,
      'image_contrast': imageContrast,
      'category_name': categoryName,
      'store_name': storeName,
      'store_location': storeLocation,
      'stock_quantity': stockQuantity,
      'is_available': isAvailable,
      'store_id': storeId,
      'category_id': categoryId,
    };
  }
}
