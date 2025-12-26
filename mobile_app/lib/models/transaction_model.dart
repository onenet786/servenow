class WalletTransactionModel {
  final int id;
  final int walletId;
  final String type;
  final double amount;
  final String description;
  final String? referenceType;
  final String? referenceId;
  final double balanceAfter;
  final DateTime createdAt;

  WalletTransactionModel({
    required this.id,
    required this.walletId,
    required this.type,
    required this.amount,
    required this.description,
    this.referenceType,
    this.referenceId,
    required this.balanceAfter,
    required this.createdAt,
  });

  factory WalletTransactionModel.fromJson(Map<String, dynamic> json) {
    double parseDouble(dynamic v) {
      if (v == null) return 0.0;
      if (v is num) return v.toDouble();
      return double.tryParse(v.toString()) ?? 0.0;
    }

    return WalletTransactionModel(
      id: json['id'] as int? ?? 0,
      walletId: json['wallet_id'] as int? ?? 0,
      type: json['type'] as String? ?? 'credit',
      amount: parseDouble(json['amount']),
      description: json['description'] as String? ?? '',
      referenceType: json['reference_type'] as String?,
      referenceId: json['reference_id'] as String?,
      balanceAfter: parseDouble(json['balance_after']),
      createdAt: json['created_at'] != null
          ? DateTime.parse(json['created_at'] as String)
          : DateTime.now(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'wallet_id': walletId,
      'type': type,
      'amount': amount,
      'description': description,
      'reference_type': referenceType,
      'reference_id': referenceId,
      'balance_after': balanceAfter,
      'created_at': createdAt.toIso8601String(),
    };
  }

  WalletTransactionModel copyWith({
    int? id,
    int? walletId,
    String? type,
    double? amount,
    String? description,
    String? referenceType,
    String? referenceId,
    double? balanceAfter,
    DateTime? createdAt,
  }) {
    return WalletTransactionModel(
      id: id ?? this.id,
      walletId: walletId ?? this.walletId,
      type: type ?? this.type,
      amount: amount ?? this.amount,
      description: description ?? this.description,
      referenceType: referenceType ?? this.referenceType,
      referenceId: referenceId ?? this.referenceId,
      balanceAfter: balanceAfter ?? this.balanceAfter,
      createdAt: createdAt ?? this.createdAt,
    );
  }
}
