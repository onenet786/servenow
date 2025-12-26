class WalletTransferModel {
  final int id;
  final int senderId;
  final int recipientId;
  final double amount;
  final String description;
  final String status; // 'pending', 'completed', 'rejected', 'cancelled'
  final String? senderEmail;
  final String? senderName;
  final String? recipientEmail;
  final String? recipientName;
  final String? rejectionReason;
  final DateTime? completedAt;
  final DateTime createdAt;
  final DateTime updatedAt;

  WalletTransferModel({
    required this.id,
    required this.senderId,
    required this.recipientId,
    required this.amount,
    required this.description,
    required this.status,
    this.senderEmail,
    this.senderName,
    this.recipientEmail,
    this.recipientName,
    this.rejectionReason,
    this.completedAt,
    required this.createdAt,
    required this.updatedAt,
  });

  factory WalletTransferModel.fromJson(Map<String, dynamic> json) {
    double parseDouble(dynamic v) {
      if (v == null) return 0.0;
      if (v is num) return v.toDouble();
      return double.tryParse(v.toString()) ?? 0.0;
    }

    return WalletTransferModel(
      id: json['id'] as int? ?? 0,
      senderId: json['sender_id'] as int? ?? 0,
      recipientId: json['recipient_id'] as int? ?? 0,
      amount: parseDouble(json['amount']),
      description: json['description'] as String? ?? '',
      status: json['status'] as String? ?? 'pending',
      senderEmail: json['sender_email'] as String?,
      senderName: json['sender_name'] as String?,
      recipientEmail: json['recipient_email'] as String?,
      recipientName: json['recipient_name'] as String?,
      rejectionReason: json['rejection_reason'] as String?,
      completedAt: json['completed_at'] != null
          ? DateTime.parse(json['completed_at'] as String)
          : null,
      createdAt: json['created_at'] != null
          ? DateTime.parse(json['created_at'] as String)
          : DateTime.now(),
      updatedAt: json['updated_at'] != null
          ? DateTime.parse(json['updated_at'] as String)
          : DateTime.now(),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'sender_id': senderId,
      'recipient_id': recipientId,
      'amount': amount,
      'description': description,
      'status': status,
      'sender_email': senderEmail,
      'sender_name': senderName,
      'recipient_email': recipientEmail,
      'recipient_name': recipientName,
      'rejection_reason': rejectionReason,
      'completed_at': completedAt?.toIso8601String(),
      'created_at': createdAt.toIso8601String(),
      'updated_at': updatedAt.toIso8601String(),
    };
  }

  WalletTransferModel copyWith({
    int? id,
    int? senderId,
    int? recipientId,
    double? amount,
    String? description,
    String? status,
    String? senderEmail,
    String? senderName,
    String? recipientEmail,
    String? recipientName,
    String? rejectionReason,
    DateTime? completedAt,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return WalletTransferModel(
      id: id ?? this.id,
      senderId: senderId ?? this.senderId,
      recipientId: recipientId ?? this.recipientId,
      amount: amount ?? this.amount,
      description: description ?? this.description,
      status: status ?? this.status,
      senderEmail: senderEmail ?? this.senderEmail,
      senderName: senderName ?? this.senderName,
      recipientEmail: recipientEmail ?? this.recipientEmail,
      recipientName: recipientName ?? this.recipientName,
      rejectionReason: rejectionReason ?? this.rejectionReason,
      completedAt: completedAt ?? this.completedAt,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}
