import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:logger/logger.dart';
import 'package:geolocator/geolocator.dart';
import 'package:geocoding/geocoding.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import 'login_screen.dart';

class RiderDashboardScreen extends StatefulWidget {
  const RiderDashboardScreen({super.key});

  @override
  State<RiderDashboardScreen> createState() => _RiderDashboardScreenState();
}

class _RiderDashboardScreenState extends State<RiderDashboardScreen>
    with SingleTickerProviderStateMixin {
  final Logger _logger = Logger();
  late TabController _tabController;
  bool _isLoading = true;
  Map<String, dynamic>? _riderProfile;
  List<dynamic> _assignedDeliveries = [];
  List<dynamic> _completedDeliveries = [];
  String _currentLocation = 'Getting location...';

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadAllData();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _loadAllData() async {
    setState(() => _isLoading = true);
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;

      await Future.wait([
        _loadProfile(token),
        _loadDeliveries(token, 'assigned'),
        _loadDeliveries(token, 'completed'),
        _getCurrentLocation(),
      ]);
    } catch (e) {
      _logger.e('Error loading rider data: $e');
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _loadProfile(String token) async {
    try {
      final data = await ApiService.getRiderProfile(token);
      if (data['success'] == true) {
        setState(() {
          _riderProfile = data['rider'];
        });
      }
    } catch (e) {
      _logger.e('Error loading profile: $e');
    }
  }

  Future<void> _loadDeliveries(String token, String status) async {
    try {
      final deliveries = await ApiService.getRiderDeliveries(token, status);
      setState(() {
        if (status == 'assigned') {
          _assignedDeliveries = deliveries;
        } else {
          _completedDeliveries = deliveries;
        }
      });
    } catch (e) {
      _logger.e('Error loading $status deliveries: $e');
    }
  }

  Future<void> _refreshLocation() async {
    setState(() => _currentLocation = 'Updating...');
    await _getCurrentLocation();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Location updated successfully!')),
      );
    }
  }

  Future<void> _getCurrentLocation() async {
    try {
      bool serviceEnabled;
      LocationPermission permission;

      serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        if (mounted) {
          setState(() => _currentLocation = 'Location services disabled');
        }
        return;
      }

      permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
        if (permission == LocationPermission.denied) {
          if (mounted) {
            setState(() => _currentLocation = 'Location permission denied');
          }
          return;
        }
      }

      if (permission == LocationPermission.deniedForever) {
        if (mounted) {
          setState(
            () => _currentLocation = 'Location permission permanently denied',
          );
        }
        return;
      }

      Position position = await Geolocator.getCurrentPosition();

      try {
        List<Placemark> placemarks = await placemarkFromCoordinates(
          position.latitude,
          position.longitude,
        );

        if (mounted && placemarks.isNotEmpty) {
          Placemark place = placemarks[0];
          String address = '';
          if (place.street != null && place.street!.isNotEmpty) {
            address += place.street!;
          }
          if (place.locality != null && place.locality!.isNotEmpty) {
            if (address.isNotEmpty) address += ', ';
            address += place.locality!;
          }

          if (address.isEmpty) {
            address =
                '${position.latitude.toStringAsFixed(4)}, ${position.longitude.toStringAsFixed(4)}';
          }

          setState(() {
            _currentLocation = address;
          });
        } else if (mounted) {
          setState(() {
            _currentLocation =
                '${position.latitude.toStringAsFixed(4)}, ${position.longitude.toStringAsFixed(4)}';
          });
        }
      } catch (e) {
        if (mounted) {
          setState(() {
            _currentLocation =
                '${position.latitude.toStringAsFixed(4)}, ${position.longitude.toStringAsFixed(4)}';
          });
        }
      }
    } catch (e) {
      _logger.e('Error getting location: $e');
      if (mounted) setState(() => _currentLocation = 'Error getting location');
    }
  }

  Future<void> _markAsDelivered(int orderId) async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;

      await ApiService.updateOrderStatus(token, orderId, 'delivered');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Order marked as delivered!')),
        );
        _loadAllData(); // Refresh list
      }
    } catch (e) {
      _logger.e('Error marking delivered: $e');
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Failed to update status: $e')));
      }
    }
  }

  Future<void> _markPaymentReceived(int orderId) async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;

      await ApiService.updatePaymentStatus(token, orderId, 'paid');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Payment marked as received!')),
        );
        _loadAllData(); // Refresh list
      }
    } catch (e) {
      _logger.e('Error updating payment: $e');
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('Failed to update payment: $e')));
      }
    }
  }

  void _logout() {
    Provider.of<AuthProvider>(context, listen: false).logout();
    Navigator.of(
      context,
    ).pushReplacement(MaterialPageRoute(builder: (_) => const LoginScreen()));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Rider Dashboard'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loadAllData),
          IconButton(icon: const Icon(Icons.logout), onPressed: _logout),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                // Rider Info Section
                _buildRiderInfoCard(),

                // Tabs
                TabBar(
                  controller: _tabController,
                  labelColor: Colors.blue,
                  unselectedLabelColor: Colors.grey,
                  tabs: const [
                    Tab(text: 'My Deliveries'),
                    Tab(text: 'Completed'),
                  ],
                ),

                // Tab Content
                Expanded(
                  child: TabBarView(
                    controller: _tabController,
                    children: [
                      _buildDeliveriesList(_assignedDeliveries, true),
                      _buildDeliveriesList(_completedDeliveries, false),
                    ],
                  ),
                ),
              ],
            ),
    );
  }

  Widget _buildRiderInfoCard() {
    return Card(
      margin: const EdgeInsets.all(16),
      elevation: 4,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Welcome, ${_riderProfile?['first_name'] ?? 'Rider'}',
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text('Vehicle: ${_riderProfile?['vehicle_type'] ?? 'N/A'}'),
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.location_on, color: Colors.blue, size: 20),
                const SizedBox(width: 4),
                Expanded(
                  child: Text(
                    _currentLocation,
                    style: const TextStyle(fontWeight: FontWeight.w500),
                  ),
                ),
                TextButton(
                  onPressed: _refreshLocation,
                  child: const Text('Refresh'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDeliveriesList(List<dynamic> deliveries, bool isAssigned) {
    if (deliveries.isEmpty) {
      return const Center(child: Text('No deliveries found.'));
    }

    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: deliveries.length,
      itemBuilder: (context, index) {
        final delivery = deliveries[index];
        return _buildDeliveryCard(delivery, isAssigned);
      },
    );
  }

  Widget _buildDeliveryCard(Map<String, dynamic> delivery, bool isAssigned) {
    final status = delivery['status'] ?? 'unknown';
    final paymentStatus = delivery['payment_status'] ?? 'pending';

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(
                    'Order #${delivery['order_number']}',
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                    ),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 4,
                  ),
                  decoration: BoxDecoration(
                    color: _getStatusColor(status).withValues(alpha: 0.1),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: _getStatusColor(status)),
                  ),
                  child: Text(
                    status.toUpperCase(),
                    style: TextStyle(
                      color: _getStatusColor(status),
                      fontWeight: FontWeight.bold,
                      fontSize: 12,
                    ),
                  ),
                ),
              ],
            ),
            const Divider(),

            // Details
            _buildDetailRow(
              'Customer',
              '${delivery['first_name']} ${delivery['last_name']}',
            ),
            _buildDetailRow('Store', '${delivery['store_name']}'),
            _buildDetailRow('Total', 'PKR ${delivery['total_amount']}'),
            _buildDetailRow('Address', '${delivery['delivery_address']}'),
            _buildDetailRow('Phone', '${delivery['phone'] ?? 'N/A'}'),
            _buildDetailRow(
              'Payment',
              paymentStatus,
              valueColor: paymentStatus == 'paid'
                  ? Colors.green
                  : Colors.orange,
            ),

            if (delivery['rider_location'] != null)
              _buildDetailRow('My Location', '${delivery['rider_location']}'),

            const SizedBox(height: 16),

            // Actions
            if (isAssigned && status == 'out_for_delivery') ...[
              Row(
                children: [
                  Expanded(
                    child: ElevatedButton(
                      onPressed: () => _markAsDelivered(delivery['id']),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.green,
                        foregroundColor: Colors.white,
                      ),
                      child: const Text('Mark Delivered'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  if (paymentStatus != 'paid')
                    Expanded(
                      child: ElevatedButton(
                        onPressed: () => _markPaymentReceived(delivery['id']),
                        style: ElevatedButton.styleFrom(
                          backgroundColor: Colors.blue,
                          foregroundColor: Colors.white,
                        ),
                        child: const Text('Payment Recvd'),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 8),
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed:
                      _refreshLocation, // Ideally updates specific order location
                  icon: const Icon(Icons.location_on),
                  label: const Text('Update My Location'),
                ),
              ),
            ] else if (!isAssigned) ...[
              // Completed or other
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () {
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(content: Text('Viewing details...')),
                    );
                  },
                  child: const Text('View Details'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildDetailRow(String label, String value, {Color? valueColor}) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 80,
            child: Text(
              '$label:',
              style: const TextStyle(
                fontWeight: FontWeight.bold,
                color: Colors.grey,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: TextStyle(
                color: valueColor ?? Colors.black87,
                fontWeight: valueColor != null
                    ? FontWeight.bold
                    : FontWeight.normal,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Color _getStatusColor(String status) {
    switch (status.toLowerCase()) {
      case 'delivered':
        return Colors.green;
      case 'cancelled':
        return Colors.red;
      case 'out_for_delivery':
        return Colors.blue;
      case 'preparing':
        return Colors.orange;
      case 'pending':
        return Colors.amber;
      default:
        return Colors.grey;
    }
  }
}
