import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:logger/logger.dart';
import 'package:provider/provider.dart';
import '../../providers/auth_provider.dart';
import '../../services/api_service.dart';

class AdminOrdersReportScreen extends StatefulWidget {
  const AdminOrdersReportScreen({super.key});

  @override
  State<AdminOrdersReportScreen> createState() =>
      _AdminOrdersReportScreenState();
}

class _AdminOrdersReportScreenState extends State<AdminOrdersReportScreen> {
  final _logger = Logger();
  bool _isLoading = true;
  List<dynamic> _orders = [];
  String _selectedStatus = 'all';

  @override
  void initState() {
    super.initState();
    _loadOrders();
  }

  Future<void> _loadOrders() async {
    setState(() => _isLoading = true);
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;
      
      final orders = await ApiService.getAllOrders(
        token,
        status: _selectedStatus == 'all' ? null : _selectedStatus,
      );
      
      setState(() {
        _orders = orders;
        _isLoading = false;
      });
    } catch (e) {
      _logger.e('Error loading orders: $e');
      setState(() => _isLoading = false);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error loading orders: $e')),
        );
      }
    }
  }

  void _showOrderDetails(Map<String, dynamic> order) {
    var itemsData = order['items'];
    List<dynamic> items = [];
    if (itemsData is String) {
      try {
        items = jsonDecode(itemsData);
      } catch (e) {
        _logger.e('Error parsing items: $e');
      }
    } else if (itemsData is List) {
      items = itemsData;
    }

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Order #${order['id']} Details'),
        content: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              _buildDetailRow('Store', '${order['store_name'] ?? 'N/A'}'),
              _buildDetailRow('Store Addr', '${order['store_location'] ?? 'N/A'}'),
              const Divider(),
              _buildDetailRow('Customer', '${order['first_name']} ${order['last_name']}'),
              _buildDetailRow('Phone', '${order['phone'] ?? 'N/A'}'),
              _buildDetailRow('Address', '${order['delivery_address'] ?? 'N/A'}'),
              const Divider(),
              const Text('Items:', style: TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              if (items.isEmpty)
                const Text('No items found')
              else
                ...items.map((item) => Padding(
                  padding: const EdgeInsets.only(bottom: 4),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(child: Text('${item['quantity']}x ${item['name']}')),
                      Text('PKR ${item['price']}'),
                    ],
                  ),
                )),
              const Divider(),
              _buildDetailRow('Total', 'PKR ${order['total_amount']}', valueColor: Colors.green),
              _buildDetailRow('Payment', '${order['payment_method']} (${order['payment_status']})'),
              _buildDetailRow('Status', '${order['status']}', valueColor: _getStatusColor(order['status'] ?? '')),
              if (order['rider_id'] != null) ...[
                const Divider(),
                _buildDetailRow('Rider', '${order['rider_first_name']} ${order['rider_last_name']}'),
              ],
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Close'),
          ),
        ],
      ),
    );
  }

  Widget _buildDetailRow(String label, String value, {Color? valueColor}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 80,
            child: Text(
              '$label:',
              style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(fontSize: 12, color: valueColor),
            ),
          ),
        ],
      ),
    );
  }

  Color _getStatusColor(String status) {
    switch (status.toLowerCase()) {
      case 'pending': return Colors.orange;
      case 'confirmed': return Colors.blue;
      case 'preparing': return Colors.indigo;
      case 'ready_for_pickup': return Colors.purple;
      case 'picked_up': return Colors.teal;
      case 'delivered': return Colors.green;
      case 'cancelled': return Colors.red;
      default: return Colors.grey;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Orders Report'),
        actions: [
          PopupMenuButton<String>(
            initialValue: _selectedStatus,
            onSelected: (value) {
              setState(() {
                _selectedStatus = value;
              });
              _loadOrders();
            },
            itemBuilder: (context) => [
              const PopupMenuItem(value: 'all', child: Text('All Status')),
              const PopupMenuItem(value: 'pending', child: Text('Pending')),
              const PopupMenuItem(value: 'confirmed', child: Text('Confirmed')),
              const PopupMenuItem(value: 'preparing', child: Text('Preparing')),
              const PopupMenuItem(value: 'ready_for_pickup', child: Text('Ready for Pickup')),
              const PopupMenuItem(value: 'picked_up', child: Text('Picked Up')),
              const PopupMenuItem(value: 'delivered', child: Text('Delivered')),
              const PopupMenuItem(value: 'cancelled', child: Text('Cancelled')),
            ],
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadOrders,
              child: _orders.isEmpty
                  ? const Center(child: Text('No orders found'))
                  : ListView.builder(
                      itemCount: _orders.length,
                      itemBuilder: (context, index) {
                        final order = _orders[index];
                        final date = DateTime.parse(order['created_at']);
                        return Card(
                          margin: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                          child: ListTile(
                            title: Row(
                              children: [
                                Text('Order #${order['id']}'),
                                const Spacer(),
                                Text(
                                  'PKR ${order['total_amount']}',
                                  style: const TextStyle(
                                    fontWeight: FontWeight.bold,
                                    color: Colors.green,
                                  ),
                                ),
                              ],
                            ),
                            subtitle: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text('${order['store_name']} • ${DateFormat('MMM d, h:mm a').format(date)}'),
                                Text(
                                  'Status: ${order['status']}',
                                  style: TextStyle(
                                    color: _getStatusColor(order['status'] ?? ''),
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ],
                            ),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () => _showOrderDetails(order),
                          ),
                        );
                      },
                    ),
            ),
    );
  }
}
