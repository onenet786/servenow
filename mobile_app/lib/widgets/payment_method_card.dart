import 'package:flutter/material.dart';
import '../models/payment_method_model.dart';

class PaymentMethodCard extends StatelessWidget {
  final PaymentMethodModel paymentMethod;
  final bool isSelected;
  final VoidCallback? onTap;
  final VoidCallback? onSetPrimary;
  final VoidCallback? onDelete;
  final bool isDeleting;
  final bool isSettingPrimary;

  const PaymentMethodCard({
    super.key,
    required this.paymentMethod,
    this.isSelected = false,
    this.onTap,
    this.onSetPrimary,
    this.onDelete,
    this.isDeleting = false,
    this.isSettingPrimary = false,
  });

  @override
  Widget build(BuildContext context) {
    final bool isCard = paymentMethod.type == 'card';

    return Card(
      elevation: isSelected ? 4 : 1,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: isSelected
            ? const BorderSide(color: Color(0xFF667eea), width: 2)
            : BorderSide.none,
      ),
      margin: const EdgeInsets.only(bottom: 12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            children: [
              Row(
                children: [
                  Container(
                    width: 48,
                    height: 32,
                    decoration: BoxDecoration(
                      color: Colors.grey[200],
                      borderRadius: BorderRadius.circular(4),
                    ),
                    child: Center(
                      child: _getBrandIcon(paymentMethod.cardBrand),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          isCard
                              ? '${paymentMethod.cardBrand?.toUpperCase() ?? 'Card'} •••• ${paymentMethod.cardLastFour}'
                              : 'PayPal',
                          style: const TextStyle(
                            fontWeight: FontWeight.bold,
                            fontSize: 16,
                          ),
                        ),
                        if (isCard &&
                            paymentMethod.cardExpiryMonth != null &&
                            paymentMethod.cardExpiryYear != null)
                          Text(
                            'Expires ${paymentMethod.cardExpiryMonth.toString().padLeft(2, '0')}/${paymentMethod.cardExpiryYear.toString().substring(2)}',
                            style: TextStyle(
                              color: Colors.grey[600],
                              fontSize: 13,
                            ),
                          ),
                      ],
                    ),
                  ),
                  if (paymentMethod.isPrimary)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFF667eea).withValues(alpha: 0.1),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: const Text(
                        'PRIMARY',
                        style: TextStyle(
                          color: Color(0xFF667eea),
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 12),
              const Divider(),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  if (!paymentMethod.isPrimary && onSetPrimary != null)
                    TextButton.icon(
                      onPressed: isSettingPrimary ? null : onSetPrimary,
                      icon: isSettingPrimary
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                valueColor: AlwaysStoppedAnimation<Color>(
                                    Color(0xFF667eea)),
                              ),
                            )
                          : const Icon(Icons.check_circle_outline, size: 18),
                      label: const Text('Set as Primary'),
                      style: TextButton.styleFrom(
                        foregroundColor: const Color(0xFF667eea),
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                      ),
                    ),
                  const Spacer(),
                  if (onDelete != null)
                    IconButton(
                      onPressed: isDeleting ? null : onDelete,
                      icon: isDeleting
                          ? const SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                valueColor:
                                    AlwaysStoppedAnimation<Color>(Colors.red),
                              ),
                            )
                          : const Icon(Icons.delete_outline,
                              color: Colors.red, size: 20),
                      tooltip: 'Delete Card',
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _getBrandIcon(String? brand) {
    brand = brand?.toLowerCase();
    if (brand == 'visa') {
      return const Icon(Icons.credit_card, color: Color(0xFF1A1F71));
    } else if (brand == 'mastercard') {
      return const Icon(Icons.credit_card, color: Color(0xFFEB001B));
    } else if (brand == 'amex') {
      return const Icon(Icons.credit_card, color: Color(0xFF007BC1));
    } else {
      return const Icon(Icons.credit_card, color: Colors.grey);
    }
  }
}
