class PaymentMethodModel {
  final int id;
  final String type; // 'card', 'paypal'
  final String? cardLastFour;
  final String? cardBrand;
  final int? cardExpiryMonth;
  final int? cardExpiryYear;
  final bool isPrimary;
  final bool isActive;
  final DateTime createdAt;

  PaymentMethodModel({
    required this.id,
    required this.type,
    this.cardLastFour,
    this.cardBrand,
    this.cardExpiryMonth,
    this.cardExpiryYear,
    required this.isPrimary,
    required this.isActive,
    required this.createdAt,
  });

  factory PaymentMethodModel.fromJson(Map<String, dynamic> json) {
    return PaymentMethodModel(
      id: json['id'] as int? ?? 0,
      type: json['type'] as String? ?? 'card',
      cardLastFour: json['card_last4'] as String?,
      cardBrand: json['card_brand'] as String?,
      cardExpiryMonth: json['card_exp_month'] as int?,
      cardExpiryYear: json['card_exp_year'] as int?,
      isPrimary: json['is_primary'] == 1 || json['is_primary'] == true,
      isActive: json['is_active'] == 1 || json['is_active'] == true,
      createdAt: json['created_at'] != null
          ? DateTime.parse(json['created_at'] as String)
          : DateTime.now(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'type': type,
      'card_last4': cardLastFour,
      'card_brand': cardBrand,
      'card_exp_month': cardExpiryMonth,
      'card_exp_year': cardExpiryYear,
      'is_primary': isPrimary ? 1 : 0,
      'is_active': isActive ? 1 : 0,
      'created_at': createdAt.toIso8601String(),
    };
  }

  PaymentMethodModel copyWith({
    int? id,
    String? type,
    String? cardLastFour,
    String? cardBrand,
    int? cardExpiryMonth,
    int? cardExpiryYear,
    bool? isPrimary,
    bool? isActive,
    DateTime? createdAt,
  }) {
    return PaymentMethodModel(
      id: id ?? this.id,
      type: type ?? this.type,
      cardLastFour: cardLastFour ?? this.cardLastFour,
      cardBrand: cardBrand ?? this.cardBrand,
      cardExpiryMonth: cardExpiryMonth ?? this.cardExpiryMonth,
      cardExpiryYear: cardExpiryYear ?? this.cardExpiryYear,
      isPrimary: isPrimary ?? this.isPrimary,
      isActive: isActive ?? this.isActive,
      createdAt: createdAt ?? this.createdAt,
    );
  }
}
