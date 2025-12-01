import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';

class OrdersScreen extends StatefulWidget {
  const OrdersScreen({super.key});

  @override
  State<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends State<OrdersScreen> {
  List<dynamic> _orders = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadOrders();
  }

  Future<void> _loadOrders() async {
    final authProvider = Provider.of<AuthProvider>(context, listen: false);

    if (!authProvider.isAuthenticated) return;

    setState(() => _isLoading = true);

    try {
      final orders = await ApiService.getOrders(authProvider.token!);
      setState(() => _orders = orders);
    } catch (e) {
      String errorMessage = 'Failed to load orders: $e';
      if (e.toString().contains('403') || e.toString().contains('Forbidden')) {
        errorMessage = 'Session expired. Please login again.';
        await authProvider.logout();
        if (mounted) {
          Navigator.of(context).pushReplacementNamed('/login');
        }
        return;
      }
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(errorMessage)),
        );
      }
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final authProvider = Provider.of<AuthProvider>(context);

    if (!authProvider.isAuthenticated) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('Orders'),
          backgroundColor: Colors.green,
        ),
        body: const Center(
          child: Text('Please login to view your orders'),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Orders'),
        backgroundColor: Colors.green,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _orders.isEmpty
              ? const Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.receipt_long_outlined,
                        size: 80,
                        color: Colors.grey,
                      ),
                      SizedBox(height: 16),
                      Text(
                        'No orders yet',
                        style: TextStyle(
                          fontSize: 18,
                          color: Colors.grey,
                        ),
                      ),
                    ],
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _loadOrders,
                  child: ListView.builder(
                    itemCount: _orders.length,
                    itemBuilder: (context, index) {
                      final order = _orders[index];
                      return Card(
                        margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                        child: Padding(
                          padding: const EdgeInsets.all(16),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    'Order #${order['order_number']?.toString() ?? 'N/A'}',
                                    style: const TextStyle(
                                      fontSize: 16,
                                      fontWeight: FontWeight.bold,
                                    ),
                                  ),
                                  Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                    decoration: BoxDecoration(
                                      color: _getStatusColor(order['status']?.toString() ?? 'unknown'),
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    child: Text(
                                      (order['status']?.toString() ?? 'UNKNOWN').toUpperCase(),
                                      style: const TextStyle(
                                        color: Colors.white,
                                        fontSize: 12,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 8),
                              Text(
                                'Total: \$${order['total_amount']?.toString() ?? '0.00'}',
                                style: const TextStyle(
                                  fontSize: 14,
                                  color: Colors.green,
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                'Ordered on: ${order['created_at']?.toString() ?? 'Unknown'}',
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: Colors.grey,
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    },
                  ),
                ),
    );
  }

  Color _getStatusColor(String status) {
    switch (status.toLowerCase()) {
      case 'pending':
        return Colors.orange;
      case 'confirmed':
        return Colors.blue;
      case 'preparing':
        return Colors.purple;
      case 'ready':
        return Colors.teal;
      case 'out_for_delivery':
        return Colors.indigo;
      case 'delivered':
        return Colors.green;
      case 'cancelled':
        return Colors.red;
      default:
        return Colors.grey;
    }
  }
}
