import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:logger/logger.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';

class AdminDashboardScreen extends StatefulWidget {
  const AdminDashboardScreen({super.key});

  @override
  State<AdminDashboardScreen> createState() => _AdminDashboardScreenState();
}

class _AdminDashboardScreenState extends State<AdminDashboardScreen> {
  final Logger _logger = Logger();
  bool _isLoading = true;

  // Today's Orders Stats
  int _todayTotal = 0;
  int _todayDelivered = 0;
  int _todayPending = 0;
  int _todayCancelled = 0;

  // All Orders Stats
  int _allTotal = 0;
  int _allDelivered = 0;
  int _allPending = 0;
  int _allCancelled = 0;

  // Today's Visitors Stats
  int _activeUsers = 0;
  int _todayLogins = 0;

  // Recent Activity
  List<Map<String, dynamic>> _recentActivities = [];

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  Future<void> _loadStats() async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;

      // Fetch Orders, Visitor Stats, Users, and Stores in parallel
      final results = await Future.wait([
        ApiService.getOrders(token),
        ApiService.getVisitorStats(token),
        ApiService.getUsers(token),
        ApiService.getStoresForAdmin(token),
      ]);

      final orders = results[0] as List<dynamic>;
      final visitorStats = results[1] as Map<String, dynamic>;
      final users = results[2] as List<dynamic>;
      final stores = results[3] as List<dynamic>;

      final now = DateTime.now();
      final todayOrders = orders.where((o) {
        try {
          final dt = DateTime.parse(o['created_at'].toString());
          return dt.year == now.year &&
              dt.month == now.month &&
              dt.day == now.day;
        } catch (e) {
          return false;
        }
      }).toList();

      int countStatus(List list, String status) {
        return list
            .where(
              (o) => (o['status'] ?? '').toString().toLowerCase() == status,
            )
            .length;
      }

      int countPendingLike(List list) {
        return list.where((o) {
          final s = (o['status'] ?? '').toString().toLowerCase();
          return s != 'delivered' && s != 'cancelled';
        }).length;
      }

      // Build recent activities list - only show the LAST record for each type
      final activities = <Map<String, dynamic>>[];

      // Get last order
      final sortedOrders = [...orders];
      try {
        sortedOrders.sort((a, b) {
          final dateA =
              DateTime.tryParse(a['created_at'].toString()) ?? DateTime.now();
          final dateB =
              DateTime.tryParse(b['created_at'].toString()) ?? DateTime.now();
          return dateB.compareTo(dateA);
        });
      } catch (e) {
        _logger.w('Error sorting orders: $e');
      }

      if (sortedOrders.isNotEmpty) {
        final lastOrder = sortedOrders.first;
        activities.add({
          'type': 'order',
          'data': lastOrder,
          'title': 'New Order #${lastOrder['id']}',
          'subtitle': _formatTimeAgo(lastOrder['created_at']),
          'icon': Icons.shopping_bag,
          'color': Colors.blue,
        });
      }

      // Get last user registration
      final sortedUsers = [...users];
      try {
        sortedUsers.sort((a, b) {
          final dateA =
              DateTime.tryParse(a['created_at']?.toString() ?? '') ??
              DateTime.now();
          final dateB =
              DateTime.tryParse(b['created_at']?.toString() ?? '') ??
              DateTime.now();
          return dateB.compareTo(dateA);
        });
      } catch (e) {
        _logger.w('Error sorting users: $e');
      }

      if (sortedUsers.isNotEmpty) {
        final lastUser = sortedUsers.first;
        activities.add({
          'type': 'user',
          'data': lastUser,
          'title': 'New User: ${lastUser['first_name'] ?? 'User'} registered',
          'subtitle': _formatTimeAgo(lastUser['created_at']),
          'icon': Icons.person_add,
          'color': Colors.green,
        });
      }

      // Get last store
      if (stores.isNotEmpty) {
        final sortedStores = [...stores];
        try {
          sortedStores.sort((a, b) {
            final dateA =
                DateTime.tryParse(a['created_at']?.toString() ?? '') ??
                DateTime.now();
            final dateB =
                DateTime.tryParse(b['created_at']?.toString() ?? '') ??
                DateTime.now();
            return dateB.compareTo(dateA);
          });
        } catch (e) {
          _logger.w('Error sorting stores: $e');
        }

        final lastStore = sortedStores.first;
        activities.add({
          'type': 'store',
          'data': lastStore,
          'title': 'New Store: ${lastStore['store_name'] ?? 'Store'} added',
          'subtitle': _formatTimeAgo(lastStore['created_at']),
          'icon': Icons.store,
          'color': Colors.orange,
        });
      }

      setState(() {
        // Today
        _todayTotal = todayOrders.length;
        _todayDelivered = countStatus(todayOrders, 'delivered');
        _todayPending = countPendingLike(todayOrders);
        _todayCancelled = countStatus(todayOrders, 'cancelled');

        // All
        _allTotal = orders.length;
        _allDelivered = countStatus(orders, 'delivered');
        _allPending = countPendingLike(orders);
        _allCancelled = countStatus(orders, 'cancelled');

        // Visitors
        _activeUsers = visitorStats['active_users'] ?? 0;
        _todayLogins = visitorStats['today_logins'] ?? 0;

        // Recent Activities
        _recentActivities = activities;

        _isLoading = false;
      });
    } catch (e) {
      _logger.e('Error loading stats: $e');
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final authProvider = Provider.of<AuthProvider>(context);

    return Scaffold(
      backgroundColor: Colors.grey[100],
      appBar: AppBar(
        elevation: 0,
        backgroundColor: Colors.white,
        title: const Text(
          'Admin Dashboard',
          style: TextStyle(color: Colors.black87, fontWeight: FontWeight.bold),
        ),
        actions: [
          IconButton(
            icon: const Icon(
              Icons.notifications_outlined,
              color: Colors.black87,
            ),
            onPressed: () {},
          ),
          Padding(
            padding: const EdgeInsets.only(right: 16.0),
            child: CircleAvatar(
              backgroundColor: Colors.indigo,
              child: Text(
                authProvider.user?.firstName.substring(0, 1).toUpperCase() ??
                    'A',
                style: const TextStyle(color: Colors.white),
              ),
            ),
          ),
        ],
      ),
      drawer: _buildDrawer(context, authProvider),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : RefreshIndicator(
              onRefresh: _loadStats,
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16.0),
                physics: const AlwaysScrollableScrollPhysics(),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Dashboard Overview',
                      style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.bold,
                        color: Colors.black87,
                      ),
                    ),
                    const SizedBox(height: 12),

                    // Today's Orders Section
                    const Text(
                      "Today's Orders",
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 4),
                    _buildStatGrid(
                      total: _todayTotal,
                      delivered: _todayDelivered,
                      pending: _todayPending,
                      cancelled: _todayCancelled,
                    ),

                    const SizedBox(height: 4),

                    // All Orders Section
                    const Text(
                      "All Orders",
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 4),
                    _buildStatGrid(
                      total: _allTotal,
                      delivered: _allDelivered,
                      pending: _allPending,
                      cancelled: _allCancelled,
                    ),

                    const SizedBox(height: 4),

                    // Today's Visitors Section (Mocked for now as per request)
                    const Text(
                      "Today's Visitors",
                      style: TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 4),
                    _buildVisitorsGrid(),

                    const SizedBox(height: 32),
                    const Text(
                      'Recent Activity',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                        color: Colors.black87,
                      ),
                    ),
                    const SizedBox(height: 16),
                    _buildRecentActivityList(),
                  ],
                ),
              ),
            ),
    );
  }

  Widget _buildDrawer(BuildContext context, AuthProvider authProvider) {
    return Drawer(
      child: ListView(
        padding: EdgeInsets.zero,
        children: [
          UserAccountsDrawerHeader(
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [Colors.indigo, Colors.blueAccent],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
            ),
            accountName: Text(
              '${authProvider.user?.firstName} ${authProvider.user?.lastName}',
            ),
            accountEmail: Text(authProvider.user?.email ?? ''),
            currentAccountPicture: CircleAvatar(
              backgroundColor: Colors.white,
              child: Text(
                authProvider.user?.firstName.substring(0, 1).toUpperCase() ??
                    'A',
                style: const TextStyle(fontSize: 24, color: Colors.indigo),
              ),
            ),
          ),
          ListTile(
            leading: const Icon(Icons.dashboard),
            title: const Text('Dashboard'),
            selected: true,
            onTap: () {
              Navigator.of(context).pop();
            },
          ),
          ListTile(
            leading: const Icon(Icons.store),
            title: const Text('Manage Stores'),
            onTap: () {
              Navigator.of(context).pop();
              Navigator.of(context).pushNamed('/manage-stores');
            },
          ),
          ListTile(
            leading: const Icon(Icons.shopping_bag),
            title: const Text('Manage Products'),
            onTap: () {
              Navigator.of(context).pop();
              Navigator.of(context).pushNamed('/manage-products');
            },
          ),
          ListTile(
            leading: const Icon(Icons.people),
            title: const Text('Manage Users'),
            onTap: () {
              Navigator.of(context).pop();
              Navigator.of(context).pushNamed('/manage-users');
            },
          ),
          ListTile(
            leading: const Icon(Icons.account_balance_wallet),
            title: const Text('Wallet'),
            onTap: () {
              Navigator.of(context).pop();
              Navigator.of(context).pushNamed('/wallet');
            },
          ),
          ListTile(
            leading: const Icon(Icons.delivery_dining),
            title: const Text('Riders'),
            onTap: () {
              Navigator.of(context).pop();
              Navigator.of(context).pushNamed('/manage-riders');
            },
          ),
          ListTile(
            leading: const Icon(Icons.inventory),
            title: const Text('Inventory Report'),
            onTap: () {
              Navigator.of(context).pop();
              Navigator.of(context).pushNamed('/inventory-report');
            },
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.logout, color: Colors.red),
            title: const Text('Logout', style: TextStyle(color: Colors.red)),
            onTap: () {
              authProvider.logout();
              Navigator.of(context).pushReplacementNamed('/login');
            },
          ),
        ],
      ),
    );
  }

  Widget _buildStatGrid({
    required int total,
    required int delivered,
    required int pending,
    required int cancelled,
  }) {
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: _buildStatCard(
                title: 'Total Orders',
                value: total.toString(),
                icon: Icons.shopping_cart,
                color: Colors.blue,
                gradient: [Colors.blue.shade400, Colors.blue.shade700],
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _buildStatCard(
                title: 'Total Delivered',
                value: delivered.toString(),
                icon: Icons.check_circle,
                color: Colors.green,
                gradient: [Colors.green.shade400, Colors.green.shade700],
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: _buildStatCard(
                title: 'Pending Orders',
                value: pending.toString(),
                icon: Icons.pending_actions,
                color: Colors.orange,
                gradient: [Colors.orange.shade400, Colors.orange.shade700],
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _buildStatCard(
                title: 'Cancelled',
                value: cancelled.toString(),
                icon: Icons.cancel,
                color: Colors.red,
                gradient: [Colors.red.shade400, Colors.red.shade700],
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildVisitorsGrid() {
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: _buildStatCard(
                title: 'Currently Login',
                value: _activeUsers.toString(),
                icon: Icons.person,
                color: Colors.purple,
                gradient: [Colors.purple.shade400, Colors.purple.shade700],
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: _buildStatCard(
                title: "Today's Total Logins/Visitors",
                value: _todayLogins.toString(),
                icon: Icons.people_alt,
                color: Colors.teal,
                gradient: [Colors.teal.shade400, Colors.teal.shade700],
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildStatCard({
    required String title,
    required String value,
    required IconData icon,
    required Color color,
    required List<Color> gradient,
  }) {
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: gradient,
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(12), // Smaller radius
        boxShadow: [
          BoxShadow(
            color: color.withValues(alpha: 0.3),
            blurRadius: 6,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  value,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 20, // Smaller font
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text(
                  title,
                  style: const TextStyle(
                    color: Colors.white70,
                    fontSize: 11,
                  ), // Smaller font
                  overflow: TextOverflow.ellipsis,
                  maxLines: 2,
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.all(6),
            decoration: BoxDecoration(
              color: Colors.white.withValues(alpha: 0.2),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: Colors.white, size: 18),
          ),
        ],
      ),
    );
  }

  Widget _buildRecentActivityList() {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        boxShadow: [
          BoxShadow(
            color: Colors.grey.withValues(alpha: 0.1),
            blurRadius: 10,
            offset: const Offset(0, 5),
          ),
        ],
      ),
      child: _recentActivities.isEmpty
          ? Padding(
              padding: const EdgeInsets.all(24.0),
              child: Text(
                'No recent activity',
                style: TextStyle(color: Colors.grey[600]),
              ),
            )
          : Column(
              children: [
                for (int i = 0; i < _recentActivities.length; i++) ...[
                  GestureDetector(
                    onTap: () => _showDetailedRecords(
                      _recentActivities[i]['type'],
                      _recentActivities[i]['data'],
                    ),
                    child: _buildActivityItem(
                      title: _recentActivities[i]['title'],
                      subtitle: _recentActivities[i]['subtitle'],
                      icon: _recentActivities[i]['icon'],
                      color: _recentActivities[i]['color'],
                    ),
                  ),
                  if (i < _recentActivities.length - 1)
                    const Divider(height: 1),
                ],
              ],
            ),
    );
  }

  void _showDetailedRecords(String type, dynamic lastRecord) async {
    final token = Provider.of<AuthProvider>(context, listen: false).token;
    if (token == null) return;

    List<dynamic> records = [];
    String title = '';

    try {
      if (type == 'order') {
        final allOrders = await ApiService.getOrders(token);
        records = _sortByDate(allOrders, 'created_at').take(7).toList();
        title = 'Last 7 Orders';
      } else if (type == 'user') {
        final allUsers = await ApiService.getUsers(token);
        records = _sortByDate(allUsers, 'created_at').take(7).toList();
        title = 'Last 7 Users Registered';
      } else if (type == 'store') {
        final allStores = await ApiService.getStoresForAdmin(token);
        records = _sortByDate(allStores, 'created_at').take(7).toList();
        title = 'Last 7 Stores Added';
      }

      if (!mounted) return;

      showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
        ),
        builder: (ctx) => DraggableScrollableSheet(
          expand: false,
          builder: (ctx, controller) => Container(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 16),
                Expanded(
                  child: ListView.builder(
                    controller: controller,
                    itemCount: records.length,
                    itemBuilder: (ctx, index) {
                      final record = records[index];
                      if (type == 'order') {
                        return _buildOrderListItem(record);
                      } else if (type == 'user') {
                        return _buildUserListItem(record);
                      } else {
                        return _buildStoreListItem(record);
                      }
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('Error loading records: $e')));
    }
  }

  List<dynamic> _sortByDate(List<dynamic> list, String dateField) {
    final sorted = [...list];
    try {
      sorted.sort((a, b) {
        final dateA =
            DateTime.tryParse(a[dateField]?.toString() ?? '') ?? DateTime.now();
        final dateB =
            DateTime.tryParse(b[dateField]?.toString() ?? '') ?? DateTime.now();
        return dateB.compareTo(dateA);
      });
    } catch (e) {
      _logger.w('Error sorting: $e');
    }
    return sorted;
  }

  Widget _buildOrderListItem(dynamic order) {
    return Card(
      child: ListTile(
        title: Text('Order #${order['id']}'),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            Text('Status: ${order['status'] ?? 'Unknown'}'),
            Text('Total: PKR ${order['total_amount'] ?? 0}'),
            Text(_formatTimeAgo(order['created_at'])),
          ],
        ),
        trailing: Icon(Icons.shopping_bag, color: Colors.blue[700]),
      ),
    );
  }

  Widget _buildUserListItem(dynamic user) {
    return Card(
      child: ListTile(
        title: Text('${user['first_name'] ?? ''} ${user['last_name'] ?? ''}'),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            Text('Email: ${user['email'] ?? 'N/A'}'),
            Text('Type: ${user['user_type'] ?? 'Unknown'}'),
            Text(_formatTimeAgo(user['created_at'])),
          ],
        ),
        trailing: Icon(Icons.person, color: Colors.green[700]),
      ),
    );
  }

  Widget _buildStoreListItem(dynamic store) {
    return Card(
      child: ListTile(
        title: Text('${store['store_name'] ?? 'Unknown Store'}'),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            Text('Email: ${store['email'] ?? 'N/A'}'),
            Text('Phone: ${store['phone'] ?? 'N/A'}'),
            Text(_formatTimeAgo(store['created_at'])),
          ],
        ),
        trailing: Icon(Icons.store, color: Colors.orange[700]),
      ),
    );
  }

  String _formatTimeAgo(dynamic dateTimeStr) {
    if (dateTimeStr == null) return 'Just now';
    try {
      final dateTime = DateTime.tryParse(dateTimeStr.toString());
      if (dateTime == null) return 'Just now';

      final now = DateTime.now();
      final difference = now.difference(dateTime);

      if (difference.inSeconds < 60) {
        return 'Just now';
      } else if (difference.inMinutes < 60) {
        return '${difference.inMinutes} min${difference.inMinutes > 1 ? 's' : ''} ago';
      } else if (difference.inHours < 24) {
        return '${difference.inHours} hour${difference.inHours > 1 ? 's' : ''} ago';
      } else if (difference.inDays < 7) {
        return '${difference.inDays} day${difference.inDays > 1 ? 's' : ''} ago';
      } else {
        return 'A week ago';
      }
    } catch (e) {
      return 'Just now';
    }
  }

  Widget _buildActivityItem({
    required String title,
    required String subtitle,
    required IconData icon,
    required Color color,
  }) {
    return ListTile(
      leading: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          shape: BoxShape.circle,
        ),
        child: Icon(icon, color: color, size: 20),
      ),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
      subtitle: Text(subtitle),
      trailing: const Icon(
        Icons.arrow_forward_ios,
        size: 14,
        color: Colors.grey,
      ),
    );
  }
}
