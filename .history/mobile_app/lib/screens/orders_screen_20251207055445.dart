import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:geolocator/geolocator.dart';
import 'package:logging/logging.dart';
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
  String _currentTab = 'assigned'; // For riders: 'assigned' or 'completed'
  String? _currentLocation;

  @override
  void initState() {
    super.initState();
    _loadOrders();
    _initLocation();
  }

  Future<void> _initLocation() async {
    final authProvider = Provider.of<AuthProvider>(context, listen: false);
    if (authProvider.user?.userType != 'rider') return;

    try {
      LocationPermission permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
        if (permission == LocationPermission.denied) {
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Location permission denied')),
            );
          }
          return;
        }
      }

      if (permission == LocationPermission.deniedForever) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Location permission permanently denied')),
          );
        }
        return;
      }

      // Get initial location
      Position position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      );
      setState(() {
        _currentLocation = '${position.latitude.toStringAsFixed(6)}, ${position.longitude.toStringAsFixed(6)}';
      });

      // Start location tracking
      _startLocationTracking(authProvider);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to get location: $e')),
        );
      }
    }
  }

  void _startLocationTracking(AuthProvider authProvider) {
    Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 10, // Update every 10 meters
      ),
    ).listen((Position position) {
      final location = '${position.latitude.toStringAsFixed(6)}, ${position.longitude.toStringAsFixed(6)}';
      setState(() => _currentLocation = location);

      // Auto-update location for active deliveries
      _autoUpdateLocation(authProvider, location);
    });
  }

  Future<void> _autoUpdateLocation(AuthProvider authProvider, String location) async {
    if (authProvider.token == null) return;

    try {
      final deliveries = await ApiService.getRiderDeliveries(authProvider.token!, status: 'assigned');
      for (final delivery in deliveries) {
        if (delivery['status'] == 'out_for_delivery') {
          await ApiService.updateRiderLocation(authProvider.token!, delivery['id'], location);
        }
      }
    } catch (e) {
      // Silent fail for auto-update
      print('Auto-update location failed: $e');
    }
  }

  Future<void> _refreshLocation() async {
    final authProvider = Provider.of<AuthProvider>(context, listen: false);
    if (authProvider.user?.userType != 'rider') return;

    try {
      Position position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      );
      final location = '${position.latitude.toStringAsFixed(6)}, ${position.longitude.toStringAsFixed(6)}';
      setState(() => _currentLocation = location);
      _autoUpdateLocation(authProvider, location);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Location refreshed')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to refresh location: $e')),
        );
      }
    }
  }

  Future<void> _loadOrders() async {
    final authProvider = Provider.of<AuthProvider>(context, listen: false);

    if (!authProvider.isAuthenticated) return;

    setState(() => _isLoading = true);

    try {
      List<dynamic> orders;
      if (authProvider.user!.userType == 'admin') {
        orders = await ApiService.getAllOrders(authProvider.token!);
      } else if (authProvider.user!.userType == 'rider') {
        orders = await ApiService.getRiderDeliveries(authProvider.token!, status: _currentTab);
      } else {
        orders = await ApiService.getOrders(authProvider.token!);
      }
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
        title: Text(authProvider.user!.userType == 'rider' ? 'My Deliveries' : 'My Orders'),
        backgroundColor: Colors.green,
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                if (authProvider.user!.userType == 'rider') ...[
                  Container(
                    color: Colors.blue.shade50,
                    padding: const EdgeInsets.all(8),
                    child: Row(
                      children: [
                        const Icon(Icons.location_on, color: Colors.blue),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _currentLocation != null
                                ? 'Current Location: $_currentLocation'
                                : 'Getting location...',
                            style: const TextStyle(fontSize: 14),
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.refresh),
                          onPressed: _refreshLocation,
                          tooltip: 'Refresh Location',
                        ),
                      ],
                    ),
                  ),
                  Container(
                    color: Colors.green.shade50,
                    child: Row(
                      children: [
                        Expanded(
                          child: TextButton(
                            onPressed: () {
                              setState(() => _currentTab = 'assigned');
                              _loadOrders();
                            },
                            style: TextButton.styleFrom(
                              backgroundColor: _currentTab == 'assigned'
                                  ? Colors.green
                                  : Colors.transparent,
                              foregroundColor: _currentTab == 'assigned'
                                  ? Colors.white
                                  : Colors.green,
                            ),
                            child: const Text('My Deliveries'),
                          ),
                        ),
                        Expanded(
                          child: TextButton(
                            onPressed: () {
                              setState(() => _currentTab = 'completed');
                              _loadOrders();
                            },
                            style: TextButton.styleFrom(
                              backgroundColor: _currentTab == 'completed'
                                  ? Colors.green
                                  : Colors.transparent,
                              foregroundColor: _currentTab == 'completed'
                                  ? Colors.white
                                  : Colors.green,
                            ),
                            child: const Text('Completed'),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                Expanded(
                  child: _orders.isEmpty
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
                                'No deliveries yet',
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
                              if (authProvider.user!.userType == 'rider') ...[
                                const SizedBox(height: 8),
                                Text(
                                  'Customer: ${order['first_name'] ?? 'N/A'} ${order['last_name'] ?? ''}',
                                  style: const TextStyle(
                                    fontSize: 14,
                                    color: Colors.black87,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  'Store: ${order['store_name'] ?? 'N/A'}',
                                  style: const TextStyle(
                                    fontSize: 14,
                                    color: Colors.black87,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  'Delivery Address: ${order['delivery_address'] ?? 'N/A'}',
                                  style: const TextStyle(
                                    fontSize: 14,
                                    color: Colors.black87,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  'Phone: ${order['phone'] ?? 'N/A'}',
                                  style: const TextStyle(
                                    fontSize: 14,
                                    color: Colors.black87,
                                  ),
                                ),
                                const SizedBox(height: 12),
                                Row(
                                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                                  children: _buildRiderActionButtons(order, authProvider),
                                ),
                              ] else ...[
                                Text(
                                  'Ordered on: ${order['created_at']?.toString() ?? 'Unknown'}',
                                  style: const TextStyle(
                                    fontSize: 12,
                                    color: Colors.grey,
                                  ),
                                ),
                                if (authProvider.user!.userType == 'admin') ...[
                                  const SizedBox(height: 12),
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                                    children: _buildActionButtons(order, authProvider),
                                  ),
                                ],
                              ],
                            ],
                          ),
                        ),
                      );
                    },
                          ),
                        ),
                ),
              ],
            ),
    );
  }

  List<Widget> _buildActionButtons(dynamic order, AuthProvider authProvider) {
    final status = order['status']?.toString().toLowerCase() ?? 'unknown';
    final orderId = order['id'] as int;

    switch (status) {
      case 'pending':
        return [
          ElevatedButton(
            onPressed: () => _updateOrderStatus(orderId, 'confirmed', authProvider),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.blue),
            child: const Text('Confirm'),
          ),
          ElevatedButton(
            onPressed: () => _assignRider(orderId, authProvider),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
            child: const Text('Assign Rider'),
          ),
          ElevatedButton(
            onPressed: () => _updateOrderStatus(orderId, 'cancelled', authProvider),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.red),
            child: const Text('Cancel'),
          ),
        ];
      case 'out_for_delivery':
        return [
          ElevatedButton(
            onPressed: () => _updateRiderLocation(orderId, authProvider),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.blue),
            child: const Text('Update Location'),
          ),
          ElevatedButton(
            onPressed: () => _markPaymentReceived(orderId, authProvider),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.orange),
            child: const Text('Mark Payment Received'),
          ),
          ElevatedButton(
            onPressed: () => _markAsDelivered(orderId, authProvider),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
            child: const Text('Mark Delivered'),
          ),
        ];
      default:
        return [];
    }
  }

  List<Widget> _buildRiderActionButtons(dynamic order, AuthProvider authProvider) {
    final status = order['status']?.toString().toLowerCase() ?? 'unknown';
    final orderId = order['id'] as int;

    switch (status) {
      case 'confirmed':
      case 'preparing':
      case 'ready':
        return [
          ElevatedButton(
            onPressed: () => _updateOrderStatus(orderId, 'out_for_delivery', authProvider),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.blue),
            child: const Text('Start Delivery'),
          ),
        ];
      case 'out_for_delivery':
        return [
          ElevatedButton(
            onPressed: () => _updateRiderLocation(orderId, authProvider),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.blue),
            child: const Text('Update Location'),
          ),
          ElevatedButton(
            onPressed: () => _markPaymentReceived(orderId, authProvider),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.orange),
            child: const Text('Mark Payment Received'),
          ),
          ElevatedButton(
            onPressed: () => _markAsDelivered(orderId, authProvider),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
            child: const Text('Mark Delivered'),
          ),
        ];
      default:
        return [];
    }
  }

  Future<void> _updateOrderStatus(int orderId, String status, AuthProvider authProvider) async {
    try {
      await ApiService.updateOrderStatus(authProvider.token!, orderId, status);
      _loadOrders();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Order status updated to $status')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to update order: $e')),
        );
      }
    }
  }

  Future<void> _assignRider(int orderId, AuthProvider authProvider) async {
    try {
      final riders = await ApiService.getAvailableRiders(authProvider.token!);
      if (riders.isEmpty) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('No available riders')),
          );
        }
        return;
      }

      if (!mounted) return;

      // Show dialog to select rider
      final selectedRider = await showDialog<int>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Select Rider'),
          content: SizedBox(
            width: double.maxFinite,
            child: ListView.builder(
              shrinkWrap: true,
              itemCount: riders.length,
              itemBuilder: (context, index) {
                final rider = riders[index];
                return ListTile(
                  title: Text('${rider['first_name']} ${rider['last_name']}'),
                  subtitle: Text(rider['vehicle_type'] ?? 'Unknown'),
                  onTap: () => Navigator.of(context).pop(rider['id'] as int),
                );
              },
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Cancel'),
            ),
          ],
        ),
      );

      if (selectedRider != null) {
        await ApiService.assignRider(authProvider.token!, orderId, selectedRider);
        _loadOrders();
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Rider assigned successfully')),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to assign rider: $e')),
        );
      }
    }
  }

  Future<void> _updateRiderLocation(int orderId, AuthProvider authProvider) async {
    try {
      Position position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      );
      final location = '${position.latitude.toStringAsFixed(6)}, ${position.longitude.toStringAsFixed(6)}';
      await ApiService.updateRiderLocation(authProvider.token!, orderId, location);
      _loadOrders();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Rider location updated')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to update location: $e')),
        );
      }
    }
  }

  Future<void> _markPaymentReceived(int orderId, AuthProvider authProvider) async {
    try {
      await ApiService.updatePaymentStatus(authProvider.token!, orderId, 'paid');
      _loadOrders();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Payment status updated')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to update payment status: $e')),
        );
      }
    }
  }

  Future<void> _markAsDelivered(int orderId, AuthProvider authProvider) async {
    try {
      await ApiService.markAsDelivered(authProvider.token!, orderId);
      _loadOrders();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Order marked as delivered')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Failed to mark as delivered: $e')),
        );
      }
    }
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
