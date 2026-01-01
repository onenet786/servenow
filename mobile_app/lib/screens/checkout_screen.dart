import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../providers/cart_provider.dart';
import '../providers/wallet_provider.dart';
import '../services/api_service.dart';
import 'package:servenow/services/notifier.dart';

class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key});

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  final _formKey = GlobalKey<FormState>();
  final _addressController = TextEditingController();
  final _timeController = TextEditingController();
  final _instructionsController = TextEditingController();
  String _paymentMethod = 'cash';
  bool _isLoading = false;
  double? _walletBalance;

  @override
  void initState() {
    super.initState();
    final user = Provider.of<AuthProvider>(context, listen: false).user;
    if (user != null && user.address != null) {
      _addressController.text = user.address!;
    }
    _loadWalletBalance();
  }

  Future<void> _loadWalletBalance() async {
    try {
      final auth = Provider.of<AuthProvider>(context, listen: false);
      final wallet = Provider.of<WalletProvider>(context, listen: false);

      if (auth.token != null) {
        await wallet.loadWalletBalance(auth.token!);
        if (wallet.wallet != null) {
          setState(() {
            _walletBalance = wallet.wallet!.balance;
          });
        }
      }
    } catch (e) {
      debugPrint('Error loading wallet balance: $e');
    }
  }

  @override
  void dispose() {
    _addressController.dispose();
    _timeController.dispose();
    _instructionsController.dispose();
    super.dispose();
  }

  Widget _buildPaymentOption({
    required String title,
    required String value,
    required IconData icon,
    String? subtitle,
  }) {
    final isSelected = _paymentMethod == value;
    final scheme = Theme.of(context).colorScheme;
    return InkWell(
      onTap: () => setState(() => _paymentMethod = value),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(12),
          border: Border.all(
            color: isSelected ? scheme.primary : Colors.grey.shade300,
            width: isSelected ? 2 : 1,
          ),
          color: isSelected
              ? scheme.primaryContainer.withAlpha((0.25 * 255).round())
              : Colors.transparent,
        ),
        child: Row(
          children: [
            Icon(icon, color: isSelected ? scheme.primary : Colors.grey[700]),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontWeight: FontWeight.w600,
                      color: isSelected ? scheme.primary : null,
                    ),
                  ),
                  if (subtitle != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        subtitle,
                        style: TextStyle(fontSize: 12, color: Colors.grey[600]),
                      ),
                    ),
                ],
              ),
            ),
            // ignore: deprecated_member_use
            Radio<String>(
              value: value,
              // ignore: deprecated_member_use
              groupValue: _paymentMethod,
              // ignore: deprecated_member_use
              onChanged: (newValue) {
                if (newValue != null) setState(() => _paymentMethod = newValue);
              },
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submitOrder() async {
    if (!_formKey.currentState!.validate()) return;

    final cart = Provider.of<CartProvider>(context, listen: false);
    final auth = Provider.of<AuthProvider>(context, listen: false);

    if (cart.items.isEmpty) return;

    if (_paymentMethod == 'wallet' && _walletBalance != null) {
      if (_walletBalance! < cart.totalAmount) {
        if (!mounted) return;
        Notifier.error(
          context,
          'Insufficient wallet balance. Need PKR ${(cart.totalAmount - _walletBalance!).toStringAsFixed(2)} more.',
        );
        return;
      }
    }

    setState(() {
      _isLoading = true;
    });

    try {
      final Map<int, List<Map<String, dynamic>>> ordersByStore = {};

      for (var item in cart.items) {
        final storeId = item.product.storeId;
        if (storeId == null) continue;

        if (!ordersByStore.containsKey(storeId)) {
          ordersByStore[storeId] = [];
        }

        final payload = <String, dynamic>{
          'product_id': item.product.id,
          'quantity': item.quantity,
        };
        if (item.variant?.sizeId != null) {
          payload['size_id'] = item.variant!.sizeId;
        }
        if (item.variant?.unitId != null) {
          payload['unit_id'] = item.variant!.unitId;
        }
        if (item.variantLabel != null) {
          payload['variant_label'] = item.variantLabel;
        }

        ordersByStore[storeId]!.add(payload);
      }

      for (final storeId in ordersByStore.keys) {
        await ApiService.createOrder(
          auth.token!,
          storeId: storeId,
          items: ordersByStore[storeId]!,
          deliveryAddress: _addressController.text,
          paymentMethod: _paymentMethod,
          deliveryTime: _timeController.text.isNotEmpty
              ? _timeController.text
              : null,
          specialInstructions: _instructionsController.text.isNotEmpty
              ? _instructionsController.text
              : null,
        );
      }

      // Clear cart
      cart.clear();

      if (!mounted) return;

      // Show success dialog
      showDialog(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          title: const Text('Order Placed!'),
          content: const Text('Your order has been successfully placed.'),
          actions: [
            TextButton(
              child: const Text('OK'),
              onPressed: () {
                Navigator.of(ctx).pop(); // Close dialog
                Navigator.of(
                  context,
                ).pushNamedAndRemoveUntil('/home', (route) => false);
              },
            ),
          ],
        ),
      );
    } catch (e) {
      if (!mounted) return;
      Notifier.error(context, 'Failed to place order: $e');
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cart = Provider.of<CartProvider>(context);

    if (cart.items.isEmpty) {
      return Scaffold(
        appBar: AppBar(title: const Text('Checkout')),
        body: const Center(child: Text('Your cart is empty')),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Checkout')),
      resizeToAvoidBottomInset: true,
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : SafeArea(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final isWide = constraints.maxWidth >= 800;
                  final sidePadding = isWide
                      ? (constraints.maxWidth - 800) / 2
                      : 0.0;

                  final content = Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Order Summary Card
                        Card(
                          elevation: 2,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(16.0),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: const [
                                    Icon(Icons.receipt_long, size: 20),
                                    SizedBox(width: 8),
                                    Text(
                                      'Order Summary',
                                      style: TextStyle(
                                        fontSize: 18,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 12),
                                ListView.separated(
                                  physics: const NeverScrollableScrollPhysics(),
                                  shrinkWrap: true,
                                  itemCount: cart.items.length,
                                  separatorBuilder: (context, index) =>
                                      const Divider(height: 1),
                                  itemBuilder: (context, i) {
                                    final item = cart.items[i];
                                    return ListTile(
                                      contentPadding: EdgeInsets.zero,
                                      title: Text(
                                        item.product.name,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                      subtitle: Text(
                                        item.variantLabel != null
                                            ? '${item.variantLabel} • ${item.quantity} x PKR ${item.unitPrice}'
                                            : '${item.quantity} x PKR ${item.unitPrice}',
                                      ),
                                      trailing: Text(
                                        'PKR ${item.total.toStringAsFixed(2)}',
                                        style: const TextStyle(
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    );
                                  },
                                ),
                                const SizedBox(height: 12),
                                Row(
                                  mainAxisAlignment:
                                      MainAxisAlignment.spaceBetween,
                                  children: [
                                    const Text(
                                      'Total',
                                      style: TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                    Text(
                                      'PKR ${cart.totalAmount.toStringAsFixed(2)}',
                                      style: TextStyle(
                                        fontSize: 16,
                                        fontWeight: FontWeight.w700,
                                        color: Theme.of(
                                          context,
                                        ).colorScheme.primary,
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 16),

                        // Delivery Details Card
                        Card(
                          elevation: 2,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(16.0),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: const [
                                    Icon(Icons.local_shipping, size: 20),
                                    SizedBox(width: 8),
                                    Text(
                                      'Delivery Details',
                                      style: TextStyle(
                                        fontSize: 18,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 12),
                                TextFormField(
                                  controller: _addressController,
                                  decoration: const InputDecoration(
                                    labelText: 'Delivery Address',
                                    border: OutlineInputBorder(),
                                    prefixIcon: Icon(Icons.location_on),
                                  ),
                                  maxLines: 2,
                                  validator: (value) {
                                    if (value == null || value.isEmpty) {
                                      return 'Please enter delivery address';
                                    }
                                    return null;
                                  },
                                ),
                                const SizedBox(height: 12),
                                TextFormField(
                                  controller: _timeController,
                                  decoration: const InputDecoration(
                                    labelText:
                                        'Preferred Delivery Time (Optional)',
                                    border: OutlineInputBorder(),
                                    prefixIcon: Icon(Icons.access_time),
                                    hintText: 'e.g., ASAP or 2026-01-01 18:00',
                                  ),
                                ),
                                const SizedBox(height: 12),
                                TextFormField(
                                  controller: _instructionsController,
                                  decoration: const InputDecoration(
                                    labelText:
                                        'Special Instructions (Optional)',
                                    border: OutlineInputBorder(),
                                    prefixIcon: Icon(Icons.note),
                                  ),
                                  maxLines: 2,
                                ),
                              ],
                            ),
                          ),
                        ),

                        const SizedBox(height: 16),

                        // Payment Method Card
                        Card(
                          elevation: 2,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(16.0),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: const [
                                    Icon(Icons.payment, size: 20),
                                    SizedBox(width: 8),
                                    Text(
                                      'Payment Method',
                                      style: TextStyle(
                                        fontSize: 18,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 12),
                                Column(
                                  children: [
                                    _buildPaymentOption(
                                      title: 'Cash on Delivery',
                                      value: 'cash',
                                      icon: Icons.delivery_dining,
                                      subtitle: 'Pay with cash at delivery',
                                    ),
                                    const SizedBox(height: 8),
                                    _buildPaymentOption(
                                      title: 'Credit/Debit Card',
                                      value: 'card',
                                      icon: Icons.credit_card,
                                      subtitle: 'Pay securely with your card',
                                    ),
                                    const SizedBox(height: 8),
                                    _buildPaymentOption(
                                      title: 'Wallet',
                                      value: 'wallet',
                                      icon: Icons.account_balance_wallet,
                                      subtitle: 'Use your in-app wallet',
                                    ),
                                  ],
                                ),
                                if (_paymentMethod == 'wallet' &&
                                    _walletBalance != null)
                                  Padding(
                                    padding: const EdgeInsets.only(
                                      top: 12,
                                      left: 4,
                                      right: 4,
                                    ),
                                    child: Container(
                                      padding: const EdgeInsets.all(12),
                                      decoration: BoxDecoration(
                                        borderRadius: BorderRadius.circular(12),
                                        color:
                                            _walletBalance! >= cart.totalAmount
                                            ? Colors.green.shade50
                                            : Colors.red.shade50,
                                        border: Border.all(
                                          color:
                                              _walletBalance! >=
                                                  cart.totalAmount
                                              ? Colors.green
                                              : Colors.red,
                                        ),
                                      ),
                                      child: Row(
                                        children: [
                                          Icon(
                                            _walletBalance! >= cart.totalAmount
                                                ? Icons.check_circle
                                                : Icons.error,
                                            color:
                                                _walletBalance! >=
                                                    cart.totalAmount
                                                ? Colors.green
                                                : Colors.red,
                                          ),
                                          const SizedBox(width: 8),
                                          Expanded(
                                            child: Column(
                                              crossAxisAlignment:
                                                  CrossAxisAlignment.start,
                                              children: [
                                                Text(
                                                  'Wallet Balance: PKR ${_walletBalance!.toStringAsFixed(2)}',
                                                  style: TextStyle(
                                                    fontWeight: FontWeight.bold,
                                                    color:
                                                        _walletBalance! >=
                                                            cart.totalAmount
                                                        ? Colors.green
                                                        : Colors.red,
                                                  ),
                                                ),
                                                if (_walletBalance! <
                                                    cart.totalAmount)
                                                  Padding(
                                                    padding:
                                                        const EdgeInsets.only(
                                                          top: 4,
                                                        ),
                                                    child: Text(
                                                      'Insufficient balance. Need PKR ${(cart.totalAmount - _walletBalance!).toStringAsFixed(2)} more.',
                                                      style: const TextStyle(
                                                        fontSize: 12,
                                                        color: Colors.red,
                                                      ),
                                                    ),
                                                  ),
                                              ],
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                        ),

                        const SizedBox(height: 24),
                        SizedBox(
                          width: double.infinity,
                          child: ElevatedButton.icon(
                            icon: const Icon(Icons.lock_outline),
                            style: ElevatedButton.styleFrom(
                              padding: const EdgeInsets.symmetric(vertical: 16),
                            ),
                            onPressed: _submitOrder,
                            label: const Text(
                              'Place Order',
                              style: TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(height: 40),
                      ],
                    ),
                  );

                  return SingleChildScrollView(
                    padding: EdgeInsets.fromLTRB(
                      16 + sidePadding,
                      16,
                      16 + sidePadding,
                      16,
                    ),
                    child: content,
                  );
                },
              ),
            ),
    );
  }
}
