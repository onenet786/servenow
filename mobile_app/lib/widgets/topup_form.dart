import 'package:flutter/material.dart';
import 'package:flutter_stripe/flutter_stripe.dart';
import 'package:servenow/services/notifier.dart';
import '../models/payment_method_model.dart';

class TopupForm extends StatefulWidget {
  final Function(double amount, bool saveCard) onSubmit;
  final Function(double amount, int paymentMethodId)? onSavedCardSubmit;
  final List<PaymentMethodModel> savedPaymentMethods;
  final bool isLoading;
  final String? error;

  const TopupForm({
    super.key,
    required this.onSubmit,
    this.onSavedCardSubmit,
    this.savedPaymentMethods = const [],
    this.isLoading = false,
    this.error,
  });

  @override
  State<TopupForm> createState() => _TopupFormState();
}

class _TopupFormState extends State<TopupForm> {
  final _formKey = GlobalKey<FormState>();
  final _amountController = TextEditingController();
  bool _saveCard = false;
  String? _selectedAmount;
  int? _selectedPaymentMethodId;

  final List<double> _quickAmounts = [500, 1000, 2000, 5000];

  @override
  void initState() {
    super.initState();
    // Pre-select primary payment method if available
    if (widget.savedPaymentMethods.isNotEmpty) {
      final primary = widget.savedPaymentMethods.firstWhere(
        (pm) => pm.isPrimary,
        orElse: () => widget.savedPaymentMethods.first,
      );
      _selectedPaymentMethodId = primary.id;
    }
  }

  @override
  void dispose() {
    _amountController.dispose();
    super.dispose();
  }

  void _selectQuickAmount(double amount) {
    setState(() {
      _selectedAmount = amount.toString();
      _amountController.text = amount.toStringAsFixed(2);
    });
  }

  void _submit() {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    final amount = double.tryParse(_amountController.text);
    if (amount == null || amount <= 0) {
      Notifier.error(context, 'Please enter a valid amount');
      return;
    }

    if (_selectedPaymentMethodId != null && widget.onSavedCardSubmit != null) {
      widget.onSavedCardSubmit!(amount, _selectedPaymentMethodId!);
    } else {
      widget.onSubmit(amount, _saveCard);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Quick Amount',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: Color(0xFF333333),
              ),
            ),
            const SizedBox(height: 12),
            GridView.count(
              crossAxisCount: 4,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 8,
              crossAxisSpacing: 8,
              childAspectRatio: 1.2,
              children: _quickAmounts
                  .map((amount) => _buildQuickAmountButton(amount))
                  .toList(),
            ),
            const SizedBox(height: 20),
            const Text(
              'Enter Amount',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: Color(0xFF333333),
              ),
            ),
            const SizedBox(height: 8),
            TextFormField(
              controller: _amountController,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(
                hintText: 'Enter amount (PKR)',
                prefixText: 'PKR ',
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: Color(0xFFDDDDDD)),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(color: Color(0xFFDDDDDD)),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: const BorderSide(
                    color: Color(0xFF667eea),
                    width: 2,
                  ),
                ),
                contentPadding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 14,
                ),
              ),
              validator: (value) {
                if (value == null || value.isEmpty) {
                  return 'Please enter an amount';
                }
                final amount = double.tryParse(value);
                if (amount == null || amount <= 0) {
                  return 'Please enter a valid amount';
                }
                return null;
              },
              onChanged: (value) {
                setState(() {
                  _selectedAmount = null;
                });
              },
            ),
            const SizedBox(height: 20),
            if (widget.savedPaymentMethods.isNotEmpty) ...[
              const Text(
                'Select Payment Method',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: Color(0xFF333333),
                ),
              ),
              const SizedBox(height: 12),
              SizedBox(
                height: 100,
                child: ListView.builder(
                  scrollDirection: Axis.horizontal,
                  itemCount: widget.savedPaymentMethods.length + 1,
                  itemBuilder: (context, index) {
                    if (index == widget.savedPaymentMethods.length) {
                      return _buildNewCardOption();
                    }
                    return _buildSavedCardOption(widget.savedPaymentMethods[index]);
                  },
                ),
              ),
              const SizedBox(height: 20),
            ],
            if (_selectedPaymentMethodId == null) ...[
              const Text(
                'Card Details',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: Color(0xFF333333),
                ),
              ),
              const SizedBox(height: 8),
              Container(
                decoration: BoxDecoration(
                  border: Border.all(color: const Color(0xFFDDDDDD)),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: CardField(
                  onCardChanged: (card) {
                    // Card state changes
                  },
                  decoration: InputDecoration(
                    border: InputBorder.none,
                    contentPadding: const EdgeInsets.all(12),
                    hintText: 'Card details',
                    hintStyle: TextStyle(
                      color: const Color(0xFF999999).withValues(alpha: 0.7),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              CheckboxListTile(
                value: _saveCard,
                onChanged: (value) {
                  setState(() {
                    _saveCard = value ?? false;
                  });
                },
                title: const Text(
                  'Save this card for future payments',
                  style: TextStyle(
                    fontSize: 13,
                    color: Color(0xFF333333),
                  ),
                ),
                contentPadding: EdgeInsets.zero,
                controlAffinity: ListTileControlAffinity.leading,
              ),
            ] else
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFFF0F1FF),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: const Color(0xFF667eea).withValues(alpha: 0.3)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.security, color: Color(0xFF667eea), size: 20),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        'Paying with your saved card ending in ${widget.savedPaymentMethods.firstWhere((pm) => pm.id == _selectedPaymentMethodId).cardLastFour}',
                        style: const TextStyle(
                          fontSize: 13,
                          color: Color(0xFF333333),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            const SizedBox(height: 20),
            if (widget.error != null)
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFffebee),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  widget.error!,
                  style: const TextStyle(
                    color: Color(0xFFc62828),
                    fontSize: 13,
                  ),
                ),
              ),
            const SizedBox(height: 20),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: widget.isLoading ? null : _submit,
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF667eea),
                  disabledBackgroundColor: const Color(0xFFCCCCCC),
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
                child: widget.isLoading
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          valueColor:
                              AlwaysStoppedAnimation<Color>(Colors.white),
                        ),
                      )
                    : const Text(
                        'Add to Wallet',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildQuickAmountButton(double amount) {
    final isSelected = _selectedAmount == amount.toString();
    return GestureDetector(
      onTap: () => _selectQuickAmount(amount),
      child: Container(
        decoration: BoxDecoration(
          border: Border.all(
            color: isSelected ? const Color(0xFF667eea) : const Color(0xFFDDDDDD),
            width: isSelected ? 2 : 1,
          ),
          borderRadius: BorderRadius.circular(8),
          color: isSelected ? const Color(0xFFF0F1FF) : Colors.white,
        ),
        child: Center(
          child: Text(
            amount.toInt().toString(),
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: isSelected ? const Color(0xFF667eea) : const Color(0xFF666666),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildSavedCardOption(PaymentMethodModel pm) {
    final isSelected = _selectedPaymentMethodId == pm.id;
    return GestureDetector(
      onTap: () {
        setState(() {
          _selectedPaymentMethodId = pm.id;
        });
      },
      child: Container(
        width: 140,
        margin: const EdgeInsets.only(right: 12),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          border: Border.all(
            color: isSelected ? const Color(0xFF667eea) : const Color(0xFFDDDDDD),
            width: isSelected ? 2 : 1,
          ),
          borderRadius: BorderRadius.circular(8),
          color: isSelected ? const Color(0xFFF0F1FF) : Colors.white,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Row(
              children: [
                Icon(
                  Icons.credit_card,
                  size: 20,
                  color: isSelected ? const Color(0xFF667eea) : Colors.grey[600],
                ),
                const Spacer(),
                if (pm.isPrimary)
                  Icon(
                    Icons.check_circle,
                    size: 16,
                    color: const Color(0xFF667eea).withValues(alpha: 0.5),
                  ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              '•••• ${pm.cardLastFour}',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.bold,
                color: isSelected ? const Color(0xFF667eea) : const Color(0xFF333333),
              ),
            ),
            Text(
              pm.cardBrand?.toUpperCase() ?? 'CARD',
              style: TextStyle(
                fontSize: 11,
                color: isSelected ? const Color(0xFF667eea).withValues(alpha: 0.7) : Colors.grey[600],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildNewCardOption() {
    final isSelected = _selectedPaymentMethodId == null;
    return GestureDetector(
      onTap: () {
        setState(() {
          _selectedPaymentMethodId = null;
        });
      },
      child: Container(
        width: 140,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          border: Border.all(
            color: isSelected ? const Color(0xFF667eea) : const Color(0xFFDDDDDD),
            width: isSelected ? 2 : 1,
          ),
          borderRadius: BorderRadius.circular(8),
          color: isSelected ? const Color(0xFFF0F1FF) : Colors.white,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              Icons.add_circle_outline,
              size: 20,
              color: isSelected ? const Color(0xFF667eea) : Colors.grey[600],
            ),
            const SizedBox(height: 8),
            Text(
              'New Card',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.bold,
                color: isSelected ? const Color(0xFF667eea) : const Color(0xFF333333),
              ),
            ),
            Text(
              'Add a new card',
              style: TextStyle(
                fontSize: 11,
                color: isSelected ? const Color(0xFF667eea).withValues(alpha: 0.7) : Colors.grey[600],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
