class ProductVariant {
  final int? sizeId;
  final String? sizeLabel;
  final int? unitId;
  final String? unitName;
  final String? unitAbbreviation;
  final double price;
  final double? costPrice;

  const ProductVariant({
    this.sizeId,
    this.sizeLabel,
    this.unitId,
    this.unitName,
    this.unitAbbreviation,
    required this.price,
    this.costPrice,
  });

  factory ProductVariant.fromJson(Map<String, dynamic> json) {
    int? parseNullableInt(dynamic v) {
      if (v == null) return null;
      if (v is int) return v;
      return int.tryParse(v.toString());
    }

    double? parseNullableDouble(dynamic v) {
      if (v == null) return null;
      if (v is num) return v.toDouble();
      return double.tryParse(v.toString());
    }

    return ProductVariant(
      sizeId: parseNullableInt(json['size_id']),
      sizeLabel: json['size_label'],
      unitId: parseNullableInt(json['unit_id']),
      unitName: json['unit_name'],
      unitAbbreviation: json['unit_abbreviation'],
      price: (json['price'] is num)
          ? (json['price'] as num).toDouble()
          : double.tryParse(json['price'].toString()) ?? 0.0,
      costPrice: parseNullableDouble(json['cost_price']),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'size_id': sizeId,
      'size_label': sizeLabel,
      'unit_id': unitId,
      'unit_name': unitName,
      'unit_abbreviation': unitAbbreviation,
      'price': price,
      'cost_price': costPrice,
    };
  }

  String get displayLabel {
    final size = (sizeLabel ?? '').trim();
    final unit = (unitName ?? '').trim();
    if (size.isNotEmpty && unit.isNotEmpty) return '$size $unit';
    if (size.isNotEmpty) return size;
    if (unit.isNotEmpty) return unit;
    return 'Default';
  }
}

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
  final List<ProductVariant> sizeVariants;

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
    this.sizeVariants = const [],
  });

  factory Product.fromJson(Map<String, dynamic> json) {
    final rawVariants = json['size_variants'];
    final variants = rawVariants is List
        ? rawVariants
            .whereType<Map>()
            .map((v) => ProductVariant.fromJson(v.cast<String, dynamic>()))
            .toList()
        : <ProductVariant>[];

    return Product(
      id: json['id'],
      name: json['name'],
      description: json['description'],
      price: double.tryParse(json['price']?.toString() ?? '') ?? 0.0,
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
      sizeVariants: variants,
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
      'size_variants': sizeVariants.map((v) => v.toJson()).toList(),
    };
  }
}
