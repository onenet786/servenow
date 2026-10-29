import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:logger/logger.dart';
import '../providers/auth_provider.dart';
import '../services/api_service.dart';
import '../widgets/admin/admin_ui.dart';
import '../widgets/ui/ui.dart';

class ManageUsersScreen extends StatefulWidget {
  const ManageUsersScreen({super.key});

  @override
  State<ManageUsersScreen> createState() => _ManageUsersScreenState();
}

class _ManageUsersScreenState extends State<ManageUsersScreen> {
  final Logger _logger = Logger();
  bool _isLoading = true;
  bool _hasError = false;
  List<dynamic> _users = [];
  List<dynamic> _filteredUsers = [];
  String _filterType = '';
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loadUsers();
    _searchController.addListener(_filterUsers);
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _loadUsers() async {
    try {
      final token = Provider.of<AuthProvider>(context, listen: false).token;
      if (token == null) return;

      final users = await ApiService.getUsers(token);

      setState(() {
        _users = users;
        _filteredUsers = users;
        _isLoading = false;
        _hasError = false;
      });
      _filterUsers();
    } catch (e) {
      _logger.e('Error loading users: $e');
      if (mounted) {
        setState(() {
          _isLoading = false;
          _hasError = _users.isEmpty;
        });
        if (_users.isNotEmpty) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Could not refresh users.')),
          );
        }
      }
    }
  }

  void _filterUsers() {
    final query = _searchController.text.toLowerCase();
    final List<dynamic> filtered = _users.where((user) {
      final name = '${user['first_name'] ?? ''} ${user['last_name'] ?? ''}'
          .toLowerCase();
      final email = (user['email'] ?? '').toString().toLowerCase();
      final phone = (user['phone'] ?? '').toString().toLowerCase();
      final userType = (user['user_type'] ?? '').toString();

      final matchesSearch =
          name.contains(query) ||
          email.contains(query) ||
          phone.contains(query);
      final matchesType = _filterType.isEmpty || userType == _filterType;

      return matchesSearch && matchesType;
    }).toList();

    setState(() => _filteredUsers = filtered);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Users')),
      body: _isLoading
          ? const SkeletonList(count: 6)
          : _hasError
          ? EmptyState(
              isError: true,
              icon: Icons.cloud_off_rounded,
              title: 'Could not load users',
              message: 'Check the connection and try again.',
              actionLabel: 'Retry',
              actionIcon: Icons.refresh_rounded,
              onAction: () {
                setState(() => _isLoading = true);
                _loadUsers();
              },
            )
          : RefreshIndicator(
              onRefresh: _loadUsers,
              child: Column(
                children: [
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                    child: Column(
                      children: [
                        TextField(
                          controller: _searchController,
                          textInputAction: TextInputAction.search,
                          decoration: const InputDecoration(
                            hintText: 'Search by name, e-mail or phone',
                            prefixIcon: Icon(Icons.search),
                          ),
                        ),
                        const SizedBox(height: AppSpace.md),
                        SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: Row(
                            children: [
                              _buildFilterChip('All', ''),
                              _buildFilterChip('Customers', 'customer'),
                              _buildFilterChip('Store owners', 'store_owner'),
                              _buildFilterChip('Riders', 'rider'),
                              _buildFilterChip('Admins', 'admin'),
                            ],
                          ),
                        ),
                        const SizedBox(height: AppSpace.sm),
                        Align(
                          alignment: AlignmentDirectional.centerStart,
                          child: Text(
                            Fmt.count(_filteredUsers.length, 'user'),
                            style: AppText.small,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Expanded(
                    child: _filteredUsers.isEmpty
                        ? ListView(
                            physics: const AlwaysScrollableScrollPhysics(),
                            children: [
                              EmptyState(
                                compact: true,
                                icon: Icons.people_outline_rounded,
                                title: _users.isEmpty
                                    ? 'No users yet'
                                    : 'No users match',
                              ),
                            ],
                          )
                        : ListView.separated(
                            padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                            physics: const AlwaysScrollableScrollPhysics(),
                            itemCount: _filteredUsers.length,
                            separatorBuilder: (_, _) =>
                                const SizedBox(height: AppSpace.sm + 2),
                            itemBuilder: (context, index) {
                              final user = _filteredUsers[index];
                              return _buildUserCard(user);
                            },
                          ),
                  ),
                ],
              ),
            ),
    );
  }

  Widget _buildFilterChip(String label, String type) {
    final isSelected = _filterType == type;
    return Padding(
      padding: const EdgeInsetsDirectional.only(end: 8.0),
      child: ChoiceChip(
        label: Text(label),
        selected: isSelected,
        onSelected: (selected) {
          setState(() => _filterType = selected ? type : '');
          _filterUsers();
        },
      ),
    );
  }

  Widget _roleChip(String userType) {
    final label = switch (userType) {
      'store_owner' => 'Store owner',
      'standard_user' => 'Staff',
      _ => adminHumanize(userType, fallback: 'User'),
    };
    return switch (userType) {
      'admin' || 'standard_user' => TonePill.success(label),
      'store_owner' => TonePill.info(label),
      'rider' => TonePill.warning(label),
      _ => TonePill.neutral(label),
    };
  }

  Widget _buildUserCard(dynamic user) {
    final userType = (user['user_type'] ?? '').toString();
    final name = '${user['first_name'] ?? ''} ${user['last_name'] ?? ''}'
        .trim();
    final email = (user['email'] ?? '').toString().trim();
    final phone = (user['phone'] ?? '').toString().trim();
    // `/api/users` returns booleans `is_active` / `is_verified` (no
    // `status` field - the old card always printed "active").
    final active = adminFlag(user['is_active'], fallback: true);
    final verified = adminFlag(user['is_verified']);
    final joined = Fmt.date(user['created_at']);

    return AppCard(
      padding: const EdgeInsets.all(AppSpace.md + 2),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      name.isEmpty ? 'Unnamed user' : name,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.title,
                    ),
                    if (email.isNotEmpty)
                      Text(
                        email,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppText.small,
                      ),
                  ],
                ),
              ),
              const SizedBox(width: AppSpace.sm),
              _roleChip(userType),
            ],
          ),
          const SizedBox(height: AppSpace.sm),
          Wrap(
            spacing: AppSpace.sm,
            runSpacing: AppSpace.xs,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (!active) const TonePill.danger('Inactive'),
              if (verified)
                const TonePill.success('Verified')
              else
                const TonePill.neutral('Not verified'),
              if (phone.isNotEmpty)
                Text(
                  phone,
                  style: AppText.small.copyWith(color: AppColors.text),
                ),
              if (joined.isNotEmpty)
                Text('Joined $joined', style: AppText.caption),
            ],
          ),
        ],
      ),
    );
  }
}
