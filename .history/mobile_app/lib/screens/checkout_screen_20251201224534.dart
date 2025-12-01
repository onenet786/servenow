import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/cart_provider.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';

class CheckoutScreen extends StatefulWidget {
  const CheckoutScreen({super.key});

  @override
  State<CheckoutScreen> createState() => _CheckoutScreenState();
}

class _CheckoutScreenState extends State<CheckoutScreen> {
  final _formKey = GlobalKey<FormState>();
  final _addressController = TextEditingController();
  final _instructionsController = TextEditingController();

  String _paymentMethod = 'cash';
  bool _isPlacingOrder = false;

  @override
  void initState() {
    super.initState();
    // Pre-fill address if user has one
    final authProvider = Provider.of<AuthProvider>(context, listen: false);
    if (authProvider.user?.address != null) {
      _addressController.text = authProvider.user!.address!;
    }
  }

  @override
  void dispose() {
    _addressController.dispose();
    _instructionsController.dispose();
    super.dispose();
  }

  Future<void> _placeOrder() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isPlacingOrder = true);

    try {
      final cartProvider = Provider.of<CartProvider>(context, listen: false);
      final authProvider = Provider.of<AuthProvider>(context, listen: false);

      // For demo, use first store from cart items
      final storeId = cartProvider.items.first.product.storeId ?? 1;

      final orderData = await ApiService.createOrder(
        token: authProvider.token!,
        storeId: storeId,
        items: cartProvider.getItemsForOrder(),
        paymentMethod: _paymentMethod,
        deliveryAddress: _addressController.text.trim(),
        specialInstructions: _instructionsController.text.trim().isEmpty
            ? null
            : _instructionsController.text.trim(),
      );

      cartProvider.clear();

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Order placed successfully! Order #${orderData['order']['order_number']}'),
            backgroundColor: Colors.green,
          ),
        );
        Navigator.of(context).popUntil((route) => route.isFirst);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Failed to place order: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) {
        setState(() => _isPlacingOrder = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final cartProvider = Provider.of<CartProvider>(context);
    const deliveryFee = 2.99;
    final subtotal = cartProvider.totalAmount;
    final total = subtotal + deliveryFee;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Checkout'),
        backgroundColor: Colors.green,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16).copyWith(bottom: 32),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Order summary
              const Text(
                'Order Summary',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 16),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: cartProvider.items.map((item) {
                      return Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Expanded(
                              child: Text(
                                '${item.product.name} x${item.quantity}',
                                style: const TextStyle(fontSize: 14),
                              ),
                            ),
                            Text(
                              '\$${item.totalPrice.toStringAsFixed(2)}',
                              style: const TextStyle(fontWeight: FontWeight.w500),
                            ),
                          ],
                        ),
                      );
                    }).toList(),
                  ),
                ),
              ),

              const SizedBox(height: 24),

              // Delivery address
              const Text(
                'Delivery Address',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _addressController,
                decoration: const InputDecoration(
                  labelText: 'Delivery Address',
                  border: OutlineInputBorder(),
                  hintText: 'Enter your complete delivery address',
                ),
                maxLines: 3,
                validator: (value) {
                  if (value?.isEmpty ?? true) {
                    return 'Delivery address is required';
                  }
                  return null;
                },
              ),

              const SizedBox(height: 16),

              // Special instructions
              TextFormField(
                controller: _instructionsController,
                decoration: const InputDecoration(
                  labelText: 'Special Instructions (optional)',
                  border: OutlineInputBorder(),
                  hintText: 'Any special delivery instructions',
                ),
                maxLines: 2,
              ),

              const SizedBox(height: 24),

              // Payment method
              const Text(
                'Payment Method',
                style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 16),
              SegmentedButton<String>(
                segments: const [
                  ButtonSegment(value: 'cash', label: Text('Cash')),
                  ButtonSegment(value: 'card', label: Text('Card')),
                  ButtonSegment(value: 'wallet', label: Text('Wallet')),
                ],
                selected: {_paymentMethod},
                onSelectionChanged: (Set<String> value) {
                  setState(() => _paymentMethod = value.first);
                },
              ),

              const SizedBox(height: 24),

              // Price breakdown
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text('Subtotal:'),
                          Text('\$${subtotal.toStringAsFixed(2)}'),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text('Delivery Fee:'),
                          Text('\$${deliveryFee.toStringAsFixed(2)}'),
                        ],
                      ),
                      const Divider(height: 16),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          const Text(
                            'Total:',
                            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                          ),
                          Text(
                            '\$${total.toStringAsFixed(2)}',
                            style: const TextStyle(
                              fontWeight: FontWeight.bold,
                              fontSize: 16,
                              color: Colors.green,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),

              const SizedBox(height: 24),

              // Place order button
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _isPlacingOrder ? null : _placeOrder,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.green,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  child: _isPlacingOrder
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                          ),
                        )
                      : const Text(
                          'Place Order',
                          style: TextStyle(fontSize: 16),
                        ),
                ),
              ),
              const SizedBox(height: 20), // Extra space to prevent overflow
            ],
          ),
        ),
      ),
    );
  }
}
