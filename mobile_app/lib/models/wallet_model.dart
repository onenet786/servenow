class WalletModel {
  final int id;
  final int userId;
  final double balance;
  final double totalCredited;
  final double totalSpent;
  final bool autoRechargeEnabled;
  final double? autoRechargeAmount;
  final double? autoRechargeThreshold;
  final DateTime? lastCreditedAt;
  final DateTime createdAt;
  final DateTime? updatedAt;
  final int? totalTransactions;

  WalletModel({
    required this.id,
    required this.userId,
    required this.balance,
    required this.totalCredited,
    required this.totalSpent,
    required this.autoRechargeEnabled,
    this.autoRechargeAmount,
    this.autoRechargeThreshold,
    this.lastCreditedAt,
    required this.createdAt,
    this.updatedAt,
    this.totalTransactions,
  });

  factory WalletModel.fromJson(Map<String, dynamic> json) {
    double parseDouble(dynamic v) {
      if (v == null) return 0.0;
      if (v is num) return v.toDouble();
      return double.tryParse(v.toString()) ?? 0.0;
    }

    double? parseNullableDouble(dynamic v) {
      if (v == null) return null;
      if (v is num) return v.toDouble();
      return double.tryParse(v.toString());
    }

    return WalletModel(
      id: json['id'] as int? ?? 0,
      userId: json['user_id'] as int? ?? 0,
      balance: parseDouble(json['balance']),
      totalCredited: parseDouble(json['total_credited']),
      totalSpent: parseDouble(json['total_spent']),
      autoRechargeEnabled: json['auto_recharge_enabled'] as bool? ?? false,
      autoRechargeAmount: parseNullableDouble(json['auto_recharge_amount']),
      autoRechargeThreshold: parseNullableDouble(json['auto_recharge_threshold']),
      lastCreditedAt: json['last_credited_at'] != null
          ? DateTime.parse(json['last_credited_at'] as String)
          : null,
      createdAt: json['created_at'] != null
          ? DateTime.parse(json['created_at'] as String)
          : DateTime.now(),
      updatedAt: json['updated_at'] != null
          ? DateTime.parse(json['updated_at'] as String)
          : null,
      totalTransactions: json['total_transactions'] as int?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'user_id': userId,
      'balance': balance,
      'total_credited': totalCredited,
      'total_spent': totalSpent,
      'auto_recharge_enabled': autoRechargeEnabled,
      'auto_recharge_amount': autoRechargeAmount,
      'auto_recharge_threshold': autoRechargeThreshold,
      'last_credited_at': lastCreditedAt?.toIso8601String(),
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt?.toIso8601String(),
      'total_transactions': totalTransactions,
    };
  }

  WalletModel copyWith({
    int? id,
    int? userId,
    double? balance,
    double? totalCredited,
    double? totalSpent,
    bool? autoRechargeEnabled,
    double? autoRechargeAmount,
    double? autoRechargeThreshold,
    DateTime? lastCreditedAt,
    DateTime? createdAt,
    DateTime? updatedAt,
    int? totalTransactions,
  }) {
    return WalletModel(
      id: id ?? this.id,
      userId: userId ?? this.userId,
      balance: balance ?? this.balance,
      totalCredited: totalCredited ?? this.totalCredited,
      totalSpent: totalSpent ?? this.totalSpent,
      autoRechargeEnabled: autoRechargeEnabled ?? this.autoRechargeEnabled,
      autoRechargeAmount: autoRechargeAmount ?? this.autoRechargeAmount,
      autoRechargeThreshold: autoRechargeThreshold ?? this.autoRechargeThreshold,
      lastCreditedAt: lastCreditedAt ?? this.lastCreditedAt,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      totalTransactions: totalTransactions ?? this.totalTransactions,
    );
  }
}
